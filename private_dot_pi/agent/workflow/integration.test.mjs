import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createConnection, createServer } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import { Type } from "typebox";
import { startBroker, requestBroker, acquireChild } from "./broker.mjs";
import { checkChildLaunch } from "./children.mjs";
import { activeToolNames } from "./index.mjs";

// Unix sockets are unavailable in some sandboxes (EPERM on listen); probe once
// up front so every test in this file can share one skip reason.
const socketsDenied = await new Promise(resolve => {
  const dir = mkdtempSync(join(tmpdir(), "pi-probe-"));
  const probe = createServer();
  probe.once("error", () => { rmSync(dir, { recursive: true, force: true }); resolve(true); });
  probe.listen(join(dir, "p.sock"), () => probe.close(() => { rmSync(dir, { recursive: true, force: true }); resolve(false); }));
});
const skip = socketsDenied && "Unix sockets are not permitted here";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-integration-test-"));
  const agentDir = join(root, "agent");
  mkdirSync(join(agentDir, "agents"), { recursive: true });
  // Mirrors the applied extensions/subagent/config.json: with the bridge on,
  // pi-subagents adds contact_supervisor to every child's allowlist.
  mkdirSync(join(agentDir, "extensions", "subagent"), { recursive: true });
  writeFileSync(join(agentDir, "extensions", "subagent", "config.json"), JSON.stringify({ intercomBridge: { mode: "off" } }));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const role = { readonly: true, tools: ["workspace_read"], model: "openai-codex/gpt-5.6-luna", thinking: "low", agentPath: join(agentDir, "agents", "fixture-reader.md"), extensionPath: join(agentDir, "reader.ts") };
  const writer = { ...role, readonly: false, agentPath: join(agentDir, "agents", "fixture-writer.md"), extensionPath: join(agentDir, "writer.ts") };
  writeFileSync(role.extensionPath, "export default function () {}\n");
  writeFileSync(role.agentPath, `---\nname: fixture-reader\ndescription: Fixture\nmodel: ${role.model}\nthinking: low\ntools: workspace_read\nextensions: ${role.extensionPath}\n---\nRead only.\n`);
  writeFileSync(writer.extensionPath, "export default function () {}\n");
  writeFileSync(writer.agentPath, `---\nname: fixture-writer\ndescription: Fixture\nmodel: ${writer.model}\nthinking: low\ntools: workspace_read\nextensions: ${writer.extensionPath}\n---\nWrite enabled.\n`);
  const config = { version: 1, agentDir, models: { provider: "openai-codex", default: "gpt-5.6-sol", defaultEffort: "medium", planEffort: "high", tiers: { small: "gpt-5.6-luna", top: "gpt-5.6-sol", frontier: "gpt-6-astra" } }, filesystem: { denyRead: [], denyWrite: [], allowWrite: [] }, network: { allowedDomains: [] }, agents: { "fixture-reader": role, "fixture-writer": writer }, mcp: {} };
  return { root, config };
}

test("active tool exposure follows root mode and UI without changing child authority", () => {
  const tools = ["workspace_read", "workspace_write", "workspace_edit", "ask_user_question"].map(name => ({ name }));
  const root = options => activeToolNames(tools, { ready: true, permitted: () => true, isRoot: true, mode: "plan", currentContext: { mode: "tui", hasUI: true }, ...options });
  assert.deepEqual(root(), ["workspace_read", "ask_user_question"]);
  assert.deepEqual(root({ mode: "execute" }), tools.map(tool => tool.name));
  assert.deepEqual(root({ currentContext: { mode: "rpc", hasUI: true } }), ["workspace_read"]);
  assert.deepEqual(root({ currentContext: { mode: "tui", hasUI: false } }), ["workspace_read"]);
  assert.deepEqual(root({ ready: false }), []);
  assert.deepEqual(activeToolNames(tools, { ready: true, permitted: name => name === "workspace_read", isRoot: false, mode: "plan", currentContext: { mode: "tui", hasUI: true } }), ["workspace_read"]);
  assert.deepEqual(activeToolNames(tools, { ready: true, permitted: name => name.startsWith("workspace_"), isRoot: false, mode: "plan", currentContext: { mode: "tui", hasUI: true } }), ["workspace_read", "workspace_write", "workspace_edit"]);
});

