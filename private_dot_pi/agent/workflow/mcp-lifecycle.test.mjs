import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import { mcpAdapterSettings } from "./index.mjs";

const jiti = createJiti(import.meta.url);
const { createMcpAdapter } = await jiti.import("pi-mcp-adapter");
const { computeServerHash } = await jiti.import(new URL("metadata-cache.ts", import.meta.resolve("pi-mcp-adapter")).pathname);

for (const warm of [true, false]) test(`frozen MCP registration survives peer metadata and reconnects (${warm ? "warm" : "cold"} cache)`, async t => {
  const root = mkdtempSync(join(tmpdir(), "pi-mcp-lifecycle-"));
  const agentDir = join(root, "agent");
  mkdirSync(agentDir);
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const instances = [];
  t.after(async () => {
    for (const instance of instances) await instance.stop();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  });
  const server = join(root, "server.mjs");
  const catalog = join(root, "catalog.json");
  const tool = (name, description) => ({ name, description, inputSchema: { type: "object", properties: {} } });
  writeFileSync(catalog, JSON.stringify([tool("echo", "First")]));
  // A local JSON-RPC fixture: no network, OAuth, credentials or managed server.
  writeFileSync(server, `import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
for await (const line of createInterface({ input: process.stdin })) {
  const q = JSON.parse(line);
  if (q.id === undefined) continue;
  const result = q.method === "initialize"
    ? { protocolVersion: q.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } }
    : q.method === "tools/list" ? { tools: JSON.parse(readFileSync(process.argv[2], "utf8")) }
    : q.method === "tools/call" ? { content: [{ type: "text", text: "fixture result" }] } : {};
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: q.id, result }) + "\\n");
}
`);
  const definition = { command: process.execPath, args: [server, catalog], directTools: true };
  if (warm) writeFileSync(join(agentDir, "mcp-cache.json"), JSON.stringify({ version: 1, servers: { fixture: {
    configHash: computeServerHash(definition), cachedAt: Date.now(), resources: [], tools: [tool("echo", "First")],
  } } }));
  const instance = async (id, env) => {
    const handlers = new Map();
    const tools = new Map();
    const notifications = [];
    const bus = new EventEmitter();
    const pi = {
      events: { on(name, fn) { bus.on(name, fn); return () => bus.off(name, fn); }, emit: (...args) => bus.emit(...args) },
      on(name, fn) { handlers.set(name, fn); }, registerTool(tool) { tools.set(tool.name, tool); }, unregisterTool: name => tools.delete(name),
      registerCommand() {}, registerFlag() {}, getFlag() {}, getAllTools: () => [...tools.values()],
      getActiveTools: () => [...tools.keys()], setActiveTools() {}, appendEntry() {}, sendMessage() {},
    };
    const ctx = { cwd: root, hasUI: true, sessionManager: { getSessionId: () => id, getEntries: () => [], getBranch: () => [] }, ui: { notify: (...args) => notifications.push(args), select: async () => "Allow once", setStatus() {}, theme: { fg: (_color, text) => text } } };
    await createMcpAdapter({ config: { mcpServers: { fixture: { ...definition, ...(env ? { env } : {}) } }, settings: mcpAdapterSettings } })(pi);
    const result = { tools, notifications, call: args => tools.get("mcp").execute(id, args, undefined, undefined, ctx), stop: () => handlers.get("session_shutdown")({}, ctx) };
    instances.push(result);
    await handlers.get("session_start")({}, ctx);
    return result;
  };
  const first = await instance("first");
  assert.equal((await first.call({ connect: "fixture" })).details?.error, undefined);
  const original = first.tools.get("mcp__fixture_echo");
  if (warm) assert.ok(original);
  const notices = first.notifications.length;
  writeFileSync(catalog, JSON.stringify([tool("echo", "Changed"), tool("new_tool", "New")]));
  const peer = await instance("peer", { FIXTURE_ROLE: "peer" });
  assert.equal((await peer.call({ connect: "fixture" })).details?.error, undefined);
  assert.equal(first.notifications.length, notices, "a peer cache write does not notify this session");
  assert.equal((await first.call({ connect: "fixture" })).details?.error, undefined);
  assert.equal(first.tools.get("mcp__fixture_echo"), original, "even an updated schema retains the frozen registration");
  assert.equal(first.tools.has("mcp__fixture_new_tool"), false);
  assert.equal(first.notifications.length, notices, "reconnect does not churn the frozen surface");
  const described = await first.call({ describe: "new_tool" });
  assert.equal(described.details?.error, undefined);
  assert.match(JSON.stringify(described.content), /new_tool/);
  await peer.stop();
  const called = await first.call({ tool: "new_tool", args: {} });
  assert.equal(called.details?.error, undefined);
  assert.match(JSON.stringify(called.content), /fixture result/, "stopping the peer leaves this session's connection usable");
});
