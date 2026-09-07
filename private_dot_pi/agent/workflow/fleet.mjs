import { randomUUID } from "node:crypto";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";

// Rows hang under the status line as Claude Code's subagent statusline does
// (docs/pi-design.md): a `π main` root row, then `⊙ title · tokens · model`
// per child, the cursor row marked `›`. The title is cut at a word boundary.
export const ROOT = "π";
export const CHILD = "⊙";
export const CURSOR = "›";
const SEP = " · ";
const NAME_SEP = " › ";
const TOK_FMT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1, minimumFractionDigits: 1 });
export const VISIBLE_ROWS = 5;
export const TITLE_WIDTH = 36;
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

const oneLine = text => (text ?? "").replace(/\s+/g, " ").trim();

export function shortTitle(text, width = TITLE_WIDTH) {
  const title = oneLine(text);
  if (title.length <= width) return title;
  const cut = title.slice(0, width - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > width / 2 ? cut.slice(0, space) : cut}…`;
}

export function buildRow({ agent, goal, tokens, model, effort }) {
  const total = formatTokens(tokens?.total ?? tokens);
  return [shortTitle(goal) || agent, total && `${total} tokens`, modelLabel(model, effort)].filter(Boolean).join(SEP);
}

export function createFleetState() {
  return { entries: [], totalActive: 0, runs: [], launches: new Map(), focused: false, cursor: 0 };
}

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
  const lines = [`  ${theme.fg("accent", ROOT)} main`];
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
export function installFleet(pi, ctx, { pollMs = 1_000, quietMs = 10_000, timeoutMs = 2_000 } = {}) {
  const state = { ...createFleetState(), pending: new Map(), active: new Set(), lastWake: 0, timer: undefined, polling: false, stopped: false, capable: undefined, tui: null };

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
    if (again) state.timer = setTimeout(poll, pollMs);
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
  pi.events.on("subagent:async-complete", payload => { state.active.delete(payload?.id ?? payload?.runId); wake(); });
  pi.on("session_shutdown", () => {
    state.stopped = true;
    clearTimeout(state.timer);
    show(null);
  });
  wake();

  // Enter shows the highlighted child's transcript tail (pi-subagents' own
  // status view) in an overlay, and says so when there is none yet — Enter is
  // never silent.
  const peek = async entry => {
    const id = runIdFor(state, entry);
    const reply = id ? await rpcCall(pi.events, "status", { id, view: "transcript", lines: 40 }, timeoutMs) : null;
    if (!reply?.text || !ctx.hasUI) return ctx.ui.notify(`No transcript yet for ${entry.agent}`, "info");
    const { agent, goal, model, effort } = rowFor(state, entry);
    const header = [goal ? `${agent}${NAME_SEP}${oneLine(goal)}` : agent, modelLabel(model, effort)].filter(Boolean).join(" · ");
    await ctx.ui.custom((_tui, theme, _keybindings, done) => {
      const body = new Text(`${theme.fg("accent", header)}\n\n${reply.text}\n\n${theme.fg("dim", "esc close")}`, 1, 0);
      return { render: width => body.render(width), invalidate: () => body.invalidate(), handleInput: () => done() };
    }, { overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "80%", margin: 1 } });
  };
  const handleKey = action => {
    const consumed = navigate(state, action, entry => { void peek(entry); });
    state.tui?.requestRender();
    return consumed;
  };
  return {
    wake,
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
