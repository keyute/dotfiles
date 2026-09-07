import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { Type } from "typebox";
import * as sdk from "@earendil-works/pi-coding-agent";
import { startBroker as createPolicyBroker, requestBroker as callPolicyBroker, acquireChild } from "./broker.mjs";
import { startToolWorker, workerOperations, executeSandboxGrep } from "./operations.mjs";
import { workerTools, canonical, publicToolName } from "./policy.mjs";
import { reviewAction } from "./approval.mjs";
import { checkChildLaunch } from "./children.mjs";
import { installFooter } from "./footer.mjs";
import { installFleet } from "./fleet.mjs";

const runnerPath = fileURLToPath(new URL("./sandbox-runner.mjs", import.meta.url));
const resultText = text => ({ content: [{ type: "text", text }], details: {} });

// Definitions must be identical across sessions: pi-mcp-adapter keys its
// metadata cache on them, env included, and a cold cache costs a connect and
// describe round trip per server per session. The runner takes the broker
// socket and token from the inherited process environment, never from here.
export const mcpServerDefinitions = (config, role) => Object.fromEntries(Object.entries(config.mcp).map(([name, entry]) => [name, {
  command: process.execPath, args: [runnerPath, "server", name], env: { PI_WORKFLOW_ROLE: role },
  excludeTools: entry.policy.denied_tools, ...(entry.policy.allowed_tools?.length ? { includeTools: entry.policy.allowed_tools } : {}), approveTools: true,
  directTools: entry.policy.direct_tools === true,
}]));
// Direct MCP tools carry the adapter's mcp__<server> prefix; the proxy stays
// for servers left behind it (playwright).
const isDirectMcpTool = name => name.startsWith("mcp__");

// Claude-Code-style input caret. Rendered lines carry their cursor marker
// inline, so prefixing the first content line shifts the cursor correctly;
// if the render shape ever changes, the caret silently disappears instead
// of corrupting the editor.
export class CaretEditor extends sdk.CustomEditor {
  constructor(tui, theme, keybindings, { fleet } = {}) {
    super(tui, theme, keybindings, { paddingX: 2 });
    this.fleet = fleet;
  }
  // Fleet navigation is an editor-owned mode (widgets cannot take focus). Down
  // enters it only when the editor itself had nothing left to do with the key,
  // so wrapped lines, line-end moves, history and autocomplete keep priority.
  handleInput(data) {
    const fleet = this.fleet;
    if (fleet?.focused()) {
      const action = ["down", "up", "confirm", "cancel"].find(name => this.keybindings.matches(data, `tui.select.${name}`)) ?? "other";
      if (fleet.handleKey(action, this)) return;
    } else if (fleet && this.keybindings.matches(data, "tui.editor.cursorDown") && !this.isShowingAutocomplete()) {
      const before = JSON.stringify([this.getCursor(), this.getLines()]);
      super.handleInput(data);
      if (JSON.stringify([this.getCursor(), this.getLines()]) === before) fleet.handleKey("enter", this);
      return;
    }
    super.handleInput(data);
  }
  // The host copies the settings editorPaddingX (default 0) onto custom
  // editors right after construction and on settings reloads; the caret
  // needs its two padding columns.
  setPaddingX(padding) {
    super.setPaddingX(Math.max(2, padding));
  }
  render(width) {
    const lines = super.render(width);
    // lines[0] is the top border; lines[1] is the first visible content line.
    if (lines.length > 1 && lines[1].startsWith("  ")) lines[1] = this.borderColor("❯ ") + lines[1].slice(2);
    return lines;
  }
}