test("plan mode rejects configured writers before resolving a child contract", async t => {
  const { config } = fixture(t);
  let resolved = 0;
  const ctx = { cwd: process.cwd(), model: { provider: "openai-codex", id: "gpt-5.6-sol" }, modelRegistry: { find: () => true, isUsingOAuth: () => true, getAvailable: () => [] } };
  const resolve = async request => {
    resolved++;
    const child = config.agents[request.agent];
    return { ok: true, contract: { agent: { filePath: child.agentPath }, tools: { configuredExtensions: [child.extensionPath], effectiveAllowlist: child.tools }, digest: "fixture" } };
  };
  await checkChildLaunch({ agent: "fixture-reader", task: "Inspect fixture" }, config, "root", ctx, resolve, "plan");
  await assert.rejects(checkChildLaunch({ agent: "fixture-writer", task: "Implement fixture" }, config, "root", ctx, resolve, "plan"), /plan mode/i);
  assert.equal(resolved, 1);
  await checkChildLaunch({ agent: "fixture-writer", task: "Implement fixture" }, config, "root", ctx, resolve, "execute");
  await assert.rejects(checkChildLaunch({ agent: "fixture-writer", task: "Implement fixture" }, config, "fixture-reader", ctx, resolve, "execute"), /delegate to writers/);
  assert.equal(resolved, 2);
});

test("broker does not expose its credential to the classifier and invalidates pending approval", { skip }, async t => {
  const { root, config } = fixture(t);
  let finish;
  let received;
  let reached;
  const reviewStarted = new Promise(resolve => { reached = resolve; });
  const broker = await startBroker(config, root, request => {
    received = request;
    reached();
    return new Promise(resolve => { finish = resolve; });
  });
  t.after(() => broker.close());
  // A remote-mutating verb: other sandboxed commands are allowed without review.
  const pending = requestBroker(broker.env, "root", { action: "authorize", tool: "bash", args: { command: "git push" }, history: [{ command: "true", sandboxed: true, exitCode: 0, extra: "dropped" }, { command: "bad", sandboxed: "no" }, "bad"] });
  await reviewStarted;
  assert.equal(received.token, undefined);
  // The requester's shell history reaches the review shape-checked.
  assert.deepEqual(received.history, [{ command: "true", sandboxed: true, exitCode: 0 }]);
  await broker.setMode("execute");
  finish(true);
  await assert.rejects(pending, /approval was pending/);
  await assert.rejects(requestBroker({ ...broker.env, PI_WORKFLOW_TOKEN: "invalid" }, "root", { action: "state" }), /Unavailable/);
});

