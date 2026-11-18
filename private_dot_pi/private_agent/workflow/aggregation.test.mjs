import test from "node:test";
import assert from "node:assert/strict";
import { reviewAction } from "./approval.mjs";
import { sessionCost } from "./usage.mjs";

test("two failed SDK stages count as two unknown approvals in session accounting", async () => {
  const config = { models: { provider: "fixture", classifierFilter: { model: "fixture", reasoningEffort: "minimal" }, classifierJudge: { model: "fixture", reasoningEffort: "medium" } } };
  const entries = [];
  const ctx = { hasUI: false, modelRegistry: { find: () => ({}), isUsingOAuth: () => true, complete: async () => ({ stopReason: entries.length ? "aborted" : "error", content: [], errorMessage: "private failure", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }) } };
  await reviewAction(ctx, config, "private task", {}, { count: 0 }, data => entries.push({ type: "custom", id: `approval-${entries.length}`, timestamp: new Date().toISOString(), customType: "workflow-classifier-usage", data }));
  assert.equal(entries.length, 2);
  assert.ok(entries.every(entry => entry.data.usage === null));
  assert.equal(JSON.stringify(entries).includes("private"), false);
  assert.equal(sessionCost(entries, null).approvals.unknown, 2);
});
