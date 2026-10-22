import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import net, { createConnection, createServer } from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import { Type } from "typebox";
import { normalizeContext, validateToolArguments } from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { startBroker, requestBroker, acquireChild } from "./broker.mjs";
import { checkChildLaunch } from "./children.mjs";
import { readLines, sendLine } from "./lines.mjs";
import { activeToolNames, taskNotifier } from "./index.mjs";

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
  writeFileSync(join(agentDir, "orchestrate-tool-description.md"), "Managed fixture: workflow scripts.\n");
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
  const config = { version: 1, agentDir, models: { provider: "openai-codex", tiers: { small: "gpt-5.6-luna", top: "gpt-5.6-sol", frontier: "gpt-6-astra" } }, filesystem: { denyRead: [], denyWrite: [], allowWrite: [] }, network: { allowedDomains: [] }, agents: { "fixture-reader": role, "fixture-writer": writer }, mcp: {}, childLimit: 3, orchestrateConcurrency: 2 };
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

test("a task notice after the user stops a run is only appended until the next run or session starts", () => {
  const handlers = {};
  const sent = [];
  const notify = taskNotifier({ on: (name, fn) => { handlers[name] = fn; }, sendMessage: (_message, options) => sent.push(options.triggerTurn) });
  const end = (hasUI, aborted) => handlers.agent_end({}, { hasUI, signal: { aborted } });
  notify("done");
  end(true, false);
  notify("done");
  end(false, true);
  notify("done");
  end(true, true);
  notify("done");
  handlers.agent_start();
  notify("done");
  end(true, true);
  handlers.session_start();
  notify("done");
  assert.deepEqual(sent, [true, true, true, false, true, true]);
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
  writeFileSync(descriptionPath, "Managed fixture.\n");
  writeFileSync(join(config.agentDir, "orchestrate-tool-description.md"), "  \n");
  await assert.rejects(installWorkflow({}, configPath, "root", runtime), /orchestrate description is empty/);
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
  registerWaitTool({ on() {}, registerTool: tool => { wait = tool; } }, {}, true, undefined, undefined, { nestedRootRunId: "fixture" });
  assert.equal(wait.name, "bg_wait");
  assert.match(wait.description, /This child runtime has no native completion notifier/);
  assert.match(wait.description, /use blocking bg_wait/);
});

