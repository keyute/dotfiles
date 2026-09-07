import { randomUUID } from "node:crypto";
import { Text, isKittyProtocolActive, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// Row contract mirrors ~/.claude/subagent-statusline.js: name › description ·
// <compact> tokens · model, description trimmed first, tail never.
const SEP = " · ";
const NAME_SEP = " › ";
const TOK_FMT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1, minimumFractionDigits: 1 });
export const VISIBLE_ROWS = 5;
// pi-subagents' fleet inspector shortcut (⌃⌥F): legacy ESC+control-char, or
// CSI u with modifier 1+alt(2)+ctrl(4) under the kitty keyboard protocol.
const FLEET_SHORTCUT = () => (isKittyProtocolActive() ? "\x1b[102;7u" : "\x1b\x06");

export function formatTokens(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  return `${TOK_FMT.format(v).toLowerCase().replace(".0", "")} tokens`;
}

export function buildRow({ agent, goal, tokens, model, effort }, width) {
  const modelLabel = model ? (effort ? `${model} ${effort}` : model) : null;
  const description = (goal ?? "").replace(/\s+/g, " ").trim();
  const build = text => [text ? `${agent}${NAME_SEP}${text}` : agent, formatTokens(tokens?.total ?? tokens), modelLabel].filter(Boolean).join(SEP);
  let row = build(description);
  if (width > 0 && row.length > width && description) {
    const room = width - build("").length - NAME_SEP.length;
    row = build(room > 1 ? `${description.slice(0, room - 1)}…` : "");
  }
  return row;
}

export function createFleetState() {
  return { entries: [], totalActive: 0, runs: [], focused: false, cursor: 0 };
}

export function setEntries(state, fleet, snapshot) {
  state.entries = fleet?.entries ?? [];
  state.runs = snapshot?.runs ?? [];
  state.totalActive = Math.max(fleet?.totalActive ?? 0, state.entries.length);
  state.cursor = Math.min(state.cursor, Math.max(0, state.entries.length - 1));
  if (!state.entries.length) state.focused = false;
}

// Navigation is an editor-owned mode: the editor keeps input focus and routes
// keys here; the widget only draws the cursor. Actions: "enter" (editor could
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
// siblings launched in one turn start too close to tell apart, so any
// ambiguity yields null (inspector fallback) rather than a guess.
export function runIdFor(state, entry) {
  const candidates = state.runs.filter(run => run.label === entry?.agent && typeof run.startedAt === "number"
    && typeof entry.startedAt === "number" && Math.abs(run.startedAt - entry.startedAt) <= 30_000);
  return candidates.length === 1 ? candidates[0].id : null;
}

// Claude Code's subagent panel shape: a root row, a window of child rows with
// a selection cursor, and overflow markers instead of an ever-growing list.
export function renderFleet(state, width, theme, { model, effort, hint } = {}) {
  if (!state.entries.length) return [];
  const dim = text => theme.fg("dim", text);
  const root = `  ${theme.fg("accent", "⏺")} main${model ? SEP + (effort ? `${model} ${effort}` : model) : ""}`;
  const hintText = hint ? dim(hint) : "";
  const pad = hintText ? " ".repeat(Math.max(1, width - visibleWidth(root) - visibleWidth(hintText))) : "";
  const lines = [truncateToWidth(root + pad + hintText, width)];
  const start = Math.max(0, state.cursor - (VISIBLE_ROWS - 1));
  const shown = state.entries.slice(start, start + VISIBLE_ROWS);
  if (start > 0) lines.push(dim(`  ↑ ${start} more`));
  shown.forEach((entry, index) => {
    const selected = state.focused && start + index === state.cursor;
    const prefix = selected ? theme.fg("accent", "❯ ") : "  ";
    lines.push(truncateToWidth(`${prefix}${dim("◯")} ${buildRow(entry, width - 4)}`, width));
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

export function installFleet(pi, ctx, { pollMs = 1_000, quietMs = 10_000, timeoutMs = 2_000 } = {}) {
  const state = { ...createFleetState(), lastWake: 0, timer: undefined, polling: false, stopped: false, capable: undefined, tui: null };

  const show = (fleet, snapshot) => {
    const before = JSON.stringify([state.entries, state.totalActive]);
    setEntries(state, fleet, snapshot);
    if (JSON.stringify([state.entries, state.totalActive]) !== before) state.tui?.requestRender();
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
  // The install-time and ready-time polls cover jobs restored with the session.
  pi.on("tool_execution_end", event => { if (event.toolName === "subagent") wake(); });
  pi.events.on("subagents:rpc:v1:ready", wake);
  pi.events.on("subagent:async-started", wake);
  pi.on("session_shutdown", () => {
    state.stopped = true;
    clearTimeout(state.timer);
    show(null);
  });

  ctx.ui.setWidget("workflow-fleet", (tui, theme) => {
    state.tui = tui;
    return {
      invalidate() {},
      render(width) {
        return renderFleet(state, width, theme, { model: ctx.model?.id, effort: ctx.thinkingLevel, hint: "⌃⌥F fleet" });
      },
    };
  }, { placement: "belowEditor" });
  wake();

  // Enter shows the highlighted child's transcript tail (pi-subagents' own
  // status view) in an overlay; without a resolvable run id it falls back to
  // the fleet inspector via the editor's extension-shortcut path.
  const peek = async (entry, editor) => {
    const id = runIdFor(state, entry);
    const reply = id ? await rpcCall(pi.events, "status", { id, view: "transcript", lines: 40 }, timeoutMs) : null;
    if (!reply?.text || !ctx.hasUI) return editor.onExtensionShortcut?.(FLEET_SHORTCUT());
    await ctx.ui.custom((_tui, theme, _keybindings, done) => {
      const body = new Text(`${theme.fg("accent", buildRow(entry, 0))}\n\n${reply.text}\n\n${theme.fg("dim", "esc close · ⌃⌥F fleet")}`, 1, 0);
      return { render: width => body.render(width), invalidate: () => body.invalidate(), handleInput: () => done() };
    }, { overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "80%", margin: 1 } });
  };
  const handleKey = (action, editor) => {
    const consumed = navigate(state, action, entry => { void peek(entry, editor); });
    state.tui?.requestRender();
    return consumed;
  };
  return { wake, handleKey, focused: () => state.focused };
}
