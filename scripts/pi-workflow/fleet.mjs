import { randomUUID } from "node:crypto";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// Row contract mirrors ~/.claude/subagent-statusline.js: name › description ·
// <compact> tokens · model, description trimmed first, tail never.
const SEP = " · ";
const NAME_SEP = " › ";
const TOK_FMT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1, minimumFractionDigits: 1 });

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
  const state = { entries: [], lastWake: 0, timer: undefined, polling: false, stopped: false, capable: undefined, tui: null };

  const show = entries => {
    if (JSON.stringify(entries) === JSON.stringify(state.entries)) return;
    state.entries = entries;
    state.tui?.requestRender();
  };
  const poll = async () => {
    state.timer = undefined;
    try {
      state.capable ??= (await rpcCall(pi.events, "ping", {}, timeoutMs))?.capabilities?.fleetStatus?.version === 1;
      // A dropped or slow reply keeps the last rows; only a reply may clear them.
      const reply = state.capable ? await rpcCall(pi.events, "status", {}, timeoutMs) : null;
      if (reply && !state.stopped) show(reply.fleet?.entries ?? []);
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
    show([]);
  });

  ctx.ui.setWidget("workflow-fleet", (tui, theme) => {
    state.tui = tui;
    const hint = theme.fg("dim", "⌃⌥F fleet");
    return {
      invalidate() {},
      render(width) {
        return state.entries.map((entry, index) => {
          const row = buildRow(entry, index === 0 ? width - visibleWidth(hint) - 1 : width);
          if (index !== 0) return truncateToWidth(row, width);
          const pad = " ".repeat(Math.max(1, width - visibleWidth(row) - visibleWidth(hint)));
          return truncateToWidth(row + pad + hint, width);
        });
      },
    };
  }, { placement: "belowEditor" });
  wake();
  return wake;
}
