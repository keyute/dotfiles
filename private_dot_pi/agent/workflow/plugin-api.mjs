import { Text } from "@earendil-works/pi-tui";
import { noticeLine } from "./rows.mjs";
import { runnerPath } from "./operations.mjs";

// Definitions stay stable across sessions of the same role: pi-mcp-adapter keys its
// metadata cache on them, env included, and a cold cache costs a connect and
// describe round trip per server per session. The runner takes the broker
// socket and token from the inherited process environment, never from here.
export const mcpServerDefinitions = (config, role) => Object.fromEntries(Object.entries(config.mcp).map(([name, entry]) => [name, {
  command: process.execPath, args: [runnerPath, "server", name], env: { PI_WORKFLOW_ROLE: role },
  excludeTools: entry.policy.denied_tools, approveTools: true,
  directTools: entry.policy.direct_tools === true,
}]));
// The gateway as exposed here: upstream's description, snippet and schema
// (the `server` parameter's text included) also advertise install, auth and UI
// actions and mcpScript, which the tool_call hook and scriptMode:false refuse. A pure function of config, as upstream's
// is, so the adapter's re-registration never rewrites the prompt prefix.
const MCP_REFUSED_PARAMS = new Set(["action", "url", "target", "searchMode"]);
export const mcpGateway = servers => ({
  description: [
    "MCP gateway — server status, tool search/describe, and single MCP tool calls. Non-MCP Pi tools should be called directly, not through mcp.",
    "",
    `Servers: ${servers.join(", ")}`,
    "",
    "Usage:",
    "  mcp({ })                              → Show server status and tool counts",
    '  mcp({ server: "name" })               → List tools from server',
    '  mcp({ search: "query" })              → Search MCP tools by name/description',
    '  mcp({ describe: "tool_name" })        → Show tool details and parameters',
    '  mcp({ instructions: "name" })         → Show full server usage instructions',
    '  mcp({ connect: "server-name" })       → Connect to a server and refresh metadata',
    '  mcp({ tool: "name", args: { key: "value" } })         → Call a tool (object args; JSON string also accepted)',
    "",
    "Mode: tool (call) > connect > describe > instructions > search > server (list) > nothing (status)",
  ].join("\n"),
  promptSnippet: "MCP gateway — status, search, describe, and single MCP tool calls",
  narrow: schema => {
    const properties = Object.fromEntries(Object.entries(schema.properties).filter(([key]) => !MCP_REFUSED_PARAMS.has(key)));
    return { ...schema, properties: { ...properties, server: { ...properties.server, description: "Server name: filters searches and disambiguates calls and describe operations" } } };
  },
});
export const mcpAdapterSettings = { hostConfigDiscovery: "off", directTools: false, freezeDirectTools: true, toolPrefix: "mcp", namespaceProxyTools: false, scriptMode: false, jev: false, approveTools: true, autoAuth: false, sampling: false, elicitation: false };
export async function installMcpAdapter(pi, config, jiti) {
  const { logger } = await jiti.import(new URL("logger.ts", import.meta.resolve("pi-mcp-adapter")).pathname);
  // Routine info would draw over the live composer; an explicit MCP_UI_DEBUG request keeps its level.
  if (!["1", "true"].includes(process.env.MCP_UI_DEBUG)) logger.setLevel("warn");
  const { createMcpAdapter } = await jiti.import("pi-mcp-adapter");
  await createMcpAdapter({ config })(pi);
}

// pi-subagents' control notice: a message whose content is the model's
// instructions (run id, four subagent({…}) calls) and whose own renderer draws
// all of it in a box. The content is left alone — the model acts on it — and
// only the row is ours. A payload missing the fields the row needs is the
// plugin's to draw, so the guard is total and never throws: pi drops a throwing
// renderer to its own box, which is the notice in full.
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
  // A goal mission's body is several lines opening "Goal mission needs attention:",
  // which the row's "<agent> <state>" strip cannot read; the plugin's box draws it.
  if (message.details.source === "goal") return undefined;
  return new Text(noticeLine({ agent: event.agent, message: event.message }, theme), 0, 0);
};

// Plugins register their tools and their custom message renderers through the
// API they are handed and pi keeps what they pass, so a Proxy that decorates
// every registration gives their rows the transcript's shape without touching
// execution or message content. The subagent schema and description reflect
// only the managed launch/control surface, and the mcp gateway's only the
// calls this workflow admits (mcpGateway). A message renderer we own is composed
// over the plugin's, which stays as the fallback: ours answers undefined for a
// payload it does not recognise, so a plugin that changes its details shape
// renders its own way again rather than losing its notice. A customType in
// quietMessages is sent with display off — in the session and the model's
// context, never drawn. Everything else
// (events included) is the original, and the raw function is called on the raw
// API because the adapter extracts it.
export function pluginApi(pi, renderersFor, messageRenderers = {}, quietMessages = [], narrowSchema, isShuttingDown = () => false, subagentDescription, mcp) {
  return new Proxy(pi, {
    get(target, key, receiver) {
      if (key === "registerTool") return tool => target.registerTool({
        ...tool,
        ...(tool.name === "subagent" && narrowSchema ? { parameters: narrowSchema(tool.parameters) } : {}),
        ...(tool.name === "subagent" && subagentDescription !== undefined ? { description: subagentDescription } : {}),
        ...(tool.name === "mcp" && mcp ? { parameters: mcp.narrow(tool.parameters), description: mcp.description, promptSnippet: mcp.promptSnippet } : {}),
        ...renderersFor(tool.name),
      });
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
