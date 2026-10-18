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
export const SUBAGENT_NOTIFY = "subagent-notify";
// The first sentence of pi-subagents' PARENT_WAKE_TEXT; the rest of it is
// instructions the model still reads in the hidden wake.
const PARENT_WAKE = "Inspect subagent updates above.";
export const controlNotice = (message, _options, theme) => {
  const event = message?.details?.event;
  if (!event?.agent || !event.message) return undefined;
  return new Text(noticeLine({ agent: event.agent, message: event.message }, theme), 0, 0);
};

// pi-subagents draws each of these notices as its shaded `[subagent]` block
// (rule 9). Ours, composed over it, takes the transcript's shape — a rule 4
// status line or a π line, the rest two in — and answers undefined for a
// payload it does not recognise, leaving the plugin's block as the fallback.
// The incremental child notice's status is read from the first line
// formatIncrementalChildCompletion writes, which sessions from before its
// details still carry. The settle reminders arrive as entries pi-subagents
// returns from agent_before_settle, outside sendMessage, so they close no group.
export const INCREMENTAL_CHILD = "subagent-incremental-child-notify";
export const RESULT_WRITE_FAILED = "subagent-workflow-result-write-failed";
export const WATCHDOG_CLARIFICATION = "subagent_watchdog_clarification";
export const STEERING_NOTICE = "subagent_steering_notice";
export const COMPLETION_UNANSWERED = "subagent-completion-unanswered";
export const COMPLETION_UNHANDLED = "subagent-completion-unhandled";
const STEERING_STATES = new Set(["failed", "partial", "recovered"]);
export const QUIET_MESSAGES = {
  [SUBAGENT_NOTIFY]: () => true,
};
const textOf = content => typeof content === "string" ? content
  : Array.isArray(content) ? content.filter(part => part?.type === "text").map(part => part.text).join("\n") : "";
const notice = (head, rest, theme) => new Text([head, ...rest.filter(line => line.trim()).map(line => `${PAD}${theme.fg("muted", line)}`)].join("\n"), 0, 0);
export const NOTICE_RENDERERS = {
  [INCREMENTAL_CHILD]: (message, _options, theme) => {
    const [first, ...rest] = textOf(message?.content).split("\n");
    const match = first.match(/^Workflow child (completed|failed|paused \(needs attention\)|stopped): \*\*(.+)\*\*$/);
    return match ? notice(completionLine({ agent: match[2], status: match[1].split(" ")[0] }, theme), rest, theme) : undefined;
  },
  [RESULT_WRITE_FAILED]: (message, _options, theme) => {
    const text = textOf(message?.content).trim();
    return text ? notice(completionLine({ agent: "workflow result write", status: "failed" }, theme), text.split("\n"), theme) : undefined;
  },
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
// A completion notice whose every run claimRuns claims is dropped while the
// root is busy: the orchestrating tool call consumed those results, and the
// root, busy inside it, got the notice as a plain steer with no wake
// (parent-wake.js). An idle root's notice is followed by a wake, so a late
// owned one is forwarded hidden rather than leaving that wake empty. A batch
// with any unowned run is forwarded whole. Ownership ends at the notice, not
// the completion event, because pi-subagents batches and defers the notice.
export function pluginApi(pi, messageRenderers = {}, quietMessages = {}, subagentSchema, isShuttingDown = () => false, subagentDescription, mcpTools = new Map(), pluginTools = new Set(), isIdle = () => true, folds = defaultFolds, claimRuns = () => false) {
  let deferred = 0;
  const drain = () => {
    if (!deferred) return;
    deferred = 0;
    closeFolds(folds);
  };
  for (const event of ["turn_start", "agent_end", "agent_settled"]) pi.on(event, drain);
  return new Proxy(pi, {
    get(target, key, receiver) {
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
        const runs = message?.customType === SUBAGENT_NOTIFY ? message.details?.runs : undefined;
        if (Array.isArray(runs) && runs.length && claimRuns(runs.map(run => run?.runId)) && !isIdle()) return;
        if (Object.hasOwn(quietMessages, message?.customType) && quietMessages[message.customType](message)) {
          return target.sendMessage({ ...message, display: false }, isShuttingDown() ? { ...options, triggerTurn: false } : options);
        }
        if (message?.display && options?.deliverAs !== "nextTurn") {
          if (isIdle()) { if (!options?.triggerTurn) closeFolds(folds); }
          else if (options?.triggerTurn === false) deferred += 1;
        }
        return target.sendMessage(message, options);
      };
      // pi-subagents wakes an idle parent with a user prompt so the run gets
      // before_agent_start; a triggered custom message gets that natively, with
      // no user box to end the group. At shutdown the notice is already kept,
      // so the wake is dropped.
      if (key === "sendUserMessage") return (content, options) => {
        if (typeof content !== "string" || !content.startsWith(PARENT_WAKE) || options?.deliverAs !== "steer") return target.sendUserMessage(content, options);
        if (!isShuttingDown()) target.sendMessage({ customType: "subagent-wake", content, display: false }, { deliverAs: "steer", triggerTurn: true });
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
