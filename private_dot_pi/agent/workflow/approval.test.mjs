import test from "node:test";
import assert from "node:assert/strict";
import { parseDecision, reviewAction } from "./approval.mjs";

test("only structured classifier decisions are accepted", () => {
  for (const text of ["allow", "```json\n{}\n```", '{"decision":"allow_for_session"}']) {
    assert.equal(parseDecision({ content: [{ type: "text", text }] }), "ask");
  }
  assert.equal(parseDecision({ content: [{ type: "text", text: '{"decision":"allow"}' }] }), "allow");
  assert.equal(parseDecision({ content: [{ type: "text", text: '```json\n{"decision":"deny"}\n```' }] }), "deny");
  assert.equal(parseDecision({ stopReason: "error", content: [] }), "ask");
});

test("classifier failure asks root UI and denies unattended requests", async () => {
  const ctx = { hasUI: false, modelRegistry: { find: () => undefined } };
  const config = { models: { provider: "openai-codex", classifier: "fixture" } };
  assert.equal(await reviewAction(ctx, config, "test", { approval: "auto" }), false);
  ctx.hasUI = true;
  ctx.ui = { confirm: async () => true };
  assert.equal(await reviewAction(ctx, config, "test", { approval: "auto" }), true);
});
