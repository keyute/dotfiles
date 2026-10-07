import test from "node:test";
import assert from "node:assert/strict";
import { parseDecision, reviewAction } from "./approval.mjs";

const config = { models: { provider: "openai-codex", classifierFilter: { model: "filter", reasoningEffort: "minimal" }, classifierJudge: { model: "judge", reasoningEffort: "medium" } } };

const said = text => ({ content: [{ type: "text", text }] });

test("only structured classifier decisions are accepted", () => {
  for (const text of ["allow", "```json\n{}\n```", '{"decision":"allow_for_session"}']) {
    assert.equal(parseDecision(said(text)).decision, "ask");
  }
  assert.deepEqual(parseDecision(said('{"decision":"allow"}')), { decision: "allow", reason: undefined });
  assert.equal(parseDecision(said('```json\n{"decision":"deny"}\n```')).decision, "deny");
  assert.deepEqual(parseDecision({ stopReason: "error", content: [] }), { decision: "ask" });
});

test("the classifier's reason is one line of at most 200 characters, or absent", () => {
  assert.deepEqual(parseDecision(said('{"decision":"deny","reason":"It reads\\n  ~/.ssh keys."}')), { decision: "deny", reason: "It reads ~/.ssh keys" });
  assert.equal(parseDecision(said(JSON.stringify({ decision: "deny", reason: `a${" b".repeat(300)}` }))).reason.length, 200);
  for (const reason of [undefined, 42, " \n "]) assert.equal(parseDecision(said(JSON.stringify({ decision: "deny", reason }))).reason, undefined);
});

