import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertCompleted,
  assertNoPendingMigration,
  composeReviewPrompt,
  diffCommands,
  parseEvents,
  piArgs,
  thinkingLevel,
  validateBase,
  validateThreadId,
} from "./pi-bridge.mjs";
import { decide } from "./pi-bridge-guard.mjs";

test("piArgs pins the read-only, prompt-free, worker-tier envelope", () => {
  const args = piArgs({ model: "gpt-test", effort: "high", sessionId: "sid-1" });
  const after = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(after("--tools"), "read,grep,find,ls");
  assert.ok(args.includes("--no-approve"));
  assert.ok(args.includes("--no-extensions"));
  assert.match(after("-e"), /pi-bridge-guard\.mjs$/);
  assert.equal(after("--model"), "gpt-test");
  assert.equal(after("--thinking"), "high");
  assert.equal(after("--session-id"), "sid-1");
});

test("parseEvents picks text from the last assistant message_end", () => {
  const lines = [
    JSON.stringify({ type: "session", id: "abc-123" }),
    JSON.stringify({ type: "message_end", message: { role: "user", content: [] } }),
    JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "first" }] },
    }),
    JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "final answer" }] },
    }),
  ].join("\n");

  const result = parseEvents(lines);
  assert.equal(result.threadId, "abc-123");
  assert.equal(result.text, "final answer");
  assert.equal(result.stopReason, undefined);
});

test("parseEvents surfaces stopReason and errorMessage on failure", () => {
  const lines = [
    JSON.stringify({ type: "session", id: "abc-123" }),
    JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [], stopReason: "error", errorMessage: "boom" },
    }),
  ].join("\n");

  const result = parseEvents(lines);
  assert.equal(result.stopReason, "error");
  assert.equal(result.errorMessage, "boom");
});

test("assertCompleted accepts only a stop reason of stop", () => {
  const stopped = { text: "done", stopReason: "stop" };
  assert.doesNotThrow(() => assertCompleted(stopped, 1, ""));
  const truncated = { text: "partial", stopReason: "length" };
  assert.throws(() => assertCompleted(truncated, 0, ""), /pi length/);
  assert.throws(() => assertCompleted({ text: "" }, 0, "boom"), /produced no response/);
});

test("thinkingLevel validates against pi's thinking levels", () => {
  assert.equal(thinkingLevel("high"), "high");
  assert.throws(() => thinkingLevel("extreme"));
});

test("validateBase rejects a leading dash and unsafe characters", () => {
  assert.doesNotThrow(() => validateBase("main"));
  assert.doesNotThrow(() => validateBase(undefined));
  assert.throws(() => validateBase("-x"));
  assert.throws(() => validateBase("main; rm -rf /"));
});

test("validateThreadId requires a strict UUID v4", () => {
  assert.doesNotThrow(() => validateThreadId("0199a0cb-5bf3-4774-b36f-22248f52a611"));
  assert.throws(() => validateThreadId("--last"));
  assert.throws(() => validateThreadId("not-a-uuid"));
});

test("composeReviewPrompt states the scope and includes the diff", () => {
  const prompt = composeReviewPrompt({ diffText: "diff --git a/x b/x" });
  assert.match(prompt, /Review the uncommitted changes/);
  assert.match(prompt, /diff --git a\/x b\/x/);
});

test("composeReviewPrompt truncates an oversized diff", () => {
  const prompt = composeReviewPrompt({ base: "main", diffText: "x".repeat(400_000) });
  assert.match(prompt, /Review this branch's changes against base main/);
  assert.match(prompt, /\[diff truncated — read the changed files directly]/);
});

test("diffCommands uses merge-base scope for a base and lists untracked files otherwise", () => {
  const [stat, diff] = diffCommands("main").map(([, args]) => args);
  assert.deepEqual(stat, ["--no-pager", "diff", "--no-color", "--stat", "main...HEAD"]);
  assert.deepEqual(diff, ["--no-pager", "diff", "--no-color", "main...HEAD"]);
  const uncommitted = diffCommands(undefined).map(([, args]) => args);
  assert.deepEqual(uncommitted[0], ["status", "--porcelain"]);
  assert.deepEqual(uncommitted[1], ["--no-pager", "diff", "--no-color", "HEAD"]);
  assert.deepEqual(uncommitted[2], ["ls-files", "--others", "--exclude-standard"]);
});

test("assertNoPendingMigration refuses a repo pi would rewrite at startup", () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-bridge-migrate-"));
  assert.doesNotThrow(() => assertNoPendingMigration(cwd));
  mkdirSync(join(cwd, ".pi", "commands"), { recursive: true });
  assert.throws(() => assertNoPendingMigration(cwd), /\.pi\/commands/);
  mkdirSync(join(cwd, ".pi", "prompts"));
  assert.doesNotThrow(() => assertNoPendingMigration(cwd));
});

test("guard blocks escapes, .env files, and disallowed tools", () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-bridge-guard-"));
  writeFileSync(join(cwd, "a.ts"), "");

  assert.ok(decide("read", { path: "../x" }, cwd));
  assert.ok(decide("read", { path: "/etc/passwd" }, cwd));
  assert.ok(decide("read", { path: "~/.pi/agent/auth.json" }, cwd));
  assert.ok(decide("read", { path: ".env" }, cwd));
  assert.ok(decide("read", { path: "sub/.env.local" }, cwd));
  assert.ok(decide("bash", { command: "ls" }, cwd));
  assert.ok(decide("read", { path: ["a.ts"] }, cwd));

  assert.equal(decide("read", { path: "src/a.ts" }, cwd), null);
  assert.equal(decide("ls", { path: "." }, cwd), null);
});

test("guard hands pi the vetted absolute path so its own normalization cannot escape", () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "pi-bridge-guard-")));
  writeFileSync(join(cwd, "a.ts"), "");
  // pi strips a leading "@" and converts file:// before resolving; after the
  // guard both land inside cwd as literal names
  for (const raw of ["@/etc/passwd", "@~/.pi/agent/auth.json", "file:///etc/passwd", "a.ts"]) {
    const input = { path: raw };
    assert.equal(decide("read", input, cwd), null, raw);
    assert.equal(input.path === cwd || input.path.startsWith(`${cwd}/`), true, raw);
  }
  const unset = {};
  assert.equal(decide("ls", unset, cwd), null);
  assert.equal("path" in unset, false);
  // pi folds unicode spaces after the rewrite, so such paths are refused
  assert.ok(decide("read", { path: "a b.ts" }, cwd));
});

test("guard blocks a symlink that resolves outside cwd", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bridge-guard-"));
  const cwd = join(root, "repo");
  const outside = join(root, "outside");
  mkdirSync(cwd);
  mkdirSync(outside);
  writeFileSync(join(outside, "secret.txt"), "shh");
  symlinkSync(join(outside, "secret.txt"), join(cwd, "link"));

  assert.ok(decide("read", { path: "link" }, cwd));
});
