import test from "node:test";
import assert from "node:assert/strict";
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { Container, visibleWidth } from "@earendil-works/pi-tui";
import { runAgentLoop } from "@earendil-works/pi-agent-core";
import { installPendingInput } from "./pending-input.mjs";

const palette = name => ({ fg: (color, text) => `\x1b[${color === "userMessageText" ? 36 : name === "mocha" ? 31 : 32}m${text}\x1b[39m`, bg: (_color, text) => `\x1b[${name === "mocha" ? 41 : 42}m${text}\x1b[49m` });
const plain = line => line.replace(/\x1b\[[0-9;]*m/g, "");

function host() {
  const queue = { steering: [], followUp: [] };
  const children = [];
  const mode = Object.create(InteractiveMode.prototype);
  mode.pendingMessagesContainer = { children, clear: () => { children.length = 0; }, addChild: child => children.push(child) };
  mode.ui = { requestRender() {} };
  mode.getAppKeyDisplay = action => action === "app.message.dequeue" ? "alt+up" : "unexpected";
  Object.defineProperty(mode, "session", { configurable: true, value: {
    getSteeringMessages: () => [...queue.steering], getFollowUpMessages: () => [...queue.followUp],
    clearQueue: () => { const prior = { steering: [...queue.steering], followUp: [...queue.followUp] }; queue.steering.length = 0; queue.followUp.length = 0; return prior; },
  } });
  mode.compactionQueuedMessages = [];
  mode.editor = { getText: () => "", setText: text => { mode.restored = text; } };
  return { mode, queue, children, render: width => children.flatMap(child => child.render(width)) };
}

test("display reads native queues, retains order, and clears only the view on dequeue/compaction", () => {
  let theme = palette("mocha");
  installPendingInput(() => theme);
  const { mode, queue, children, render } = host();
  queue.steering.push("first steering", "second steering");
  queue.followUp.push("later follow-up");
  mode.updatePendingMessagesDisplay();
  const output = render(140).map(plain).join("\n");
  assert.ok(output.indexOf("first steering") < output.indexOf("second steering"));
  assert.ok(output.indexOf("second steering") < output.indexOf("later follow-up"));
  assert.match(output, /π Steering · next response/);
  assert.match(output, /π Follow-up · after current task/);
  assert.equal(output.match(/alt\+up/g)?.length, 1);
  assert.equal(output.match(/❯ /g)?.length, 3);
  const lines = render(140).map(plain);
  const labels = lines.flatMap((line, index) => line.startsWith("π ") ? [index] : []);
  assert.equal(labels.length, 2, "one header per delivery queue");
  assert.ok(labels.every(index => lines[index - 1] === ""), "one unshaded blank above each group");
  assert.equal(lines.filter(line => line === "").length, 3, "group and inter-message gaps; the native widget owns the final gap");
  assert.match(output, /2 messages/);
  assert.equal(output.match(/ctrl\+enter send now/g)?.length, 1);
  assert.match(lines[labels[0]], /alt\+up edit all queued/);
  assert.ok(render(140).at(-1).startsWith("\x1b[41m"), "the queued section ends at its shaded block");
  assert.match(render(60).join("\n"), /\x1b\[36mfirst steering/);
  const shaded = render(60).filter(line => line.startsWith("\x1b[41m"));
  assert.equal(shaded.length, 9, "each queued input has a content row and two shaded blank rows");
  assert.ok(shaded.every(line => visibleWidth(line) === 60), "shading spans the entire render width");
  assert.equal(plain(shaded[0]), " ".repeat(60));
  assert.equal(plain(shaded[2]), " ".repeat(60));
  assert.deepEqual(queue, { steering: ["first steering", "second steering"], followUp: ["later follow-up"] });
  mode.compactionQueuedMessages.push({ text: "compaction follow-up", mode: "followUp" });
  mode.updatePendingMessagesDisplay();
  assert.match(render(60).map(plain).join("\n"), /compaction follow-up/);
  assert.equal(mode.restoreQueuedMessagesToEditor(), 4);
  assert.equal(mode.restored, "first steering\n\nsecond steering\n\nlater follow-up\n\ncompaction follow-up");
  assert.deepEqual(queue, { steering: [], followUp: [] });
  assert.equal(children.length, 0);
});

test("native widget composition leaves exactly one unshaded blank below queued input", () => {
  installPendingInput(() => palette("mocha"));
  const { mode, queue, render } = host();
  queue.steering.push("first", "second");
  mode.updatePendingMessagesDisplay();
  const widgets = new Container();
  mode.renderWidgetContainer(widgets, new Map([["working", { render: () => ["working", ""], invalidate() {} }]]), true, true);
  const lines = [...render(80), ...widgets.render(80)];
  const working = lines.indexOf("working");
  assert.equal(lines[working - 1], "");
  assert.ok(lines[working - 2].startsWith("\x1b[41m"), "the preceding row is shaded, not a second unshaded blank");
});

test("a queued skill invocation draws as its /skill: command, not the expanded instructions", () => {
  installPendingInput(() => palette("mocha"));
  const { mode, queue, render } = host();
  queue.followUp.push('<skill name="review" location="/fixture/review/SKILL.md">\n# Internal instructions\n\nNever show this.\n</skill>\n\nthe diff');
  mode.updatePendingMessagesDisplay();
  const output = render(80).map(plain).join("\n");
  assert.match(output, /❯ \/skill:review the diff/);
  assert.doesNotMatch(output, /Never show this/);
});

test("consumed steering leaves follow-ups visible, and native abort restores the remainder with the draft", () => {
  installPendingInput(() => palette("mocha"));
  const { mode, queue, children, render } = host();
  queue.steering.push("consumed steer");
  queue.followUp.push("remaining follow-up");
  mode.updatePendingMessagesDisplay();
  queue.steering.shift();
  mode.updatePendingMessagesDisplay();
  const text = render(60).map(plain).join("\n");
  assert.doesNotMatch(text, /consumed steer|π Steering/);
  assert.match(text, /remaining follow-up/);
  let aborted = false;
  mode.session.abort = () => { aborted = true; };
  assert.equal(mode.restoreQueuedMessagesToEditor({ abort: true, currentText: "draft" }), 1);
  assert.equal(mode.restored, "remaining follow-up\n\ndraft");
  assert.equal(aborted, true);
  assert.equal(children.length, 0);
});

test("width and live theme switch, including reinstallation, never stale-cache queued blocks", () => {
  let theme = palette("mocha");
  installPendingInput(() => theme);
  const method = InteractiveMode.prototype.updatePendingMessagesDisplay;
  installPendingInput(() => theme);
  assert.equal(InteractiveMode.prototype.updatePendingMessagesDisplay, method);
  const { mode, queue, render } = host();
  queue.followUp.push("界 long words across narrow widths\nsecond line");
  mode.updatePendingMessagesDisplay();
  for (const width of [1, 2, 3, 12, 40]) {
    assert.ok(render(width).every(line => visibleWidth(line) <= width));
    const text = render(width).map(plain).join("").replaceAll(" ", "");
    assert.match(text, /alt\+upeditallqueued/, "narrow headers wrap instead of truncating hints");
  }
  assert.deepEqual(render(0), []);
  assert.match(render(40).join("\n"), /\x1b\[41m/);
  theme = palette("latte");
  assert.match(render(40).join("\n"), /\x1b\[42m/);
});

test("a fresh module updates the installed display's theme getter without wrapping it again", async () => {
  installPendingInput(() => palette("mocha"));
  const method = InteractiveMode.prototype.updatePendingMessagesDisplay;
  const { mode, queue, render } = host();
  queue.followUp.push("new theme");
  mode.updatePendingMessagesDisplay();
  assert.match(render(40).join("\n"), /\x1b\[41m/);
  const fresh = await import(new URL(`./pending-input.mjs?reload=${Date.now()}`, import.meta.url));
  fresh.installPendingInput(() => palette("latte"));
  assert.equal(InteractiveMode.prototype.updatePendingMessagesDisplay, method);
  mode.updatePendingMessagesDisplay();
  assert.match(render(40).join("\n"), /\x1b\[42m/);
});

function sender() {
  const control = installPendingInput(() => palette("mocha"));
  const h = host();
  const session = h.mode.session;
  const starts = [], errors = [], history = [], native = [];
  let text = "";
  Object.assign(session, {
    isIdle: false, isStreaming: true,
    async abort() { this.isIdle = true; this.isStreaming = false; },
    async steer(value) { h.queue.steering.push(value); },
    async followUp(value) { h.queue.followUp.push(value); },
    async _runAgentPrompt(messages) {
      assert.deepEqual(messages, []);
      starts.push([...h.queue.steering]);
      h.queue.steering.length = 0;
      h.mode.updatePendingMessagesDisplay();
    },
  });
  h.mode.isExtensionCommand = () => false;
  h.mode.showError = error => errors.push(error);
  h.mode.editor = {
    getText: () => text, getExpandedText: () => text,
    setText: value => { text = value; }, addToHistory: value => history.push(value),
    submitValue: () => { native.push(text); text = ""; },
  };
  h.mode.updatePendingMessagesDisplay();
  return { ...h, control, session, starts, errors, history, native, send: () => control.sendNow(h.mode.editor) };
}

test("send-now aborts once, sends steering then expanded draft, and never requeues follow-ups", async () => {
  const h = sender();
  let settleAbort;
  let aborts = 0;
  h.session.abort = () => { aborts++; return new Promise(resolve => { settleAbort = resolve; }); };
  h.queue.steering.push("first", "second");
  h.queue.followUp.push("expanded follow-up");
  h.session.followUp = () => { throw new Error("existing follow-up must not be expanded twice"); };
  h.mode.editor.setText("[paste]");
  h.mode.editor.getExpandedText = () => "expanded draft";
  const sending = h.send();
  await h.send();
  assert.equal(aborts, 1);
  assert.deepEqual(h.starts, []);
  h.queue.steering.push("arrived during abort");
  h.mode.editor.setText("new draft while aborting");
  h.session.isIdle = true;
  h.session.isStreaming = false;
  settleAbort();
  await sending;
  assert.deepEqual(h.starts, [["first", "second", "arrived during abort", "expanded draft"]]);
  assert.deepEqual(h.queue.followUp, ["expanded follow-up"]);
  assert.equal(h.mode.editor.getText(), "new draft while aborting");
  assert.deepEqual(h.history, ["expanded draft"]);
  assert.deepEqual(h.errors, []);
});

test("send-now holds compaction flush through abort and transfers raw arrivals once", async () => {
  const h = sender();
  const handled = [];
  h.session.steer = async value => { handled.push(value); h.queue.steering.push(value); };
  h.session.followUp = async value => { handled.push(value); h.queue.followUp.push(value); };
  h.mode.compactionQueuedMessages.push({ text: "compact steer", mode: "steer" });
  h.session.abort = async () => {
    h.mode.compactionQueuedMessages.push({ text: "compact follow-up", mode: "followUp" });
    await h.mode.flushCompactionQueue({ willRetry: false });
    assert.equal(h.mode.compactionQueuedMessages.length, 2, "native flush must not race send-now");
    h.session.isStreaming = false;
    h.session.isIdle = true;
  };
  await h.send();
  assert.deepEqual(handled, ["compact steer", "compact follow-up"]);
  assert.deepEqual(h.starts, [["compact steer"]]);
  assert.deepEqual(h.queue.followUp, ["compact follow-up"]);
  assert.deepEqual(h.mode.compactionQueuedMessages, []);
});

test("send-now is empty-safe, uses native idle/command submission, and clears only a sent draft", async () => {
  const h = sender();
  h.session.abort = () => { throw new Error("must not abort"); };
  h.queue.followUp.push("later only");
  await h.send();
  assert.deepEqual(h.starts, []);
  h.session.isIdle = true;
  h.mode.editor.setText("idle text");
  await h.send();
  assert.deepEqual(h.native, ["idle text"]);
  h.session.isIdle = false;
  h.mode.editor.setText("/plan show");
  await h.send();
  assert.deepEqual(h.native, ["idle text", "/plan show"]);
  assert.deepEqual(h.errors, []);
  h.mode.editor.setText("send draft");
  h.session.abort = async () => { h.session.isStreaming = false; };
  await h.send();
  assert.equal(h.mode.editor.getText(), "");
  assert.deepEqual(h.starts, [["send draft"]]);
});

test("session reset or replacement during abort never sends into the replacement", async () => {
  for (const reset of [true, false]) {
    const h = sender();
    h.queue.steering.push("old steering");
    h.mode.editor.setText("old draft");
    h.session.abort = async () => {
      if (reset) h.control.reset();
      else Object.defineProperty(h.mode, "session", { value: {} });
    };
    await h.send();
    assert.deepEqual(h.starts, []);
    assert.deepEqual(h.queue.steering, ["old steering"]);
    assert.equal(h.mode.editor.getText(), "");
    assert.deepEqual(h.mode.compactionQueuedMessages, [{ text: "old draft", mode: "steer" }], "claimed input stays in its original native queue");
  }
});

test("send-now keeps pending input on abort failure and does not race a notification's new run", async () => {
  const h = sender();
  h.queue.steering.push("steer");
  h.mode.editor.setText("draft");
  h.session.abort = async () => { throw new Error("cleanup failed"); };
  await h.send();
  assert.deepEqual(h.queue.steering, ["steer"]);
  assert.equal(h.mode.editor.getText(), "");
  assert.deepEqual(h.mode.getAllQueuedMessages().steering, ["steer", "draft"], "failed cancellation retains the claimed draft for retry or dequeue");
  assert.match(h.errors[0], /cleanup failed/);
  h.session.abort = async () => {};
  await h.send();
  assert.deepEqual(h.starts, []);
  assert.deepEqual(h.queue.steering, ["steer", "draft"]);
});

test("native Alt+Enter during cancellation cannot resubmit the claimed draft", async () => {
  const h = sender();
  let settle;
  h.session.abort = () => new Promise(resolve => { settle = resolve; });
  h.session.prompt = async (text, options) => { assert.equal(options.streamingBehavior, "followUp"); h.queue.followUp.push(text); };
  h.mode.editor.setText("send once");
  const sending = h.send();
  assert.equal(h.mode.editor.getText(), "", "the draft is claimed before the first await");
  await h.mode.handleFollowUp();
  assert.deepEqual(h.queue.followUp, []);
  h.mode.editor.setText("new follow-up");
  await h.mode.handleFollowUp();
  assert.deepEqual(h.queue.followUp, ["new follow-up"]);
  h.session.isStreaming = false;
  settle();
  await sending;
  assert.deepEqual(h.starts, [["send once"]]);
  assert.deepEqual(h.queue.followUp, ["new follow-up"]);
});

test("native dequeue during cancellation recovers the claimed draft without later sending a hidden copy", async () => {
  const h = sender();
  let settle;
  h.session.abort = () => new Promise(resolve => { settle = resolve; });
  h.queue.steering.push("earlier");
  h.mode.editor.setText("claimed draft");
  const sending = h.send();
  assert.equal(h.mode.restoreQueuedMessagesToEditor(), 2);
  assert.equal(h.mode.editor.getText(), "earlier\n\nclaimed draft");
  h.session.isStreaming = false;
  settle();
  await sending;
  assert.deepEqual(h.starts, []);
  assert.deepEqual(h.queue.steering, []);
  assert.equal(h.mode.editor.getText(), "earlier\n\nclaimed draft");
});

test("a repeated key cannot start a second run before the initial steering poll", async () => {
  const h = sender();
  h.queue.steering.push("steer");
  let finish;
  let calls = 0;
  h.session._runAgentPrompt = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  await h.send();
  await h.send();
  assert.equal(calls, 1);
  h.queue.steering.length = 0;
  h.mode.updatePendingMessagesDisplay();
  assert.equal(h.control.sending, null);
  finish();
});

test("native empty-prompt run consumes steering before its first request and follow-ups only afterward", async () => {
  const user = text => ({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
  const steer = [user("first"), user("draft")];
  steer[0].content.push({ type: "image", mimeType: "image/png", data: "fixture" });
  const followUp = [user("later")];
  const requests = [];
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  await runAgentLoop([], { messages: [], tools: [] }, {
    model: { provider: "openai-codex", id: "fixture" }, convertToLlm: messages => messages,
    getSteeringMessages: async () => steer.splice(0), getFollowUpMessages: async () => followUp.splice(0),
  }, async () => {}, undefined, async (_model, context) => {
    requests.push(structuredClone(context.messages));
    const message = { role: "assistant", content: [{ type: "text", text: "done" }], api: "openai-codex-responses", provider: "openai-codex", model: "fixture", usage, stopReason: "stop", timestamp: Date.now() };
    return { async *[Symbol.asyncIterator]() { yield { type: "done" }; }, async result() { return message; } };
  });
  assert.equal(requests.length, 2);
  const texts = messages => messages.filter(m => m.role === "user").map(m => m.content[0].text);
  assert.deepEqual(texts(requests[0]), ["first", "draft"]);
  assert.deepEqual(texts(requests[1]), ["first", "draft", "later"]);
  assert.equal(requests[0].find(m => m.role === "user").content[1].type, "image");
});
