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
const PARENT_WAKE = "Subagent updates above.";
export const controlNotice = (message, _options, theme) => {
  const event = message?.details?.event;
  if (!event?.agent || !event.message) return undefined;
  return new Text(noticeLine({ agent: event.agent, message: event.message }, theme), 0, 0);
};

// pi-subagents' notices that register no renderer, so pi draws them in its
// shaded default box (rule 9). Each takes the transcript's shape — a rule 4
// status line or a π line, the rest two in — and answers undefined for a
// payload it does not recognise, leaving pi's box as the fallback. The
// incremental child notice carries no details, so its status is read from the
// first line formatIncrementalChildCompletion writes.
export const INCREMENTAL_CHILD = "subagent-incremental-child-notify";
export const RESULT_WRITE_FAILED = "subagent-workflow-result-write-failed";
export const WATCHDOG_CLARIFICATION = "subagent_watchdog_clarification";
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
};

// Entries pi-subagents appends straight to the session, outside the agent
// stream, keyed by type to the guard its own entry renderer applies before it
// draws (watchdog/register-main.js, intercom/supervisor-ui.js replyData). Only
// an entry that draws ends the group above it.
const finite = value => typeof value === "number" && Number.isFinite(value);
export const DRAWN_ENTRIES = {
  subagent_watchdog_warning: data => Boolean(data?.summary && data.evidence && data.recommendedAction),
  subagent_supervisor_reply: data => ["requestId", "runId", "agent", "message"].every(key => typeof data?.[key] === "string") && finite(data.childIndex) && finite(data.createdAt),
};

// Plugins register their tools and their custom message renderers through the
// API they are handed and pi keeps what they pass, so a Proxy that decorates
// every registration gives their rows the transcript's shape without touching
// execution or message content. The subagent schema and description reflect
// only the managed launch/control surface. Each MCP tool's server and tool name
// are recorded in mcpTools from its `<server>/<tool>` label, since its name may
// be sanitised or hash-shortened. A message renderer we own is composed
// over the plugin's, which stays as the fallback: ours answers undefined for a
// payload it does not recognise, so a plugin that changes its details shape
// renders its own way again rather than losing its notice. A message whose
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
export function pluginApi(pi, renderersFor, messageRenderers = {}, quietMessages = {}, narrowSchema, isShuttingDown = () => false, subagentDescription, mcpTools = new Map(), isIdle = () => true, folds = defaultFolds) {
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
        return target.registerTool({
          ...tool,
          ...(tool.name === "subagent" && narrowSchema ? { parameters: narrowSchema(tool.parameters) } : {}),
          ...(tool.name === "subagent" && subagentDescription !== undefined ? { description: subagentDescription } : {}),
          ...renderersFor(tool.name),
        });
      };
      if (key === "sendMessage") return (message, options) => {
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
      // before_agent_start; installManagedRun gives a triggered custom message
      // that too, with no user box to end the group. At shutdown the notice is
      // already kept, so the wake is dropped.
      if (key === "sendUserMessage") return (content, options) => {
        if (content !== PARENT_WAKE || options?.deliverAs !== "steer") return target.sendUserMessage(content, options);
        if (!isShuttingDown()) target.sendMessage({ customType: "subagent-wake", content, display: false }, { deliverAs: "steer", triggerTurn: true });
      };
      // appendVisible places the boundary where pi mounts the entry, above a reply still streaming.
      if (key === "appendEntry") return (type, data) => Object.hasOwn(DRAWN_ENTRIES, type) && DRAWN_ENTRIES[type](data)
        ? appendVisible(target, type, data, folds)
        : target.appendEntry(type, data);
      if (key !== "registerMessageRenderer") return Reflect.get(target, key, receiver);
      return (type, renderer) => target.registerMessageRenderer(type, Object.hasOwn(messageRenderers, type)
        ? (message, options, theme) => messageRenderers[type](message, options, theme) ?? renderer(message, options, theme)
        : renderer);
    },
  });
}
