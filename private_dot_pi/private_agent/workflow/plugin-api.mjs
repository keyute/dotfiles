import { Text } from "@earendil-works/pi-tui";
import { PAD, appendVisible, closeFolds, completionLine, defaultFolds, noteLine, noticeLine } from "./rows.mjs";
import { runnerPath } from "./operations.mjs";
import { mayReachServer } from "./policy.mjs";

// pi's MCP extension config for the servers a role may reach: all at the root,
// for a child those its roster names a tool of. The runner takes the broker
// socket and token from the inherited process environment, never from here.
// A child's allowlist is its filter, so its servers are direct; the root, as
// on Claude, loads every server's tools through tool_search.
export const mcpConfig = (config, role) => ({
  servers: Object.entries(config.mcp).filter(([name]) => mayReachServer(config, role, name)).map(([name, { policy }]) => {
    const toolExposure = {};
    for (const tool of policy.denied_tools) toolExposure[tool] = "hidden";
    return { name, source: runnerPath, scope: "extension", config: {
      command: process.execPath, args: [runnerPath, "server", name], env: { PI_WORKFLOW_ROLE: role },
      exposure: role === "root" ? "deferred" : "direct", toolExposure,
    } };
  }),
  errors: [],
});

// pi-subagents' control notice: a message whose content is the model's
// instructions (run id, four subagent({…}) calls) and whose own renderer draws
// all of it in a box. The content is left alone — the model acts on it — and
// only the row is ours. A payload missing the fields the row needs is the
// plugin's to draw, so the guard is total and never throws.
export const CONTROL_NOTICE = "subagent_control_notice";
// pi-subagents' completion notice: real model context (it can trigger the next
// turn), but its box duplicates the completion line the fleet already draws
// from the same completion — and its collapsed preview's first line is the
// bare agent name, so the visible box said nothing. pi draws a custom message
// only when `display` is truthy, so the wrapper sends it quiet; the content,
// session-file path included, still reaches the model.
const SUBAGENT_NOTIFY = "subagent-notify";
export const controlNotice = (message, _options, theme) => {
  const event = message?.details?.event;
  if (!event?.agent || !event.message) return undefined;
  return new Text(noticeLine({ agent: event.agent, message: event.message }, theme), 0, 0);
};

// pi-subagents draws each of these notices as its shaded `[subagent]` block
// (rule 9). Ours, composed over it, takes the transcript's shape — a rule 4
// status line or a π line, the rest two in — and answers undefined for a
// payload it does not recognise, leaving the plugin's block as the fallback.
// The settle reminders arrive as entries pi-subagents returns from
// agent_before_settle, outside sendMessage, so they close no group.
const WATCHDOG_CLARIFICATION = "subagent_watchdog_clarification";
const STEERING_NOTICE = "subagent_steering_notice";
const COMPLETION_UNANSWERED = "subagent-completion-unanswered";
const COMPLETION_UNHANDLED = "subagent-completion-unhandled";
const STEERING_STATES = new Set(["failed", "partial", "recovered"]);
export const QUIET_MESSAGES = {
  [SUBAGENT_NOTIFY]: () => true,
};
const textOf = content => typeof content === "string" ? content
  : Array.isArray(content) ? content.filter(part => part?.type === "text").map(part => part.text).join("\n") : "";
const notice = (head, rest, theme) => new Text([head, ...rest.filter(line => line.trim()).map(line => `${PAD}${theme.fg("muted", line)}`)].join("\n"), 0, 0);
export const NOTICE_RENDERERS = {
  [WATCHDOG_CLARIFICATION]: (message, _options, theme) => {
    const [first, ...rest] = textOf(message?.content).trim().split("\n");
    return first ? notice(noteLine(first, theme), rest, theme) : undefined;
  },
  [STEERING_NOTICE]: (message, _options, theme) => {
    const { state, runId } = message?.details ?? {};
    if (!STEERING_STATES.has(state) || typeof runId !== "string") return undefined;
    return notice(completionLine({ agent: `steering for ${runId}`, status: state }, theme), textOf(message.content).split("\n"), theme);
  },
  ...Object.fromEntries([[COMPLETION_UNANSWERED, "unanswered"], [COMPLETION_UNHANDLED, "unhandled"]].map(([type, status]) => [type, (message, _options, theme) => {
    const text = textOf(message?.content).trim();
    return text ? notice(noteLine(`Completion results ${status}`, theme), text.split("\n"), theme) : undefined;
  }])),
};

