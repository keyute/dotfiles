import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, existsSync } from "node:fs";
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
  const config = { version: 1, agentDir: work, models: {}, filesystem: { denyRead: [secret], denyWrite: [], allowWrite: [] }, network: { allowedDomains: [] }, agents: {}, mcp: {}, childLimit: 1 };
  const broker = await startBroker(config, work, async () => true);
  t.after(() => broker.close());
  const call = async (tool, args, op, params, handlers) => {
    const { ticket } = await requestBroker(broker.env, "root", { action: "authorize", tool, args });
    const client = startToolWorker(tool, { cwd: work, env: { ...broker.env, PI_WORKFLOW_ROLE: "root" }, ticket });
    try { return await client.call(op, params, handlers); } finally { await client.close(); }
  };
  // Policy layer: plan mode rejects writes and symlinked secrets before any
  // lease; the broker forwards the policy's own reason.
  await assert.rejects(call("write", { path: "file" }, "writeFile", { path: join(work, "file"), data: "blocked" }), /Writes are disabled in this scope/);
  await assert.rejects(call("read", { path: "link" }, "readFile", { path: join(work, "link") }), /Resolved path denied by managed policy/);
  // Complete an operation before approval so the retained worker has a live plan lease.
  const planTicket = await requestBroker(broker.env, "root", { action: "authorize", tool: "bash", args: { command: "printf blocked > file" } });
  const planWorker = startToolWorker("bash", { cwd: work, env: { ...broker.env, PI_WORKFLOW_ROLE: "root" }, ticket: planTicket.ticket });
  t.after(() => planWorker.close());
  assert.equal((await planWorker.call("exec", { command: "true", cwd: work })).exitCode, 0);
  const planBash = await planWorker.call("exec", { command: "printf blocked > file", cwd: work });
  assert.notEqual(planBash.exitCode, 0);
  assert.equal(existsSync(join(work, "file")), false);
  await broker.setMode("execute", undefined, { keepProcesses: true });
  assert.equal((await planWorker.call("exec", { command: "true", cwd: work })).exitCode, 0);
  const retainedWrite = await planWorker.call("exec", { command: "printf blocked > file", cwd: work });
  assert.notEqual(retainedWrite.exitCode, 0);
  assert.equal(existsSync(join(work, "file")), false);
  const executeTicket = await requestBroker(broker.env, "root", { action: "authorize", tool: "bash", args: { command: "printf execute > file" } });
  const executeWorker = startToolWorker("bash", { cwd: work, env: { ...broker.env, PI_WORKFLOW_ROLE: "root" }, ticket: executeTicket.ticket });
  t.after(() => executeWorker.close());
  assert.equal((await executeWorker.call("exec", { command: "printf execute > file", cwd: work })).exitCode, 0);
  assert.equal(readFileSync(join(work, "file"), "utf8"), "execute");
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
  // Narrowing must collect both generations, with terminal proof before returning.
  await broker.setMode("plan");
  assert.equal(broker.policy.mode, "plan");
  assert.equal(broker.policy.transitioning, false);
  for (const client of [planWorker, executeWorker]) {
    await assert.rejects(client.call("exec", { command: "printf stale > file", cwd: work }), /Sandboxed bash (?:unavailable|failed)/);
    await client.close();
  }
  assert.equal(readFileSync(join(work, "file"), "utf8"), "approved");
});
