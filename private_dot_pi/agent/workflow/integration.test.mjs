import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createConnection, createServer } from "node:net";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import { Type } from "typebox";
import { normalizeContext } from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { AgentSession } from "@earendil-works/pi-coding-agent";
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
// the live flag (CI) must run these, so there a denied socket fails instead of skipping
const skip = socketsDenied && process.env.PI_WORKFLOW_LIVE_TESTS !== "1" && "Unix sockets are not permitted here";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-integration-test-"));
  const agentDir = join(root, "agent");
  mkdirSync(join(agentDir, "agents"), { recursive: true });
  writeFileSync(join(agentDir, "subagent-tool-description.md"), "Managed fixture: named asynchronous children only.\n");
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });
  // Mirrors the applied extensions/subagent/config.json: with the bridge on,
  // pi-subagents adds contact_supervisor to every child's allowlist.
  mkdirSync(join(agentDir, "extensions", "subagent"), { recursive: true });
  writeFileSync(join(agentDir, "extensions", "subagent", "config.json"), readFileSync(new URL("../extensions/subagent/config.json", import.meta.url)));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const role = { readonly: true, tools: ["workspace_read"], model: "openai-codex/gpt-5.6-luna", thinking: "low", agentPath: join(agentDir, "agents", "fixture-reader.md"), extensionPath: join(agentDir, "reader.ts") };
  const writer = { ...role, readonly: false, agentPath: join(agentDir, "agents", "fixture-writer.md"), extensionPath: join(agentDir, "writer.ts") };
  writeFileSync(role.extensionPath, "export default function () {}\n");
  writeFileSync(role.agentPath, `---\nname: fixture-reader\ndescription: Fixture\nmodel: ${role.model}\nthinking: low\ntools: workspace_read\nextensions: ${role.extensionPath}\n---\nRead only.\n`);
  writeFileSync(writer.extensionPath, "export default function () {}\n");
  writeFileSync(writer.agentPath, `---\nname: fixture-writer\ndescription: Fixture\nmodel: ${writer.model}\nthinking: low\ntools: workspace_read\nextensions: ${writer.extensionPath}\n---\nWrite enabled.\n`);
  const config = { version: 1, agentDir, models: { provider: "openai-codex", tiers: { small: "gpt-5.6-luna", top: "gpt-5.6-sol", frontier: "gpt-6-astra" } }, filesystem: { denyRead: [], denyWrite: [], allowWrite: [] }, network: { allowedDomains: [] }, agents: { "fixture-reader": role, "fixture-writer": writer }, mcp: {}, childLimit: 3 };
  return { root, config };
}

test("active tool exposure follows permission and UI, never mode", () => {
  const tools = ["workspace_read", "workspace_write", "workspace_edit", "ask_user_question"].map(name => ({ name }));
  const root = options => activeToolNames(tools, { ready: true, permitted: () => true, currentContext: { mode: "tui", hasUI: true }, ...options });
  assert.deepEqual(root(), tools.map(tool => tool.name));
  assert.deepEqual(root({ currentContext: { mode: "rpc", hasUI: true } }), ["workspace_read", "workspace_write", "workspace_edit"]);
  assert.deepEqual(root({ currentContext: { mode: "tui", hasUI: false } }), ["workspace_read", "workspace_write", "workspace_edit"]);
  assert.deepEqual(root({ ready: false }), []);
  assert.deepEqual(root({ permitted: name => name === "workspace_read" }), ["workspace_read"]);
});

test("a refresh never declares a deferred or hidden tool and keeps one tool_search already loaded", () => {
  const tools = [{ name: "workspace_read" }, { name: "tool_search", exposure: "model-only" }, { name: "mcp__exa__web_fetch_exa", exposure: "direct" }, { name: "mcp__context7__query_docs", exposure: "deferred" }, { name: "mcp__exa__agent_run", exposure: "hidden" }, { name: "mcp__playwright__browser_click", exposure: "deferred" }];
  const names = active => activeToolNames(tools, { ready: true, permitted: () => true, currentContext: { mode: "tui", hasUI: true }, active });
  assert.deepEqual(names([]), ["workspace_read", "tool_search", "mcp__exa__web_fetch_exa"]);
  assert.deepEqual(names(["workspace_read", "mcp__context7__query_docs"]), ["workspace_read", "tool_search", "mcp__exa__web_fetch_exa", "mcp__context7__query_docs"]);
  // Permission still decides first: a loaded tool outside the scope is retracted.
  assert.deepEqual(activeToolNames(tools, { ready: true, permitted: name => name !== "mcp__context7__query_docs", currentContext: { mode: "tui", hasUI: true }, active: ["mcp__context7__query_docs"] }), ["workspace_read", "tool_search", "mcp__exa__web_fetch_exa"]);
  assert.deepEqual(activeToolNames(tools, { ready: false, permitted: () => true, currentContext: { mode: "tui", hasUI: true }, active: ["mcp__context7__query_docs"] }), []);
});

