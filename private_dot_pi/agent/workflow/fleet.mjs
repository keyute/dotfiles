import { randomUUID } from "node:crypto";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { CHILD, TITLE_WIDTH, appendVisible, completionLine, oneLine, shortTitle } from "./rows.mjs";

// Rows hang under the status line as Claude Code's subagent statusline does
// (docs/pi-design.md): `○ title · tokens · model` per child, the cursor row
// marked `❭`. The title is cut at a word boundary.
export { CHILD, TITLE_WIDTH, shortTitle };
export const CURSOR = "❭";
// Worst child status wins a multi-result completion (single runs carry one).
const STATUS_ORDER = ["failed", "stopped", "paused", "partial", "detached", "completed"];
const SEP = " · ";
const NAME_SEP = " › ";
const TOK_FMT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1, minimumFractionDigits: 1 });
export const VISIBLE_ROWS = 5;
// The fleet DTO's `model` is the launch string (provider/model:thinking) and
// `effort` repeats the thinking level, so the suffix is dropped before the
// effort is appended once — the footer's own spelling.
const EFFORT_SUFFIX = /:(low|medium|high|xhigh|max)$/;

export function formatTokens(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  return TOK_FMT.format(v).toLowerCase().replace(".0", "");
}

export function modelLabel(model, effort) {
  if (!model) return null;
  const id = String(model).split("/").pop().replace(EFFORT_SUFFIX, "");
  return effort ? `${id} ${effort}` : id;
}


export function buildRow({ agent, goal, tokens, model, effort }) {
  const total = formatTokens(tokens?.total ?? tokens);
  const title = shortTitle(goal);
  return [title ? `${agent}${NAME_SEP}${title}` : agent, total && `${total} tokens`, modelLabel(model, effort)].filter(Boolean).join(SEP);
}

export function createFleetState() {
  return { entries: [], totalActive: 0, runs: [], launches: new Map(), focused: false, cursor: 0 };
}

const ACTIVE_RUN_STATES = new Set(["queued", "running"]);

export function setEntries(state, fleet, snapshot) {
  state.entries = fleet?.entries ?? [];
  state.runs = snapshot?.runs ?? [];
  state.totalActive = Math.max(fleet?.totalActive ?? 0, state.entries.length);
  state.cursor = Math.min(state.cursor, Math.max(0, state.entries.length - 1));
  if (!state.entries.length) state.focused = false;
}

// Navigation is an editor-owned mode: the editor keeps input focus and routes
// keys here; the footer only draws the cursor. Actions: "enter" (editor could
// not move down), "down", "up", "confirm", "cancel", "other". Returns true
// when the key was consumed.
export function navigate(state, action, open) {
  if (!state.focused) {
    if (action !== "enter" || !state.entries.length) return false;
    state.focused = true;
    state.cursor = 0;
    return true;
  }
  if (action === "down") { state.cursor = Math.min(state.cursor + 1, state.entries.length - 1); return true; }
  if (action === "up") { if (state.cursor > 0) state.cursor--; else state.focused = false; return true; }
  const selected = state.entries[state.cursor];
  state.focused = false;
  if (action === "confirm") { open?.(selected); return true; }
  return action === "cancel";
}

// Fleet keys are opaque by contract; the async snapshot's run ids are not.
// A row maps to its run by agent label and start time (the row carries the
// child's, the run its job's — the same launch, milliseconds apart). Same-agent
// siblings launched in one turn are paired by rank: pi-subagents orders entries
// by (startedAt, async id) and the runs sort the same way here.
export function runIdFor(state, entry) {
  if (typeof entry?.startedAt !== "number") return null;
  const near = item => typeof item.startedAt === "number" && Math.abs(item.startedAt - entry.startedAt) <= 30_000;
  const candidates = state.runs.filter(run => run.label === entry.agent && near(run))
    .sort((a, b) => a.startedAt - b.startedAt || String(a.id).localeCompare(String(b.id)));
  const siblings = state.entries.filter(other => other.agent === entry.agent && near(other));
  return candidates[siblings.indexOf(entry)]?.id ?? null;
}

// pi-subagents 0.66.0 never fills the DTO's `goal`; the task comes from the
// launch this session recorded against the run id.
export function rowFor(state, entry) {
  return entry.goal ? entry : { ...entry, goal: state.launches.get(runIdFor(state, entry))?.task };
}

// A window of child rows with a selection cursor and overflow markers instead
// of a growing list; queued children render dim.
export function renderFleet(state, width, theme) {
  if (!state.entries.length) return [];
  const dim = text => theme.fg("dim", text);
  const lines = [];
  const start = Math.max(0, state.cursor - (VISIBLE_ROWS - 1));
  const shown = state.entries.slice(start, start + VISIBLE_ROWS);
  if (start > 0) lines.push(dim(`  ↑ ${start} more`));
  shown.forEach((entry, index) => {
    const selected = state.focused && start + index === state.cursor;
    const marker = selected ? theme.fg("accent", CURSOR) : CHILD;
    const row = buildRow(rowFor(state, entry));
    lines.push(truncateToWidth(`  ${marker} ${entry.status === "pending" ? dim(row) : row}`, width));
  });
  const hidden = state.totalActive - (start + shown.length);
  if (hidden > 0) lines.push(dim(`  ↓ ${hidden} more`));
  return lines;
}