test("pinned upstream packages register against the managed extension and preflight custom child tools", { skip }, async t => {
  const { config } = fixture(t);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = config.agentDir;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });
  const configPath = join(config.agentDir, "workflow.json");
  config.agents["fixture-shell"] = { ...config.agents["fixture-reader"], tools: ["workspace_read", "workspace_bash"] };
  writeFileSync(configPath, JSON.stringify(config));
  const handlers = new Map();
  const tools = new Map();
  const events = new EventEmitter();
  const pi = {
    events: { on(name, fn) { events.on(name, fn); return () => events.off(name, fn); }, emit: (...args) => events.emit(...args) },
    on(name, fn) { const list = handlers.get(name) ?? []; list.push(fn); handlers.set(name, list); },
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand() {}, registerShortcut() {}, registerFlag() {}, registerMessageRenderer() {}, registerMarkdownTransformer() {}, registerEntryRenderer() {}, appendEntry() {},
    getFlag() { return false; }, getAllTools() { return [...tools.values()]; },
    getActiveTools() { return [...tools.keys()]; }, setActiveTools() {}, setThinkingLevel() {},
  };
  const { installWorkflow, mcpServerDefinitions } = await import("./index.mjs");
  await installWorkflow(pi, configPath, "root", { startBroker, requestBroker });
  // Upstream lifecycle callbacks require a real Pi session; this registration
  // fixture never starts one, but must always release our broker.
  t.after(() => handlers.get("session_shutdown").find(handler => handler.name === "shutdown")());
  assert.ok(tools.has("workspace_read"));
  assert.ok(tools.has("subagent"));
  const subagentSchema = tools.get("subagent").parameters;
  assert.deepEqual(Object.keys(subagentSchema.properties).sort(), ["action", "agent", "agentScope", "async", "capabilities", "context", "id", "index", "lines", "message", "mode", "model", "runId", "steeringRecovery", "task", "view"].sort());
  assert.equal(subagentSchema.additionalProperties, false);
  assert.deepEqual(subagentSchema.properties.action.enum, ["list", "status", "interrupt", "stop", "steer"]);
  assert.deepEqual(subagentSchema.properties.context.enum, ["fresh", "fork"]);
  assert.deepEqual(subagentSchema.properties.agentScope.enum, ["user"]);
  assert.ok(tools.get("subagent").description);
  assert.ok(tools.has("submit_plan"));
  assert.equal(tools.get("submit_plan").executionMode, "sequential");
  assert.equal(tools.get("submit_plan").description, "Present a concise implementation plan—recommended approach, affected files, and verification—for explicit user approval.");
  assert.ok(tools.has("ask_user_question"));
  assert.ok(!tools.has("ask_user"));
  assert.ok(!tools.has("read"));
  const blocked = [];
  events.on("herdr:blocked", data => blocked.push(data));
  for (const handler of handlers.get("ui_prompt_start")) handler({ type: "ui_prompt_start", kind: "custom", title: "Plan" });
  for (const handler of handlers.get("ui_prompt_end")) handler({ type: "ui_prompt_end", kind: "custom" });
  assert.deepEqual(blocked, [{ active: true, label: "Plan" }, { active: false }]);
  await assert.rejects(tools.get("workspace_read").execute("test", { path: "fixture" }), /not ready/);
  // The unsandboxed flag is offered to root and withheld from a read-only role (policy refuses it regardless).
  assert.ok(tools.get("workspace_bash").parameters.properties.dangerouslyDisableSandbox);
  const childHandlers = new Map();
  const childTools = new Map();
  await installWorkflow({ ...pi, on(name, fn) { const list = childHandlers.get(name) ?? []; list.push(fn); childHandlers.set(name, list); }, registerTool(tool) { childTools.set(tool.name, tool); } }, configPath, "fixture-shell", { startBroker, requestBroker });
  assert.equal(childTools.get("workspace_bash").parameters.properties.dangerouslyDisableSandbox, undefined);
  await childHandlers.get("session_shutdown").at(-1)();
  const jiti = createJiti(import.meta.url);
  const { resolveSubagentLaunchContract } = await jiti.import("pi-subagents/preflight");
  const ctx = { cwd: process.cwd(), modelRegistry: { find: (_provider, id) => ({ provider: "openai-codex", id }), isUsingOAuth: () => true, getAvailable: () => [{ provider: "openai-codex", id: "gpt-5.6-luna" }] } };
  const args = { agent: "fixture-reader", task: "Inspect fixture" };
  await checkChildLaunch(args, config, "root", ctx, resolveSubagentLaunchContract, "plan");
  assert.equal(args.agentScope, "user");
  const blocking = { agent: "fixture-reader", task: "Inspect fixture", async: false };
  await checkChildLaunch(blocking, config, "root", ctx, resolveSubagentLaunchContract, "plan");
  assert.equal(blocking.async, true);
  await assert.rejects(checkChildLaunch({ ...args, workflowScript: "bad" }, config, "root", ctx, resolveSubagentLaunchContract, "plan"), /workflow scripts/);
  // Keys the upstream schema advertises are dropped, not refused: every observed
  // first launch carried some of them and the refusal cost a turn per batch.
  const noisy = { ...args, cwd: "/elsewhere", toolBudget: { hard: 20 }, acceptance: false, context: "fork" };
  await checkChildLaunch(noisy, config, "root", ctx, resolveSubagentLaunchContract, "plan");
  assert.deepEqual(Object.keys(noisy).sort(), ["agent", "agentScope", "async", "context", "task"]);
  assert.equal(noisy.context, "fork");
  const profile = { ...args, context: "profile" };
  await checkChildLaunch(profile, config, "root", ctx, resolveSubagentLaunchContract, "plan");
  assert.equal("context" in profile, false);
  const transcript = { action: "status", id: "run", view: "transcript", lines: 50 };
  await checkChildLaunch(transcript, config, "root", ctx, resolveSubagentLaunchContract, "plan");
  assert.equal(transcript.steeringRecovery, false);
  await assert.rejects(checkChildLaunch({ action: "status", id: "run", view: "events" }, config, "root", ctx, resolveSubagentLaunchContract, "plan"), /not enabled/);
  // Session-varying values would change pi-mcp-adapter's cache key every launch.
  assert.deepEqual(mcpServerDefinitions({ mcp: { docs: { policy: { denied_tools: ["x"] } } } }, "root").docs.env, { PI_WORKFLOW_ROLE: "root" });
  const list = { action: "list", capabilities: true };
  await checkChildLaunch(list, config, "root", ctx, resolveSubagentLaunchContract, "plan");
  assert.equal(list.agentScope, "user");
  await assert.rejects(checkChildLaunch({ action: "list", view: "fleet" }, config, "root", ctx, resolveSubagentLaunchContract, "plan"), /not enabled/);

});

