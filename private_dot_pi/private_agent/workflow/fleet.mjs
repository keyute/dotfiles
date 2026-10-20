import { randomUUID } from "node:crypto";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { closeView, openView } from "./dialog.mjs";
import { CHILD, CURSOR, alignRight, appendVisible, defaultFolds, doneEntryRenderer, frameRule, oneLine, shortTitle, slotHeight } from "./rows.mjs";

// The row format is docs/pi-design.md rule 6.
// Worst child status wins a multi-result completion (single runs carry one).
const STATUS_ORDER = ["failed", "stopped", "paused", "partial", "detached", "completed"];
const SEP = " · ";
const NAME_SEP = " › ";
const TOK_FMT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1, minimumFractionDigits: 1 });
const VISIBLE_ROWS = 5;
// The fleet DTO's `model` is the launch string (provider/model:thinking) until
// the child's first reply, then the model replies came from; the thinking
// suffix is dropped, since a child's level is its role's.
const EFFORT_SUFFIX = /:([a-z]+)$/;

export function formatTokens(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  return TOK_FMT.format(v).toLowerCase().replace(".0", "");
}

export function modelLabel(model) {
  if (!model) return null;
  return String(model).split("/").pop().replace(EFFORT_SUFFIX, "");
}


export function buildRow({ agent, goal, tokens, model }) {
  const total = formatTokens(tokens?.total ?? tokens);
  const title = shortTitle(goal);
  return [title ? `${agent}${NAME_SEP}${title}` : agent, total && `${total} tokens`, modelLabel(model)].filter(Boolean).join(SEP);
}

export function createFleetState() {
  return { entries: [], totalActive: 0, runs: [], groups: [], bindings: new Map(), launches: new Map(), focused: false, cursor: 0 };
}

const RUNNING_RECORD = new Set(["launching", "running"]);

// A live workflow's children fold into its one overview row (rule 6): a row
// whose bound run id belongs to a tracked group's records is hidden.
export function fleetRows(state) {
  if (!state.groups.length) return state.entries;
  const owned = new Set(state.groups.flatMap(group => group.records.map(record => record.runId)).filter(Boolean));
  return [...state.groups, ...state.entries.filter(entry => !owned.has(runIdFor(state, entry)))];
}

// `stopped` and `unknown` count with failed; the phase is the latest live
// launch's, else the last launch's.
export function groupRow({ title, records }) {
  const running = records.filter(record => RUNNING_RECORD.has(record.status)).length;
  const done = records.filter(record => record.status === "completed").length;
  const failed = records.length - running - done;
  const phase = (records.findLast(record => RUNNING_RECORD.has(record.status)) ?? records.at(-1))?.phase;
  const name = title ? `workflow${NAME_SEP}${shortTitle(title)}` : "workflow";
  return [name, phase, `${running} running`, `${done} done`, failed && `${failed} failed`].filter(Boolean).join(SEP);
}

function clamp(state) {
  const count = fleetRows(state).length;
  state.cursor = Math.min(state.cursor, Math.max(0, count - 1));
  if (!count) state.focused = false;
}

const ACTIVE_RUN_STATES = new Set(["queued", "running"]);

export function setEntries(state, fleet, snapshot) {
  state.entries = fleet?.entries ?? [];
  state.runs = snapshot?.runs ?? [];
  const keys = new Set(state.entries.map(entry => entry.key).filter(key => key != null));
  for (const key of state.bindings.keys()) if (!keys.has(key)) state.bindings.delete(key);
  state.totalActive = Math.max(fleet?.totalActive ?? 0, state.entries.length);
  clamp(state);
}