test("classifier failure asks root UI and denies unattended requests", async () => {
  const ctx = { hasUI: false, modelRegistry: { find: () => undefined } };
  assert.equal(await reviewAction(ctx, config, "test", { approval: "auto" }, undefined, { count: 0 }), "it needs user approval and no UI is attached");
  ctx.hasUI = true;
  ctx.ui = { confirm: async () => true };
  assert.equal(await reviewAction(ctx, config, "test", { approval: "auto" }, undefined, { count: 0 }), true);
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

test("the TUI draws no approval notice; the dialog carries the pending state", async () => {
  const seen = [];
  const ctx = { mode: "tui", hasUI: true, modelRegistry: { find: () => undefined }, ui: { notify: () => { throw new Error("must not notify"); }, confirm: async title => { seen.push(title); return true; } } };
  await reviewAction(ctx, config, "test", { approval: "ask", tool: "bash", args: { command: "true", dangerouslyDisableSandbox: true } });
  await reviewAction(ctx, config, "test", { approval: "ask", tool: "bash", args: { command: "true" } });
  assert.deepEqual(seen, ["Approve this unsandboxed action once?", "Approve this action once?"]);
});

test("an unsandboxed request the dialog cannot show in full is refused without prompting", async () => {
  const ctx = { hasUI: true, modelRegistry: { find: () => undefined }, ui: { notify: () => { throw new Error("must not notify"); }, confirm: async () => { throw new Error("must not prompt"); } } };
  const command = `printf ok # ${"x".repeat(12_000)}`;
  assert.equal(await reviewAction(ctx, config, "test", { approval: "ask", tool: "bash", args: { command, dangerouslyDisableSandbox: true } }), "the unsandboxed command is too long to show for approval");
});

test("the classifier sees the session's shell history beside the action, and a filter block is re-judged", async () => {
  const calls = [];
  const answers = ['{"decision":"deny"}', '{"decision":"allow"}'];
  const ctx = { hasUI: false, sessionManager: { getSessionId: () => "s1" }, modelRegistry: { find: (_provider, id) => ({ id }), isUsingOAuth: () => true, complete: async (model, request, options) => { calls.push({ model, request, options }); return { content: [{ type: "text", text: answers[calls.length - 1] }] }; } } };
  const history = [{ command: "gh pr list", sandboxed: true, exitCode: 1 }];
  assert.equal(await reviewAction(ctx, config, "list the open PRs", { approval: "auto", tool: "bash", args: { command: "gh pr list", dangerouslyDisableSandbox: true }, history }, undefined, { count: 0 }), true);
  assert.deepEqual(calls.map(call => [call.model.id, call.options.reasoningEffort]), [["filter", "minimal"], ["judge", "medium"]]);
  const content = JSON.parse(calls[0].request.messages[0].content);
  assert.deepEqual(content.history, history);
  assert.equal("history" in content.action, false);
  assert.equal(content.action.args.dangerouslyDisableSandbox, true);
  assert.match(calls[0].request.systemPrompt, /exit code/);
  // The judge re-reads the same prompt and message.
  assert.equal(calls[1].request.messages[0].content, calls[0].request.messages[0].content);
  assert.equal(calls[1].request.systemPrompt, calls[0].request.systemPrompt);
  // Both stages carry the session id as the prompt cache key, off the root's WebSocket.
  assert.deepEqual(calls.map(call => [call.options.sessionId, call.options.transport]), [["s1", "sse"], ["s1", "sse"]]);
});

test("a filter allow ends the review, and a judge that cannot answer asks the UI", async () => {
  let calls = 0;
  const ctx = { hasUI: true, modelRegistry: { find: (_provider, id) => ({ id }), isUsingOAuth: () => true, complete: async () => { calls++; return { content: [{ type: "text", text: '{"decision":"allow"}' }] }; } }, ui: { confirm: async () => { throw new Error("must not prompt"); } } };
  assert.equal(await reviewAction(ctx, config, "test", { approval: "auto", tool: "bash", args: { command: "git push" } }, undefined, { count: 0 }), true);
  assert.equal(calls, 1);
  const asked = [];
  ctx.modelRegistry.complete = async () => ({ content: [{ type: "text", text: "not json" }] });
  ctx.ui = { notify: () => {}, confirm: async title => { asked.push(title); return false; } };
  assert.equal(await reviewAction(ctx, config, "test", { approval: "auto", tool: "bash", args: { command: "git push" } }, undefined, { count: 0 }), "the user declined it");
  assert.deepEqual(asked, ["Approve this action once?"]);
});

test("a classifier deny returns the judge's reason, or a generic one", async () => {
  const answers = ['{"decision":"deny","reason":"filter"}', '{"decision":"deny","reason":"It pushes to a remote."}', '{"decision":"deny"}', '{"decision":"deny"}'];
  const ctx = { hasUI: false, modelRegistry: { find: (_provider, id) => ({ id }), isUsingOAuth: () => true, complete: async () => said(answers.shift()) } };
  const request = { approval: "auto", tool: "bash", args: { command: "git push" } };
  assert.equal(await reviewAction(ctx, config, "test", request, undefined, { count: 0 }), "the classifier said \"It pushes to a remote\"");
  assert.equal(await reviewAction(ctx, config, "test", request, undefined, { count: 0 }), "the classifier denied it");
});

test("after three consecutive classifier denials the next goes to the user until an allow resets the count", async () => {
  let answer = '{"decision":"deny","reason":"unsafe"}';
  let approve = false;
  const asked = [];
  const ctx = { hasUI: true, modelRegistry: { find: (_provider, id) => ({ id }), isUsingOAuth: () => true, complete: async () => said(answer) }, ui: { notify: () => {}, confirm: async title => { asked.push(title); return approve; } } };
  const denials = { count: 0 };
  const review = () => reviewAction(ctx, config, "test", { approval: "auto", tool: "bash", args: { command: "git push" } }, undefined, denials);
  for (let i = 0; i < 3; i++) assert.equal(await review(), "the classifier said \"unsafe\"");
  assert.equal(asked.length, 0);
  // A user decline leaves the count, so the next deny still reaches the user.
  assert.equal(await review(), "the user declined it");
  assert.equal(await review(), "the user declined it");
  assert.deepEqual(asked, Array(2).fill("Approve this action the classifier denied (\"unsafe\") once?"));
  // Without a UI a deny stays a deny.
  ctx.hasUI = false;
  assert.equal(await review(), "the classifier said \"unsafe\"");
  ctx.hasUI = true;
  // A user approval resets the count.
  approve = true;
  assert.equal(await review(), true);
  assert.equal(denials.count, 0);
  for (let i = 0; i < 3; i++) assert.equal(await review(), "the classifier said \"unsafe\"");
  // So does a classifier allow.
  answer = '{"decision":"allow"}';
  assert.equal(await review(), true);
  assert.equal(denials.count, 0);
  answer = '{"decision":"deny","reason":"unsafe"}';
  assert.equal(await review(), "the classifier said \"unsafe\"");
  assert.equal(asked.length, 3);
  // Ask mode never touches the count.
  await reviewAction(ctx, config, "test", { approval: "ask", tool: "bash", args: { command: "true" } }, undefined, denials);
  assert.equal(denials.count, 1);
});

test("the confirm's slot is cleared first: beforeConfirm runs before ctx.ui.confirm", async () => {
  const seen = [];
  const ctx = { hasUI: true, modelRegistry: { find: () => undefined }, ui: { notify: () => {}, confirm: async () => { seen.push("confirm"); return true; } } };
  await reviewAction(ctx, config, "test", { approval: "ask", tool: "bash", args: { command: "true" } }, () => seen.push("close"));
  assert.deepEqual(seen, ["close", "confirm"]);
});
