import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createJiti } from "jiti";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import * as sdk from "@earendil-works/pi-coding-agent";
import { startBroker as createPolicyBroker, requestBroker as callPolicyBroker, acquireChild } from "./broker.mjs";
import { startToolWorker, workerOperations, executeSandboxGrep } from "./operations.mjs";
import { rootTools, canonical, expand, publicToolName, unsandboxed, workerTools } from "./policy.mjs";
import { hostEnvironment } from "./sandbox-runner.mjs";
import { TASK_CHARS, reviewAction } from "./approval.mjs";
import { allowedChildAgents, checkChildLaunch, narrowSubagentSchema } from "./children.mjs";
import { installFooter } from "./footer.mjs";
import { installHeader } from "./header.mjs";
import { installFleet } from "./fleet.mjs";
import { installShell } from "./shell.mjs";
import { installPendingInput } from "./pending-input.mjs";
import { createTasks } from "./tasks.mjs";
import { applyPlanDecision, isolatePlanApproval, PlanState, requestPlanApproval, showPlan } from "./plan-approval.mjs";
import { registerQuestionnaire } from "./questionnaire.mjs";
import { answerLines, appendVisible, bulletMarkdown, closeFolds, defaultFolds, doneEntryRenderer, installFolding, installReasoningHide, isMcp, noteLine, planRenderers, pluginRenderers, taskRenderers, toolRenderers } from "./rows.mjs";
import { CaretEditor, argumentCompletions } from "./editor.mjs";
import { installSkillDisplay } from "./skill-display.mjs";
import { readUsage, usageComponent } from "./usage.mjs";
import { webFetchTool } from "./web-fetch.mjs";
import { CONTROL_NOTICE, NOTICE_RENDERERS, QUIET_MESSAGES, controlNotice, mcpConfig, pluginApi } from "./plugin-api.mjs";

// The classifier's only evidence source: a shell command's record (command,
// sandboxed, exit code; never output) is taken where the worker returns it. A
// rejected exec keeps exitCode null. The command is cut to keep the classifier
// message compact. Exported for its test.
export function recordingExec(history, args, exec) {
  return async (...params) => {
    const entry = { command: args.command.slice(0, 2000), sandboxed: !unsandboxed("bash", args), exitCode: null };
    if (history.push(entry) > 20) history.shift();
    const result = await exec(...params);
    entry.exitCode = result.exitCode ?? null;
    return result;
  };
}
// What an authorization carries: the newest records whose JSON fits the
// budget, since the broker drops any request line over 128 KiB and escaping
// can multiply a command's size. Exported for its test.
export function trimHistory(history, budget = 16 * 1024) {
  const kept = [...history];
  while (kept.length && JSON.stringify(kept).length > budget) kept.shift();
  return kept;
}
const resultText = text => ({ content: [{ type: "text", text }], details: {} });

// `readonly` is also every read-only role's state in execute mode, so the
// planning workflow is gated on the root in plan mode: a child has neither
// submit_plan nor ask_user_question (policy.mjs rootTools).
// Fills the `workflow` system prompt section (see before_agent_start).
export function workflowPrompt({ mode, readonly, isRoot }) {
  // Read-only requests need an answer, not implementation permission.
  const planning = isRoot && mode === "plan" ? " Answer read-only questions and command requests directly. For requested source edits or external mutations, research the request to the point of a plan without being asked: read what the change touches, delegate the independent exploration, and ask with ask_user_question where different readings would lead to materially different work. Then submit the plan for explicit approval yourself — the user should not have to ask for it. Approval switches the mode and revokes running child sessions, aborting their work: settle async children before submitting the plan, or launch them after." : "";
  return `Workflow mode: ${mode}. ${readonly ? `Investigate only; source edits and external mutations are disabled.${planning}` : "Execute only the user-approved task."}`;
}

// Plan mode keeps write/edit declared: the broker refuses the call, while a
// retracted tool makes pi-ai resend the whole tool list and re-bill the
// context on every later mode switch; revisit if pi-ai stops re-declaring
// tools after a removal.
// A deferred or hidden tool is left as it stands: a refresh neither declares
// it nor retracts one tool_search loaded.
export function activeToolNames(tools, { ready, permitted, currentContext, active }) {
  if (!ready) return [];
  return tools.filter(({ name, exposure }) => permitted(name)
    && !(name === "ask_user_question" && (currentContext?.mode !== "tui" || !currentContext?.hasUI))
    && (!["deferred", "hidden"].includes(exposure) || active.includes(name))).map(tool => tool.name);
}

