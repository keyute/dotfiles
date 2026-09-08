import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBroker, requestBroker } from "./broker.mjs";
import { startToolWorker, workerOperations } from "./operations.mjs";

test("live SRT rejects source writes and sensitive symlinks, then permits approved writes", { skip: process.env.PI_WORKFLOW_LIVE_TESTS !== "1" && "Set PI_WORKFLOW_LIVE_TESTS=1 on a host that permits Unix sockets and SRT" }, async t => {
  const root = mkdtempSync(join(tmpdir(), "pi-live-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const work = join(root, "workspace");
  mkdirSync(work);
  const secret = join(root, "fixture-secret");
  writeFileSync(secret, "fixture only");
  symlinkSync(secret, join(work, "link"));
  const config = { version: 1, agentDir: work, models: {}, filesystem: { denyRead: [secret], denyWrite: [], allowWrite: [] }, network: { allowedDomains: [] }, agents: {}, mcp: {} };
  const broker = await startBroker(config, work, async () => true);
  t.after(() => broker.close());
  const call = async (tool, args, op, params, handlers) => {
    const { ticket } = await requestBroker(broker.env, "root", { action: "authorize", tool, args });
    const client = startToolWorker(tool, { cwd: work, env: { ...broker.env, PI_WORKFLOW_ROLE: "root" }, ticket });
    try { return await client.call(op, params, handlers); } finally { await client.close(); }
  };
  // Policy layer: plan mode rejects writes and symlinked secrets before any
  // lease (the broker reports every policy rejection with one generic denial).
  await assert.rejects(call("write", { path: "file" }, "writeFile", { path: join(work, "file"), data: "blocked" }), /denied/);
  await assert.rejects(call("read", { path: "link" }, "readFile", { path: join(work, "link") }), /denied/);
  // SRT layer: an approved bash lease still cannot write the workspace in plan mode.
  const planBash = await call("bash", { command: "printf blocked > file" }, "exec", { command: "printf blocked > file", cwd: work });
  assert.notEqual(planBash.exitCode, 0);
  await broker.setMode("execute");
  await call("write", { path: "file" }, "writeFile", { path: join(work, "file"), data: "approved" });
  assert.equal(readFileSync(join(work, "file"), "utf8"), "approved");
  let streamed = "";
  const bash = await call("bash", { command: "printf approved-bash" }, "exec", { command: "printf approved-bash", cwd: work }, { onChunk: chunk => { streamed += chunk; } });
  assert.equal(bash.exitCode, 0);
  assert.ok(streamed.includes("approved-bash"));
  // SRT layer: even in execute mode the leased profile denies reading the secret.
  const secretRead = await call("bash", { command: `cat ${JSON.stringify(secret)}` }, "exec", { command: `cat ${JSON.stringify(secret)}`, cwd: work });
  assert.notEqual(secretRead.exitCode, 0);
  // An approved unsandboxed lease writes where the profile would refuse.
  const outside = join(root, "outside");
  const sandboxedWrite = await call("bash", { command: `printf blocked > ${JSON.stringify(outside)}` }, "exec", { command: `printf blocked > ${JSON.stringify(outside)}`, cwd: work });
  assert.notEqual(sandboxedWrite.exitCode, 0);
  const hostWrite = await call("bash", { command: `printf host > ${JSON.stringify(outside)}`, dangerouslyDisableSandbox: true }, "exec", { command: `printf host > ${JSON.stringify(outside)}`, cwd: work });
  assert.equal(hostWrite.exitCode, 0);
  assert.equal(readFileSync(outside, "utf8"), "host");
  // A lease without a live ticket is refused outright.
  const bare = startToolWorker("bash", { cwd: work, env: { ...broker.env, PI_WORKFLOW_ROLE: "root" } });
  await assert.rejects(bare.call("exec", { command: "true" }));
  await bare.close();
});
