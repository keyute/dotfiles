import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { Type } from "typebox";
import * as sdk from "@earendil-works/pi-coding-agent";
import { startBroker as createPolicyBroker, requestBroker as callPolicyBroker, acquireChild } from "./broker.mjs";
import { workerTools, canonical, publicToolName } from "./policy.mjs";
import { reviewAction } from "./approval.mjs";
import { checkChildLaunch } from "./children.mjs";
import { installFooter } from "./footer.mjs";

const runnerPath = fileURLToPath(new URL("./sandbox-runner.mjs", import.meta.url));
const resultText = text => ({ content: [{ type: "text", text }], details: {} });

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
  let foreground = 0;
  const controllers = new Set();
  const jiti = createJiti(import.meta.url);
  const { registerSubagentCapabilityCeiling } = await jiti.import("pi-subagents/capability-ceiling");
  const { resolveSubagentLaunchContract } = await jiti.import("pi-subagents/preflight");

  if (role === "root") {
    broker = await startBroker(config, process.cwd(), request => reviewAction(currentContext, config, userTask, request));
    env = broker.env;
    Object.assign(process.env, env);
  } else {
    env = { PI_WORKFLOW_SOCKET: process.env.PI_WORKFLOW_SOCKET, PI_WORKFLOW_TOKEN: process.env.PI_WORKFLOW_TOKEN };
    await requestBroker(env, role, { action: "state" });
  }
  const permittedTools = role === "root" ? [...workerTools.map(publicToolName), "mcp", "subagent", "bg_wait", "ask_user", "submit_plan"] : config.agents[role].tools;

  async function authorize(tool, args) {
    if (!ready) throw new Error("Managed workflow is not ready");
    return requestBroker(env, role, { action: "authorize", tool, args });
  }

  function runTool(name, args, signal) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [runnerPath, "tool", name], {
        cwd: currentContext.cwd,
        env: { ...process.env, ...env, PI_WORKFLOW_ROLE: role },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "";
      let errorOutput = "";
      const abort = () => child.kill("SIGTERM");
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      child.stdout.on("data", chunk => {
        output += chunk;
        if (output.length > 16 * 1024 * 1024) abort();
      });
      child.stderr.on("data", chunk => { errorOutput = (errorOutput + chunk).slice(-4096); });
      child.stdin.on("error", () => {});
      child.on("error", reject);
      child.on("close", code => {
        signal?.removeEventListener("abort", abort);
        if (code !== 0 || signal?.aborted) return reject(new Error(`Sandboxed ${name} failed${errorOutput ? `: ${errorOutput}` : ""}`));
        try { resolve(JSON.parse(output)); } catch { reject(new Error("Invalid sandbox tool result")); }
      });
      child.stdin.end(JSON.stringify(args));
    });
  }

  function sandboxTool(tool) {
    if (!permittedTools.includes(publicToolName(tool.name))) return;
    pi.registerTool({ ...tool, name: publicToolName(tool.name), promptGuidelines: tool.promptGuidelines?.map(text => text.replace(/\b(read|write|edit|grep|find|ls|bash|lsp_diagnostics|lsp_fix)\b/g, publicToolName)), async execute(id, args, signal) {
      await authorize(tool.name, args);
      return runTool(tool.name, { ...args, ...(tool.name.startsWith("lsp_") ? { root: currentContext.cwd } : {}) }, signal);
    } });
  }
  for (const name of ["read", "write", "edit", "bash", "grep", "find", "ls"]) {
    sandboxTool(sdk[`create${name[0].toUpperCase()}${name.slice(1)}ToolDefinition`](process.cwd()));
  }
  const lsp = await jiti.import("@narumitw/pi-lsp/dist/index.ts", { default: true });
  lsp({ registerTool: sandboxTool, registerCommand() {}, on() {} });

  pi.on("tool_call", async (event, ctx) => {
    try {
      if (!ready || !permittedTools.includes(event.toolName)) throw new Error("Tool not available in this managed scope");
      if (event.toolName === "mcp" && event.input.action) throw new Error("MCP authentication/UI actions are user-operated, not model tools");
      if (event.toolName === "subagent") await checkChildLaunch(event.input, config, role, ctx, resolveSubagentLaunchContract);
      // The adapter's broker handles resolved MCP operations, not proxy arguments.
    } catch (error) { return { block: true, reason: error.message }; }
  });
  pi.on("user_bash", async event => {
    try {
      await authorize("bash", { command: event.command });
      const result = await runTool("bash", { command: event.command }, undefined);
      return { result: { output: result.content.filter(c => c.type === "text").map(c => c.text).join("\n"), exitCode: result.isError ? 1 : 0, cancelled: false, truncated: false } };
    } catch (error) {
      return { result: { output: error.message, exitCode: 1, cancelled: false, truncated: false } };
    }
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
    for (const controller of controllers) controller.abort();
    await broker.setMode(mode);
    ready = true;
    pi.setThinkingLevel(mode === "plan" ? config.models.planEffort : config.models.defaultEffort);
    ctx.ui.setStatus("workflow", `${mode} · ${broker.policy.approval} approvals · sandboxed tools`);
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
    }
    pi.setActiveTools(permittedTools.filter(name => pi.getAllTools().some(tool => tool.name === name)));
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
      if (value) { broker.policy.approval = value; broker.policy.epoch++; ctx.ui.setStatus("workflow", `${broker.policy.mode} · ${value} approvals · sandboxed tools`); }
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
    const subagents = await jiti.import("pi-subagents", { default: true });
    await subagents(new Proxy(pi, { get(target, key) {
      if (key !== "registerTool") return target[key];
      return tool => pi.registerTool({ ...tool, async execute(id, args, signal, onUpdate, ctx) {
        if (tool.name !== "subagent") return tool.execute(id, args, signal, onUpdate, ctx);
        await checkChildLaunch(args, config, role, ctx, resolveSubagentLaunchContract);
        if (args.action) return tool.execute(id, args, signal, onUpdate, ctx);
        if (foreground >= 3) throw new Error("Three child launches are already active");
        const controller = new AbortController();
        controllers.add(controller);
        foreground++;
        try { return await tool.execute(id, args, signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, onUpdate, ctx); }
        finally { controllers.delete(controller); foreground--; }
      } });
    } }));
  }

  if (permittedTools.includes("mcp")) {
    const { createMcpAdapter } = await jiti.import("pi-mcp-adapter");
    const mcpServers = Object.fromEntries(Object.entries(config.mcp).map(([name, entry]) => [name, {
      command: process.execPath, args: [runnerPath, "server", name], env: { ...env, PI_WORKFLOW_ROLE: role },
      excludeTools: entry.policy.denied_tools, ...(entry.policy.allowed_tools?.length ? { includeTools: entry.policy.allowed_tools } : {}), approveTools: true,
    }]));
    await createMcpAdapter({ config: { mcpServers, settings: { hostConfigDiscovery: "off", directTools: false, scriptMode: false, approveTools: true, toolResultRendering: "compact", collapsedResultLines: 1, autoAuth: false, sampling: false, elicitation: false } } })(pi);
  }
  pi.on("session_shutdown", async () => {
    ready = false;
    releaseChild?.();
    ceiling?.dispose();
    if (broker) {
      await broker.close();
      for (const [key, value] of Object.entries(env)) if (process.env[key] === value) delete process.env[key];
    }
  });
  installed = true;
}

export default pi => installWorkflow(pi);