test("plan mode rejects configured writers before resolving a child contract", async t => {
  const { config } = fixture(t);
  let resolved = 0;
  const ctx = { cwd: process.cwd(), isProjectTrusted: () => false, model: { provider: "openai-codex", id: "gpt-5.6-sol" }, modelRegistry: { find: () => true, isUsingOAuth: () => true, getAvailable: () => [] } };
  const resolve = async request => {
    resolved++;
    // The preflight resolves the contract under the trust the launch uses.
    assert.equal(request.projectTrusted, false);
    const child = config.agents[request.agent];
    return { ok: true, contract: { agent: { filePath: child.agentPath }, model: request.model ?? child.model, tools: { configuredExtensions: [child.extensionPath], effectiveAllowlist: child.tools }, digest: "fixture" } };
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

test("owned launch options keep an output schema and run any non-frontier tier pin", async t => {
  const { config } = fixture(t);
  const jiti = createJiti(import.meta.url);
  const { resolveSubagentLaunchContract } = await jiti.import("pi-subagents/preflight");
  const available = Object.values(config.models.tiers).map(id => ({ provider: "openai-codex", id }));
  const ctx = { cwd: process.cwd(), isProjectTrusted: () => true, modelRegistry: { find: (_provider, id) => ({ provider: "openai-codex", id }), isUsingOAuth: () => true, getAvailable: () => available } };
  const launch = () => ({ agent: "fixture-reader", task: "Inspect fixture" });
  const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] };
  let contract;
  const capture = async request => { const result = await resolveSubagentLaunchContract(request); contract = result.contract; return result; };
  const structured = launch();
  await checkChildLaunch(structured, config, "root", ctx, capture, "plan", { outputSchema: schema });
  assert.equal(structured.outputSchema, schema);
  assert.ok(contract.tools.effectiveAllowlist.includes("structured_output"));
  // Without the option, the internal tool is outside the role's scope.
  const schemaLaunch = request => resolveSubagentLaunchContract({ ...request, outputSchema: schema });
  await assert.rejects(checkChildLaunch(launch(), config, "root", ctx, schemaLaunch, "plan"), /tool scope differs/);
  const top = launch();
  await checkChildLaunch(top, config, "root", ctx, capture, "plan", { model: "openai-codex/gpt-5.6-sol" });
  assert.equal(top.model, "openai-codex/gpt-5.6-sol");
  assert.match(contract.model, /^openai-codex\/gpt-5\.6-sol(:|$)/);
  await assert.rejects(checkChildLaunch(launch(), config, "root", ctx, capture, "plan", { model: "openai-codex/gpt-6-astra" }), /Children never run the frontier tier/);
  await assert.rejects(checkChildLaunch(launch(), config, "root", ctx, capture, "plan", { model: "openai-codex/gpt-5.6-unknown" }), /outside the OpenAI tier policy/);
  // A preflight that resolves another model than the checked one is refused.
  const unpinned = async request => resolveSubagentLaunchContract({ ...request, model: undefined });
  await assert.rejects(checkChildLaunch(launch(), config, "root", ctx, unpinned, "plan", { model: "openai-codex/gpt-5.6-sol" }), /unpinned model/);
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

test("a denied authorization tells the requester the review's reason", { skip }, async t => {
  const { root, config } = fixture(t);
  const broker = await startBroker(config, root, async () => "it pushes to a remote");
  t.after(() => broker.close());
  await assert.rejects(requestBroker(broker.env, "root", { action: "authorize", tool: "bash", args: { command: "git push" } }), /Action not approved: it pushes to a remote\. Do not pursue the same outcome another way/);
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
  assert.deepEqual(Object.keys(subagentSchema.properties).sort(), ["action", "agent", "context", "id", "message", "options", "task", "title"]);
  assert.equal(subagentSchema.additionalProperties, false);
  // pi validates every call against the registered schema before any hook runs.
  const call = (id, args) => validateToolArguments(tools.get("subagent"), { type: "toolCall", id, name: "subagent", arguments: args });
  call("v-launch", { agent: "fixture-reader", task: "Inspect fixture", title: "Fixture check", context: "fresh" });
  call("v-status", { action: "status", id: "run", options: { view: "transcript", lines: 50 } });
  // The shape pi-subagents' own control notice teaches.
  call("v-steer", { action: "steer", id: "run", message: "Narrow the scope", options: { index: 0 } });
  assert.throws(() => call("v-model", { agent: "fixture-reader", task: "Inspect fixture", model: "x" }), /additional properties/);
  assert.equal(tools.get("subagent").description, "Managed fixture: named asynchronous children only.");
  assert.doesNotMatch(tools.get("subagent").description, /workflowScript|runs\.|SAFETY-CRITICAL/);
  // pi's MCP tools register once their servers connect; deferred ones load through tool_search.
  assert.ok(tools.has("tool_search"));
  assert.equal(tools.has("codemode"), false);
  assert.ok(tools.has("orchestrate"));
  const orchestrateSchema = tools.get("orchestrate").parameters;
  assert.deepEqual(Object.keys(orchestrateSchema.properties).sort(), ["args", "script", "title"]);
  assert.equal(orchestrateSchema.additionalProperties, false);
  assert.ok(tools.has("submit_plan"));
  assert.equal(tools.get("submit_plan").executionMode, "sequential");
  assert.equal(tools.get("orchestrate").executionMode, "sequential");
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
  const ctx = { cwd: process.cwd(), isProjectTrusted: () => true, modelRegistry: { find: (_provider, id) => ({ provider: "openai-codex", id }), isUsingOAuth: () => true, getAvailable: () => [{ provider: "openai-codex", id: "gpt-5.6-luna" }] } };
  const args = { agent: "fixture-reader", task: "Inspect fixture" };
  await checkChildLaunch(args, config, "root", ctx, resolveSubagentLaunchContract, "plan");
  assert.equal(args.agentScope, "user");
  const blocking = { agent: "fixture-reader", task: "Inspect fixture", async: false };
  await checkChildLaunch(blocking, config, "root", ctx, resolveSubagentLaunchContract, "plan");
  assert.equal(blocking.async, true);
  // Keys the upstream schema advertises are dropped, not refused: every observed
  // first launch carried some of them and the refusal cost a turn per batch.
  // model and outputSchema are owned launch options, never the model's own args.
  const noisy = { ...args, title: "Fixture check", cwd: "/elsewhere", toolBudget: { hard: 20 }, acceptance: false, context: "fork", model: "openai-codex/gpt-5.6-sol", outputSchema: { type: "object" } };
  let contract;
  await checkChildLaunch(noisy, config, "root", ctx, async request => { const result = await resolveSubagentLaunchContract(request); contract = result.contract; return result; }, "plan");
  assert.deepEqual(Object.keys(noisy).sort(), ["agent", "agentScope", "async", "context", "task"]);
  assert.equal(noisy.context, "fork");
  assert.match(contract.model, /^openai-codex\/gpt-5\.6-luna(:|$)/);
  const titled = { action: "status", id: "run", title: "Fixture status" };
  await checkChildLaunch(titled, config, "root", ctx, resolveSubagentLaunchContract, "plan");
  assert.equal("title" in titled, false);
  // pi validates a clone, so the stored toolCall keeps the display title the launch drops.
  const toolCall = { type: "toolCall", id: "call-t", name: "subagent", arguments: { agent: "fixture-reader", task: "Inspect fixture", title: "Fixture check" } };
  const validated = validateToolArguments(tools.get("subagent"), toolCall);
  await checkChildLaunch(validated, config, "root", ctx, resolveSubagentLaunchContract, "plan");
  assert.equal(toolCall.arguments.title, "Fixture check");
  assert.equal("title" in validated, false);
  const profile = { ...args, context: "profile" };
  await checkChildLaunch(profile, config, "root", ctx, resolveSubagentLaunchContract, "plan");
  assert.equal("context" in profile, false);
  const transcript = { action: "status", id: "run", options: { view: "transcript", lines: 50 } };
  await checkChildLaunch(transcript, config, "root", ctx, resolveSubagentLaunchContract, "plan");
  assert.equal(transcript.steeringRecovery, false);
  await assert.rejects(checkChildLaunch({ action: "status", id: "run", options: { view: "events" } }, config, "root", ctx, resolveSubagentLaunchContract, "plan"), /not enabled/);
  await assert.rejects(checkChildLaunch({ action: "status", id: "run", options: { dir: "/elsewhere" } }, config, "root", ctx, resolveSubagentLaunchContract, "plan"), /not enabled/);
  await assert.rejects(checkChildLaunch({ action: "status", id: "run", view: "fleet" }, config, "root", ctx, resolveSubagentLaunchContract, "plan"), /not enabled/);
  const list = { action: "list", options: { capabilities: true } };
  await checkChildLaunch(list, config, "root", ctx, resolveSubagentLaunchContract, "plan");
  assert.equal(list.agentScope, "user");
  await assert.rejects(checkChildLaunch({ action: "list", options: { view: "fleet" } }, config, "root", ctx, resolveSubagentLaunchContract, "plan"), /not enabled/);

});

test("orchestrate runs through the root wiring: owned notices drop while busy, and a mode change stops a live run before the broker switches", async t => {
  const { config } = fixture(t);
  config.models.classifierFilter = config.models.classifierJudge = { model: "gpt-5.6-luna", reasoningEffort: "low" };
  const configPath = join(config.agentDir, "workflow.json");
  writeFileSync(configPath, JSON.stringify(config));
  const handlers = new Map();
  const tools = new Map();
  const commands = new Map();
  const sent = [];
  const order = [];
  const appended = [];
  const entries = [];
  const events = new EventEmitter();
  let level = "low";
  const pi = {
    getThinkingLevel: () => level, setThinkingLevel: next => { level = next; },
    events: { on(name, fn) { events.on(name, fn); return () => events.off(name, fn); }, emit: (...args) => events.emit(...args) },
    on(name, fn) { const list = handlers.get(name) ?? []; list.push(fn); handlers.set(name, list); },
    registerTool(tool) { tools.set(tool.name, tool); }, registerCommand(name, command) { commands.set(name, command); },
    registerShortcut() {}, registerFlag() {}, registerMessageRenderer() {}, registerToolRenderer() {}, registerMarkdownTransformer() {}, registerEntryRenderer() {}, appendEntry: (type, data) => { appended.push(type); entries.push({ type, data }); },
    sendMessage: (message, options) => { sent.push({ message, options }); },
    getFlag() { return false; }, getAllTools() { return [...tools.values()]; },
    getActiveTools() { return [...tools.keys()]; }, setActiveTools() {}, getMcpServers() { return []; },
    getCommands: () => [...[...commands.keys()].map(name => ({ name, source: "extension" })), { name: "skill:x", source: "skill" }],
  };
  const spawned = [];
  let onSpawn;
  events.on("subagents:rpc:v1:request", ({ requestId, method, params }) => {
    const reply = data => events.emit(`subagents:rpc:v1:reply:${requestId}`, { success: true, data });
    if (method === "spawn") { const runId = `run-${spawned.push(params)}`; reply({ details: { runId, asyncDir: `/tmp/async/${runId}` } }); onSpawn?.(); }
    else if (method === "ping") reply({ capabilities: { stop: true } });
    else if (method === "status") reply({ asyncSnapshot: { version: 1, runs: [] }, details: {} });
    else if (method === "stop") {
      order.push(`stop:${params.id}`);
      reply({ runId: params.id, state: "stopping" });
      events.emit("subagent:process-terminal", { state: "observed", runId: params.id });
      events.emit("subagent:async-complete", { runId: params.id, success: false, state: "stopped", results: [{ status: "stopped" }] });
    }
  });
  const policy = { mode: "plan", epoch: 1, approval: "auto" };
  const broker = { env: {}, policy, setMode: async mode => { order.push(`mode:${mode}`); policy.mode = mode; }, close: async () => { order.push("close"); } };
  let captured;
  const { installWorkflow } = await import("./index.mjs");
  await installWorkflow(pi, configPath, "root", { startBroker: async () => broker, requestBroker: async () => ({ mode: policy.mode }), installSubagents: styled => { captured = styled; } });
  t.after(() => handlers.get("session_shutdown").find(handler => handler.name === "shutdown")());
  let idle = true;
  const available = Object.values(config.models.tiers).map(id => ({ provider: "openai-codex", id }));
  const statuses = new Map();
  // The root installs its TUI surfaces only for a UI session start; the
  // orchestrate gate reads hasUI from the tool call's ctx.
  const ctx = {
    cwd: process.cwd(), hasUI: false, isIdle: () => idle, isProjectTrusted: () => true,
    sessionManager: { getSessionId: () => "orchestrate-root", getBranch: () => [] },
    modelRegistry: { find: (_provider, id) => ({ provider: "openai-codex", id }), isUsingOAuth: () => true, getAvailable: () => available },
    ui: { setStatus(key, value) { statuses.set(key, value); }, setToolsExpanded() {}, notify() {} },
  };
  for (const handler of handlers.get("session_start")) await handler({ reason: "startup" }, ctx);
  ctx.hasUI = true;
  order.length = 0;
  const run = () => tools.get("orchestrate").execute("o1", { script: 'return await agent("look", { agentType: "fixture-reader", label: "Look" })' }, new AbortController().signal, undefined, ctx);
  // pi stops at the first `handled`, as runner.js's input dispatch does.
  const input = (text, source = "user") => { for (const handler of handlers.get("input")) { const result = handler({ source, text, streamingBehavior: "followUp" }, ctx); if (result?.action === "handled") return result; } return { action: "continue" }; };
  const deliver = text => { for (const handler of handlers.get("message_start")) handler({ message: { role: "user", content: [{ type: "text", text }] } }, ctx); };
  const arm = () => { input("ultracode: run it"); deliver("ultracode: run it"); };
  // An interactive /word naming no command, template or skill is refused; paths, known names and other sources continue.
  const notices = [];
  ctx.ui.notify = (text, level) => notices.push([level, text]);
  for (const text of ["/nope", "/skill:nope do it"]) assert.deepEqual(input(text, "interactive"), { action: "handled" });
  assert.deepEqual(notices, [["error", "/nope was not sent: no extension command, template or skill by that name"], ["error", "/skill:nope was not sent: no extension command, template or skill by that name"]]);
  for (const [text, source] of [["/skill:x go", "interactive"], ["/btw why?", "interactive"], ["/a/b c", "interactive"], ["plain", "interactive"], ["/nope", "extension"], ["/nope", "rpc"]]) assert.deepEqual(input(text, source), { action: "continue" }, text);
  // Print mode sends its prompt as interactive with no UI; refusing it would drop it silently.
  ctx.hasUI = false;
  assert.deepEqual(input("/nope", "interactive"), { action: "continue" });
  ctx.hasUI = true;
  assert.equal(notices.length, 2);
  ctx.ui.notify = () => {};
  // ultrathink holds through agent_end (retries and continuations re-run the loop) until the prompt settles.
  deliver("ultrathink it");
  assert.equal(level, "max");
  input("ultracode", "extension");
  deliver("ultracode");
  for (const handler of handlers.get("agent_end")) handler({}, ctx);
  assert.equal(level, "max");
  for (const handler of handlers.get("agent_settled")) handler({}, ctx);
  assert.equal(level, "low");
  // Text an extension injects never arms the opt-in, even once delivered.
  input("ultracode", "extension");
  deliver("ultracode");
  await assert.rejects(run(), /Ultracode is off/);
  // A queued prompt arms only at its delivery, its user message_start.
  input("ultracode: queued");
  await assert.rejects(run(), /Ultracode is off/);
  deliver("ultracode: queued");
  const quick = () => tools.get("orchestrate").execute("o0", { script: "return 1" }, new AbortController().signal, undefined, ctx);
  assert.match((await quick()).content[0].text, /^0 agents · completed/);
  // It stays on across a plain prompt and a tree move; a new session resets it.
  deliver("plain follow-up");
  assert.match((await quick()).content[0].text, /^0 agents · completed/);
  assert.equal(statuses.get("workflow"), "plan auto ultracode");
  for (const handler of handlers.get("session_tree")) await handler({}, ctx);
  assert.match((await quick()).content[0].text, /^0 agents · completed/);
  assert.equal(statuses.get("workflow"), "plan auto ultracode");
  ctx.hasUI = false;
  for (const handler of handlers.get("session_start")) await handler({ reason: "new" }, ctx);
  ctx.hasUI = true;
  await assert.rejects(run(), /Ultracode is off/);
  assert.equal(statuses.get("workflow"), "plan auto");
  const section = async () => {
    const event = { systemPromptOptions: { sections: {}, contextFiles: [], skills: [] } };
    for (const handler of handlers.get("before_agent_start")) await handler(event, ctx);
    return event.systemPromptOptions.sections.workflow;
  };
  assert.doesNotMatch(await section(), /Ultracode/);
  // /ultracode toggles it, with a π note and the status word.
  await commands.get("ultracode").handler("", ctx);
  assert.equal(statuses.get("workflow"), "plan auto ultracode");
  assert.deepEqual(entries.at(-1), { type: "workflow-note", data: { text: "Ultracode on for this session" } });
  assert.match(await section(), / Ultracode is on\.$/);
  assert.match((await quick()).content[0].text, /^0 agents · completed/);
  await commands.get("ultracode").handler("", ctx);
  assert.equal(statuses.get("workflow"), "plan auto");
  assert.deepEqual(entries.at(-1), { type: "workflow-note", data: { text: "Ultracode off" } });
  await assert.rejects(quick(), /Ultracode is off/);
  arm();
  order.length = 0;
  const launched = () => new Promise(resolve => { onSpawn = () => setImmediate(resolve); });
  idle = false;
  let spawn = launched();
  const first = run();
  await spawn;
  assert.equal(spawned[0].agent, "fixture-reader");
  assert.equal(spawned[0].agentScope, "user");
  assert.equal(spawned[0].async, true);
  assert.equal("title" in spawned[0], false);
  events.emit("subagent:async-complete", { runId: "run-1", success: true, results: [{ status: "completed", output: "seen" }] });
  const result = await first;
  assert.match(result.content[0].text, /seen/);
  assert.equal(result.details.runs[0].runId, "run-1");
  // The workflow's child draws no completion line: the orchestrate row is its outcome.
  assert.equal(appended.includes("workflow-child"), false);
  // index.mjs hands orchestrate's ownership to the Proxy: the notice pi-subagents
  // sends after the completion is dropped while the root is busy; an unowned one is forwarded.
  captured.sendMessage({ customType: "subagent-notify", content: "x", display: true, details: { runs: [{ runId: "run-1" }] } }, { triggerTurn: true });
  assert.equal(sent.length, 0);
  captured.sendMessage({ customType: "subagent-notify", content: "x", display: true, details: { runs: [{ runId: "other" }] } }, { triggerTurn: true });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].message.details.runs, [{ runId: "other" }]);
  // Through the root check and the live broker mode, still plan.
  onSpawn = () => setImmediate(() => events.emit("subagent:async-complete", { runId: `run-${spawned.length}`, success: true, results: [{ status: "completed", output: "ok", structuredOutput: { ok: true } }] }));
  const planned = await tools.get("orchestrate").execute("o2", { script: 'let refused; try { await agent("x", { agentType: "fixture-writer" }) } catch (e) { refused = e.message } return [refused, await agent("x", { agentType: "fixture-reader", tier: "top" }), await agent("x", { agentType: "fixture-reader", schema: { type: "object" } })]' }, new AbortController().signal, undefined, ctx);
  const [refused, top, typed] = JSON.parse(planned.content[0].text.split("\n\n")[1]);
  assert.match(refused, /plan mode/i);
  assert.deepEqual([top, typed], ["ok", { ok: true }]);
  assert.deepEqual(spawned.slice(1).map(params => params.agent), ["fixture-reader", "fixture-reader"]);
  assert.equal(spawned[1].model, "openai-codex/gpt-5.6-sol");
  assert.deepEqual(spawned[2].outputSchema, { type: "object" });
  // A mode change aborts the live run, stops its child and only then switches the broker.
  spawn = launched();
  const second = run().then(result => { order.push("settled"); return result; });
  await spawn;
  await commands.get("execute").handler("", ctx);
  const interrupted = await second;
  assert.equal(interrupted.isError, true);
  assert.match(interrupted.content[0].text, /Workflow interrupted/);
  assert.deepEqual(interrupted.details.runs.map(run => [run.runId, run.status]), [["run-4", "stopped"]]);
  assert.deepEqual(order, ["stop:run-4", "settled", "mode:execute"]);
  // Shutdown ends a live run and stops its child before the broker closes,
  // and puts back a level ultrathink raised.
  spawn = launched();
  const third = run();
  await spawn;
  deliver("ultrathink it");
  assert.equal(level, "max");
  await handlers.get("session_shutdown").find(handler => handler.name === "shutdown")();
  assert.equal(level, "low");
  assert.match((await third).content[0].text, /Workflow interrupted/);
  assert.ok(order.includes("stop:run-5") && order.indexOf("stop:run-5") < order.indexOf("close"), order.join(","));
});

test("only a TUI root reports to herdr, re-anchoring first and suspending before awaited cleanup", async t => {
  const { config, root } = fixture(t);
  config.models.classifierFilter = config.models.classifierJudge = { model: "gpt-5.6-luna", reasoningEffort: "low" };
  const configPath = join(config.agentDir, "workflow.json");
  writeFileSync(configPath, JSON.stringify(config));
  const frames = [];
  const socketPath = join(root, "h.sock");
  t.mock.method(net, "createConnection", () => {
    const socket = new EventEmitter();
    socket.destroy = () => {};
    socket.write = line => { frames.push(JSON.parse(line)); queueMicrotask(() => socket.emit("data", "{}\n")); };
    queueMicrotask(() => socket.emit("connect"));
    return socket;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const previous = { HERDR_ENV: process.env.HERDR_ENV, HERDR_SOCKET_PATH: process.env.HERDR_SOCKET_PATH, HERDR_PANE_ID: process.env.HERDR_PANE_ID };
  Object.assign(process.env, { HERDR_ENV: "1", HERDR_SOCKET_PATH: socketPath, HERDR_PANE_ID: "p1" });
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const { installWorkflow } = await import("./index.mjs");
  // A fresh install per mode: herdr is wired only at the first UI session start.
  const start = async (mode, close = async () => {}) => {
    const handlers = new Map();
    const bus = new EventEmitter();
    const events = { on: (name, fn) => { bus.on(name, fn); return () => bus.off(name, fn); }, emit: (name, payload) => bus.emit(name, payload) };
    events.on("subagents:rpc:v1:request", request => events.emit(`subagents:rpc:v1:reply:${request.requestId}`, { success: true, data: request.method === "ping"
      ? { capabilities: { stop: true } }
      : { fleet: { entries: [], totalActive: 0 }, asyncSnapshot: { version: 1, runs: [] } } }));
    const pi = {
      events, getThinkingLevel: () => "low", setThinkingLevel() {},
      on(name, fn) { const list = handlers.get(name) ?? []; list.push(fn); handlers.set(name, list); },
      registerTool() {}, registerCommand() {}, registerShortcut() {}, registerFlag() {}, registerMessageRenderer() {}, registerToolRenderer() {}, registerMarkdownTransformer() {}, registerEntryRenderer() {}, appendEntry() {},
      sendMessage() {}, getFlag() { return false; }, getAllTools: () => [], getActiveTools: () => [], setActiveTools() {}, getMcpServers: () => [],
    };
    const policy = { mode: "plan", epoch: 1, approval: "auto" };
    const InteractiveMode = class { getUserMessageText() {} updatePendingMessagesDisplay() {} };
    await installWorkflow(pi, configPath, "root", { startBroker: async () => ({ env: {}, policy, setMode: async next => { policy.mode = next; }, close }), requestBroker: async () => ({ mode: policy.mode }), installSubagents() {}, InteractiveMode, AssistantMessageComponent: class { updateContent() {} } });
    const ui = { setStatus() {}, setToolsExpanded() {}, getToolsExpanded: () => false, notify() {}, setWorkingVisible() {}, setWidget() {}, setFooter() {}, setHeader() {}, setEditorComponent() {}, addAutocompleteProvider() {} };
    const ctx = {
      cwd: process.cwd(), mode, hasUI: true, isIdle: () => true, isProjectTrusted: () => true, model: { provider: "openai-codex", id: "gpt-5.6-sol" }, getContextUsage: () => null,
      sessionManager: { getSessionId: () => `herdr-${mode}`, getSessionFile: () => `/abs/${mode}.jsonl`, getBranch: () => [] },
      modelRegistry: { find: (_provider, id) => ({ provider: "openai-codex", id }), isUsingOAuth: () => true, getAvailable: () => [] }, ui,
    };
    const fire = async (name, event = {}) => { for (const handler of handlers.get(name) ?? []) await handler(event, ctx); };
    await fire("session_start", { reason: "startup" });
    t.after(() => fire("session_shutdown", { reason: "quit" }));
    return fire;
  };
  await start("rpc");
  await flush();
  assert.deepEqual(frames, [], "RPC reports hasUI with no pane to show");
  let releaseCleanup, cleanupStarted = false;
  const cleanup = new Promise(resolve => { releaseCleanup = resolve; });
  t.after(() => releaseCleanup());
  const fire = await start("tui", () => { cleanupStarted = true; return cleanup; });
  await flush();
  assert.equal(frames[0].method, "pane.report_agent_session");
  assert.equal(frames[0].params.session_start_source, "startup");
  assert.equal(frames[0].params.agent_session_path, "/abs/tui.jsonl");
  assert.ok(frames.findIndex(frame => frame.method === "pane.report_agent") > 0);

  t.mock.timers.enable({ apis: ["setTimeout"] });
  await fire("agent_start");
  await flush();
  assert.equal(frames.at(-1).params.state, "working");
  await fire("agent_settled");
  t.mock.timers.tick(100);
  const closing = fire("session_shutdown", { reason: "switch" });
  await flush();
  assert.ok(cleanupStarted, "shutdown is awaiting cleanup before later handlers run");
  const before = frames.length;
  t.mock.timers.tick(300);
  await flush();
  assert.equal(frames.length, before, "no delayed idle while shutdown awaits cleanup");
  releaseCleanup();
  await closing;
  await fire("session_start", { reason: "new" });
  await flush();
  assert.deepEqual(frames.slice(before).map(frame => [frame.method, frame.params.session_start_source ?? frame.params.state]), [["pane.report_agent_session", "new"], ["pane.report_agent", "idle"]]);
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
    getFlag() { return false; }, getAllTools() { return [...tools.values()]; }, getActiveTools() { return [...tools.keys()]; }, setActiveTools(names) { activeTools.push(names); }, getCommands: () => [],
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
  // An idle triggerTurn starts a run without prompt(); pi prepares it with
  // before_agent_start and the wrapper guards the model itself.
  const session = Object.create(AgentSession.prototype);
  const prompted = [];
  const appended = [];
  Object.assign(session, {
    _pendingNextTurnMessages: [], _baseSystemPromptOptions: { ...promptEvent.systemPromptOptions, sections: {}, selectedTools: [] },
    _extensionRunner: {
      createContext: () => ctx,
      async emitBeforeAgentStart(trigger, base) {
        const options = structuredClone(base);
        const prompt = trigger.messageType === "custom" ? trigger.message.content : trigger.prompt;
        for (const handler of handlers.get("before_agent_start")) await handler({ prompt, systemPromptOptions: options }, ctx);
        return { messages: [], systemPromptOptions: options };
      },
    },
    agent: { state: { messages: [] }, prompt: async messages => prompted.push({ messages, options: session._runSystemPromptOptions }) },
    getActiveToolNames: () => ["workspace_read"], _preparePromptAndToolLoadout: () => undefined,
    _pendingToolNames: new Set(), _recordSelection() {}, _handlePostAgentRun: async () => false, _runBeforeSettleBoundary: async () => false,
    _flushPendingBashMessages() {}, _flushPendingCustomMessages() {}, _emitAgentSettled: async () => { session._isAgentRunActive = false; }, _appendCustomMessage: message => appended.push(message.content),
  });
  await session.sendCustomMessage({ customType: "workflow-shell", content: "Ran `pwd`", display: false }, { triggerTurn: true });
  assert.equal(prompted.length, 1);
  assert.match(prompted[0].options.sections.workflow, /Workflow mode: plan/);
  assert.match(prompted[0].options.sections.skills, /<name>fixture-skill<\/name>/);
  assert.equal(session._runSystemPromptOptions, undefined);
  // A second idle trigger while the first is still preparing queues behind it.
  const queued = [];
  session.agent.followUp = message => queued.push(message);
  await Promise.all([1, 2].map(n => session.sendCustomMessage({ customType: "workflow-shell", content: `Ran ${n}`, display: false }, { triggerTurn: true, deliverAs: "followUp" })));
  assert.equal(prompted.length, 2);
  assert.deepEqual(queued.map(message => message.content), ["Ran 2"]);
  // A refused custom trigger keeps its notice without a turn.
  ctx.model = { provider: "openai-codex", id: "unmanaged" };
  await assert.rejects(session.sendCustomMessage({ customType: "workflow-shell", content: "Ran `pwd`", display: false }, { triggerTurn: true }), /Select an available managed OpenAI subscription model/);
  assert.equal(prompted.length, 2, "a refused run never reaches agent.prompt");
  assert.deepEqual(appended, ["Ran `pwd`"]);
  assert.equal(session.isStreaming, false);
  ctx.model = { provider: "openai-codex", id: "gpt-5.6-sol" };
  // Ordinary prompt() starts through the same entry: a disallowed model is
  // refused before the run is prepared.
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
  assert.deepEqual(preparation, []);
  ctx.model = { provider: "openai-codex", id: "gpt-5.6-sol" };
  ctx.modelRegistry.isUsingOAuth = () => false;
  await assert.rejects(ordinary.prompt("Ordinary API prompt"), /Select an available managed OpenAI subscription model/);
  assert.equal(ordinaryPrompts.length, 0);
  assert.deepEqual(preparation, []);
  ctx.modelRegistry.isUsingOAuth = () => true;
  // The frontier tier is the root's own.
  ctx.model = { provider: "openai-codex", id: "gpt-6-astra" };
  await ordinary.prompt("Ordinary subscription prompt");
  assert.deepEqual(preparation, ["before_agent_start", "loadout", "agent.prompt"]);
  assert.equal(ordinaryPrompts.length, 1);
  assert.deepEqual(ordinaryPrompts[0].map(message => ({ role: message.role, content: message.content })), [{ role: "user", content: [{ type: "text", text: "Ordinary subscription prompt" }] }]);
  assert.equal(ordinary._runSystemPromptOptions, undefined);
  ctx.model = { provider: "openai-codex", id: "gpt-5.6-sol" };
  assert.deepEqual(activeTools.at(-1), ["workspace_read", "workspace_write", "workspace_edit", "workspace_grep", "workspace_find", "workspace_ls", "workspace_bash", "workspace_task", "orchestrate", "submit_plan", "subagent", "web_search", "web_fetch"]);
  let orchestrateVerdict;
  for (const handler of handlers.get("tool_call")) orchestrateVerdict ??= await handler({ toolName: "orchestrate", input: { script: "return 1" } }, ctx);
  assert.equal(orchestrateVerdict, undefined, "the root's tool_call hook admits orchestrate; its execute gates the run");
  let structuredVerdict;
  for (const handler of handlers.get("tool_call")) structuredVerdict ??= await handler({ toolName: "structured_output", input: {} }, ctx);
  assert.equal(structuredVerdict?.block, true, "structured_output is a child's tool only");
  assert.deepEqual(tools.get("ask_user_question").renderCall().render(), []);
  ctx.hasUI = true;
  for (const handler of handlers.get("input") ?? []) handler({ source: "interactive", text: "/nope typo'd" }, ctx);
  ctx.hasUI = false;
  for (const handler of handlers.get("input") ?? []) handler({ source: "user", text: "Choose implementation." }, ctx);
  const completed = {
    toolName: "ask_user_question",
    result: { details: { cancelled: false, answers: [{ id: 1, header: "Direction", question: "Which complete direction should we take?", selected: [{ number: 1, label: "Fast", note: "keeps the exact note" }, { number: 2, label: "Safe" }], custom: "raw custom: 1,3" }] } },
  };
  for (const handler of handlers.get("tool_execution_end") ?? []) handler(completed, ctx);
  assert.deepEqual(entries.at(-1), { type: "workflow-answers", data: { answers: [{ question: "Which complete direction should we take?", answer: "Fast — keeps the exact note; Safe", notes: "raw custom: 1,3" }] } });
  await review({ approval: "auto", tool: "bash", args: { command: "true" } });
  assert.match(classified, /User decision: Which complete direction should we take\? → Fast — keeps the exact note; Safe — raw custom: 1,3/);
  assert.doesNotMatch(classified, /typo'd/, "a refused command stays out of the classifier task");
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
  await installWorkflow(pi, configPath, "fixture-docs", { requestBroker, AgentSession });
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
  // A child run on the frontier pin is refused even off the tool_call path (RPC spawn, /run).
  const run = Object.assign(Object.create(AgentSession.prototype), { _extensionRunner: { createContext: () => ({ ...ctx, model: { provider: "openai-codex", id: "gpt-6-astra" } }) } });
  await assert.rejects(run._startRun({ messageType: "user" }), /Children never run the frontier tier/);
  assert.deepEqual(activeTools.at(-1).filter(name => name.startsWith("mcp__")), ["mcp__docs__search"]);
  const call = async (toolName, input = {}) => {
    let verdict;
    for (const handler of handlers.get("tool_call")) verdict ??= await handler({ toolName, input }, ctx);
    return verdict;
  };
  assert.equal((await call("mcp__docs__other"))?.block, true);
  assert.equal((await call("orchestrate", { script: "return 1" }))?.block, true, "orchestrate is root-only");
  assert.equal(await call("structured_output", { value: 1 }), undefined, "a child may record its structured output");
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

test("the tool renderer resolver draws plugin-registered and unregistered MCP calls as plugin rows, in every role, and defers other names", async t => {
  const { config } = fixture(t);
  config.models.classifierFilter = { model: "gpt-5.6-luna", reasoningEffort: "low" };
  config.models.classifierJudge = { model: "gpt-5.6-luna", reasoningEffort: "low" };
  config.mcp = { docs: { policy: { denied_tools: [] } } };
  config.agents["fixture-search"] = { ...config.agents["fixture-reader"], tools: ["workspace_read", "web_search"] };
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
    api.registerTool({ name: "subagent", execute() {} });
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
  for (const name of ["subagent", "web_search"]) assert.equal(typeof resolve(name, () => assert.fail(`${name} is not deferred`)).renderCall, "function");
  const native = {};
  assert.equal(resolve("read", () => native), native);
  // A child role keeps plugin rows for the plugins it loads.
  resolvers.length = 0;
  const childHandlers = new Map();
  await installWorkflow({ ...pi, on(name, fn) { const list = childHandlers.get(name) ?? []; list.push(fn); childHandlers.set(name, list); } }, configPath, "fixture-search", { requestBroker: async () => ({ mode: broker.policy.mode, readonly: true }) });
  t.after(async () => { for (const handler of childHandlers.get("session_shutdown")) await handler({ reason: "quit" }, {}); });
  assert.equal(typeof resolve("web_search", () => assert.fail("web_search is not deferred")).renderCall, "function");
  assert.equal(resolve("subagent", () => native), native);
});
