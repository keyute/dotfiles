import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import { startBroker, requestBroker, acquireChild } from "./broker.mjs";
import { checkChildLaunch } from "./children.mjs";
import { memoryTransport } from "./memory-transport.mjs";

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

test("broker does not expose its credential to the classifier and invalidates pending approval", async t => {
  const { root, config } = fixture(t);
  const transport = memoryTransport();
  let finish;
  let received;
  let reached;
  const reviewStarted = new Promise(resolve => { reached = resolve; });
  const broker = await startBroker(config, root, request => {
    received = request;
    reached();
    return new Promise(resolve => { finish = resolve; });
  }, transport);
  t.after(() => broker.close());
  const pending = requestBroker(broker.env, "root", { action: "authorize", tool: "bash", args: { command: "pwd" } }, transport.connect);
  await reviewStarted;
  assert.equal(received.token, undefined);
  await broker.setMode("execute");
  finish(true);
  await assert.rejects(pending, /denied/);
  await assert.rejects(requestBroker({ ...broker.env, PI_WORKFLOW_TOKEN: "invalid" }, "root", { action: "state" }, transport.connect), /denied/);
});

test("pinned upstream packages register against the managed extension and preflight custom child tools", async t => {
  const { config } = fixture(t);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = config.agentDir;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });
  const configPath = join(config.agentDir, "workflow.json");
  writeFileSync(configPath, JSON.stringify(config));
  const handlers = new Map();
  const tools = new Map();
  const events = new EventEmitter();
  const pi = {
    events: { on(name, fn) { events.on(name, fn); return () => events.off(name, fn); }, emit: (...args) => events.emit(...args) },
    on(name, fn) { const list = handlers.get(name) ?? []; list.push(fn); handlers.set(name, list); },
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand() {}, registerShortcut() {}, registerFlag() {}, registerMessageRenderer() {},
    getFlag() { return false; }, getAllTools() { return [...tools.values()]; },
    getActiveTools() { return [...tools.keys()]; }, setActiveTools() {}, setThinkingLevel() {},
  };
  const { installWorkflow } = await import("./index.mjs");
  const transport = memoryTransport();
  await installWorkflow(pi, configPath, "root", { startBroker: (config, cwd, review) => startBroker(config, cwd, review, transport), requestBroker: (env, role, request) => requestBroker(env, role, request, transport.connect) });
  assert.ok(tools.has("workspace_read"));
  assert.ok(tools.has("subagent"));
  assert.ok(tools.has("submit_plan"));
  assert.ok(!tools.has("read"));
  await assert.rejects(tools.get("workspace_read").execute("test", { path: "fixture" }), /not ready/);
  const jiti = createJiti(import.meta.url);
  const { resolveSubagentLaunchContract } = await jiti.import("pi-subagents/preflight");
  const ctx = { cwd: process.cwd(), modelRegistry: { find: (_provider, id) => ({ provider: "openai-codex", id }), isUsingOAuth: () => true, getAvailable: () => [{ provider: "openai-codex", id: "gpt-5.6-luna" }] } };
  const args = { agent: "fixture-reader", task: "Inspect fixture" };
  await checkChildLaunch(args, config, "root", ctx, resolveSubagentLaunchContract);
  assert.equal(args.agentScope, "user");
  await assert.rejects(checkChildLaunch({ ...args, workflowScript: "bad" }, config, "root", ctx, resolveSubagentLaunchContract), /workflow scripts/);
  // Exercise only our cleanup: upstream lifecycle callbacks require a real Pi session.
  await handlers.get("session_shutdown").at(-1)();
});

test("child sessions share one capacity ceiling and acknowledge revocation before plan becomes active", async t => {
  const { root, config } = fixture(t);
  const transport = memoryTransport();
  const broker = await startBroker(config, root, async () => true, transport);
  t.after(() => broker.close());
  await broker.setMode("execute");
  let stopped = 0;
  for (let i = 0; i < 3; i++) await acquireChild(broker.env, "fixture-reader", release => { stopped++; release(); }, transport.connect);
  await assert.rejects(acquireChild(broker.env, "fixture-reader", () => {}, transport.connect), /capacity/);
  await broker.setMode("plan");
  assert.equal(stopped, 3);
  assert.equal(broker.policy.mode, "plan");
  assert.equal(broker.policy.transitioning, false);
});

test("a disconnected child without terminal proof blocks further work and mode changes", async t => {
  const { root, config } = fixture(t);
  const transport = memoryTransport();
  const broker = await startBroker(config, root, async () => true, transport);
  t.after(async () => {
    await assert.rejects(broker.close(), /terminal proof/);
    // This fixture never spawns a process; its retained scratch is safe to remove.
    rmSync(broker.policy.scratch, { recursive: true, force: true });
  });
  let client;
  await acquireChild(broker.env, "fixture-reader", () => {}, path => {
    client = transport.connect(path);
    return client;
  });
  client.destroy();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(broker.policy.transitioning, true);
  await assert.rejects(broker.setMode("execute"), /terminal proof/);
  await assert.rejects(requestBroker(broker.env, "root", { action: "authorize", tool: "read", args: { path: "fixture" } }, transport.connect), /denied/);
});