// Navigation is an editor-owned mode: the editor keeps input focus and routes
// keys here; the footer only draws the cursor. Actions: "enter" (editor could
// not move down), "down", "up", "confirm", "cancel", "other". Returns true
// when the key was consumed.
export function navigate(state, action, open) {
  const rows = fleetRows(state);
  if (!state.focused) {
    if (action !== "enter" || !rows.length) return false;
    state.focused = true;
    state.cursor = 0;
    return true;
  }
  if (action === "down") { state.cursor = Math.min(state.cursor + 1, rows.length - 1); return true; }
  if (action === "up") { if (state.cursor > 0) state.cursor--; else state.focused = false; return true; }
  const selected = rows[state.cursor];
  state.focused = false;
  // Confirm hands the row to the caller's open callback and leaves focus
  // cleared; the caller restores focus and the cursor once its peek settles,
  // so Down/Up resume from the peeked row without pressing Enter again.
  if (action === "confirm") { open?.(selected); return true; }
  return action === "cancel";
}

// Fleet keys are opaque display identities, not run ids. A successful match
// stays bound until its row disappears; a missing bound run cannot become a
// different sibling while its key remains visible.
// pi-subagents' fleet DTO omits run ids by design, so nothing upstream retires this match.
export function runIdFor(state, entry) {
  if (entry?.key != null && state.bindings.has(entry.key)) {
    const id = state.bindings.get(entry.key);
    return state.runs.some(run => run.id === id && ACTIVE_RUN_STATES.has(run.state)) ? id : null;
  }
  if (typeof entry?.startedAt !== "number") return null;
  if (state.entries.filter(other => other.agent === entry.agent && other.startedAt === entry.startedAt).length !== 1) return null;
  const matches = state.runs.filter(run => {
    if (!run.id || run.label !== entry.agent || !ACTIVE_RUN_STATES.has(run.state)) return false;
    const steps = run.children?.filter(child => child.kind === "step") ?? [];
    if (steps.length) return steps.some(step => ACTIVE_RUN_STATES.has(step.state)
      && step.label === entry.agent && (step.startedAt ?? run.startedAt) === entry.startedAt);
    return run.label === entry.agent && run.startedAt === entry.startedAt;
  });
  if (matches.length !== 1) return null;
  const id = matches[0].id;
  if (entry.key != null) state.bindings.set(entry.key, id);
  return id;
}

// A restored or resumed session never replays this process's own
// tool_execution_start/end events, so state.launches is rebuilt from the
// session branch (docs/extensions.md, docs/session-format.md): assistant
// toolCall parts pair with a later toolResult by toolCallId, and the
// result's own details carry the run id and asyncDir the peek needs.
export function launchesFromBranch(entries) {
  const calls = new Map();
  for (const entry of entries ?? []) {
    for (const part of entry?.message?.content ?? []) {
      if (part?.type === "toolCall" && part.name === "subagent" && part.id) {
        calls.set(part.id, { agent: part.arguments?.agent, task: String(part.arguments?.title || part.arguments?.task || "") });
      }
    }
  }
  const launches = new Map();
  for (const entry of entries ?? []) {
    const message = entry?.message;
    if (message?.role !== "toolResult" || message.toolName !== "subagent") continue;
    const details = message.details;
    const id = details?.runId ?? details?.asyncId;
    if (!id || typeof details?.asyncDir !== "string") continue;
    const call = calls.get(message.toolCallId) ?? {};
    launches.set(id, { agent: call.agent, task: call.task ?? "", asyncDir: details.asyncDir });
  }
  for (const entry of entries ?? []) {
    const message = entry?.message;
    if (message?.role !== "toolResult" || message.toolName !== "orchestrate" || !Array.isArray(message.details?.runs)) continue;
    for (const run of message.details.runs) {
      if (run?.runId && typeof run.asyncDir === "string") launches.set(run.runId, { agent: run.agent, task: run.task ?? "", asyncDir: run.asyncDir });
    }
  }
  return launches;
}

// pi-subagents never fills the DTO's `goal`; the task comes from the
// launch this session recorded against the run id.
function rowFor(state, entry) {
  return entry.goal ? entry : { ...entry, goal: state.launches.get(runIdFor(state, entry))?.task };
}