test("headless root cleanup uses plugin RPC before its shutdown hook and still closes the broker on stop failure", async t => {
  const { config } = fixture(t);
  config.models.classifierFilter = { model: "gpt-5.6-luna", reasoningEffort: "low" };
  config.models.classifierJudge = { model: "gpt-5.6-luna", reasoningEffort: "low" };
  const configPath = join(config.agentDir, "workflow.json");
  writeFileSync(configPath, JSON.stringify(config));
  const handlers = new Map();
  const eventHandlers = new Map();
  const tools = new Map();
  const commands = new Map();
  const log = [];
  const activeTools = [];
  const entries = [];
  let rpcReady = false;
  let running = false;
  let review;
  let classified;
  const events = {
    on(name, fn) {
      const list = eventHandlers.get(name) ?? new Set();
      list.add(fn);
      eventHandlers.set(name, list);
      return () => list.delete(fn);
    },
    emit(name, payload) {
      for (const fn of eventHandlers.get(name) ?? []) fn(payload);
    },
  };
  const pi = {
    events,
    on(name, fn) { const list = handlers.get(name) ?? []; list.push(fn); handlers.set(name, list); },
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand(name, command) { commands.set(name, command); }, registerShortcut() {}, registerFlag() {}, registerMessageRenderer() {}, registerMarkdownTransformer() {}, registerEntryRenderer() {}, appendEntry(type, data) { entries.push({ type, data }); },
    getFlag() { return false; }, getAllTools() { return [...tools.values()]; }, getActiveTools() { return [...tools.keys()]; }, setActiveTools(names) { activeTools.push(names); }, setThinkingLevel() {},
  };
  const broker = {
    env: { PI_WORKFLOW_SOCKET: "fake-socket", PI_WORKFLOW_TOKEN: "fake-token" },
    policy: { mode: "plan", approval: "auto", epoch: 1, roots: new Map(), addableDirs: () => [] },
    async setMode(mode) { this.policy.mode = mode; log.push(`mode:${mode}`); },
    async close() { log.push("broker:close"); },
  };
  const installSubagents = async styled => {
    styled.registerTool({ name: "subagent", label: "subagent", description: "fake", parameters: Type.Object({}), async execute() {} });
    styled.events.on("subagents:rpc:v1:request", request => {
      let success = true;
      let data;
      if (request.method === "ping") data = { capabilities: { fleetStatus: { version: 1 }, stop: true, processTerminalProof: { version: 1 } } };
      else if (!rpcReady) success = false;
      else if (request.method === "status" && !request.params.id) data = { fleet: { entries: [], totalActive: running ? 1 : 0 }, asyncSnapshot: { version: 1, omitted: { runs: 0 }, runs: running ? [{ id: "owned-run", state: "running" }] : [] } };
      else if (request.method === "status") data = { details: { lifecycleStatus: { processTerminal: { version: 1, runId: "owned-run", state: "pending" } } }, asyncSnapshot: { version: 1, omitted: { runs: 0 }, runs: [{ id: "owned-run", state: "running" }] } };
      else if (request.method === "stop") { log.push(`stop:${request.params.id}`); success = false; }
      events.emit(`subagents:rpc:v1:reply:${request.requestId}`, success ? { success: true, data } : { success: false, error: { code: "failed", message: "fixture stop failure" } });
    });
    styled.on("session_start", () => { rpcReady = true; events.emit("subagents:rpc:v1:ready"); });
    styled.on("session_shutdown", () => { log.push("rpc:teardown"); rpcReady = false; });
  };
  const { installWorkflow } = await import("./index.mjs");
  await installWorkflow(pi, configPath, "root", { startBroker: async (_config, _cwd, callback) => { review = callback; return broker; }, requestBroker: async () => ({ mode: broker.policy.mode, readonly: false }), installSubagents });
  assert.ok(tools.has("workspace_task"));
  assert.deepEqual(tools.get("workspace_task").parameters.properties.action.anyOf.map(entry => entry.const), ["list", "output", "stop"]);
  assert.equal(tools.get("workspace_task").parameters.required.includes("id"), false);
  assert.equal((await tools.get("workspace_task").execute("list", { action: "list" })).content[0].text, "No background tasks");

  const ctx = {
    cwd: process.cwd(), mode: "rpc", hasUI: false, model: { provider: "openai-codex", id: "gpt-5.6-sol" }, thinkingLevel: "medium",
    sessionManager: { getSessionId: () => "headless-root", getSessionFile: () => null },
    modelRegistry: { find: () => true, isUsingOAuth: () => true, getAvailable: () => [], complete: async (_model, request) => { classified = request.messages[0].content; return { content: [{ type: "text", text: '{"decision":"allow"}' }] }; } },
    ui: { setStatus() {}, setToolsExpanded() {}, notify() {} },
  };
  for (const handler of handlers.get("session_start") ?? []) await handler({ reason: "startup" }, ctx);
  const jiti = createJiti(import.meta.url);
  const { resolveCurrentSubagentCapabilityCeiling } = await jiti.import("pi-subagents/capability-ceiling");
  const ceiling = () => resolveCurrentSubagentCapabilityCeiling(ctx.sessionManager.getSessionId());
  assert.deepEqual(ceiling()?.allowedAgents, ["fixture-reader"]);
  assert.equal(broker.policy.mode, "plan");
  assert.deepEqual(activeTools.at(-1), ["workspace_read", "workspace_bash", "workspace_grep", "workspace_find", "workspace_ls", "workspace_task", "submit_plan", "subagent", "web_search", "mcp"]);
  assert.deepEqual(tools.get("ask_user_question").renderCall().render(), []);
  for (const handler of handlers.get("input") ?? []) handler({ source: "user", text: "Choose implementation." }, ctx);
  const completed = {
    toolName: "ask_user_question",
    result: { details: { cancelled: false, answers: [{ id: 1, header: "Direction", question: "Which complete direction should we take?", selected: [{ number: 1, label: "Fast", note: "keeps the exact note" }, { number: 2, label: "Safe" }], custom: "raw custom: 1,3" }] } },
  };
  for (const handler of handlers.get("tool_execution_end") ?? []) handler(completed, ctx);
  assert.deepEqual(entries.at(-1), { type: "workflow-answers", data: { answers: [{ question: "Which complete direction should we take?", answer: "Fast — keeps the exact note; Safe", notes: "raw custom: 1,3" }] } });
  await review({ approval: "auto", tool: "bash", args: { command: "true" } });
  assert.match(classified, /User decision: Which complete direction should we take\? → Fast — keeps the exact note; Safe — raw custom: 1,3/);
  for (const event of [{ ...completed, isError: true }, { ...completed, result: { ...completed.result, isError: true } }, { ...completed, result: { details: { ...completed.result.details, error: "unavailable" } } }, { ...completed, result: { details: { ...completed.result.details, cancelled: true } } }, { ...completed, result: { details: { cancelled: false, answers: [] } } }]) {
    for (const handler of handlers.get("tool_execution_end") ?? []) handler(event, ctx);
  }
  assert.equal(entries.length, 1);
  ctx.hasUI = true;
  ctx.ui.confirm = async () => true;
  await commands.get("execute").handler("", ctx);
  assert.equal(broker.policy.mode, "execute");
  assert.deepEqual(ceiling()?.allowedAgents, ["fixture-reader", "fixture-writer"]);
  assert.ok(activeTools.at(-1).includes("workspace_write"));
  assert.ok(activeTools.at(-1).includes("workspace_edit"));
  assert.equal(activeTools.at(-1).includes("ask_user_question"), false, "RPC UI cannot show the TUI questionnaire");
  await commands.get("plan").handler("", ctx);
  assert.equal(broker.policy.mode, "plan");
  assert.deepEqual(ceiling()?.allowedAgents, ["fixture-reader"]);
  assert.equal(activeTools.at(-1).includes("workspace_write"), false);
  assert.equal(activeTools.at(-1).includes("workspace_edit"), false);
  running = true;
  log.length = 0;
  await assert.rejects(commands.get("plan").handler("", ctx), /owned-run: stop request failed/);
  assert.deepEqual(activeTools.at(-1), []);
  assert.deepEqual(log, ["stop:owned-run"], "a failed child stop does not reach the broker mode update");
  log.length = 0;
  let cleanupError;
  for (const handler of handlers.get("session_shutdown") ?? []) {
    try { await handler({ reason: "quit" }, ctx); }
    catch (error) { cleanupError ??= error; }
  }
  assert.match(cleanupError?.message ?? "", /owned-run: stop request failed/);
  assert.deepEqual(log, ["stop:owned-run", "broker:close", "rpc:teardown"]);
});

