import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { reviewAction } from "./approval.mjs";
import { sessionCost } from "./usage.mjs";

test("two failed SDK stages count as two unknown approvals in session and offline accounting", async t => {
  const root = mkdtempSync(join(tmpdir(), "usage-failed-approval-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = { models: { provider: "fixture", classifierFilter: { model: "fixture", reasoningEffort: "minimal" }, classifierJudge: { model: "fixture", reasoningEffort: "medium" } } };
  const entries = [];
  const ctx = { hasUI: false, modelRegistry: { find: () => ({}), isUsingOAuth: () => true, complete: async () => ({ stopReason: entries.length ? "aborted" : "error", content: [], errorMessage: "private failure", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }) } };
  await reviewAction(ctx, config, "private task", { approval: "auto" }, { count: 0 }, data => entries.push({ type: "custom", id: `approval-${entries.length}`, timestamp: new Date().toISOString(), customType: "workflow-classifier-usage", data }));
  assert.equal(entries.length, 2);
  assert.ok(entries.every(entry => entry.data.usage === null));
  assert.equal(JSON.stringify(entries).includes("private"), false);
  assert.equal(sessionCost(entries, null).approvals.unknown, 2);
  const sessions = join(root, ".pi/agent/sessions");
  mkdirSync(sessions, { recursive: true });
  writeFileSync(join(sessions, "root.jsonl"), entries.map(entry => JSON.stringify(entry)).join("\n"));
  const stdout = execFileSync(process.execPath, ["scripts/agent-usage.mjs", "--days", "1"], { cwd: process.cwd(), env: { ...process.env, HOME: root, TMPDIR: root }, encoding: "utf8" });
  const result = JSON.parse(readFileSync(stdout.match(/JSON: (.+)/)[1], "utf8"));
  assert.equal(result.pi.modelOrigin["fixture|root"].unknown, 2);
  assert.equal(result.pi.operationOrigin["approval_filter|root"].unknown, 1);
  assert.equal(result.pi.operationOrigin["approval_judge|root"].unknown, 1);
});

test("offline fixture counts approvals/fetch/search without duplicating mirrored children or Claude streams", t => {
  const root = mkdtempSync(join(tmpdir(), "usage-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const timestamp = new Date().toISOString();
  const write = (file, rows) => {
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, rows.map(r => JSON.stringify({ timestamp, ...r })).join("\n"));
  };
  const usage = { input: 10, output: 2, cacheRead: 3, cacheWrite: 0, cost: { total: 0.01 } };
  const child = { type: "message", message: { role: "assistant", responseId: "child-response", model: "fixture", usage } };
  write(join(root, ".pi/agent/sessions/root.jsonl"), [
    { type: "message", message: { role: "assistant", responseId: "root-response", model: "fixture", usage } },
    ...["filter", "judge"].map((stage, i) => ({ type: "custom", id: `approval-${i}`, customType: "workflow-classifier-usage", data: { stage, model: "fixture", outcome: "allow", usage: i ? null : usage } })),
    { type: "custom", id: "skipped", customType: "workflow-classifier-usage", data: { stage: "judge", outcome: "not_attempted", usage: null } },
    { type: "message", message: { role: "toolResult", toolName: "web_fetch", usage } },
    { type: "message", message: { role: "toolResult", toolName: "subagent", usage } },
    { type: "message", message: { role: "toolResult", toolName: "web_search" } },
  ]);
  write(join(root, ".pi/agent/sessions/run-1/child.jsonl"), [child]);
  write(join(root, ".pi/agent/sessions/subagent-artifacts/mirror.jsonl"), [child]);
  write(join(root, ".claude/projects/fixture.jsonl"), [1, 3, 2].map(output_tokens => ({ type: "assistant", message: { id: "stream", model: "fixture", usage: { input_tokens: 10, output_tokens } } })));
  const stdout = execFileSync(process.execPath, ["scripts/agent-usage.mjs", "--days", "1"], { cwd: process.cwd(), env: { ...process.env, HOME: root, TMPDIR: root }, encoding: "utf8" });
  const result = JSON.parse(readFileSync(stdout.match(/JSON: (.+)/)[1], "utf8"));
  assert.equal(result.pi.modelOrigin["fixture|child"].calls, 1);
  assert.equal(result.pi.modelOrigin["fixture|root"].calls, 3);
  assert.equal(result.pi.modelOrigin["fixture|root"].unknown, 1);
  assert.equal(result.pi.operationOrigin["approval_filter|root"].input, 10);
  assert.equal(result.pi.operationOrigin["approval_judge|root"].unknown, 1);
  assert.equal(result.pi.operationOrigin["web_fetch|root"].output, 2);
  assert.equal(result.pi.modelOrigin["unknown-summary-model|root"].calls, 1);
  assert.equal(result.pi.unmeteredCalls.web_search, 1);
  assert.equal(result.claude.modelOrigin["fixture|root"].calls, 1);
  assert.match(result.pi.dollarBasis, /not subscription allowance or cash/);
});