// Every agent run passes through _runAgentPrompt, but only prompt() emits
// before_agent_start first, and pi swallows a handler's throw: an idle
// triggerTurn ran without the workflow sections and past the model guard
// (docs/pi-coupling.md, Managed agent runs). The guard throws here, on every
// run, and a run prompt() did not prepare gets prompt()'s preparation.
const MANAGED_RUN = Symbol.for("pi-workflow:managed-run");
function installManagedRun(AgentSession, guard) {
  const prototype = AgentSession.prototype;
  const installed = prototype._runAgentPrompt[MANAGED_RUN];
  if (installed) { installed.guard = guard; return; }
  const state = { guard };
  const original = prototype._runAgentPrompt;
  // What the original's finally does for a run that never reached agent.prompt.
  const settle = async session => {
    session._agentRunAbortRequested = false;
    session._runSystemPromptOptions = undefined;
    session._flushPendingBashMessages();
    session._flushPendingCustomMessages();
    await session._emitAgentSettled();
  };
  const run = async function (messages) {
    const caller = [messages].flat();
    // The original records the caller's messages via agent.prompt; a run that
    // never reaches it appends them without a turn, as a non-triggering
    // sendCustomMessage would, so an idle notice is not lost.
    // `_appendCustomMessage` reaches no extension event, so a displayed one
    // ends the activity group here.
    const keep = () => {
      for (const message of caller) {
        if (message.role !== "custom") continue;
        if (message.display) closeFolds(defaultFolds);
        this._appendCustomMessage(message);
      }
    };
    try { state.guard(this._extensionRunner.createContext()); }
    catch (error) { this._runSystemPromptOptions = undefined; keep(); throw error; }
    if (!this._runSystemPromptOptions) {
      // Marked active before the first await, as the original does, so a
      // second idle trigger queues instead of starting a parallel run.
      this._isAgentRunActive = true;
      try {
        messages = [...caller];
        const text = messages.map(({ content }) => typeof content === "string" ? content : content.filter(part => part.type === "text").map(part => part.text).join("\n")).join("\n");
        const before = this._baseSystemPromptOptions.selectedTools;
        const result = await this._extensionRunner.emitBeforeAgentStart(text, undefined, this._baseSystemPromptOptions);
        const options = result.systemPromptOptions;
        if (options.selectedTools.length === before.length && options.selectedTools.every((name, index) => name === before[index])) options.selectedTools = this.getActiveToolNames();
        messages.push(...this._pendingNextTurnMessages, ...result.messages.map(({ customType, content, display, details }) => ({ role: "custom", customType, content: content ?? [], display, details, timestamp: Date.now() })));
        const update = this._preparePromptAndToolLoadout(options);
        this._runSystemPromptOptions = options;
        if (update) messages.unshift(update);
      } catch (error) { keep(); await settle(this); throw error; }
      // An abort during preparation finds no model call to cancel; the
      // original would clear its flag and start the turn anyway.
      if (this._agentRunAbortRequested) { keep(); return settle(this); }
      this._pendingNextTurnMessages = [];
    }
    return original.call(this, messages);
  };
  run[MANAGED_RUN] = state;
  prototype._runAgentPrompt = run;
}