test("Subscription Responses payloads retain distinct workflow and project-context patches across mode switches", async () => {
  const found = openaiCodexProvider().getModels().find(model => model.reasoning && model.compat?.supportsMidConvoSystemMessages);
  assert.ok(found);
  const model = { ...found, baseUrl: "https://example.test" };
  const token = `x.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "fixture" } })).toString("base64url")}.x`;
  const read = { name: "workspace_read", description: "Read", parameters: Type.Object({ path: Type.String() }) };
  const write = { name: "workspace_write", description: "Write", parameters: Type.Object({ path: Type.String() }) };
  const providerTool = tool => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters, strict: null });
  const capture = async messages => {
    let payload;
    const response = streamSimple(model, normalizeContext({ messages }), {
      apiKey: token, transport: "sse", reasoning: "high", maxRetries: 0,
      onPayload: value => { payload = value; },
      fetch: async () => new Response("fixture", { status: 400 }),
    });
    await response.result();
    return payload;
  };
  // Plan mode declares the same tools as execute (activeToolNames), so a mode
  // switch is a section patch only.
  const prefix = [{ role: "system", content: "base prompt", sections: { workflow: "Workflow mode: plan.", projectContext: "Project context: fixture." }, toolsAdded: [read, write], timestamp: 1 }, { role: "user", content: "Plan it", timestamp: 2 }];
  const plan = await capture(prefix);
  assert.deepEqual(await capture(prefix), plan, "repeated requests are byte-stable before transport");
  const planPatch = await capture([...prefix, { role: "system", content: "", sections: { workflow: "Workflow mode: plan; expanded.", projectContext: "Project context: expanded." }, timestamp: 3 }, { role: "user", content: "Continue", timestamp: 4 }]);
  const toExecute = [...prefix, { role: "system", content: "", sections: { workflow: "Workflow mode: execute." }, timestamp: 5 }, { role: "user", content: "Implement", timestamp: 6 }];
  const execute = await capture(toExecute);
  const backToPlan = await capture([...toExecute, { role: "system", content: "", sections: { workflow: "Workflow mode: plan." }, timestamp: 7 }, { role: "user", content: "Plan again", timestamp: 8 }]);
  const commonInput = [{ role: "user", content: [{ type: "input_text", text: "Plan it" }] }];
  const commonTools = [providerTool(read), providerTool(write)];
  assert.equal(plan.instructions, "base prompt\n\nWorkflow mode: plan.\n\nProject context: fixture.");
  assert.deepEqual(plan.input, commonInput);
  assert.deepEqual(plan.tools, commonTools);
  for (const payload of [planPatch, execute, backToPlan]) {
    assert.equal(payload.instructions, plan.instructions);
    assert.deepEqual(payload.input.slice(0, plan.input.length), plan.input);
    assert.deepEqual(payload.reasoning, plan.reasoning);
    assert.deepEqual(payload.tools, plan.tools, "mode switches keep the tool declarations");
    assert.ok(!payload.input.some(message => message.type === "additional_tools"));
  }
  assert.match(JSON.stringify(planPatch.input), /Updated system prompt section \\"workflow\\"/);
  assert.match(JSON.stringify(planPatch.input), /Workflow mode: plan; expanded\./);
  assert.match(JSON.stringify(planPatch.input), /Updated system prompt section \\"projectContext\\"/);
  assert.match(JSON.stringify(planPatch.input), /Project context: expanded\./);
  assert.deepEqual(backToPlan.input.slice(0, execute.input.length), execute.input, "execute-to-plan extends the execute prefix");
});

test("missing or empty managed descriptions stop root installation before broker startup", async t => {
  const { config } = fixture(t);
  const configPath = join(config.agentDir, "workflow-policy.json");
  writeFileSync(configPath, JSON.stringify(config));
  const descriptionPath = join(config.agentDir, "subagent-tool-description.md");
  const { installWorkflow } = await import("./index.mjs");
  const runtime = { startBroker: () => assert.fail("broker must not start") };
  rmSync(descriptionPath);
  await assert.rejects(installWorkflow({}, configPath, "root", runtime), /ENOENT/);
  writeFileSync(descriptionPath, "  \n");
  await assert.rejects(installWorkflow({}, configPath, "root", runtime), /description is empty/);
});