// A window of child rows with a selection cursor and overflow markers instead
// of a growing list; queued children render dim.
export function renderFleet(state, width, theme) {
  const rows = fleetRows(state);
  if (!rows.length) return [];
  const dim = text => theme.fg("dim", text);
  const lines = [];
  const start = Math.max(0, state.cursor - (VISIBLE_ROWS - 1));
  const shown = rows.slice(start, start + VISIBLE_ROWS);
  if (start > 0) lines.push(dim(`  ↑ ${start} more`));
  shown.forEach((entry, index) => {
    const selected = state.focused && start + index === state.cursor;
    const marker = selected ? theme.fg("accent", CURSOR) : CHILD;
    const group = state.groups.includes(entry);
    const row = group ? groupRow(entry) : buildRow(rowFor(state, entry));
    lines.push(truncateToWidth(`  ${marker} ${entry.status === "pending" ? dim(row) : row}`, width));
  });
  // The active count less the folded children, plus one per group.
  const folded = state.entries.length - (rows.length - state.groups.length);
  const hidden = state.totalActive - folded + state.groups.length - (start + shown.length);
  if (hidden > 0) lines.push(dim(`  ↓ ${hidden} more`));
  return lines;
}

export function completionStatus(payload) {
  const statuses = (payload?.results ?? []).map(result => result?.status).filter(Boolean);
  return (statuses.length ? STATUS_ORDER.find(s => statuses.includes(s)) ?? statuses[0] : null)
    ?? (payload?.state === "paused" || payload?.state === "stopped" ? payload.state : payload?.success === true ? "completed" : "failed");
}

// pi-subagents' documented in-process RPC (docs/extension-api.md): the reply
// channel is per request, so the listener is dropped as soon as it answers.
// A spawn runs as tool call "rpc-spawn-<requestId>", so a caller that supplies
// the id can recover a lost reply by status. `raw` resolves the whole reply
// (success, data or error) instead of folding an error reply into null, for a
// caller that must tell a refused launch from a lost one.
export function rpcCall(events, method, params = {}, timeoutMs = 2_000, requestId = randomUUID(), raw = false) {
  return new Promise(resolve => {
    const done = value => { clearTimeout(timer); off(); resolve(value); };
    const timer = setTimeout(() => done(null), timeoutMs);
    const off = events.on(`subagents:rpc:v1:reply:${requestId}`, reply => done(raw ? reply ?? null : reply?.success ? reply.data : null));
    events.emit("subagents:rpc:v1:request", { version: 1, requestId, method, params });
  });
}

