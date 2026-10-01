import { Text } from "@earendil-works/pi-tui";
import { noticeLine } from "./rows.mjs";
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
export const controlNotice = (message, _options, theme) => {
  const event = message?.details?.event;
  if (!event?.agent || !event.message) return undefined;
  return new Text(noticeLine({ agent: event.agent, message: event.message }, theme), 0, 0);
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
// renders its own way again rather than losing its notice. A customType in
// quietMessages is sent with display off — in the session and the model's
// context, never drawn. Everything else
// (events included) is the original, and the raw function is called on the raw
// API because a plugin may extract it.
export function pluginApi(pi, renderersFor, messageRenderers = {}, quietMessages = [], narrowSchema, isShuttingDown = () => false, subagentDescription, mcpTools = new Map()) {
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
        if (!quietMessages.includes(message?.customType)) return target.sendMessage(message, options);
        return target.sendMessage({ ...message, display: false }, isShuttingDown() ? { ...options, triggerTurn: false } : options);
      };
      if (key !== "registerMessageRenderer") return Reflect.get(target, key, receiver);
      return (type, renderer) => target.registerMessageRenderer(type, Object.hasOwn(messageRenderers, type)
        ? (message, options, theme) => messageRenderers[type](message, options, theme) ?? renderer(message, options, theme)
        : renderer);
    },
  });
}