export async function installWorkflow(pi, configPath = join(sdk.getAgentDir(), "workflow.json"), role = "root", runtime = {}) {
  const startBroker = runtime.startBroker ?? createPolicyBroker;
  const requestBroker = runtime.requestBroker ?? callPolicyBroker;
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  let currentContext;
  let userTask = "";
  let ready = false;
  let installed = false;
  let ceiling;
  let footerInstalled = false;
  let releaseChild;
  let childRevoked = false;
  let broker;
  let env;
  const jiti = createJiti(import.meta.url);
  const { registerSubagentCapabilityCeiling } = await jiti.import("pi-subagents/capability-ceiling");
  const { resolveSubagentLaunchContract } = await jiti.import("pi-subagents/preflight");

  // Children carry the epoch they were launched under; the broker refuses a
  // child arriving after a later epoch, so root must refresh this on every bump.
  const publishEpoch = () => { process.env.PI_WORKFLOW_EPOCH = String(broker.policy.epoch); };
  if (role === "root") {
    broker = await startBroker(config, process.cwd(), request => reviewAction(currentContext, config, userTask, request));
    env = broker.env;
    Object.assign(process.env, env);
    publishEpoch();
  } else {
    env = { PI_WORKFLOW_SOCKET: process.env.PI_WORKFLOW_SOCKET, PI_WORKFLOW_TOKEN: process.env.PI_WORKFLOW_TOKEN, PI_WORKFLOW_EPOCH: process.env.PI_WORKFLOW_EPOCH };
    await requestBroker(env, role, { action: "state" });
  }
  const permittedTools = role === "root" ? [...workerTools.map(publicToolName), "mcp", "subagent", "bg_wait", "ask_user", "submit_plan"] : config.agents[role].tools;
  const permitted = name => permittedTools.includes(name) || (permittedTools.includes("mcp") && isDirectMcpTool(name));

  async function authorize(tool, args) {
    if (!ready) throw new Error("Managed workflow is not ready");
    return requestBroker(env, role, { action: "authorize", tool, args });
  }

  const toolFactory = name => sdk[`create${name[0].toUpperCase()}${name.slice(1)}ToolDefinition`];
  // Session env exposure is disabled: exec runs in a worker whose environment
  // is the broker-leased safe set, so session variables would never arrive.
  const bashOptions = { exposeSessionEnvironment: false };
  const workerEnv = { ...env, PI_WORKFLOW_ROLE: role };

  function sandboxTool(name) {
    if (!permittedTools.includes(publicToolName(name))) return;
    const template = toolFactory(name)(process.cwd(), name === "bash" ? bashOptions : undefined);
    pi.registerTool({ ...template, name: publicToolName(name), promptGuidelines: template.promptGuidelines?.map(text => text.replace(/\b(read|write|edit|grep|find|ls|bash)\b/g, publicToolName)), async execute(id, args, signal, onUpdate, ctx) {
      const { ticket } = await authorize(name, args);
      const client = startToolWorker(name, { cwd: currentContext.cwd, env: workerEnv, ticket, signal });
      try {
        if (name === "grep") return await executeSandboxGrep(client, args, signal);
        const operations = workerOperations(client)[name];
        const tool = toolFactory(name)(currentContext.cwd, name === "bash" ? { ...bashOptions, operations } : { operations });
        return await tool.execute(id, args, signal, onUpdate, ctx);
      } finally { await client.close(); }
    } });
  }
  for (const name of ["read", "write", "edit", "bash", "grep", "find", "ls"]) sandboxTool(name);

  pi.on("tool_call", async (event, ctx) => {
    try {
      if (!ready || !permitted(event.toolName)) throw new Error("Tool not available in this managed scope");
      if (event.toolName === "mcp" && event.input.action) throw new Error("MCP authentication/UI actions are user-operated, not model tools");
      if (event.toolName === "subagent") await checkChildLaunch(event.input, config, role, ctx, resolveSubagentLaunchContract);
      // The adapter's broker handles resolved MCP operations, not proxy arguments.
    } catch (error) { return { block: true, reason: error.message }; }
  });
  pi.on("user_bash", async event => {
    let client;
    try {
      const { ticket } = await authorize("bash", { command: event.command });
      client = startToolWorker("bash", { cwd: currentContext.cwd, env: workerEnv, ticket });
      let output = "";
      const { exitCode } = await client.call("exec", { command: event.command, cwd: currentContext.cwd }, { onChunk: chunk => { output += chunk; } });
      return { result: { output, exitCode: exitCode ?? 1, cancelled: false, truncated: false } };
    } catch (error) {
      return { result: { output: error.message, exitCode: 1, cancelled: false, truncated: false } };
    } finally { await client?.close(); }
  });

  pi.events.on("pi-mcp-adapter:tool-approval-request", request => {
    request.claim(async () => {
      if (!ready) return "deny";
      try {
        await requestBroker(env, role, { action: "mcp", server: request.serverName, tool: request.originalToolName, args: request.args });
        return request.signal?.aborted ? "deny" : "allow_once";
      } catch { return "deny"; }
    });
  });

  async function setMode(mode, ctx) {
    if (!broker) throw new Error("Only the parent can change workflow mode");
    ready = false;
    await broker.setMode(mode);
    publishEpoch();
    ready = true;
    pi.setThinkingLevel(mode === "plan" ? config.models.planEffort : config.models.defaultEffort);
    ctx.ui.setStatus("workflow", mode);
  }

  pi.on("session_start", async (_event, ctx) => {
    if (!installed) throw new Error("Workflow installation failed; tools remain disabled");
    currentContext = ctx;
    const allowedAgents = Object.entries(config.agents).filter(([, child]) => role === "root" || !config.agents[role].readonly || child.readonly).map(([name]) => name);
    ceiling?.dispose();
    ceiling = registerSubagentCapabilityCeiling({ sessionId: ctx.sessionManager.getSessionId(), source: "managed-workflow", ceiling: { allowedAgents, allowedTools: permittedTools } });
    if (broker) await setMode("plan", ctx);
    else {
      releaseChild = await acquireChild(env, role, release => {
        ready = false;
        childRevoked = true;
        ctx.abort();
        if (ctx.isIdle()) release();
      });
      ready = !childRevoked;
    }
    if (ctx.hasUI) ctx.ui.setToolsExpanded(false);
    if (broker && ctx.hasUI && !footerInstalled) {
      footerInstalled = true;
      installFooter(pi, ctx);
      const fleet = installFleet(pi, ctx);
      ctx.ui.setEditorComponent((tui, theme, keybindings) => new CaretEditor(tui, theme, keybindings, { fleet }));
    }
    pi.setActiveTools(pi.getAllTools().map(tool => tool.name).filter(permitted));
    if (!ctx.modelRegistry.find(config.models.provider, config.models.tiers.frontier)) ctx.ui.notify("Astra is configured as frontier but unavailable in this Pi model catalog; no fallback will be used.", "warning");
  });
  pi.on("input", event => {
    if (role === "root" && event.source !== "extension") userTask = `${userTask}\n${event.text}`.slice(-8000);
    return { action: "continue" };
  });
  pi.on("agent_end", () => { if (childRevoked) releaseChild?.(); });
  pi.on("before_agent_start", async (event, ctx) => {
    if (!ready || canonical(ctx.cwd) !== canonical(currentContext.cwd)) throw new Error("Restart the managed workflow after changing workspace");
    const model = ctx.model;
    if (!model || model.provider !== config.models.provider || !Object.values(config.models.tiers).includes(model.id) || !ctx.modelRegistry.isUsingOAuth(model)) throw new Error("Select an available managed OpenAI subscription model; API fallback is disabled");
    const state = await requestBroker(env, role, { action: "state" });
    return { systemPrompt: `${event.systemPrompt}\n\nWorkflow mode: ${state.mode}. ${state.readonly ? "Investigate only; source edits and external mutations are disabled. Submit the plan for explicit approval before implementation." : "Execute only the user-approved task."}` };
  });

  if (role === "root") {
    pi.registerCommand("plan", { description: "Stop sandbox work and enter read-only planning", handler: (_args, ctx) => setMode("plan", ctx) });
    pi.registerCommand("execute", { description: "Approve the current plan and enable scoped execution", handler: async (_args, ctx) => {
      if (ctx.hasUI && await ctx.ui.confirm("Approve the current plan?", "Enable scoped edits and auto-reviewed actions for this task?")) await setMode("execute", ctx);
    } });
    pi.registerCommand("approvals", { description: "Choose auto-reviewed or individually prompted approvals", handler: async (_args, ctx) => {
      const value = await ctx.ui.select("Approval mode", ["auto", "ask"]);
      if (value) { broker.policy.approval = value; broker.policy.epoch++; publishEpoch(); ctx.ui.setStatus("workflow", broker.policy.mode); }
    } });
    pi.registerTool({ name: "ask_user", label: "Question", description: "Ask the user for a missing decision.", parameters: Type.Object({ question: Type.String(), options: Type.Optional(Type.Array(Type.String())) }), async execute(_id, args) {
      if (!currentContext.hasUI) return resultText("User input unavailable; stop and report the missing decision.");
      const answer = args.options?.length ? await currentContext.ui.select(args.question, [...args.options, "Enter another answer"]) : "Enter another answer";
      const text = answer === "Enter another answer" ? await currentContext.ui.input(args.question) : answer;
      if (text) userTask = `${userTask}\nUser decision: ${text}`.slice(-8000);
      return resultText(text || "No answer submitted.");
    } });
    pi.registerTool({ name: "submit_plan", label: "Plan approval", description: "Present the implementation plan for explicit user approval.", parameters: Type.Object({ plan: Type.String() }), async execute(_id, args) {
      const ctx = currentContext;
      if (!ctx.hasUI || !await ctx.ui.confirm("Approve this implementation plan?", args.plan)) return resultText("Plan not approved. Remain in planning mode.");
      userTask = `${userTask}\nApproved plan: ${args.plan}`.slice(-8000);
      await setMode("execute", ctx);
      return resultText("Plan approved; scoped execution enabled.");
    } });
    // Registered as documented; model-originated launches are validated (and
    // their args patched) by the blocking tool_call hook, the capability
    // ceiling bounds every launch path, and the broker's child leases enforce
    // capacity and runtime role.
    const subagents = await jiti.import("pi-subagents", { default: true });
    await subagents(pi);
  }

  if (permittedTools.includes("mcp")) {
    const { createMcpAdapter } = await jiti.import("pi-mcp-adapter");
    await createMcpAdapter({ config: { mcpServers: mcpServerDefinitions(config, role), settings: { hostConfigDiscovery: "off", directTools: false, toolPrefix: "mcp", scriptMode: false, approveTools: true, toolResultRendering: "boxed", collapsedResultLines: 3, autoAuth: false, sampling: false, elicitation: false } } })(pi);
  }
  pi.on("session_shutdown", async () => {
    ready = false;
    releaseChild?.();
    ceiling?.dispose();
    if (broker) {
      await broker.close();
      delete process.env.PI_WORKFLOW_EPOCH;
      for (const [key, value] of Object.entries(env)) if (process.env[key] === value) delete process.env[key];
    }
  });
  installed = true;
}

export default pi => installWorkflow(pi);
