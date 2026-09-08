import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createConnection, createServer } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import { startBroker, requestBroker, acquireChild } from "./broker.mjs";
import { checkChildLaunch } from "./children.mjs";

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
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const role = { readonly: true, tools: ["workspace_read"], model: "openai-codex/gpt-5.6-luna", thinking: "low", agentPath: join(agentDir, "agents", "fixture-reader.md"), extensionPath: join(agentDir, "reader.ts") };
  writeFileSync(role.extensionPath, "export default function () {}\n");
  writeFileSync(role.agentPath, `---\nname: fixture-reader\ndescription: Fixture\nmodel: ${role.model}\nthinking: low\ntools: workspace_read\nextensions: ${role.extensionPath}\n---\nRead only.\n`);
  const config = { version: 1, agentDir, models: { provider: "openai-codex", default: "gpt-5.6-sol", defaultEffort: "medium", planEffort: "high", tiers: { small: "gpt-5.6-luna", top: "gpt-5.6-sol", frontier: "gpt-6-astra" } }, filesystem: { denyRead: [], denyWrite: [], allowWrite: [] }, network: { allowedDomains: [] }, agents: { "fixture-reader": role }, mcp: {} };
  return { root, config };
}

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
  assert.ok(tools.has("workspace_read"));
  assert.ok(tools.has("subagent"));
  assert.ok(tools.has("submit_plan"));
  assert.ok(tools.has("ask_user_question"));
  assert.ok(!tools.has("ask_user"));
  assert.ok(!tools.has("read"));
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
  await checkChildLaunch(args, config, "root", ctx, resolveSubagentLaunchContract);
  assert.equal(args.agentScope, "user");
  const blocking = { agent: "fixture-reader", task: "Inspect fixture", async: false };
  await checkChildLaunch(blocking, config, "root", ctx, resolveSubagentLaunchContract);
  assert.equal(blocking.async, true);
  await assert.rejects(checkChildLaunch({ ...args, workflowScript: "bad" }, config, "root", ctx, resolveSubagentLaunchContract), /workflow scripts/);
  // Keys the upstream schema advertises are dropped, not refused: every observed
  // first launch carried some of them and the refusal cost a turn per batch.
  const noisy = { ...args, cwd: "/elsewhere", toolBudget: { hard: 20 }, acceptance: false, context: "fork" };
  await checkChildLaunch(noisy, config, "root", ctx, resolveSubagentLaunchContract);
  assert.deepEqual(Object.keys(noisy).sort(), ["agent", "agentScope", "async", "context", "task"]);
  assert.equal(noisy.context, "fork");
  const profile = { ...args, context: "profile" };
  await checkChildLaunch(profile, config, "root", ctx, resolveSubagentLaunchContract);
  assert.equal("context" in profile, false);
  const transcript = { action: "status", id: "run", view: "transcript", lines: 50 };
  await checkChildLaunch(transcript, config, "root", ctx, resolveSubagentLaunchContract);
  assert.equal(transcript.steeringRecovery, false);
  await assert.rejects(checkChildLaunch({ action: "status", id: "run", view: "events" }, config, "root", ctx, resolveSubagentLaunchContract), /not enabled/);
  // Session-varying values would change pi-mcp-adapter's cache key every launch.
  assert.deepEqual(mcpServerDefinitions({ mcp: { docs: { policy: { denied_tools: ["x"] } } } }, "root").docs.env, { PI_WORKFLOW_ROLE: "root" });
  const list = { action: "list", capabilities: true };
  await checkChildLaunch(list, config, "root", ctx, resolveSubagentLaunchContract);
  assert.equal(list.agentScope, "user");
  await assert.rejects(checkChildLaunch({ action: "list", view: "fleet" }, config, "root", ctx, resolveSubagentLaunchContract), /not enabled/);
  // Exercise only our cleanup: upstream lifecycle callbacks require a real Pi session.
  await handlers.get("session_shutdown").at(-1)();
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
  await checkChildLaunch(resolved, config, "root", ctxFor("gpt-5.6-sol"), resolve);
  assert.deepEqual([resolve.model, resolved.model], ["openai-codex/gpt-5.6-sol", "openai-codex/gpt-5.6-sol"]);
  await assert.rejects(checkChildLaunch(launch(), config, "root", ctxFor("gpt-5-other"), resolve), /tier policy/);
  await assert.rejects(checkChildLaunch(launch(), config, "fixture-reader", ctxFor("gpt-5.6-sol"), resolve), /delegate to writers/);
});
