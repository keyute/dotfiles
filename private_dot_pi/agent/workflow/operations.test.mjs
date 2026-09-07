import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
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
  mkdirSync(join(root, "sub"));
  writeFileSync(join(root, "sub", "gamma.txt"), "needle deep\n");
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

test("sandboxed grep matches literal and ignoreCase parity with the old JS matcher", async t => {
  const root = fixture(t);
  writeFileSync(join(root, "delta.txt"), "axc\na.c\n");
  const client = direct("grep", root);
  try {
    const asRegex = await executeSandboxGrep(client, { pattern: "a.c" });
    assert.match(asRegex.content[0].text, /delta\.txt:1: axc/);
    const asLiteral = await executeSandboxGrep(client, { pattern: "A.C", literal: true, ignoreCase: true });
    assert.doesNotMatch(asLiteral.content[0].text, /axc/);
    assert.match(asLiteral.content[0].text, /delta\.txt:2: a\.c/);
  } finally { await client.close(); }
});

test("sandboxed grep glob with a slash matches at any depth, mirroring matchesToolGlob", async t => {
  const root = fixture(t);
  const client = direct("grep", root);
  try {
    const result = await executeSandboxGrep(client, { pattern: "needle", glob: "sub/gamma.txt" });
    assert.equal(result.content[0].text, "sub/gamma.txt:1: needle deep");
  } finally { await client.close(); }
});

test("sandboxed grep stops at the match limit and reports it in details", async t => {
  const root = fixture(t);
  const client = direct("grep", root);
  try {
    const result = await executeSandboxGrep(client, { pattern: "needle", limit: 1 });
    assert.match(result.content[0].text, /\[1 matches limit reached\]/);
    assert.equal(result.details.matchLimitReached, 1);
  } finally { await client.close(); }
});

test("sandboxed grep on a single file path returns basename-relative output", async t => {
  const root = fixture(t);
  const client = direct("grep", root);
  try {
    const result = await executeSandboxGrep(client, { pattern: "needle", path: "alpha.txt" });
    assert.equal(result.content[0].text, "alpha.txt:2: needle here");
  } finally { await client.close(); }
});

test("sandboxed grep reports no matches found and rejects on an aborted signal", async t => {
  const root = fixture(t);
  const client = direct("grep", root);
  try {
    const empty = await executeSandboxGrep(client, { pattern: "nope-nowhere" });
    assert.equal(empty.content[0].text, "No matches found");
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(executeSandboxGrep(client, { pattern: "needle" }, controller.signal), /aborted/);
  } finally { await client.close(); }
});

test("the match limit keeps the accepted match's trailing context", async t => {
  const root = fixture(t);
  writeFileSync(join(root, "ctx.txt"), "needle one\nafter one\nafter two\nneedle two\nafter three\n");
  const client = direct("grep", root);
  try {
    const hit = await executeSandboxGrep(client, { pattern: "needle", glob: "ctx.txt", context: 2, limit: 1 });
    assert.deepEqual(hit.content[0].text.split("\n").slice(0, 3), ["ctx.txt:1: needle one", "ctx.txt-2- after one", "ctx.txt-3- after two"]);
    assert.doesNotMatch(hit.content[0].text, /needle two/);
    assert.equal(hit.details.matchLimitReached, 1);
    // A further match inside the accepted window renders as context.
    writeFileSync(join(root, "adjacent.txt"), "needle one\nneedle two\nafter\nneedle far\n");
    const adjacent = await executeSandboxGrep(client, { pattern: "needle", glob: "adjacent.txt", context: 2, limit: 1 });
    assert.deepEqual(adjacent.content[0].text.split("\n").slice(0, 3), ["adjacent.txt:1: needle one", "adjacent.txt-2- needle two", "adjacent.txt-3- after"]);
    assert.doesNotMatch(adjacent.content[0].text, /needle far/);
  } finally { await client.close(); }
});
