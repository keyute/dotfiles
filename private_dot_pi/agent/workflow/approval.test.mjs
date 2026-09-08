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

test("an unsandboxed request is named as such in the notice and the dialog", async () => {
  const seen = [];
  const ctx = { hasUI: true, modelRegistry: { find: () => undefined }, ui: { notify: text => seen.push(text), confirm: async title => { seen.push(title); return true; } } };
  const config = { models: { provider: "openai-codex", classifier: "fixture" } };
  await reviewAction(ctx, config, "test", { approval: "ask", tool: "bash", args: { command: "true", dangerouslyDisableSandbox: true } });
  await reviewAction(ctx, config, "test", { approval: "ask", tool: "bash", args: { command: "true" } });
  assert.match(seen[0], /^Awaiting approval \(unsandboxed\): /);
  assert.equal(seen[1], "Approve this unsandboxed action once?");
  assert.match(seen[2], /^Awaiting approval: /);
  assert.equal(seen[3], "Approve this action once?");
});

test("an unsandboxed request the dialog cannot show in full is refused without prompting", async () => {
  const ctx = { hasUI: true, modelRegistry: { find: () => undefined }, ui: { notify: () => { throw new Error("must not notify"); }, confirm: async () => { throw new Error("must not prompt"); } } };
  const config = { models: { provider: "openai-codex", classifier: "fixture" } };
  const command = `printf ok # ${"x".repeat(12_000)}`;
  assert.equal(await reviewAction(ctx, config, "test", { approval: "ask", tool: "bash", args: { command, dangerouslyDisableSandbox: true } }), false);
});