// pi-subagents' documented in-process RPC (docs/extension-api.md): the reply
// channel is per request, so the listener is dropped as soon as it answers.
export function rpcCall(events, method, params = {}, timeoutMs = 2_000) {
  return new Promise(resolve => {
    const requestId = randomUUID();
    const done = value => { clearTimeout(timer); off(); resolve(value); };
    const timer = setTimeout(() => done(null), timeoutMs);
    const off = events.on(`subagents:rpc:v1:reply:${requestId}`, reply => done(reply?.success ? reply.data : null));
    events.emit("subagents:rpc:v1:request", { version: 1, requestId, method, params });
  });
}

// The rows render inside the footer (attach/render): pi's dock order is fixed
// with the footer last, so a widget could only sit above the status line.
export function installFleet(pi, ctx, { pollMs = 1_000, quietMs = 10_000, timeoutMs = 2_000, cleanupTimeoutMs = 5_000 } = {}) {
  const state = { ...createFleetState(), pending: new Map(), active: new Set(), lastWake: 0, timer: undefined, polling: false, stopped: false, capable: undefined, tui: null, ctx };

  const shape = () => [state.totalActive, ...state.entries.map(entry => `${entry.agent}|${entry.status}|${entry.goal}|${entry.tokens?.total ?? entry.tokens}`)].join("\n");
  const show = (fleet, snapshot) => {
    const before = shape();
    setEntries(state, fleet, snapshot);
    if (shape() !== before) state.tui?.requestRender();
  };
  const poll = async () => {
    state.timer = undefined;
    try {
      state.capable ??= (await rpcCall(pi.events, "ping", {}, timeoutMs))?.capabilities?.fleetStatus?.version === 1;
      // A dropped or slow reply keeps the last rows; only a reply may clear them.
      const reply = state.capable ? await rpcCall(pi.events, "status", {}, timeoutMs) : null;
      if (reply && !state.stopped) show(reply.fleet, reply.asyncSnapshot);
    } catch { state.capable = false; }
    const again = state.capable && !state.stopped && (state.entries.length || Date.now() - state.lastWake < quietMs);
    if (again) {
      state.timer = setTimeout(poll, pollMs);
      state.timer.unref?.();
    }
    else state.polling = false;
  };
  const wake = () => {
    if (state.stopped) return;
    state.lastWake = Date.now();
    if (state.polling) return;
    state.polling = true;
    void poll();
  };
  // The launch's own events are the only place the task text and the async run
  // id appear together (the DTO redacts one and hides the other).
  pi.on("tool_execution_start", event => {
    if (event.toolName === "subagent" && event.args?.agent) state.pending.set(event.toolCallId, { agent: event.args.agent, task: String(event.args.task ?? "") });
  });
  pi.on("tool_execution_end", event => {
    if (event.toolName !== "subagent") return;
    const launch = state.pending.get(event.toolCallId);
    state.pending.delete(event.toolCallId);
    const id = event.result?.details?.runId ?? event.result?.details?.asyncId;
    if (launch && id) state.launches.set(id, launch);
    wake();
  });
  // The install-time and ready-time polls cover jobs restored with the session.
  // Live children are counted from the launch events themselves: the status
  // poll lags agent_settled, where the footer asks whether a turn is over.
  pi.events.on("subagents:rpc:v1:ready", wake);
  pi.events.on("subagent:async-started", payload => { if (payload?.id) state.active.add(payload.id); wake(); });
  pi.events.on("subagent:process-terminal", proof => {
    if (proof?.state === "observed" && proof?.runId) state.active.delete(proof.runId);
    wake();
  });
  // The completion payload spreads the result file (`success`, `state`,
  // `agent`, `durationMs` from launch to end) plus `runId` and, per result,
  // pi-subagents' resolved `status` (completed, failed, partial, paused,
  // stopped, detached); the task comes from the launch recorded above.
  pi.events.on("subagent:async-complete", payload => {
    const id = payload?.runId ?? payload?.id;
    const launch = state.launches.get(id);
    const statuses = (payload?.results ?? []).map(result => result?.status).filter(Boolean);
    const status = (statuses.length ? STATUS_ORDER.find(s => statuses.includes(s)) ?? statuses[0] : null)
      ?? (payload?.state === "paused" || payload?.state === "stopped" ? payload.state : payload?.success === true ? "completed" : "failed");
    const durationMs = typeof payload?.durationMs === "number" ? payload.durationMs : undefined;
    appendVisible(pi, "workflow-child", { agent: launch?.agent ?? payload?.agent ?? "subagent", task: launch?.task ?? "", status, durationMs });
    wake();
  });
  pi.registerEntryRenderer("workflow-child", (entry, _options, theme) => new Text(completionLine(entry.data, theme), 0, 0));
  pi.on("session_shutdown", () => {
    state.stopped = true;
    clearTimeout(state.timer);
    show(null);
  });
  if (ctx) wake();

  // Stop only current-session top-level async run IDs. The fresh public
  // snapshot supplies restored ownership; launch events cover runs that have
  // not reached that bounded projection yet. Fleet entry keys are display-only
  // and are never treated as control IDs.
  const stopAll = async () => {
    const failures = [];
    const terminal = new Set();
    let wakeSettlement;
    const observe = proof => {
      if (proof?.state !== "observed" || !proof.runId) return;
      terminal.add(proof.runId);
      state.active.delete(proof.runId);
      wakeSettlement?.();
    };
    const offProof = pi.events.on("subagent:process-terminal", observe);
    try {
      const ping = await rpcCall(pi.events, "ping", {}, timeoutMs);
      if (!ping?.capabilities?.stop) failures.push("subagent stop RPC is unavailable");
      const status = await rpcCall(pi.events, "status", {}, timeoutMs);
      const snapshot = status?.asyncSnapshot;
      const validSnapshot = snapshot?.version === 1 && Array.isArray(snapshot.runs);
      if (!validSnapshot) failures.push("fresh async status was unavailable; cleanup of restored work could not be established");
      const ids = new Set(state.active);
      if (validSnapshot) {
        for (const run of snapshot.runs) if (run?.id && ACTIVE_RUN_STATES.has(run.state)) ids.add(run.id);
      }
      const ordered = [...ids].sort();
      const stops = new Map(await Promise.all(ordered.map(async id => [id, await rpcCall(pi.events, "stop", { id }, timeoutMs)])));
      const inspect = () => Promise.all(ordered.filter(id => !terminal.has(id)).map(async id => {
        const reply = await rpcCall(pi.events, "status", { id }, timeoutMs);
        const proof = reply?.details?.lifecycleStatus?.processTerminal;
        if (proof?.runId === id) observe(proof);
      }));
      await inspect();
      if (!ordered.every(id => terminal.has(id))) {
        await new Promise(resolve => {
          const timer = setTimeout(resolve, cleanupTimeoutMs);
          wakeSettlement = () => {
            if (!ordered.every(id => terminal.has(id))) return;
            clearTimeout(timer);
            resolve();
          };
        });
        await inspect();
      }
      for (const id of ordered) {
        // A natural exit can beat stop's state check. Its observed close is
        // sufficient; neither a stop acknowledgment nor completion is.
        if (terminal.has(id)) continue;
        const reply = stops.get(id);
        failures.push(`${id}: ${reply?.runId === id && reply.state === "stopping" ? "terminal state was not established" : "stop request failed; terminal state was not established"}`);
      }
      if (validSnapshot && snapshot.omitted?.runs > 0) {
        // The snapshot caps history, not active runs. Historical omissions
        // alone are harmless; any remaining active work is not accounted for.
        const remaining = await rpcCall(pi.events, "status", {}, timeoutMs);
        if (remaining?.fleet?.totalActive !== 0) failures.push(`async status snapshot omitted ${snapshot.omitted.runs} runs; cleanup of omitted or restored work could not be established`);
      }
    } finally {
      offProof?.();
    }
    if (failures.length) throw new Error(`Subagent cleanup failed: ${failures.join("; ")}`);
  };

  // Enter shows the highlighted child's transcript tail (pi-subagents' own
  // status view) in an overlay, and says so when there is none yet — Enter is
  // never silent.
  const peek = async entry => {
    const current = state.ctx;
    if (!current) return;
    const id = runIdFor(state, entry);
    const reply = id ? await rpcCall(pi.events, "status", { id, view: "transcript", lines: 40 }, timeoutMs) : null;
    if (!reply?.text || !current.hasUI) return current.ui.notify(`No transcript yet for ${entry.agent}`, "info");
    const { agent, goal, model, effort } = rowFor(state, entry);
    const header = [goal ? `${agent}${NAME_SEP}${oneLine(goal)}` : agent, modelLabel(model, effort)].filter(Boolean).join(" · ");
    await current.ui.custom((_tui, theme, _keybindings, done) => {
      const body = new Text(`${theme.fg("accent", header)}\n\n${reply.text}\n\n${theme.fg("dim", "esc close")}`, 1, 0);
      return { render: width => body.render(width), invalidate: () => body.invalidate(), handleInput: () => done() };
    }, { overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "80%", margin: 1 } });
  };
  const handleKey = action => {
    const consumed = navigate(state, action, entry => { void peek(entry); });
    state.tui?.requestRender();
    return consumed;
  };
  let stopping;
  return {
    wake,
    stopAll: () => stopping ??= stopAll().finally(() => { stopping = undefined; }),
    attachContext: current => { state.ctx = current; state.stopped = false; wake(); },
    handleKey,
    // Runs restored with the session never emit async-started; the poll's
    // count covers them (it lags a completion by one poll, so the event set
    // is the fast path).
    activeCount: () => Math.max(state.active.size, state.totalActive),
    focused: () => state.focused,
    attach: tui => { state.tui = tui; },
    render: (width, theme) => renderFleet(state, width, theme),
  };
}