// Entries pi-subagents appends straight to the session, outside the agent
// stream, of the types its entry renderer draws (tui/subagent-messages.js
// ENTRY_VIEWS); it draws every payload, a fallback headline for one it does
// not recognise, so any entry of these types ends the group above it.
export const DRAWN_ENTRIES = new Set(["subagent_watchdog_warning", "subagent_supervisor_reply"]);

// Plugins register their tools and their custom message renderers through the
// API they are handed and pi keeps what they pass. Every tool name registered
// here is recorded in pluginTools, for the registerToolRenderer resolver that
// gives those rows the transcript's shape. The subagent schema and description
// are replaced by the managed launch/control surface; executors are kept. Each
// MCP tool's server and tool name are recorded in mcpTools from its
// `<server>/<tool>` label, since its name may be sanitised or hash-shortened.
// A message renderer we own is composed over the plugin's, which stays as the
// fallback: ours answers undefined for a payload it does not recognise, so a
// plugin that changes its details shape renders its own way again rather than
// losing its notice. A message whose
// quietMessages check holds is sent with display off — in the session and the
// model's context, never drawn. Everything else
// (events included) is the original, and the raw function is called on the raw
// API because a plugin may extract it.
//
// A displayed message or drawn entry pi appends outside the agent stream never
// reaches the extension's message_end (`_appendCustomMessage` emits only to
// pi's own listeners), so it ends the group here, mirroring sendCustomMessage's
// branches: an idle send without a turn appends synchronously, so the group
// closes just before it; a streaming send with triggerTurn false is flushed
// after the turn_end handlers or at run end, so the group closes at the first
// event after that flush. Every other branch draws through the agent stream.
//
// Wholly owned completions have already reached their workflow. Native delivery
// records wake bookkeeping and reserves an idle wake before calling us. Capture
// the pre-reservation value through its bound context, and clean up after
// native's own post-send splice (removing early would make it splice(-1)).
export function pluginApi(pi, messageRenderers = {}, quietMessages = {}, subagentSchema, isShuttingDown = () => false, subagentDescription, mcpTools = new Map(), pluginTools = new Set(), isIdle = () => true, folds = defaultFolds, claimRuns = () => false, getSession = () => undefined) {
  let snapshot;
  const reservationsSymbol = Symbol.for("pi.idle-wake.v1");
  const queuedWakesSymbol = Symbol.for("pi-subagents.queued-completion-wakes.v2");
  let deferred = 0;
  const drain = () => {
    if (!deferred) return;
    deferred = 0;
    closeFolds(folds);
  };
  for (const event of ["turn_start", "agent_end", "agent_settled"]) pi.on(event, drain);
  return new Proxy(pi, {
    get(target, key, receiver) {
      if (key === "on") return (event, handler) => target.on.call(receiver, event, event === "session_start"
        ? (event, ctx) => handler(event, new Proxy(ctx, {
          get(context, key, receiver) {
            if (key !== "isIdle") return Reflect.get(context, key, receiver);
            return () => {
              const idle = context.isIdle();
              const manager = context.sessionManager;
              const reservations = globalThis[reservationsSymbol];
              const prior = reservations instanceof WeakMap ? reservations.get(manager) : undefined;
              const queued = globalThis[queuedWakesSymbol];
              const state = queued instanceof WeakMap ? queued.get(manager) : undefined;
              const token = { manager, sessionId: manager.getSessionId(), reservations, prior, sentAt: prior?.sentAt, queued, state, idle };
              snapshot = token;
              queueMicrotask(() => { if (snapshot === token) snapshot = undefined; });
              return idle;
            };
          },
        })) : handler);
      if (key === "registerTool") return tool => {
        const split = tool.name.startsWith("mcp__") ? tool.label?.indexOf("/") ?? -1 : -1;
        if (split > 0) mcpTools.set(tool.name, { server: tool.label.slice(0, split), tool: tool.label.slice(split + 1) });
        pluginTools.add(tool.name);
        return target.registerTool({
          ...tool,
          ...(tool.name === "subagent" && subagentSchema ? { parameters: subagentSchema } : {}),
          ...(tool.name === "subagent" && subagentDescription !== undefined ? { description: subagentDescription } : {}),
        });
      };
      if (key === "sendMessage") return (message, options) => {
        const token = snapshot;
        snapshot = undefined;
        const runs = message?.customType === SUBAGENT_NOTIFY ? message.details?.runs : undefined;
        if (Array.isArray(runs) && runs.length && runs.every(run => typeof run?.runId === "string")) {
          const manager = getSession();
          const reservations = globalThis[reservationsSymbol];
          const queued = globalThis[queuedWakesSymbol];
          const sessionId = manager?.getSessionId?.();
          const state = queued instanceof WeakMap && manager ? queued.get(manager) : undefined;
          const current = reservations instanceof WeakMap && manager ? reservations.get(manager) : undefined;
          const content = message.content;
          const entry = state?.unansweredCompletions instanceof Map ? state.unansweredCompletions.get(content) : undefined;
          const tracked = state?.notices instanceof Map && state.notices.get(content) === message
            && Array.isArray(state.wakes) && state.wakes.includes(content) && entry?.reminded === false;
          const correlated = token && token.manager === manager && token.sessionId === sessionId
            && token.reservations === reservations && token.prior === current
            && token.queued === queued && token.state === state
            && (!token.idle || (typeof current?.sentAt === "number" && current.sentAt !== token.sentAt));
          // claimRuns releases ownership even for mixed batches. Validate the private
          // transaction first, so a changed native shape cannot steal those claims.
          if (typeof sessionId === "string" && state?.sessionId === sessionId
            && Array.isArray(state.wakes) && state.unansweredCompletions instanceof Map && state.notices instanceof Map
            && reservations instanceof WeakMap && typeof content === "string"
            && (current === undefined || (current?.sessionId === sessionId && (current.sentAt === undefined || typeof current.sentAt === "number")))
            && (options?.triggerTurn === true ? tracked && correlated : options?.triggerTurn === false && (tracked || (entry === undefined && !state.notices.has(content) && !state.wakes.includes(content))))
            && claimRuns(runs.map(run => run.runId))) {
            // parentWake has already reserved this send. Undo it before another
            // completion in this stack decides whether its own wake is reserved.
            if (options?.triggerTurn === true && token.idle) current.sentAt = token.sentAt;
            const { wakes, unansweredCompletions, notices } = state;
            const notice = notices.get(content);
            queueMicrotask(() => {
              if (getSession() !== manager || manager.getSessionId() !== sessionId
                || globalThis[queuedWakesSymbol] !== queued || queued.get(manager) !== state || state.sessionId !== sessionId
                || state.wakes !== wakes || state.unansweredCompletions !== unansweredCompletions || state.notices !== notices
                || unansweredCompletions.get(content) !== entry
                || (notices.has(content) && notices.get(content) !== notice)) return;
              // Native may splice its appended wake after sendMessage returns.
              // Removing earlier risks its splice(-1) deleting an unrelated wake.
              if (entry !== undefined && unansweredCompletions.get(content) === entry) {
                unansweredCompletions.delete(content);
                const index = wakes.lastIndexOf(content);
                if (index !== -1) wakes.splice(index, 1);
              }
              if (notice !== undefined && notices.get(content) === notice) notices.delete(content);
            });
            return;
          }
        }
        if (Object.hasOwn(quietMessages, message?.customType) && quietMessages[message.customType](message)) {
          return target.sendMessage({ ...message, display: false }, isShuttingDown() ? { ...options, triggerTurn: false } : options);
        }
        if (message?.display && options?.deliverAs !== "nextTurn") {
          if (isIdle()) { if (!options?.triggerTurn) closeFolds(folds); }
          else if (options?.triggerTurn === false) deferred += 1;
        }
        return target.sendMessage(message, options);
      };
      // appendVisible places the boundary where pi mounts the entry, above a reply still streaming.
      if (key === "appendEntry") return (type, data) => DRAWN_ENTRIES.has(type)
        ? appendVisible(target, type, data, folds)
        : target.appendEntry(type, data);
      if (key !== "registerMessageRenderer") return Reflect.get(target, key, receiver);
      return (type, renderer) => target.registerMessageRenderer(type, Object.hasOwn(messageRenderers, type)
        ? (message, options, theme) => messageRenderers[type](message, options, theme) ?? renderer(message, options, theme)
        : renderer);
    },
  });
}