test("nested preflight retains bg_wait and loads the managed runtime backstop", async t => {
  const { config } = fixture(t);
  const role = config.agents["fixture-writer"];
  role.nests = true;
  role.tools = ["workspace_read", "subagent", "bg_wait"];
  writeFileSync(role.agentPath, `---\nname: fixture-writer\ndescription: Fixture\nmodel: ${role.model}\ntools: ${role.tools.join(", ")}\nextensions: ${role.extensionPath}\nallowNestedSubagents: true\n---\nCoordinate.\n`);
  const jiti = createJiti(import.meta.url);
  const { loadConfig } = await jiti.import(new URL("src/extension/config.js", import.meta.resolve("pi-subagents")).pathname);
  const defaults = loadConfig();
  assert.equal(defaults.timeoutMs, 7_200_000);
  assert.equal(defaults.checkpointBeforeDeadlineMs, 300_000);
  const { resolveSubagentLaunchContract } = await jiti.import("pi-subagents/preflight");
  const resolved = await resolveSubagentLaunchContract({ agent: "fixture-writer", task: "Coordinate", agentScope: "user", cwd: process.cwd(), availableModels: [{ provider: "openai-codex", id: "gpt-5.6-luna" }] });
  assert.equal(resolved.ok, true, JSON.stringify(resolved));
  assert.ok(resolved.contract.tools.effectiveAllowlist.includes("bg_wait"));
  const { registerWaitTool } = await jiti.import(new URL("src/runs/background/wait-tool.js", import.meta.resolve("pi-subagents")).pathname);
  let wait;
  registerWaitTool({ registerTool: tool => { wait = tool; } }, {}, true, undefined, undefined, { nestedRootRunId: "fixture" });
  assert.equal(wait.name, "bg_wait");
  assert.match(wait.description, /This child runtime does not install the root session's native completion notifier/);
  assert.match(wait.description, /Use blocking bg_wait/);
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
  // The frontier tier is in the catalog but never a child's.
  config.agents["fixture-frontier"] = { ...config.agents["fixture-reader"], model: "openai-codex/gpt-6-astra" };
  await assert.rejects(checkChildLaunch({ agent: "fixture-frontier", task: "Inspect fixture" }, config, "root", ctx, resolve, "plan"), /frontier/);
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

test("broker cannot enable execution after its plan/session or transition is superseded", { skip }, async t => {
  const { root, config } = fixture(t);
  const broker = await startBroker(config, root, async () => true);
  t.after(() => broker.close());
  await assert.rejects(broker.setMode("execute", () => false), /superseded/);
  assert.equal(broker.policy.mode, "plan");
  assert.equal(broker.policy.transitioning, true, "stale approval leaves tools blocked");
  await broker.setMode("execute");
  const older = broker.setMode("execute");
  const newer = broker.setMode("plan");
  await assert.rejects(older, /superseded/);
  await newer;
  assert.equal(broker.policy.mode, "plan");
  assert.equal(broker.policy.transitioning, false);
});

test("pinned upstream packages register against the managed extension and preflight custom child tools", async t => {
  const { config } = fixture(t);
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
    registerCommand() {}, registerShortcut() {}, registerFlag() {}, registerMessageRenderer() {}, registerToolRenderer() {}, registerMarkdownTransformer() {}, registerEntryRenderer() {}, appendEntry() {},
    getFlag() { return false; }, getAllTools() { return [...tools.values()]; },
    getActiveTools() { return [...tools.keys()]; }, setActiveTools() {}, getMcpServers() { return []; },
  };
  const { installWorkflow } = await import("./index.mjs");
  config.mcp = Object.fromEntries(["context7", "exa", "playwright"].map(name => [name, { policy: { denied_tools: [] } }]));
  config.agents["fixture-docs"] = { ...config.agents["fixture-reader"], tools: ["workspace_read", "mcp__context7__query_docs"] };
  writeFileSync(configPath, JSON.stringify(config));
  const jiti = createJiti(import.meta.url);
  const runtime = {
    startBroker: async () => ({ env: {}, policy: { mode: "plan", epoch: 1 }, async close() {} }),
    requestBroker: async () => ({ mode: "plan" }),
  };
  await installWorkflow(pi, configPath, "root", runtime);
  // Upstream lifecycle callbacks require a real Pi session; this registration
  // fixture never starts one, but must always release our broker.
  t.after(() => handlers.get("session_shutdown").find(handler => handler.name === "shutdown")());
  assert.ok(tools.has("workspace_read"));
  assert.ok(tools.has("subagent"));
  assert.equal(tools.has("subagents_enable"), false);
  const subagentSchema = tools.get("subagent").parameters;
  assert.deepEqual(Object.keys(subagentSchema.properties).sort(), ["action", "agent", "agentScope", "async", "capabilities", "context", "id", "index", "lines", "message", "mode", "runId", "steeringRecovery", "task", "view"].sort());
  assert.equal(subagentSchema.additionalProperties, false);
  assert.deepEqual(subagentSchema.properties.action.enum, ["list", "status", "interrupt", "stop", "steer"]);
  assert.deepEqual(subagentSchema.properties.context.enum, ["fresh", "fork"]);
  assert.deepEqual(subagentSchema.properties.agentScope.enum, ["user"]);
  assert.equal(tools.get("subagent").description, "Managed fixture: named asynchronous children only.");
  assert.doesNotMatch(tools.get("subagent").description, /workflowScript|runs\.|SAFETY-CRITICAL/);
  // pi's MCP tools register once their servers connect; deferred ones load through tool_search.
  assert.ok(tools.has("tool_search"));
  assert.equal(tools.has("codemode"), false);
  assert.ok(tools.has("submit_plan"));
  assert.equal(tools.get("submit_plan").executionMode, "sequential");
  assert.match(tools.get("submit_plan").description, /Read the current plan/);
  assert.ok(tools.has("ask_user_question"));
  assert.ok(!tools.has("ask_user"));
  assert.ok(!tools.has("read"));
  // promptGuidelines are the SDK's, renamed: a reworded SDK line would leave a bare tool name
  for (const name of ["read", "write", "edit"]) {
    const guidelines = tools.get(`workspace_${name}`).promptGuidelines;
    assert.ok(guidelines.some(line => line.includes(`workspace_${name}`)));
    assert.ok(guidelines.every(line => !new RegExp(`(?<!workspace_)\\b${name}\\b(?= )`).test(line)), guidelines.join("\n"));
  }
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
  await installWorkflow({ ...pi, on(name, fn) { const list = childHandlers.get(name) ?? []; list.push(fn); childHandlers.set(name, list); }, registerTool(tool) { childTools.set(tool.name, tool); } }, configPath, "fixture-shell", runtime);
  assert.equal(childTools.get("workspace_bash").parameters.properties.dangerouslyDisableSandbox, undefined);
  await childHandlers.get("session_shutdown").at(-1)();
  // A child reaching MCP gets pi's MCP extension, without tool_search: its allowlist names its tools.
  const docsTools = new Map();
  const docsHandlers = new Map();
  await installWorkflow({ ...pi, on(name, fn) { const list = docsHandlers.get(name) ?? []; list.push(fn); docsHandlers.set(name, list); }, registerTool(tool) { docsTools.set(tool.name, tool); } }, configPath, "fixture-docs", runtime);
  assert.equal(docsTools.has("tool_search"), false);
  assert.ok(docsHandlers.get("mcp_servers_change"), "pi's MCP extension is installed for the child");
  await docsHandlers.get("session_shutdown").find(handler => handler.name === "shutdown")();
  const { resolveSubagentLaunchContract } = await jiti.import("pi-subagents/preflight");
  const ctx = { cwd: process.cwd(), modelRegistry: { find: (_provider, id) => ({ provider: "openai-codex", id }), isUsingOAuth: () => true, getAvailable: () => [{ provider: "openai-codex", id: "gpt-5.6-luna" }] } };
  const args = { agent: "fixture-reader", task: "Inspect fixture" };
  await checkChildLaunch(args, config, "root", ctx, resolveSubagentLaunchContract, "plan");
  assert.equal(args.agentScope, "user");
  const blocking = { agent: "fixture-reader", task: "Inspect fixture", async: false };
  await checkChildLaunch(blocking, config, "root", ctx, resolveSubagentLaunchContract, "plan");
  assert.equal(blocking.async, true);
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
    registerCommand(name, command) { commands.set(name, command); }, registerShortcut() {}, registerFlag() {}, registerMessageRenderer() {}, registerToolRenderer() {}, registerMarkdownTransformer() {}, registerEntryRenderer() {}, appendEntry(type, data) { entries.push({ type, data }); },
    getFlag() { return false; }, getAllTools() { return [...tools.values()]; }, getActiveTools() { return [...tools.keys()]; }, setActiveTools(names) { activeTools.push(names); },
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
  await installWorkflow(pi, configPath, "root", { startBroker: async (_config, _cwd, callback) => { review = callback; return broker; }, requestBroker: async () => ({ mode: broker.policy.mode, readonly: false }), installSubagents, AgentSession });
  assert.ok(tools.has("workspace_task"));
  assert.deepEqual(tools.get("workspace_task").parameters.properties.action.anyOf.map(entry => entry.const), ["list", "output", "stop"]);
  assert.equal(tools.get("workspace_task").parameters.required.includes("id"), false);
  assert.equal((await tools.get("workspace_task").execute("list", { action: "list" })).content[0].text, "No background tasks");

  const ctx = {
    cwd: process.cwd(), mode: "rpc", hasUI: false, model: { provider: "openai-codex", id: "gpt-5.6-sol" }, thinkingLevel: "medium",
    sessionManager: { getSessionId: () => "headless-root", getSessionFile: () => null, getBranch: () => [] },
    modelRegistry: { find: () => true, isUsingOAuth: () => true, getAvailable: () => [], complete: async (_model, request) => { classified = request.messages[0].content; return { content: [{ type: "text", text: '{"decision":"allow"}' }] }; } },
    ui: { setStatus() {}, setToolsExpanded() {}, notify() {} },
  };
  for (const handler of handlers.get("session_start") ?? []) await handler({ reason: "startup" }, ctx);
  const jiti = createJiti(import.meta.url);
  const { resolveCurrentSubagentCapabilityCeiling } = await jiti.import("pi-subagents/capability-ceiling");
  const ceiling = () => resolveCurrentSubagentCapabilityCeiling(ctx.sessionManager.getSessionId());
  assert.deepEqual(ceiling()?.allowedAgents, ["fixture-reader"]);
  assert.equal(broker.policy.mode, "plan");
  const promptEvent = { systemPromptOptions: { sections: {}, contextFiles: [], skills: [{ name: "fixture-skill", description: "Fixture", filePath: "/skills/fixture/SKILL.md" }] } };
  for (const handler of handlers.get("before_agent_start")) assert.equal(await handler(promptEvent, ctx), undefined);
  assert.match(promptEvent.systemPromptOptions.sections.workflow, /Workflow mode: plan/);
  assert.match(promptEvent.systemPromptOptions.sections.skills, /Use the workspace_read tool[^]*<name>fixture-skill<\/name>/);
  assert.equal(promptEvent.systemPromptOptions.forceSystemPrompt, undefined);
  // An idle triggerTurn reaches _runAgentPrompt without prompt(); the wrapper
  // emits before_agent_start and guards the model itself.
  const session = Object.create(AgentSession.prototype);
  const prompted = [];
  const appended = [];
  Object.assign(session, {
    _pendingNextTurnMessages: [], _baseSystemPromptOptions: { ...promptEvent.systemPromptOptions, sections: {}, selectedTools: [] },
    _extensionRunner: {
      createContext: () => ctx,
      async emitBeforeAgentStart(prompt, _images, base) {
        const options = structuredClone(base);
        for (const handler of handlers.get("before_agent_start")) await handler({ prompt, systemPromptOptions: options }, ctx);
        if (prompt === "abort me") session._agentRunAbortRequested = true;
        return { messages: [], systemPromptOptions: options };
      },
    },
    agent: { prompt: async messages => prompted.push({ messages, options: session._runSystemPromptOptions }) },
    getActiveToolNames: () => ["workspace_read"], _preparePromptAndToolLoadout: () => undefined,
    _pendingToolNames: new Set(), _recordSelection() {}, _handlePostAgentRun: async () => false, _runBeforeSettleBoundary: async () => false,
    _flushPendingBashMessages() {}, _flushPendingCustomMessages() {}, _emitAgentSettled: async () => {}, _appendCustomMessage: message => appended.push(message.content),
  });
  await session.sendCustomMessage({ customType: "workflow-shell", content: "Ran `pwd`", display: false }, { triggerTurn: true });
  assert.equal(prompted.length, 1);
  assert.match(prompted[0].options.sections.workflow, /Workflow mode: plan/);
  assert.match(prompted[0].options.sections.skills, /<name>fixture-skill<\/name>/);
  assert.equal(session._runSystemPromptOptions, undefined);
  session._isAgentRunActive = false;
  // A second idle trigger while the first is still preparing queues behind it.
  const queued = [];
  session.agent.followUp = message => queued.push(message);
  await Promise.all([1, 2].map(n => session.sendCustomMessage({ customType: "workflow-shell", content: `Ran ${n}`, display: false }, { triggerTurn: true, deliverAs: "followUp" })));
  assert.equal(prompted.length, 2);
  assert.deepEqual(queued.map(message => message.content), ["Ran 2"]);
  session._isAgentRunActive = false;
  // An abort while the run is being prepared settles it without a model call.
  let settled = 0;
  session._emitAgentSettled = async () => { settled++; session._isAgentRunActive = false; };
  // The caller's notice is kept without a turn, and next-turn messages wait for a run that starts.
  session._pendingNextTurnMessages = [{ role: "custom", customType: "workflow-shell", content: "next turn" }];
  await session.sendCustomMessage({ customType: "workflow-shell", content: "abort me", display: false }, { triggerTurn: true });
  assert.equal(prompted.length, 2);
  assert.deepEqual(appended, ["abort me"]);
  assert.deepEqual(session._pendingNextTurnMessages.map(message => message.content), ["next turn"]);
  session._pendingNextTurnMessages = [];
  assert.equal(settled, 1);
  assert.equal(session._agentRunAbortRequested, false);
  assert.equal(session._runSystemPromptOptions, undefined);
  ctx.model = { provider: "openai-codex", id: "unmanaged" };
  await assert.rejects(session.sendCustomMessage({ customType: "workflow-shell", content: "Ran `pwd`", display: false }, { triggerTurn: true }), /Select an available managed OpenAI subscription model/);
  assert.equal(prompted.length, 2, "a refused run never reaches agent.prompt");
  assert.deepEqual(appended, ["abort me", "Ran `pwd`"]);
  assert.equal(session._runSystemPromptOptions, undefined);
  ctx.model = { provider: "openai-codex", id: "gpt-5.6-sol" };
  // Ordinary prompt() prepares the run before the wrapper guards it; the
  // wrapper must reject disallowed models without preparing an allowed run twice.
  const ordinary = Object.create(AgentSession.prototype);
  const preparation = [];
  const ordinaryPrompts = [];
  Object.assign(ordinary, {
    ...session, _isAgentRunActive: false,
    _modelRuntime: { hasConfiguredAuth: () => true },
    _resourceLoader: { getPrompts: () => ({ prompts: [] }) },
    _extensionRunner: {
      ...session._extensionRunner, hasHandlers: () => false,
      async emitBeforeAgentStart(...args) {
        preparation.push("before_agent_start");
        return session._extensionRunner.emitBeforeAgentStart(...args);
      },
    },
    _preparePromptAndToolLoadout(options) {
      preparation.push("loadout");
      assert.match(options.sections.workflow, /Workflow mode: plan/);
      assert.match(options.sections.skills, /<name>fixture-skill<\/name>/);
    },
    agent: {
      state: { get model() { return ctx.model; }, messages: [] },
      async prompt(messages) {
        preparation.push("agent.prompt");
        ordinaryPrompts.push(messages);
        assert.ok(ordinary._runSystemPromptOptions);
      },
    },
    _emitAgentSettled: async () => { ordinary._isAgentRunActive = false; },
  });
  ctx.model = { provider: "openai-codex", id: "unmanaged" };
  await assert.rejects(ordinary.prompt("Ordinary unmanaged prompt"), /Select an available managed OpenAI subscription model/);
  assert.equal(ordinaryPrompts.length, 0);
  assert.deepEqual(preparation, ["before_agent_start", "loadout"]);
  assert.equal(ordinary._runSystemPromptOptions, undefined);
  preparation.length = 0;
  ctx.model = { provider: "openai-codex", id: "gpt-5.6-sol" };
  ctx.modelRegistry.isUsingOAuth = () => false;
  await assert.rejects(ordinary.prompt("Ordinary API prompt"), /Select an available managed OpenAI subscription model/);
  assert.equal(ordinaryPrompts.length, 0);
  assert.deepEqual(preparation, ["before_agent_start", "loadout"]);
  assert.equal(ordinary._runSystemPromptOptions, undefined);
  preparation.length = 0;
  ctx.modelRegistry.isUsingOAuth = () => true;
  await ordinary.prompt("Ordinary subscription prompt");
  assert.deepEqual(preparation, ["before_agent_start", "loadout", "agent.prompt"]);
  assert.equal(ordinaryPrompts.length, 1);
  assert.deepEqual(ordinaryPrompts[0].map(message => ({ role: message.role, content: message.content })), [{ role: "user", content: [{ type: "text", text: "Ordinary subscription prompt" }] }]);
  assert.equal(ordinary._runSystemPromptOptions, undefined);
  assert.deepEqual(activeTools.at(-1), ["workspace_read", "workspace_write", "workspace_edit", "workspace_grep", "workspace_find", "workspace_ls", "workspace_bash", "workspace_task", "submit_plan", "subagent", "web_search", "web_fetch"]);
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
  const beforeExecute = activeTools.length;
  await commands.get("execute").handler("", ctx);
  assert.equal(broker.policy.mode, "execute");
  // A turn prepared inside the transition must not see a tool removal: pi-ai
  // would then re-declare the whole tool list on every later request.
  assert.ok(activeTools.slice(beforeExecute).every(names => names.includes("workspace_read")), "a mode transition keeps the declared set");
  assert.deepEqual(ceiling()?.allowedAgents, ["fixture-reader", "fixture-writer"]);
  const executeTools = activeTools.at(-1);
  assert.ok(executeTools.includes("workspace_write"));
  assert.equal(executeTools.includes("ask_user_question"), false, "RPC UI cannot show the TUI questionnaire");
  const notifications = [];
  ctx.ui.notify = text => notifications.push(text);
  assert.deepEqual(commands.get("plan").getArgumentCompletions("s"), [{ value: "show", label: "show" }]);
  await commands.get("plan").handler("show", ctx);
  assert.equal(broker.policy.mode, "execute", "show does not change mode");
  assert.equal(notifications.at(-1), "No current plan");
  const submit = tools.get("submit_plan");
  const updates = [];
  ctx.abort = () => {};
  const cancelled = await submit.execute("p", { plan: "# First\n\nChange A" }, undefined, update => updates.push(update));
  assert.equal(cancelled.details.decision, "cancelled");
  assert.equal(cancelled.details.revision, 1);
  assert.equal(updates[0].details.plan, cancelled.details.plan);
  assert.equal(broker.policy.mode, "plan", "changed draft revokes execute before approval");
  const read = await submit.execute("r", { action: "read" });
  assert.match(read.content[0].text, /Change A/);
  await assert.rejects(submit.execute("bad", { revision: 0, edits: [{ oldText: "A", newText: "B" }] }), /current revision/);
  assert.equal((await submit.execute("r", { action: "read" })).details.revision, 1);
  const branch = [{ type: "message", message: { role: "toolResult", toolName: "submit_plan", details: { ...cancelled.details, decision: "approved" } } }, { type: "compaction" }];
  ctx.sessionManager.getBranch = () => branch;
  for (const handler of handlers.get("session_tree")) await handler({}, ctx);
  assert.equal((await submit.execute("r", { action: "read" })).details.plan, cancelled.details.plan);
  assert.equal(broker.policy.mode, "plan", "restored approval is not execution permission");
  ctx.hasUI = false;
  for (const handler of handlers.get("session_start")) await handler({}, ctx);
  ctx.hasUI = true;
  assert.equal((await submit.execute("r", { action: "read" })).details.revision, 1);
  let finishApproval;
  ctx.mode = "tui";
  ctx.ui.custom = () => new Promise(resolve => { finishApproval = resolve; });
  const pending = submit.execute("pending", { revision: 1, edits: [{ oldText: "Change A", newText: "Change B" }] }, undefined, update => updates.push(update));
  assert.equal(updates.at(-1).details.plan, "# First\n\nChange B");
  assert.equal(updates.at(-1).details.revision, 2);
  ctx.sessionManager.getBranch = () => [];
  for (const handler of handlers.get("session_tree")) await handler({}, ctx);
  finishApproval({ decision: "approved" });
  assert.equal((await pending).details.decision, "cancelled");
  assert.equal(broker.policy.mode, "plan", "a stale approval cannot grant permission");
  ctx.mode = "rpc";
  assert.equal((await submit.execute("r", { action: "read" })).content[0].text, "No current plan");
  await commands.get("plan").handler("", ctx);
  assert.equal(broker.policy.mode, "plan");
  assert.deepEqual(ceiling()?.allowedAgents, ["fixture-reader"]);
  assert.deepEqual(activeTools.at(-1), executeTools, "plan mode keeps the tool declarations; the broker refuses writes");
  running = true;
  log.length = 0;
  await assert.rejects(commands.get("plan").handler("", ctx), /owned-run: stop request failed/);
  assert.deepEqual(activeTools.at(-1), executeTools, "a failed transition leaves the declarations");
  let verdict;
  for (const handler of handlers.get("tool_call")) verdict ??= await handler({ toolName: "workspace_read", input: {} }, ctx);
  assert.equal(verdict?.block, true, "the unavailable workflow refuses every call");
  assert.deepEqual(log, ["stop:owned-run"], "a failed child stop does not reach the broker mode update");
  log.length = 0;
  let cleanupError;
  for (const handler of handlers.get("session_shutdown") ?? []) {
    try { await handler({ reason: "quit" }, ctx); }
    catch (error) { cleanupError ??= error; }
  }
  assert.match(cleanupError?.message ?? "", /owned-run: stop request failed/);
  assert.deepEqual(log, ["stop:owned-run", "broker:close", "rpc:teardown"]);
  // A shutting-down workflow refuses an idle trigger; a reinstall swaps in its own guard.
  await assert.rejects(session.sendCustomMessage({ customType: "workflow-shell", content: "late", display: false }, { triggerTurn: true }), /Restart the managed workflow/);
  running = false;
  ctx.hasUI = false;
  handlers.clear();
  await installWorkflow(pi, configPath, "root", { startBroker: async () => broker, requestBroker: async () => ({ mode: broker.policy.mode, readonly: false }), installSubagents, AgentSession });
  for (const handler of handlers.get("session_start")) await handler({ reason: "startup" }, ctx);
  await session.sendCustomMessage({ customType: "workflow-shell", content: "reinstalled", display: false }, { triggerTurn: true });
  assert.equal(prompted.length, 3, "the reinstall's guard, not the shut-down one, decides");
  for (const handler of handlers.get("session_shutdown")) await handler({ reason: "quit" }, ctx);
});

test("every MCP call is resolved to its server and tool and put to the broker; unknown or unconfigured MCP tools are blocked", async t => {
  const { config } = fixture(t);
  config.models.classifierFilter = { model: "gpt-5.6-luna", reasoningEffort: "low" };
  config.models.classifierJudge = { model: "gpt-5.6-luna", reasoningEffort: "low" };
  config.mcp = { docs: { policy: { denied_tools: [] } } };
  config.agents["fixture-docs"] = { ...config.agents["fixture-reader"], tools: ["workspace_read", "mcp__docs__search"] };
  const configPath = join(config.agentDir, "workflow.json");
  writeFileSync(configPath, JSON.stringify(config));
  const handlers = new Map();
  const tools = new Map();
  const activeTools = [];
  const events = new EventEmitter();
  const pi = {
    events: { on(name, fn) { events.on(name, fn); return () => events.off(name, fn); }, emit: (...args) => events.emit(...args) },
    // Only the workflow's own hooks are kept: plugins register through the
    // styled proxy (`this` is not pi), and pi's MCP session_start would spawn
    // the configured servers.
    on(name, fn) { if (this !== pi) return; const list = handlers.get(name) ?? []; list.push(fn); handlers.set(name, list); },
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand() {}, registerShortcut() {}, registerFlag() {}, registerMessageRenderer() {}, registerToolRenderer() {}, registerMarkdownTransformer() {}, registerEntryRenderer() {}, appendEntry() {},
    getFlag() { return false; }, getAllTools() { return [...tools.values()]; }, getActiveTools() { return activeTools.at(-1) ?? []; }, setActiveTools(names) { activeTools.push(names); }, getMcpServers() { return []; },
  };
  const broker = {
    env: { PI_WORKFLOW_SOCKET: "fake-socket", PI_WORKFLOW_TOKEN: "fake-token" },
    policy: { mode: "plan", approval: "auto", epoch: 1, roots: new Map(), addableDirs: () => [] },
    async setMode(mode) { this.policy.mode = mode; },
    async close() {},
  };
  const asked = [];
  let refusal;
  const requestBroker = async (_env, role, request) => {
    if (request.action !== "mcp") return { mode: broker.policy.mode, readonly: true };
    asked.push({ role, ...request });
    if (refusal) throw new Error(refusal);
    return { ok: true };
  };
  const execute = async () => {};
  const installSubagents = async styled => {
    styled.registerTool({ name: "subagent", label: "subagent", description: "fake", parameters: Type.Object({}), execute });
    // Registered as pi's MCP extension does: the identity is the label.
    styled.registerTool({ name: "mcp__docs__search", label: "docs/search", exposure: "deferred", parameters: Type.Object({}), execute });
    styled.registerTool({ name: "mcp__other__search", label: "other/search", exposure: "direct", parameters: Type.Object({}), execute });
    for (const name of ["read_mcp_resource", "list_mcp_resources", "list_mcp_resource_templates"]) styled.registerTool({ name, label: name, parameters: Type.Object({}), execute });
    styled.events.on("subagents:rpc:v1:request", request => events.emit(`subagents:rpc:v1:reply:${request.requestId}`, { success: true, data: request.method === "ping"
      ? { capabilities: { fleetStatus: { version: 1 }, stop: true, processTerminalProof: { version: 1 } } }
      : { fleet: { entries: [], totalActive: 0 }, asyncSnapshot: { version: 1, omitted: { runs: 0 }, runs: [] } } }));
  };
  const { installWorkflow } = await import("./index.mjs");
  await installWorkflow(pi, configPath, "root", { startBroker: async () => broker, requestBroker, installSubagents });
  const ctx = {
    cwd: process.cwd(), mode: "rpc", hasUI: false, model: { provider: "openai-codex", id: "gpt-5.6-sol" },
    sessionManager: { getSessionId: () => "mcp-gate-root", getSessionFile: () => null, getBranch: () => [] },
    modelRegistry: { find: () => true, isUsingOAuth: () => true, getAvailable: () => [] },
    ui: { setStatus() {}, setToolsExpanded() {}, notify() {} },
  };
  for (const handler of handlers.get("session_start")) await handler({ reason: "startup" }, ctx);
  t.after(async () => { for (const handler of handlers.get("session_shutdown")) await handler({ reason: "quit" }, ctx); });
  const jiti = createJiti(import.meta.url);
  const { resolveCurrentSubagentCapabilityCeiling } = await jiti.import("pi-subagents/capability-ceiling");
  // pi-subagents drops a child's tool the ceiling does not name.
  assert.ok(resolveCurrentSubagentCapabilityCeiling("mcp-gate-root")?.allowedTools.includes("mcp__docs__search"));
  // tool_search is declared; the deferred tool waits for it, and the unconfigured server's tool is out of scope.
  assert.ok(activeTools.at(-1).includes("tool_search"));
  assert.equal(activeTools.at(-1).includes("mcp__docs__search"), false);
  assert.equal(activeTools.at(-1).includes("mcp__other__search"), false);
  const call = async (toolName, input = {}) => {
    let verdict;
    for (const handler of handlers.get("tool_call")) verdict ??= await handler({ toolName, input }, ctx);
    return verdict;
  };
  assert.equal(await call("mcp__docs__search", { query: "hooks" }), undefined);
  assert.deepEqual(asked, [{ role: "root", action: "mcp", server: "docs", tool: "search", args: { query: "hooks" } }]);
  refusal = "Action not approved";
  assert.deepEqual(await call("mcp__docs__search", { query: "again" }), { block: true, reason: "Action not approved" });
  assert.equal(asked.length, 2);
  refusal = undefined;
  for (const name of ["mcp__docs__ghost", "mcp__other__search", "read_mcp_resource", "list_mcp_resources", "list_mcp_resource_templates"]) assert.equal((await call(name))?.block, true, name);
  assert.equal(asked.length, 2, "a blocked name never reaches the broker");
});

test("a child's MCP calls reach the broker only for the tools its roster names", { skip }, async t => {
  const { root, config } = fixture(t);
  config.models.classifierFilter = { model: "gpt-5.6-luna", reasoningEffort: "low" };
  config.models.classifierJudge = { model: "gpt-5.6-luna", reasoningEffort: "low" };
  config.mcp = { docs: { policy: { denied_tools: [] } } };
  config.agents["fixture-docs"] = { ...config.agents["fixture-reader"], tools: ["workspace_read", "mcp__docs__search"] };
  const configPath = join(config.agentDir, "workflow.json");
  writeFileSync(configPath, JSON.stringify(config));
  // Stands in for the parent's broker at the child handshake only; every other request is the fake requestBroker's.
  const socketPath = join(root, "broker.sock");
  // resume(): an unread socket never sees the child's end, so the pair would outlive the test.
  const server = createServer(socket => { socket.on("error", () => {}); socket.resume(); socket.write(`${JSON.stringify({ ok: true })}\n`); });
  await new Promise(resolve => server.listen(socketPath, resolve));
  // Not awaited: the child's handshake socket stays open until its session_shutdown hook below.
  t.after(() => server.close());
  const saved = { ...process.env };
  Object.assign(process.env, { PI_WORKFLOW_SOCKET: socketPath, PI_WORKFLOW_TOKEN: "fake-token", PI_WORKFLOW_EPOCH: "1" });
  t.after(() => { for (const key of ["PI_WORKFLOW_SOCKET", "PI_WORKFLOW_TOKEN", "PI_WORKFLOW_EPOCH"]) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; });
  const handlers = new Map();
  const tools = new Map();
  const activeTools = [];
  let styled;
  const pi = {
    events: { on() { return () => {}; }, emit() {} },
    // pi's MCP extension registers through the styled proxy (`this`), which is
    // kept to register its tools; its hooks would spawn the configured server.
    on(name, fn) { if (this !== pi) { styled = this; return; } const list = handlers.get(name) ?? []; list.push(fn); handlers.set(name, list); },
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand() {}, registerShortcut() {}, registerFlag() {}, registerMessageRenderer() {}, registerToolRenderer() {}, registerMarkdownTransformer() {}, registerEntryRenderer() {}, appendEntry() {},
    getFlag() { return false; }, getAllTools() { return [...tools.values()]; }, getActiveTools() { return activeTools.at(-1) ?? []; }, setActiveTools(names) { activeTools.push(names); }, getMcpServers() { return []; },
  };
  const asked = [];
  const requestBroker = async (_env, role, request) => {
    if (request.action !== "mcp") return { mode: "plan", readonly: true };
    asked.push({ role, ...request });
    return { ok: true };
  };
  const { installWorkflow } = await import("./index.mjs");
  await installWorkflow(pi, configPath, "fixture-docs", { requestBroker });
  // Registered as pi's MCP extension does: the identity is the label.
  for (const name of ["search", "other"]) styled.registerTool({ name: `mcp__docs__${name}`, label: `docs/${name}`, exposure: "direct", parameters: Type.Object({}), async execute() {} });
  const ctx = {
    cwd: process.cwd(), mode: "rpc", hasUI: false, abort() {}, isIdle: () => true,
    sessionManager: { getSessionId: () => "mcp-gate-child", getSessionFile: () => null, getBranch: () => [] },
    modelRegistry: { find: () => true, isUsingOAuth: () => true, getAvailable: () => [] },
    ui: { setStatus() {}, setToolsExpanded() {}, notify() {} },
  };
  for (const handler of handlers.get("session_start")) await handler({ reason: "startup" }, ctx);
  t.after(async () => { for (const handler of handlers.get("session_shutdown")) await handler({ reason: "quit" }, ctx); });
  assert.deepEqual(activeTools.at(-1).filter(name => name.startsWith("mcp__")), ["mcp__docs__search"]);
  const call = async (toolName, input = {}) => {
    let verdict;
    for (const handler of handlers.get("tool_call")) verdict ??= await handler({ toolName, input }, ctx);
    return verdict;
  };
  assert.equal((await call("mcp__docs__other"))?.block, true);
  assert.deepEqual(asked, [], "an unrostered tool never reaches the broker");
  assert.equal(await call("mcp__docs__search", { query: "hooks" }), undefined);
  assert.deepEqual(asked, [{ role: "fixture-docs", action: "mcp", server: "docs", tool: "search", args: { query: "hooks" } }]);
});

test("child sessions share one capacity ceiling and acknowledge revocation before plan becomes active", { skip }, async t => {
  const { root, config } = fixture(t);
  const broker = await startBroker(config, root, async () => true);
  t.after(() => broker.close());
  await broker.setMode("execute");
  const childEnv = () => ({ ...broker.env, PI_WORKFLOW_EPOCH: String(broker.policy.epoch) });
  let stopped = 0;
  const staleEnv = childEnv();
  for (let i = 0; i < config.childLimit; i++) await acquireChild(childEnv(), "fixture-reader", release => { stopped++; release(); });
  await assert.rejects(acquireChild(childEnv(), "fixture-reader", () => {}), /capacity/);
  await broker.setMode("plan");
  // A child launched under an earlier epoch cannot connect after the change.
  await assert.rejects(acquireChild(staleEnv, "fixture-reader", () => {}), /capacity/);
  await assert.rejects(acquireChild({ ...broker.env }, "fixture-reader", () => {}), /capacity/);
  assert.equal(stopped, config.childLimit);
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

test("only a server the config marks unsandboxed receives the managed null-profile lease", { skip }, async t => {
  const { root, config } = fixture(t);
  config.mcp = {
    playwright: { connection: { type: "stdio", command: "managed-playwright", args: ["--stdio"], env: { SERVER_TOKEN: "configured" } }, policy: { denied_tools: [], unsandboxed: true } },
    docs: { connection: { type: "stdio", command: "managed-docs", args: ["--stdio"], env: {} }, policy: { denied_tools: [], unsandboxed: false } },
  };
  config.agents["fixture-browser"] = { ...config.agents["fixture-reader"], tools: ["workspace_read", "mcp__playwright__browser_navigate"] };
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
  // A child's server lease follows the MCP tools its role names.
  assert.equal((await leaseServer("playwright", "fixture-browser")).ok, true);
  assert.equal((await leaseServer("docs", "fixture-browser")).ok, false);
});

test("the tool renderer resolver draws an unregistered MCP call as a plugin row and defers other names", async t => {
  const { config } = fixture(t);
  config.models.classifierFilter = { model: "gpt-5.6-luna", reasoningEffort: "low" };
  config.models.classifierJudge = { model: "gpt-5.6-luna", reasoningEffort: "low" };
  config.mcp = { docs: { policy: { denied_tools: [] } } };
  const configPath = join(config.agentDir, "workflow.json");
  writeFileSync(configPath, JSON.stringify(config));
  const broker = { env: {}, policy: { mode: "plan", approval: "auto", epoch: 1, roots: new Map(), addableDirs: () => [] }, async setMode(mode) { this.policy.mode = mode; }, async close() {} };
  const handlers = new Map();
  const resolvers = [];
  const events = new EventEmitter();
  const pi = {
    events: { on(name, fn) { events.on(name, fn); return () => events.off(name, fn); }, emit: (...args) => events.emit(...args) },
    // Only the workflow's own hooks: pi's MCP session_start would spawn the server.
    on(name, fn) { if (this !== pi) return; const list = handlers.get(name) ?? []; list.push(fn); handlers.set(name, list); },
    registerTool() {}, registerToolRenderer(resolver) { resolvers.push(resolver); },
    registerCommand() {}, registerShortcut() {}, registerFlag() {}, registerMessageRenderer() {}, registerMarkdownTransformer() {}, registerEntryRenderer() {}, appendEntry() {},
    getFlag() { return false; }, getAllTools() { return []; }, getActiveTools() { return []; }, setActiveTools() {}, getMcpServers() { return []; },
  };
  const installSubagents = async api => {
    api.events.on("subagents:rpc:v1:request", request => events.emit(`subagents:rpc:v1:reply:${request.requestId}`, { success: true, data: request.method === "ping"
      ? { capabilities: { fleetStatus: { version: 1 }, stop: true, processTerminalProof: { version: 1 } } }
      : { fleet: { entries: [], totalActive: 0 }, asyncSnapshot: { version: 1, omitted: { runs: 0 }, runs: [] } } }));
  };
  const { installWorkflow } = await import("./index.mjs");
  await installWorkflow(pi, configPath, "root", { startBroker: async () => broker, requestBroker: async () => ({ mode: broker.policy.mode, readonly: true }), installSubagents });
  t.after(async () => { for (const handler of handlers.get("session_shutdown")) await handler({ reason: "quit" }, {}); });
  // pi's MCP extension adds its own resolver after ours; ours, first, answers mcp__ names.
  const resolve = (name, base) => { const at = index => index < resolvers.length ? resolvers[index](name, () => at(index + 1)) : base(); return at(0); };
  const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: text => text };
  const row = resolve("mcp__docs__search", () => assert.fail("an MCP name is not deferred"));
  assert.equal(row.renderCall({ query: "hooks" }, theme, { toolCallId: "c1", lastComponent: undefined, isPartial: false, executionStarted: true, state: {}, invalidate() {}, expanded: false, argsComplete: true, showImages: false, isError: false }).render(80)[0].trim(), "• docs › search \"hooks\"");
  const native = {};
  assert.equal(resolve("read", () => native), native);
});