test("child sessions share one capacity ceiling and acknowledge revocation before plan becomes active", { skip }, async t => {
  const { root, config } = fixture(t);
  const broker = await startBroker(config, root, async () => true);
  t.after(() => broker.close());
  await broker.setMode("execute");
  const childEnv = () => ({ ...broker.env, PI_WORKFLOW_EPOCH: String(broker.policy.epoch) });
  let stopped = 0;
  const staleEnv = childEnv();
  for (let i = 0; i < 20; i++) await acquireChild(childEnv(), "fixture-reader", release => { stopped++; release(); });
  await assert.rejects(acquireChild(childEnv(), "fixture-reader", () => {}), /capacity/);
  await broker.setMode("plan");
  // A child launched under an earlier epoch cannot connect after the change.
  await assert.rejects(acquireChild(staleEnv, "fixture-reader", () => {}), /capacity/);
  await assert.rejects(acquireChild({ ...broker.env }, "fixture-reader", () => {}), /capacity/);
  assert.equal(stopped, 20);
  assert.equal(broker.policy.mode, "plan");
  assert.equal(broker.policy.transitioning, false);
});

test("a disconnected child without terminal proof blocks further work and mode changes", { skip }, async t => {
  const { root, config } = fixture(t);
  const broker = await startBroker(config, root, async () => true);
  t.after(async () => {
    await assert.rejects(broker.close(), /terminal proof/);
    // This fixture never spawns a process; its retained scratch is safe to remove.
    rmSync(broker.policy.scratch, { recursive: true, force: true });
  });
  let client;
  await acquireChild({ ...broker.env, PI_WORKFLOW_EPOCH: String(broker.policy.epoch) }, "fixture-reader", () => {}, path => {
    client = createConnection(path);
    return client;
  });
  client.destroy();
  // A real socket's close propagates through the kernel, not a same-tick
  // EventEmitter, so poll instead of assuming one microtask suffices.
  for (let i = 0; i < 50 && !broker.policy.transitioning; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(broker.policy.transitioning, true);
  await assert.rejects(broker.setMode("execute"), /terminal proof/);
  await assert.rejects(requestBroker(broker.env, "root", { action: "authorize", tool: "read", args: { path: "fixture" } }), /transition in progress/);
});

test("tool leases require a single-use ticket bound to the current epoch", { skip }, async t => {
  const { root, config } = fixture(t);
  const histories = [];
  const broker = await startBroker(config, root, async request => { histories.push(request.history); return true; });
  t.after(() => broker.close());
  await broker.setMode("execute");
  const leaseTool = request => new Promise(resolve => {
    const socket = createConnection(broker.env.PI_WORKFLOW_SOCKET);
    let buffer = "";
    socket.on("error", () => resolve({ ok: false }));
    socket.on("connect", () => socket.write(`${JSON.stringify({ action: "lease", token: broker.env.PI_WORKFLOW_TOKEN, kind: "tool", role: "root", ...request })}\n`));
    socket.on("data", chunk => {
      buffer += chunk;
      if (!buffer.includes("\n")) return;
      let message;
      try { message = JSON.parse(buffer.slice(0, buffer.indexOf("\n"))); } catch { return resolve({ ok: false }); }
      if (message.ok) { socket.write(`${JSON.stringify({ action: "terminated" })}\n`); socket.end(); }
      resolve(message);
    });
  });
  const authorize = () => requestBroker(broker.env, "root", { action: "authorize", tool: "bash", args: { command: "true" } });
  const { ticket } = await authorize();
  assert.ok(ticket);
  assert.equal((await leaseTool({ name: "bash", ticket })).ok, true);
  assert.equal((await leaseTool({ name: "bash", ticket })).ok, false);
  const other = await authorize();
  assert.equal((await leaseTool({ name: "read", ticket: other.ticket })).ok, false);
  const stale = await authorize();
  await broker.setMode("plan");
  await broker.setMode("execute");
  assert.equal((await leaseTool({ name: "bash", ticket: stale.ticket })).ok, false);
  assert.equal((await leaseTool({ name: "bash" })).ok, false);
  // The reviewed ticket alone decides the lease's profile: an unsandboxed bash gets none, a flagged read keeps its profile.
  const escalated = await requestBroker(broker.env, "root", { action: "authorize", tool: "bash", args: { command: "true", dangerouslyDisableSandbox: true }, history: "not a list" });
  assert.equal((await leaseTool({ name: "bash", ticket: escalated.ticket })).profile, null);
  // A missing or malformed history reaches the review as an empty list.
  assert.deepEqual(histories.at(-1), []);
  const flaggedRead = await requestBroker(broker.env, "root", { action: "authorize", tool: "read", args: { path: "fixture", dangerouslyDisableSandbox: true } });
  assert.ok((await leaseTool({ name: "read", ticket: flaggedRead.ticket })).profile.filesystem);
});

test("only the configured Playwright server receives the managed null-profile lease", { skip }, async t => {
  const { root, config } = fixture(t);
  config.mcp = {
    playwright: { connection: { type: "stdio", command: "managed-playwright", args: ["--stdio"], env: { SERVER_TOKEN: "configured" } }, policy: { denied_tools: [] } },
    docs: { connection: { type: "stdio", command: "managed-docs", args: ["--stdio"], env: {} }, policy: { denied_tools: [] } },
  };
  const broker = await startBroker(config, root, async () => true);
  t.after(() => broker.close());
  const leaseServer = (name, role = "root") => new Promise(resolve => {
    const socket = createConnection(broker.env.PI_WORKFLOW_SOCKET);
    let buffer = "";
    socket.on("error", () => resolve({ ok: false }));
    socket.on("connect", () => socket.write(`${JSON.stringify({ action: "lease", token: broker.env.PI_WORKFLOW_TOKEN, kind: "server", role, name, command: "client-command", args: ["--client"], profile: null, env: { CLIENT_TOKEN: "spoofed" } })}\n`));
    socket.on("data", chunk => {
      buffer += chunk;
      if (!buffer.includes("\n")) return;
      const message = JSON.parse(buffer.slice(0, buffer.indexOf("\n")));
      if (message.ok) socket.write(`${JSON.stringify({ action: "terminated" })}\n`);
      socket.end(() => resolve(message));
    });
  });

  const playwright = await leaseServer("playwright");
  assert.equal(playwright.profile, null);
  assert.equal(playwright.command, "managed-playwright");
  assert.deepEqual(playwright.args, ["--stdio"]);
  assert.equal(playwright.env.SERVER_TOKEN, "configured");
  assert.equal(playwright.env.CLIENT_TOKEN, undefined);

  const docs = await leaseServer("docs");
  assert.ok(docs.profile.filesystem);
  assert.equal(docs.command, "managed-docs");
  assert.deepEqual(docs.args, ["--stdio"]);
  assert.equal((await leaseServer("unconfigured")).ok, false);
  assert.equal((await leaseServer("playwright", "fixture-reader")).ok, false);
});

test("an inherit-model child resolves to the parent's model before the tier check", { skip }, async t => {
  const { config } = fixture(t);
  const role = config.agents["fixture-reader"];
  config.agents["fixture-worker"] = { ...role, readonly: false, model: "inherit" };
  const contract = { agent: { filePath: role.agentPath }, tools: { configuredExtensions: [role.extensionPath], effectiveAllowlist: ["workspace_read"] }, digest: "d" };
  const resolve = async request => { resolve.model = request.model; return { ok: true, contract }; };
  const registry = { find: (_provider, id) => ({ provider: "openai-codex", id }), isUsingOAuth: () => true, getAvailable: () => [] };
  const launch = () => ({ agent: "fixture-worker", task: "Do the thing" });
  const ctxFor = id => ({ cwd: process.cwd(), model: { provider: "openai-codex", id }, modelRegistry: registry });
  const resolved = launch();
  await checkChildLaunch(resolved, config, "root", ctxFor("gpt-5.6-sol"), resolve, "execute");
  assert.deepEqual([resolve.model, resolved.model], ["openai-codex/gpt-5.6-sol", "openai-codex/gpt-5.6-sol"]);
  await assert.rejects(checkChildLaunch(launch(), config, "root", ctxFor("gpt-5-other"), resolve, "execute"), /tier policy/);
  await assert.rejects(checkChildLaunch(launch(), config, "fixture-reader", ctxFor("gpt-5.6-sol"), resolve, "execute"), /delegate to writers/);
  // The frontier tier is in the catalog but never a child's, requested or inherited.
  await assert.rejects(checkChildLaunch({ ...launch(), model: "openai-codex/gpt-6-astra" }, config, "root", ctxFor("gpt-5.6-sol"), resolve, "execute"), /frontier/);
  await assert.rejects(checkChildLaunch(launch(), config, "root", ctxFor("gpt-6-astra"), resolve, "execute"), /frontier/);
});
