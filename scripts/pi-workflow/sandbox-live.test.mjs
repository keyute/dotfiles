import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startBroker } from "./broker.mjs";

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
  const run = (tool, args) => new Promise(resolve => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("./sandbox-runner.mjs", import.meta.url)), "tool", tool], { env: { ...process.env, ...broker.env }, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("close", code => resolve({ code, output }));
    child.stdin.end(JSON.stringify(args));
  });
  assert.notEqual((await run("write", { path: "file", content: "blocked" })).code, 0);
  assert.notEqual((await run("read", { path: "link" })).code, 0);
  assert.notEqual((await run("bash", { command: "printf blocked > file" })).code, 0);
  await broker.setMode("execute");
  assert.equal((await run("write", { path: "file", content: "approved" })).code, 0);
  assert.equal(readFileSync(join(work, "file"), "utf8"), "approved");
});
