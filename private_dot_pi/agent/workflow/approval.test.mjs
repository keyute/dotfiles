import test from "node:test";
import assert from "node:assert/strict";
import { parseDecision, reviewAction } from "./approval.mjs";

const config = { models: { provider: "openai-codex", classifierFilter: { model: "filter", reasoningEffort: "minimal" }, classifierJudge: { model: "judge", reasoningEffort: "medium" } } };

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
  assert.equal(await reviewAction(ctx, config, "test", { approval: "auto" }), false);
  ctx.hasUI = true;
  ctx.ui = { confirm: async () => true };
  assert.equal(await reviewAction(ctx, config, "test", { approval: "auto" }), true);
});

test("an unsandboxed request is named as such in the notice and the dialog", async () => {
  const seen = [];
  const ctx = { hasUI: true, modelRegistry: { find: () => undefined }, ui: { notify: text => seen.push(text), confirm: async title => { seen.push(title); return true; } } };
  await reviewAction(ctx, config, "test", { approval: "ask", tool: "bash", args: { command: "true", dangerouslyDisableSandbox: true } });
  await reviewAction(ctx, config, "test", { approval: "ask", tool: "bash", args: { command: "true" } });
  assert.match(seen[0], /^Awaiting approval \(unsandboxed\): /);
  assert.equal(seen[1], "Approve this unsandboxed action once?");
  assert.match(seen[2], /^Awaiting approval: /);
  assert.equal(seen[3], "Approve this action once?");
});

test("an unsandboxed request the dialog cannot show in full is refused without prompting", async () => {
  const ctx = { hasUI: true, modelRegistry: { find: () => undefined }, ui: { notify: () => { throw new Error("must not notify"); }, confirm: async () => { throw new Error("must not prompt"); } } };
  const command = `printf ok # ${"x".repeat(12_000)}`;
  assert.equal(await reviewAction(ctx, config, "test", { approval: "ask", tool: "bash", args: { command, dangerouslyDisableSandbox: true } }), false);
});

test("the classifier sees the session's shell history beside the action, and a filter block is re-judged", async () => {
  const calls = [];
  const answers = ['{"decision":"deny"}', '{"decision":"allow"}'];
  const ctx = { hasUI: false, modelRegistry: { find: (_provider, id) => ({ id }), isUsingOAuth: () => true, complete: async (model, request, options) => { calls.push({ model, request, options }); return { content: [{ type: "text", text: answers[calls.length - 1] }] }; } } };
  const history = [{ command: "gh pr list", sandboxed: true, exitCode: 1 }];
  assert.equal(await reviewAction(ctx, config, "list the open PRs", { approval: "auto", tool: "bash", args: { command: "gh pr list", dangerouslyDisableSandbox: true }, history }), true);
  assert.deepEqual(calls.map(call => [call.model.id, call.options.reasoningEffort]), [["filter", "minimal"], ["judge", "medium"]]);
  const content = JSON.parse(calls[0].request.messages[0].content);
  assert.deepEqual(content.history, history);
  assert.equal("history" in content.action, false);
  assert.equal(content.action.args.dangerouslyDisableSandbox, true);
  assert.match(calls[0].request.systemPrompt, /exit code/);
  // The judge re-reads the same prompt and message.
  assert.equal(calls[1].request.messages[0].content, calls[0].request.messages[0].content);
  assert.equal(calls[1].request.systemPrompt, calls[0].request.systemPrompt);
});

test("a filter allow ends the review, and a judge that cannot answer asks the UI", async () => {
  let calls = 0;
  const ctx = { hasUI: true, modelRegistry: { find: (_provider, id) => ({ id }), isUsingOAuth: () => true, complete: async () => { calls++; return { content: [{ type: "text", text: '{"decision":"allow"}' }] }; } }, ui: { confirm: async () => { throw new Error("must not prompt"); } } };
  assert.equal(await reviewAction(ctx, config, "test", { approval: "auto", tool: "bash", args: { command: "git push" } }), true);
  assert.equal(calls, 1);
  const asked = [];
  ctx.modelRegistry.complete = async () => ({ content: [{ type: "text", text: "not json" }] });
  ctx.ui = { notify: () => {}, confirm: async title => { asked.push(title); return false; } };
  assert.equal(await reviewAction(ctx, config, "test", { approval: "auto", tool: "bash", args: { command: "git push" } }), false);
  assert.deepEqual(asked, ["Approve this action once?"]);
});