// The rows render inside the footer (attach/render): pi's dock order is fixed
// with the footer last, so a widget could only sit above the status line.
export function installFleet(pi, ctx, {
  pollMs = 1_000, quietMs = 10_000, timeoutMs = 2_000, cleanupTimeoutMs = 5_000, owedMs = 10_000, folds = defaultFolds,
  openPeek = async (ctx, opts) => {
    const { openPeek: open } = await import("./peek.mjs");
    // A slot dialog can close the peek during this import; an aborted signal
    // must not mount one (Dialog finishes in its constructor, into pi's slot).
    if (opts.signal?.aborted) return;
    return open(ctx, opts);
  },
  openWorkflowView = async (ctx, opts) => {
    const { openWorkflowView: open } = await import("./workflow-view.mjs");
    if (opts.signal?.aborted) return;
    return open(ctx, opts);
  },
} = {}) {
  const state = { ...createFleetState(), pending: new Map(), active: new Set(), owed: new Map(), lastWake: 0, timer: undefined, polling: false, stopped: false, capable: undefined, tui: null, ctx };
  const listeners = new Set();
  // A stopped fleet's listeners belong to a torn-down session.
  const changed = () => { if (!state.stopped) for (const listener of listeners) listener(); };

  // Must key every rendered segment, or the no-change check below freezes it.
  const shape = () => [state.totalActive, ...state.entries.map(entry => `${entry.agent}|${entry.status}|${entry.goal}|${entry.tokens?.total ?? entry.tokens}`)].join("\n");
  const show = (fleet, snapshot) => {
    const before = shape();
    const total = state.totalActive;
    setEntries(state, fleet, snapshot);
    if (shape() !== before) state.tui?.requestRender();
    if (state.totalActive !== total) changed();
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
  // id appear together (the DTO redacts one and hides the other); the same
  // result also carries the run's artifact directory (`asyncDir`), the peek's
  // way into its events.jsonl.
  pi.on("tool_execution_start", event => {
    if (event.toolName === "subagent" && event.args?.agent) state.pending.set(event.toolCallId, { agent: event.args.agent, task: String(event.args.title || event.args.task || "") });
  });
  pi.on("tool_execution_end", event => {
    if (event.toolName !== "subagent") return;
    const launch = state.pending.get(event.toolCallId);
    state.pending.delete(event.toolCallId);
    const id = event.result?.details?.runId ?? event.result?.details?.asyncId;
    if (launch && id) state.launches.set(id, { ...launch, asyncDir: event.result?.details?.asyncDir });
    wake();
  });
  // The install-time and ready-time polls cover jobs restored with the session.
  // Live children are counted from the launch events themselves: the status
  // poll lags agent_settled, where the footer asks whether a turn is over.
  pi.events.on("subagents:rpc:v1:ready", wake);
  // A child is also owed from launch until its completion line: pi-subagents
  // emits async-complete only once the wake has reached pi (the run is active
  // by then), and the process can exit well before that. A completion that
  // never comes stops being owed a while after the exit.
  pi.events.on("subagent:async-started", payload => {
    if (payload?.id) { state.active.add(payload.id); state.owed.set(payload.id, undefined); }
    wake();
    changed();
  });
  pi.events.on("subagent:process-terminal", proof => {
    if (proof?.state === "observed" && proof?.runId) {
      state.active.delete(proof.runId);
      if (state.stopped) state.owed.delete(proof.runId);
      else if (state.owed.has(proof.runId) && !state.owed.get(proof.runId)) {
        const timer = setTimeout(() => { state.owed.delete(proof.runId); changed(); }, owedMs);
        timer.unref?.();
        state.owed.set(proof.runId, timer);
      }
    }
    wake();
    changed();
  });
  // The completion payload spreads the result file (`success`, `state`,
  // `agent`, `durationMs` from launch to end) plus `runId` and, per result,
  // pi-subagents' resolved `status` (completed, failed, partial, paused,
  // stopped, detached); the task comes from the launch recorded above.
  pi.events.on("subagent:async-complete", payload => {
    const id = payload?.runId ?? payload?.id;
    const launch = state.launches.get(id);
    const status = completionStatus(payload);
    const durationMs = typeof payload?.durationMs === "number" ? payload.durationMs : undefined;
    appendVisible(pi, "workflow-child", { agent: launch?.agent ?? payload?.agent ?? "subagent", task: launch?.task ?? "", status, durationMs }, folds);
    clearTimeout(state.owed.get(id));
    state.owed.delete(id);
    wake();
    changed();
  });
  pi.registerEntryRenderer("workflow-child", doneEntryRenderer("workflow-child", folds));
  pi.on("session_shutdown", () => {
    state.stopped = true;
    clearTimeout(state.timer);
    // An expiry firing after teardown would reach the old session's listeners.
    for (const [id, timer] of state.owed) if (timer) { clearTimeout(timer); state.owed.delete(id); }
    closeView();
    show(null);
    state.bindings.clear();
  });
  if (ctx) wake();

  // Proof is collected from subscription on, so a caller that subscribes
  // before its own RPCs keeps a proof that lands before the stops.
  const watchTerminal = () => {
    const watch = { terminal: new Set(), wakeSettlement: undefined };
    watch.observe = proof => {
      if (proof?.state !== "observed" || !proof.runId) return;
      watch.terminal.add(proof.runId);
      state.active.delete(proof.runId);
      watch.wakeSettlement?.();
    };
    watch.off = pi.events.on("subagent:process-terminal", watch.observe);
    return watch;
  };
  const stopWatched = async (ordered, watch) => {
    const { terminal, observe } = watch;
    const failures = [];
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
        watch.wakeSettlement = () => {
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
    return failures;
  };
  // Stops the given run ids and resolves to the failures; never rejects.
  const stopRuns = async ids => {
    const watch = watchTerminal();
    try {
      return await stopWatched([...ids], watch);
    } catch (error) {
      return [String(error?.message ?? error)];
    } finally {
      watch.off?.();
    }
  };

  // Stop only current-session top-level async run IDs. The fresh public
  // snapshot supplies restored ownership; launch events cover runs that have
  // not reached that bounded projection yet. Fleet entry keys are display-only
  // and are never treated as control IDs.
  const stopAll = async () => {
    const failures = [];
    const watch = watchTerminal();
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
      failures.push(...await stopWatched(ordered, watch));
      if (validSnapshot && snapshot.omitted?.runs > 0) {
        // The snapshot caps history, not active runs. Historical omissions
        // alone are harmless; any remaining active work is not accounted for.
        const remaining = await rpcCall(pi.events, "status", {}, timeoutMs);
        if (remaining?.fleet?.totalActive !== 0) failures.push(`async status snapshot omitted ${snapshot.omitted.runs} runs; cleanup of omitted or restored work could not be established`);
      }
    } finally {
      watch.off?.();
    }
    if (failures.length) throw new Error(`Subagent cleanup failed: ${failures.join("; ")}`);
  };

  // The peek's live facts for a run id, re-read from the current poll every
  // time the caller asks (the dialog's own clock is this fleet's poll).
  const describe = id => {
    const entry = state.entries.find(candidate => runIdFor(state, candidate) === id);
    const run = state.runs.find(item => item.id === id);
    const launch = state.launches.get(id);
    return {
      agent: entry?.agent ?? launch?.agent,
      task: launch?.task,
      model: entry?.model,
      tokens: entry?.tokens,
      startedAt: entry?.startedAt,
      state: run?.state,
      // A run absent from the snapshot (evicted, or never seen) is terminal.
      terminal: !run || !ACTIVE_RUN_STATES.has(run.state),
    };
  };
  // Enter peeks the highlighted child: a live rule-11 dialog in the composer's
  // slot over its events.jsonl when this process saw the launch (`asyncDir`
  // came back with it) and pi is rendering a TUI, otherwise pi-subagents' own
  // transcript tail in the same slot — and says so when there is none yet,
  // Enter is never silent. Resolves to whether closeView ended it.
  // `row` names the text tail's header: { agent, goal, model }.
  const showPeek = async (current, id, asyncDir, row, signal) => {
    if (current.mode === "tui" && asyncDir) {
      await openPeek(current, { id, asyncDir, describe: () => describe(id), events: pi.events, rpcCall, timeoutMs, signal });
      return signal.aborted;
    }
    // The status reply can take timeoutMs; a closed peek must not hold up the dialog taking the slot.
    const reply = id ? await Promise.race([
      rpcCall(pi.events, "status", { id, view: "transcript", lines: 40 }, timeoutMs),
      new Promise(resolve => signal.addEventListener("abort", resolve, { once: true })),
    ]) : null;
    if (signal.aborted) return true;
    const { agent, goal, model } = row();
    if (!reply?.text || !current.hasUI) { current.ui.notify(`No transcript yet for ${agent}`, "info"); return false; }
    const header = [goal ? `${agent}${NAME_SEP}${oneLine(goal)}` : agent, modelLabel(model)].filter(Boolean).join(" · ");
    await current.ui.custom((tui, theme, _keybindings, done) => {
      signal.addEventListener("abort", () => done(), { once: true });
      const body = new Text(reply.text, 2, 0);
      return {
        // The live peek's frame and height (rules 11 and 6): the tail is cut
        // to fit, since pi's dock clips an oversized slot from the bottom,
        // rule first.
        render: width => {
          const height = slotHeight(tui.terminal?.rows ?? 24);
          const rule = frameRule(theme, width);
          const tail = body.render(width).slice(-(height - 5));
          return [rule, `  ${alignRight(theme.fg("accent", header), theme.fg("dim", "esc back"), width - 2)}`, "", ...tail, "", rule].map(line => truncateToWidth(line, width, ""));
        },
        invalidate: () => body.invalidate(),
        handleInput: () => done(),
      };
    });
    return signal.aborted;
  };
  const peek = async entry => {
    const current = state.ctx;
    if (!current) return false;
    const id = runIdFor(state, entry);
    const launch = id ? state.launches.get(id) : undefined;
    // Fleet keys still reach the editor while a peek awaits its import or RPC;
    // opening a view ends the first, so a second Enter cannot mount it later unowned.
    return openView(signal => showPeek(current, id, launch?.asyncDir, () => rowFor(state, entry), signal));
  };
  // Enter on a workflow row opens its view; a pick there peeks the record by
  // its own run id and asyncDir (runIdFor knows active runs only, so a
  // finished child stays peekable). Esc-back without a dialog stack: the view
  // and its peek take turns in this one mount, and Esc in the view ends it.
  const workflow = group => {
    const current = state.ctx;
    if (!current) return false;
    return openView(async signal => {
      let selected;
      while (!signal.aborted) {
        selected = await openWorkflowView(current, { group, signal, selected });
        if (!selected || signal.aborted) break;
        await showPeek(current, selected.runId, selected.asyncDir, () => ({ agent: selected.agent, goal: selected.task }), signal);
      }
      return signal.aborted;
    });
  };
  const handleKey = action => {
    const consumed = navigate(state, action, entry => {
      // navigate() cleared focus for this callback; restore it and the
      // cursor to the peeked row once the peek settles, so Down/Up resume
      // without another Enter. The row is found again by the DTO's opaque
      // key (a sibling can land above it while the peek is open), the saved
      // index clamped to the panel is the fallback. A peek that closeView
      // ended leaves focus alone: another dialog holds the slot, and the
      // fleet's ❭ under it would be a second cursor.
      // A group row is found again by identity.
      const group = state.groups.includes(entry);
      const { key } = entry;
      const index = state.cursor;
      void (group ? workflow(entry) : peek(entry)).catch(error => state.ctx?.ui?.notify?.(String(error?.message ?? error), "error")).then(aborted => {
        if (aborted) return;
        const rows = fleetRows(state);
        state.focused = rows.length > 0;
        const at = group ? rows.indexOf(entry) : key === undefined ? -1 : rows.findIndex(candidate => candidate.key === key);
        state.cursor = at >= 0 ? at : Math.min(index, Math.max(0, rows.length - 1));
        state.tui?.requestRender();
      });
    });
    state.tui?.requestRender();
    return consumed;
  };
  let stopping;
  return {
    wake,
    stopAll: () => stopping ??= stopAll().finally(() => { stopping = undefined; }),
    stopRuns,
    // A launch an extension made over RPC never passes the subagent tool's
    // execution events, so its row title and peek asyncDir are recorded here.
    adopt: (id, { agent, task, asyncDir }) => { state.launches.set(id, { agent, task, asyncDir }); },
    // A blocking workflow's overview row, live until end(). `records` is the
    // run's own array, mutated in place; the caller calls changed() after
    // each status change. The workflow view holds the group after end().
    track: ({ title, records }) => {
      const listeners = new Set();
      const group = {
        title, records, startedAt: Date.now(), endedAt: undefined,
        onChange: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        changed: () => {
          clamp(state);
          state.tui?.requestRender();
          for (const listener of listeners) listener();
        },
        end: () => {
          group.endedAt = Date.now();
          state.groups = state.groups.filter(other => other !== group);
          group.changed();
        },
      };
      state.groups.push(group);
      group.changed();
      return group;
    },
    attachContext: current => {
      closeView(); state.bindings.clear(); state.ctx = current; state.stopped = false;
      // A live launch recorded from this process's own events wins over the
      // branch's replay of the same run.
      for (const [id, launch] of launchesFromBranch(current?.sessionManager?.getBranch?.())) {
        if (!state.launches.has(id)) state.launches.set(id, launch);
      }
      wake();
      changed();
    },
    handleKey,
    // Runs restored with the session never emit async-started; the poll's
    // count covers them (it lags a completion by one poll, so the event set
    // is the fast path).
    activeCount: () => Math.max(new Set([...state.active, ...state.owed.keys()]).size, state.totalActive),
    // Fires whenever activeCount may have changed.
    onChange: listener => { listeners.add(listener); },
    focused: () => state.focused,
    attach: tui => { state.tui = tui; },
    render: (width, theme) => renderFleet(state, width, theme),
  };
}
