import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBashToolDefinition, createLsToolDefinition, createReadToolDefinition, createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
import { startToolWorker, workerOperations, executeSandboxGrep } from "./operations.mjs";

// Drives the real SDK tools through worker operations against a directly
// spawned worker (no broker/SRT), covering the host↔worker seam end to end.
const opsWorker = fileURLToPath(new URL("./ops-worker.mjs", import.meta.url));
const direct = (tool, cwd) => startToolWorker(tool, { spawnProcess: () => spawn(process.execPath, [opsWorker, tool], { cwd, stdio: ["pipe", "pipe", "pipe"] }) });

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-operations-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "alpha.txt"), "one\nneedle here\nthree\n");
  writeFileSync(join(root, "beta.md"), "no match\n");
  return root;
}

test("SDK read, write, and ls tools execute through worker operations", async t => {
  const root = fixture(t);
  for (const [tool, factory, args, check] of [
    ["read", createReadToolDefinition, { path: "alpha.txt" }, text => text.includes("needle here")],
    ["write", createWriteToolDefinition, { path: "out.txt", content: "written" }, () => readFileSync(join(root, "out.txt"), "utf8") === "written"],
    ["ls", createLsToolDefinition, { path: "." }, text => text.includes("beta.md")],
  ]) {
    const client = direct(tool, root);
    try {
      const definition = factory(root, { operations: workerOperations(client)[tool] });
      const result = await definition.execute("test", args);
      assert.ok(check(result.content?.[0]?.text ?? ""), `${tool} result check`);
    } finally { await client.close(); }
  }
});

test("reads beyond the old response cap stream through in chunks", async t => {
  const root = fixture(t);
  writeFileSync(join(root, "big.log"), `${"x".repeat(1024)}\n`.repeat(20 * 1024));
  const client = direct("read", root);
  try {
    const definition = createReadToolDefinition(root, { operations: workerOperations(client).read });
    const result = await definition.execute("test", { path: "big.log", offset: 20470, limit: 2 });
    assert.match(result.content[0].text, /x/);
  } finally { await client.close(); }
});

test("SDK bash tool streams through worker operations without a session", async t => {
  const root = fixture(t);
  const client = direct("bash", root);
  try {
    const definition = createBashToolDefinition(root, { exposeSessionEnvironment: false, operations: workerOperations(client).bash });
    const result = await definition.execute("test", { command: "printf seam-ok; printf ' and-err' >&2" });
    const text = result.content.filter(part => part.type === "text").map(part => part.text).join("\n");
    assert.ok(text.includes("seam-ok"));
    assert.ok(text.includes("and-err"));
  } finally { await client.close(); }
});

test("sandboxed grep matches with context and respects the glob filter", async t => {
  const root = fixture(t);
  const client = direct("grep", root);
  try {
    const hit = await executeSandboxGrep(client, { pattern: "needle", context: 1 });
    assert.match(hit.content[0].text, /alpha\.txt:2: needle here/);
    assert.match(hit.content[0].text, /alpha\.txt-1- one/);
    const filtered = await executeSandboxGrep(client, { pattern: "needle", glob: "*.md" });
    assert.equal(filtered.content[0].text, "No matches found");
  } finally { await client.close(); }
});