export async function installWorkflow(pi, configPath = join(sdk.getAgentDir(), "workflow.json"), role = "root", runtime = {}) {
  const startBroker = runtime.startBroker ?? createPolicyBroker;
  const requestBroker = runtime.requestBroker ?? callPolicyBroker;
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const isRoot = role === "root";
  const subagentDescription = isRoot ? readFileSync(join(sdk.getAgentDir(), "subagent-tool-description.md"), "utf8").trim() : undefined;
  if (isRoot && !subagentDescription) throw new Error("Managed subagent description is empty");
  let currentContext;
  let userTask = "";
  const plans = new PlanState();
  let pendingInput;
  // This process's recent shell commands (command, sandboxed, exit code; never
  // output), sent with every bash authorization as the classifier's evidence.
  const shellHistory = [];
  let ready = false;
  let shuttingDown = false;
  let installed = false;
  let ceiling;
  let fleet;
  let surfaces;
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
  if (isRoot) {
    broker = await startBroker(config, process.cwd(), request => reviewAction(currentContext, config, userTask, request, () => fleet?.closePeek()));
    env = broker.env;
    Object.assign(process.env, env);
    publishEpoch();
  } else {
    env = { PI_WORKFLOW_SOCKET: process.env.PI_WORKFLOW_SOCKET, PI_WORKFLOW_TOKEN: process.env.PI_WORKFLOW_TOKEN, PI_WORKFLOW_EPOCH: process.env.PI_WORKFLOW_EPOCH };
    await requestBroker(env, role, { action: "state" });
  }
  const permittedTools = isRoot ? rootTools : config.agents[role].tools;
  // Server and tool of every registered MCP tool, by pi tool name (pluginApi).
  const mcpTools = new Map();
  const configuredMcp = name => mcpTools.has(name) && Object.hasOwn(config.mcp, mcpTools.get(name).server);
  const permitted = name => permittedTools.includes(name) || (isRoot && configuredMcp(name));
  // pi-subagents drops a child's tool that the ceiling does not name; a
  // nesting child's descendants stay bounded by its own tools.
  const ceilingTools = isRoot ? [...new Set([...rootTools, ...Object.values(config.agents).flatMap(agent => agent.tools)])] : permittedTools;
  const refreshActiveTools = () => pi.setActiveTools(activeToolNames(pi.getAllTools(), { ready, permitted, currentContext, active: pi.getActiveTools() }));

  async function authorize(tool, args) {
    if (!ready) throw new Error("Managed workflow is not ready");
    return requestBroker(env, role, { action: "authorize", tool, args, ...(tool === "bash" ? { history: trimHistory(shellHistory) } : {}) });
  }

  const toolFactory = name => sdk[`create${name[0].toUpperCase()}${name.slice(1)}ToolDefinition`];
  const workerEnv = { ...env, PI_WORKFLOW_ROLE: role };

  // Background tasks end in a steer message (heard with the next tool result,
  // or as a new turn when idle, as Claude Code's task notification is) and one
  // completion line; the message is not displayed, the line is its record.
  const tasks = createTasks({
    notify: text => pi.sendMessage({ customType: "workflow-task", content: text, display: false }, { deliverAs: "steer", triggerTurn: true }),
    record: entry => appendVisible(pi, "workflow-task", entry),
  });
  pi.registerEntryRenderer("workflow-task", doneEntryRenderer("workflow-task"));
  const background = permittedTools.includes("workspace_task");
  const TASK_GRACE_MS = 10_000;

  function sandboxTool(name) {
    if (!permittedTools.includes(publicToolName(name))) return;
    const template = toolFactory(name)(process.cwd());
    // Claude Code's bash flags, added to the SDK's own schema: run_in_background
    // where the role has workspace_task, dangerouslyDisableSandbox where the
    // role may write (the policy refuses it for read-only roles regardless).
    const flags = name !== "bash" ? {} : {
      ...(background ? { run_in_background: { type: "boolean", description: "Run the command as a background task for work that outlasts this turn (servers, long builds, full test suites): a command that ends within 10 s is answered here like a foreground call; a longer one returns its task id at once and its output arrives when it ends, or through workspace_task." } } : {}),
      ...(isRoot || !config.agents[role].readonly ? { dangerouslyDisableSandbox: { type: "boolean", description: "Run outside the OS sandbox with the full host environment; every such call is reviewed or prompted. Set it only when the user asks, or when this exact command just failed with a sandbox restriction (operation not permitted, denied path, blocked host or socket), and decide per command: an earlier approval does not carry over." } } : {}),
    };
    const parameters = Object.keys(flags).length ? { ...template.parameters, properties: { ...template.parameters.properties, ...flags } } : template.parameters;
    // The SDK's guidelines name the tool as a word followed by a space ("Use
    // edit for", "one edit call"); "into one edit." is prose.
    pi.registerTool({ ...template, parameters, ...toolRenderers(name), name: publicToolName(name), promptGuidelines: name === "bash" ? undefined : template.promptGuidelines?.map(line => line.replace(new RegExp(`\\b${name}\\b(?= )`, "g"), publicToolName(name))), async execute(id, args, signal, onUpdate, ctx) {
      const { ticket } = await authorize(name, args);
      if (name === "bash" && background && args.run_in_background) {
        // No turn signal: the task outlives the call, and only workspace_task or a mode change stops it.
        const client = startToolWorker(name, { cwd: currentContext.cwd, env: workerEnv, ticket });
        const exec = recordingExec(shellHistory, args, (params, options) => client.call("exec", params, options));
        const taskId = tasks.start({
          command: args.command,
          run: (onChunk, taskSignal) => exec({ command: args.command, cwd: currentContext.cwd, timeout: args.timeout }, { signal: taskSignal, onChunk: chunk => onChunk(chunk.toString()) }),
          close: () => client.close(),
        });
        // Answered like a foreground call: a failure throws with the SDK bash
        // tool's trailer, and no taskId in details (the row summary keys
        // "running" on it).
        const settled = await tasks.settle(taskId, TASK_GRACE_MS, signal);
        if (settled !== null) {
          const output = settled.output || "(no output)";
          if (settled.status !== "completed") throw new Error(`${output}\n${settled.exitCode != null ? `Command exited with code ${settled.exitCode}` : `Command ${settled.status}: ${settled.error ?? "killed"}`}`);
          return { content: [{ type: "text", text: output }], details: { settled: taskId } };
        }
        return { content: [{ type: "text", text: `Started background task ${taskId}; its output arrives when it ends. Use workspace_task to read or stop it.` }], details: { taskId } };
      }
      const client = startToolWorker(name, { cwd: currentContext.cwd, env: workerEnv, ticket, signal });
      try {
        if (name === "grep") return await executeSandboxGrep(client, args, signal);
        const operations = workerOperations(client)[name];
        if (name === "bash") operations.exec = recordingExec(shellHistory, args, operations.exec);
        const tool = toolFactory(name)(currentContext.cwd, { operations });
        return await tool.execute(id, args, signal, onUpdate, ctx);
      } finally { await client.close(); }
    } });
  }
  for (const name of workerTools) sandboxTool(name);
  if (background) {
    pi.registerTool({ name: "workspace_task", label: "Background task", description: "List background tasks, read their output so far, or stop one.", parameters: Type.Object({ id: Type.Optional(Type.String()), action: Type.Union([Type.Literal("list"), Type.Literal("output"), Type.Literal("stop")]) }), ...taskRenderers, async execute(_id, args) {
      if (args.action === "list") {
        const listed = tasks.list();
        return resultText(listed.length ? listed.map(task => `${task.id} · ${task.status} · ${task.command}`).join("\n") : "No background tasks");
      }
      if (!args.id) throw new Error(`workspace_task ${args.action} requires id`);
      if (args.action === "stop") return resultText(tasks.stop(args.id) ? `Stopping task ${args.id}` : `Task ${args.id} had already ended`);
      return resultText(tasks.output(args.id));
    } });
  }

  pi.on("tool_call", async (event, ctx) => {
    try {
      if (!ready || !permitted(event.toolName)) throw new Error("Tool not available in this managed scope");
      if (event.toolName === "subagent") {
        const mode = isRoot ? broker.policy.mode : (await requestBroker(env, role, { action: "state" })).mode;
        await checkChildLaunch(event.input, config, role, ctx, resolveSubagentLaunchContract, mode);
      }
      if (mcpTools.has(event.toolName)) {
        const { server, tool } = mcpTools.get(event.toolName);
        if (!configuredMcp(event.toolName)) throw new Error("MCP server outside the managed config");
        await requestBroker(env, role, { action: "mcp", server, tool, args: event.input });
      } else if (event.toolName.startsWith("mcp__")) throw new Error("Unknown MCP tool");
    } catch (error) { return { block: true, reason: error.message }; }
  });

  // herdr's pi extension reports `blocked` only on this bus event; pi's prompt
  // span is the one signal covering plan approval, questions and broker confirms.
  // Drop once herdr's extension subscribes to ui_prompt_* itself, or each prompt counts twice.
  pi.on("ui_prompt_start", event => pi.events.emit("herdr:blocked", { active: true, label: event.title }));
  pi.on("ui_prompt_end", () => pi.events.emit("herdr:blocked", { active: false }));

  // Mode and approval reach the status line as one string so the two can never
  // drift; the footer paints it, where the theme is live.
  const publishStatus = ctx => ctx.ui.setStatus("workflow", `${broker.policy.mode} ${broker.policy.approval}`);

  async function setMode(mode, ctx, { cleanup = true } = {}) {
    if (!broker) throw new Error("Only the parent can change workflow mode");
    const generation = plans.generation;
    // Declarations stay through the transition: the tool_call hook refuses
    // every call while unready, and a turn prepared here would otherwise see
    // every tool removed, which makes pi-ai re-declare the full list on every
    // later request.
    ready = false;
    if (cleanup) {
      // Stop owners while unavailable, before the broker changes its policy:
      // shells settle normally, then detached plugin runners are stopped.
      await tasks.stopAll();
      if (tasks.live()) throw new Error("Background shell cleanup did not finish; workflow remains unavailable");
      await fleet.stopAll();
    }
    if (generation !== plans.generation) throw new Error("Mode transition superseded by a session change");
    await broker.setMode(mode, () => generation === plans.generation);
    publishEpoch();
    ceiling?.update({ allowedAgents: allowedChildAgents(config, role, broker.policy.mode), allowedTools: ceilingTools });
    ready = true;
    refreshActiveTools();
    publishStatus(ctx);
  }

  async function shutdown() {
    plans.generation++;
    pendingInput?.reset();
    ready = false;
    refreshActiveTools();
    shuttingDown = true;
    const failures = [];
    const attempt = async (label, action) => {
      try { await action(); }
      catch (error) { failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
    };
    await attempt("background shells", () => tasks.stopAll({ silent: true }));
    if (tasks.live()) failures.push("background shells: cleanup timed out");
    if (isRoot) {
      if (currentContext) await attempt("detached subagents", () => fleet.stopAll());
    } else releaseChild?.();
    await attempt("capability ceiling", () => ceiling?.dispose());
    if (broker) {
      await attempt("broker", () => broker.close());
      delete process.env.PI_WORKFLOW_EPOCH;
      for (const [key, value] of Object.entries(env)) if (process.env[key] === value) delete process.env[key];
    }
    if (failures.length) throw new Error(`Workflow shutdown cleanup failed: ${failures.join("; ")}`);
  }

  pi.on("session_start", async (_event, ctx) => {
    if (!installed) throw new Error("Workflow installation failed; tools remain disabled");
    currentContext = ctx;
    if (isRoot) plans.restore(ctx);
    if (runtime.AgentSession) installManagedRun(runtime.AgentSession, assertManagedRun);
    shuttingDown = false;
    const mode = isRoot ? broker.policy.mode : (await requestBroker(env, role, { action: "state" })).mode;
    ceiling?.dispose();
    ceiling = registerSubagentCapabilityCeiling({ sessionId: ctx.sessionManager.getSessionId(), source: "managed-workflow", ceiling: { allowedAgents: allowedChildAgents(config, role, mode), allowedTools: ceilingTools } });
    fleet?.attachContext(ctx);
    if (broker) await setMode("plan", ctx, { cleanup: false });
    else {
      releaseChild = await acquireChild(env, role, release => {
        ready = false;
        refreshActiveTools();
        childRevoked = true;
        ctx.abort();
        if (ctx.isIdle()) release();
      });
      ready = !childRevoked;
    }
    if (ctx.hasUI) ctx.ui.setToolsExpanded(false);
    if (isRoot && ctx.hasUI) {
      installSkillDisplay(runtime.InteractiveMode);
      installReasoningHide(runtime.AssistantMessageComponent);
      pendingInput = installPendingInput(() => currentContext.ui.theme, runtime.InteractiveMode);
      if (!surfaces) {
        installFolding(pi, ctx);
        const footer = installFooter(pi, ctx, { fleet, tasks });
        // `!` runs in zsh with the interactive config; workspace_bash stays on
        // bash -c without rc, which would otherwise load into every sandboxed call
        const shell = installShell(pi, () => currentContext, { working: footer.working, exec: sdk.createLocalBashOperations({ shellPath: "/bin/zsh" }).exec, env: hostEnvironment, prefix: () => "source ~/.zshrc" });
        surfaces = { footer, shell };
      } else surfaces.footer.attach(ctx);
      // pi resets every extension surface when a session is invalidated
      // (/new, /resume), so these are applied on each session start.
      installHeader(ctx);
      ctx.ui.setEditorComponent((tui, theme, keybindings) => new CaretEditor(tui, theme, keybindings, { fleet, palette: ctx.ui.theme, shell: surfaces.shell, pending: pendingInput }));
      ctx.ui.addAutocompleteProvider(argumentCompletions);
    }
    refreshActiveTools();
    // classify's own availability test, run on every tier pin and both
    // classifier pins: a classifier that fails it silently turns every
    // reviewed action into a prompt, or a denial without a UI.
    for (const id of new Set([...Object.values(config.models.tiers), config.models.classifierFilter.model, config.models.classifierJudge.model])) {
      const model = ctx.modelRegistry.find(config.models.provider, id);
      if (!model || !ctx.modelRegistry.isUsingOAuth(model)) ctx.ui.notify(`${id} is pinned but unavailable on subscription OAuth in this Pi model catalog; no fallback will be used.`, "warning");
    }
  });
  pi.on("session_tree", async (_event, ctx) => {
    currentContext = ctx;
    pendingInput?.reset();
    if (isRoot) { plans.restore(ctx); await setMode("plan", ctx); }
  });
  pi.on("input", event => {
    if (isRoot && event.source !== "extension") userTask = `${userTask}\n${event.text}`.slice(-TASK_CHARS);
    return { action: "continue" };
  });
  pi.on("agent_end", () => { if (childRevoked) releaseChild?.(); });
  const assertManagedRun = ctx => {
    // Not `ready`: setMode clears it briefly, and a task notice sent meanwhile must still run.
    if (childRevoked || shuttingDown || canonical(ctx.cwd) !== canonical(currentContext.cwd)) throw new Error("Restart the managed workflow after changing workspace");
    const model = ctx.model;
    if (!model || model.provider !== config.models.provider || !Object.values(config.models.tiers).includes(model.id) || !ctx.modelRegistry.isUsingOAuth(model)) throw new Error("Select an available managed OpenAI subscription model; API fallback is disabled");
  };
  pi.on("before_agent_start", async event => {
    const state = await requestBroker(env, role, { action: "state" });
    // A returned systemPrompt forces the whole prompt and rewrites the
    // request's leading instructions on every change;
    // sections and context files are diffed against the transcript and
    // patched in one mid-conversation system message instead.
    const options = event.systemPromptOptions;
    for (const { path, content } of extraDirs.values()) options.contextFiles.push({ path, content });
    options.sections.workflow = workflowPrompt({ mode: state.mode, readonly: state.readonly, isRoot });
    // pi lists skills only when `read` or `bash` is selected, and the workflow
    // exposes only workspace_* tools; an empty section is dropped.
    if (isRoot) options.sections.skills = sdk.formatSkillsForPrompt(options.skills, "read").replace("Use the read tool", "Use the workspace_read tool").trim();
  });

  // /add-dir, Claude Code's added working directory: the policy widens the
  // edit scope, and the directory's AGENTS.md (or CLAUDE.md) rides the
  // prompt's project context. Skills under it need a restart with --skill: pi
  // discovers resources at startup and /reload, and /reload would also
  // restart the broker.
  const extraDirs = new Map();

  // Plugin rows take the transcript's shape (docs/pi-design.md); the
  // registrations themselves are the plugins' own.
  const rowsFor = name => pluginRenderers(name, { servers: Object.keys(config.mcp) });
  const styled = pluginApi(pi, rowsFor, { [CONTROL_NOTICE]: controlNotice, ...NOTICE_RENDERERS }, QUIET_MESSAGES, narrowSubagentSchema, () => shuttingDown, subagentDescription, mcpTools, () => currentContext.isIdle());
  // Fleet owns detached-run lifecycle for every root, including headless roots;
  // only its footer rendering is conditional on UI. Register our shutdown
  // before pi-subagents installs its hook, which disposes the RPC bridge.
  if (isRoot) fleet = installFleet(pi, null);
  pi.on("session_shutdown", shutdown);
  if (isRoot) {
    pi.registerCommand("plan", { description: "Stop sandbox work and enter read-only planning", getArgumentCompletions: prefix => "show".startsWith(prefix) ? [{ value: "show", label: "show" }] : [], handler: (args, ctx) => args?.trim() === "show" ? showPlan(ctx, plans.snapshot) : setMode("plan", ctx) });
    pi.registerCommand("execute", { description: "Approve the current plan and enable scoped execution", handler: (_args, ctx) => setMode("execute", ctx) });
    pi.registerCommand("approvals", { description: "Choose auto-reviewed or individually prompted approvals", handler: async (_args, ctx) => {
      const value = await ctx.ui.select("Approval mode", ["auto", "ask"]);
      if (value) { broker.policy.approval = value; broker.policy.epoch++; publishEpoch(); publishStatus(ctx); }
    } });
    const completions = values => values.map(value => ({ value, label: value }));
    pi.registerCommand("add-dir", { description: "Add a directory to the editable workspace and load its AGENTS.md", getArgumentCompletions: prefix => completions(broker.policy.addableDirs(prefix)), handler: async (args, ctx) => {
      const input = args?.trim();
      if (!input) return ctx.ui.notify("Type a directory after /add-dir", "info");
      let dir;
      let instructions;
      try {
        dir = broker.policy.addRoot(input);
        // Read through the policy; a refusal takes the root back out.
        try { instructions = broker.policy.instructions(dir); } catch (error) { broker.policy.removeRoot(dir); throw error; }
      } catch (error) { ctx.ui.notify(error.message, "error"); return; }
      if (instructions?.content) extraDirs.set(dir, instructions); else extraDirs.delete(dir);
      // A wider scope is a new epoch, as an approval change is; running
      // processes keep their narrower profile until their next lease.
      broker.policy.epoch++;
      publishEpoch();
      appendVisible(pi, "workflow-note", { text: `Added ${dir} to the workspace${instructions?.content ? " with its instructions" : ""}` });
    } });
    pi.registerCommand("remove-dir", { description: "Remove an added directory from the workspace", getArgumentCompletions: prefix => completions([...broker.policy.roots.keys()].filter(root => root.startsWith(prefix))), handler: async (args, ctx) => {
      if (!broker.policy.roots.size) return ctx.ui.notify("No added directories", "info");
      const input = args?.trim();
      if (!input) return ctx.ui.notify("Type a directory after /remove-dir", "info");
      const dir = canonical(expand(input, broker.policy.cwd));
      try { broker.policy.removeRoot(dir); } catch (error) { return ctx.ui.notify(error.message, "error"); }
      extraDirs.delete(dir);
      // Narrowing stops running processes, as a mode change does.
      await setMode(broker.policy.mode, ctx);
      appendVisible(pi, "workflow-note", { text: `Removed ${dir} from the workspace` });
    } });
    pi.registerCommand("usage", { description: "Show plan limits, context use and session cost", handler: async (_args, ctx) => appendVisible(pi, "workflow-usage", await readUsage(pi, ctx, surfaces?.footer ? { readLimits: () => surfaces.footer.refreshUsage({ force: true }) } : undefined)) });
    pi.registerEntryRenderer("workflow-usage", (entry, _options, theme) => usageComponent(entry.data, theme));
    pi.registerEntryRenderer("workflow-note", (entry, _options, theme) => new Text(noteLine(entry.data.text, theme), 0, 0));
    // The questionnaire owns its invisible renderers; completed answers feed
    // the classifier's task context and one transcript entry.
    registerQuestionnaire(pi);
    pi.on("tool_execution_end", event => {
      const details = event.result?.details;
      if (event.toolName !== "ask_user_question" || event.isError || event.result?.isError || details?.error || details?.cancelled || !details?.answers?.length) return;
      const answers = details.answers.map(entry => {
        const selected = entry.selected?.map(option => `${option.label}${option.note ? ` — ${option.note}` : ""}`).join("; ") ?? "";
        return { question: entry.question, answer: selected, notes: entry.custom ?? "" };
      }).filter(entry => entry.answer || entry.notes);
      if (!answers.length) return;
      userTask = `${userTask}\n${answers.map(entry => `User decision: ${entry.question} → ${[entry.answer, entry.notes].filter(Boolean).join(" — ")}`).join("\n")}`.slice(-TASK_CHARS);
      appendVisible(pi, "workflow-answers", { answers });
    });
    pi.registerEntryRenderer("workflow-answers", (entry, _options, theme) => new Text(answerLines(entry.data.answers, theme).join("\n"), 0, 0));
    pi.registerMarkdownTransformer((markdown, context) => bulletMarkdown(markdown, context, currentContext?.ui.theme));
    pi.on("message_end", event => {
      const isolated = isolatePlanApproval(event.message);
      return isolated ? { message: isolated } : undefined;
    });
    pi.registerTool({ name: "submit_plan", label: "Plan approval", description: "Present a concise implementation plan—recommended approach, affected files, and verification—for explicit user approval. Create with plan. Revise with unique, non-overlapping edits against revision instead of reprinting the plan; omit both to re-present unchanged. Read the current plan with action read.", parameters: Type.Object({ plan: Type.Optional(Type.String()), edits: Type.Optional(Type.Array(Type.Object({ oldText: Type.String(), newText: Type.String() }))), revision: Type.Optional(Type.Integer()), action: Type.Optional(Type.Literal("read")) }), executionMode: "sequential", ...planRenderers, async execute(_id, args, signal, onUpdate) {
      const ctx = currentContext;
      if (args.action === "read") {
        if (args.plan !== undefined || args.edits !== undefined) throw new Error("read does not change the plan");
        return { content: [{ type: "text", text: plans.snapshot ? `Plan revision ${plans.snapshot.revision}\n\n${plans.snapshot.plan}` : "No current plan" }], details: { ...plans.snapshot, action: "read" } };
      }
      const snapshot = { ...plans.revise(args), decision: "pending" };
      const generation = plans.generation;
      if (broker.policy.mode === "execute") await setMode("plan", ctx);
      if (generation !== plans.generation) throw new Error("Plan session changed");
      onUpdate?.({ content: [], details: snapshot });
      const decision = await requestPlanApproval(ctx, signal);
      if (generation !== plans.generation || plans.snapshot?.revision !== snapshot.revision) return { content: [{ type: "text", text: "Plan approval superseded" }], details: { ...snapshot, decision: "cancelled" }, terminate: true };
      const result = await applyPlanDecision(signal?.aborted ? { decision: "cancelled" } : decision, {
        plan: snapshot.plan,
        userTask,
        setUserTask: value => { userTask = value; },
        setMode: () => setMode("execute", ctx),
        abort: () => ctx.abort(),
      });
      result.details = { ...snapshot, ...result.details };
      result.content[0].text += ` (revision ${snapshot.revision})`;
      if (generation === plans.generation) plans.snapshot = { ...result.details };
      return result;
    } });
    // pi-subagents registers no renderer for these, so ours are registered
    // directly; the map above still composes ours over one it adds later.
    for (const [type, renderer] of Object.entries(NOTICE_RENDERERS)) pi.registerMessageRenderer(type, renderer);
    // Resolvers run in registration order and pi's MCP extension, installed
    // below through the same API, only fills in its card: registered first,
    // this draws every mcp__ row, a resumed one before its server connects.
    pi.registerToolRenderer((name, next) => isMcp(name) ? rowsFor(name) : next());
    // Registered as documented; model-originated launches are validated (and
    // their args patched) by the blocking tool_call hook, the capability
    // ceiling bounds every launch path, and the broker's child leases enforce
    // capacity and runtime role.
    const subagents = runtime.installSubagents ?? await jiti.import("pi-subagents", { default: true });
    await subagents(styled);
  }

  // Provider-native web search (OpenAI's server-side web_search tool on the
  // same Responses endpoint and token as model calls). Its Gemini-only url_context
  // registers too and stays outside every role's tool list.
  if (permittedTools.includes("web_search")) {
    const webSearch = await jiti.import("pi-web-search", { default: true });
    webSearch(styled);
  }
  // Read-only and effect-free on the host (no file, process or policy
  // state), so the tool_call hook's `permitted` check is its only gate.
  if (permittedTools.includes("web_fetch")) pi.registerTool({ ...webFetchTool(config), ...pluginRenderers("web_fetch") });
  // pi's built-in MCP, fed the managed servers only (no mcp.json is read);
  // every call is gated by the tool_call hook above.
  // A trusted project's mcp.json would outrank a sandboxed server of the same name.
  if (mcpConfig(config, role).servers.length) {
    if (isRoot) await sdk.createToolSearchExtension()(styled);
    await sdk.createMcpExtension({ loadConfig: () => mcpConfig(config, role) })(styled);
  }
  // Plugin session hooks may refresh their own registrations, so ours runs
  // last and restores the managed exposure after every startup or resume.
  pi.on("session_start", refreshActiveTools);
  installed = true;
}
