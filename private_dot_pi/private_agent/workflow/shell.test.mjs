import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { Container, visibleWidth } from "@earendil-works/pi-tui";
import { Agent } from "@earendil-works/pi-agent-core";
import { AgentSession, InteractiveMode, SessionManager, createLocalBashOperations, initTheme } from "@earendil-works/pi-coding-agent";
import { addFold, createFolds, deliveryLanding, foldGroup, liveGroup, settleFold } from "./rows.mjs";
import { contextText, createShellRunner, installShell, parseShellInput, pendingShellLines, shellComponent, shellLines } from "./shell.mjs";
import { createTasks } from "./tasks.mjs";

// Real ANSI codes (not the readable `<color>` tags other suites use) so
// visibleWidth/wrapTextWithAnsi/pad, which this row depends on, measure the
// rendered lines the way a real theme would.
const CODES = { error: 31, warning: 33, success: 32, muted: 90, dim: 2, userMessageText: 97 };
const fg = (color, text) => `\x1b[${CODES[color]}m${text}\x1b[39m`;
const BG = "\x1b[48;5;1m";
const theme = { fg, bg: (_color, text) => `${BG}${text}\x1b[49m` };
const strip = text => text.replace(/\x1b\[[0-9;]*m/g, "");

test("parseShellInput: ! keeps the run in context, !! excludes it, the command is trimmed and an empty one is no command", () => {
  assert.deepEqual(parseShellInput("!ls"), { command: "ls", excludeFromContext: false });
  assert.deepEqual(parseShellInput("!!pwd"), { command: "pwd", excludeFromContext: true });
  assert.deepEqual(parseShellInput("!!  pwd  "), { command: "pwd", excludeFromContext: true });
  assert.deepEqual(parseShellInput("!   ls -la  "), { command: "ls -la", excludeFromContext: false });
  assert.equal(parseShellInput("!"), null);
  assert.equal(parseShellInput("!   "), null);
  assert.equal(parseShellInput("!!"), null);
  assert.equal(parseShellInput("text"), null);
  assert.equal(parseShellInput(""), null);
});

test("contextText: Ran `command`, the output fenced or (no output), then cancellation or a nonzero exit, then truncation", () => {
  assert.equal(contextText({ command: "ls", output: "a\nb", exitCode: 0, cancelled: false }), "Ran `ls`\n```\na\nb\n```");
  assert.equal(contextText({ command: "ls", output: "", exitCode: 0, cancelled: false }), "Ran `ls`\n(no output)");
  assert.equal(contextText({ command: "false", output: "", exitCode: 2, cancelled: false }), "Ran `false`\n(no output)\n\nCommand exited with code 2");
  assert.equal(contextText({ command: "sleep 5", output: "", exitCode: undefined, cancelled: true }), "Ran `sleep 5`\n(no output)\n\n(command cancelled)");
  assert.equal(contextText({ command: "x", output: "", exitCode: null, cancelled: false }), "Ran `x`\n(no output)");
  assert.equal(contextText({ command: "x", output: "a", exitCode: 0, cancelled: false, truncated: true }), "Ran `x`\n```\na\n```\n\n[Output truncated]");
  assert.equal(contextText({ command: "x", output: "", exitCode: 1, cancelled: false, truncated: true }), "Ran `x`\n(no output)\n\nCommand exited with code 1\n\n[Output truncated]");
});

test("shellLines: three shaded rows, then one unshaded blank before output", () => {
  const lines = shellLines({ command: "ls -la", output: "" }, {}, theme, 20);
  assert.equal(lines.length, 7);
  assert.equal(lines[3], "");
  for (const line of lines.slice(0, 3)) {
    assert.ok(line.startsWith(BG), line);
    assert.equal(visibleWidth(strip(line)), 20);
  }
  assert.equal(strip(lines[0]), " ".repeat(20));
  assert.equal(strip(lines[2]), " ".repeat(20));
  assert.match(strip(lines[1]), /^! ls -la */);
  assert.ok(lines[1].includes(fg("error", "! ")), lines[1]);
  assert.ok(lines[1].includes(fg("userMessageText", "ls -la")), lines[1]);
});

test("a two-line command shades both lines, the second two in", () => {
  const lines = shellLines({ command: "echo one\necho two", output: "" }, {}, theme, 30);
  assert.equal(lines.length, 8);
  assert.equal(lines[4], "");
  assert.match(strip(lines[1]), /^! echo one */);
  assert.match(strip(lines[2]), /^ {2}echo two */);
});

test("output lines sit two in, muted; empty output is explicit", () => {
  assert.equal(strip(shellLines({ command: "x", output: "" }, {}, theme, 30).at(-1)), "  no output");
  const lines = shellLines({ command: "x", output: "a\nb", exitCode: 0 }, {}, theme, 30);
  assert.equal(lines[3], "");
  assert.equal(strip(lines[4]), "• Output · 2 lines · exit 0");
  assert.ok(lines[4].includes(fg("success", "•")));
  assert.equal(strip(lines[5]), "  a");
  assert.equal(strip(lines[6]), "  b");
  assert.ok(lines[5].includes(fg("muted", "a")));
});

test("long success shows last four; failure and cancellation show first two and last two", () => {
  const output = Array.from({ length: 9 }, (_, i) => `l${i}`).join("\n");
  const success = shellLines({ command: "x", output, exitCode: 0 }, {}, theme, 40);
  assert.equal(strip(success[4]), "▸ Output · 9 lines · exit 0");
  assert.ok(success[4].includes(fg("success", "▸")));
  assert.deepEqual(success.slice(5).map(strip), ["  … 5 more lines", "  l5", "  l6", "  l7", "  l8"]);
  for (const details of [{ exitCode: 2 }, { cancelled: true }]) {
    const lines = shellLines({ command: "x", output, ...details }, {}, theme, 40);
    assert.equal(lines[3], "");
    assert.deepEqual(lines.slice(5).map(strip), ["  l0", "  l1", "  … 5 more lines", "  l7", "  l8"]);
  }
  const expanded = shellLines({ command: "x", output, exitCode: 0 }, { expanded: true }, theme, 40);
  assert.equal(strip(expanded[4]), "▾ Output · 9 lines · exit 0");
  assert.deepEqual(expanded.slice(5).map(strip), output.split("\n").map(line => `  ${line}`));
});

test("outcome summary uses semantic colours and calls out truncation", () => {
  for (const [details, color, label] of [
    [{ exitCode: 0 }, "success", "exit 0"],
    [{ exitCode: 1 }, "error", "exit 1"],
    [{ cancelled: true }, "warning", "cancelled"],
  ]) {
    const lines = shellLines({ command: "x", output: "", ...details }, {}, theme, 50);
    assert.equal(lines[3], "");
    const summary = lines[4];
    assert.ok(summary.includes(fg(color, label)));
    assert.ok(summary.includes(fg(color, "•")));
  }
  const truncated = shellLines({ command: "x", output: "", exitCode: 0, truncated: true }, {}, theme, 50);
  assert.match(strip(truncated[4]), /output truncated/);
  assert.ok(truncated[4].includes(fg("warning", "output truncated")));
});

test("shellComponent renders through shellLines at the given width and invalidates as a no-op", () => {
  const component = shellComponent({ command: "ls", output: "" }, {}, theme);
  assert.deepEqual(component.render(20), shellLines({ command: "ls", output: "" }, {}, theme, 20));
  assert.equal(component.invalidate(), undefined);
});

test("entry renderer retains clicked expansion through rebuild, Ctrl+O outranks clicks, and repaint fires", () => {
  const renderers = {};
  const folds = createFolds();
  let repaints = 0;
  folds.repaint = () => { repaints++; };
  const pi = {
    on() {}, registerMessageRenderer(type, renderer) { renderers.message = renderer; },
    registerEntryRenderer(type, renderer) { renderers.entry = renderer; },
    sendMessage() {}, appendEntry() {},
  };
  installShell(pi, () => ({ cwd: "/work", ui: { notify() {} }, isIdle: () => true }), { folds, working() {}, exec: async () => ({ exitCode: 0 }), env: () => ({}) });
  const details = { command: "x", output: "a\nb\nc\nd\ne\nf", exitCode: 0 };
  const entry = { data: details };
  let child = renderers.entry(entry, { expanded: false }, theme);
  assert.equal(strip(child.render(50)[4]).startsWith("▸"), true);
  assert.equal(child.handleMouse({ type: "click", button: "left", y: 3 }), undefined, "the blank line is not clickable");
  assert.equal(child.handleMouse({ type: "click", button: "left", y: 4 }).handled, true);
  assert.equal(repaints, 1);
  child = renderers.entry(entry, { expanded: false }, theme);
  assert.equal(strip(child.render(50)[4]).startsWith("▾"), true);
  assert.equal(child.handleMouse({ type: "click", button: "left", y: 5 }), undefined);
  child = renderers.entry(entry, { expanded: true }, theme);
  assert.equal(child.render(50).length, 11);
  assert.equal(child.handleMouse({ type: "click", button: "left", y: 4 }), undefined);
  child = renderers.entry(entry, { expanded: false }, theme);
  assert.equal(strip(child.render(50)[4]).startsWith("▸"), true);
  const message = { details };
  let history = renderers.message(message, { expanded: false }, theme);
  history.render(50);
  assert.equal(history.handleMouse({ type: "click", button: "left", y: 4 }).handled, true);
  history = renderers.message(message, { expanded: false }, theme);
  assert.equal(strip(history.render(50)[4]).startsWith("▾"), true);
  history = renderers.message(message, { expanded: true }, theme);
  assert.equal(history.render(50).length, 11);
  history = renderers.message(message, { expanded: false }, theme);
  assert.equal(strip(history.render(50)[4]).startsWith("▸"), true);
});

test("native host entry owns one spacer and forwards clicks across resize, theme rebuild, and Ctrl+O", () => {
  const renderers = {};
  const folds = createFolds();
  let repaints = 0;
  folds.repaint = () => { repaints++; };
  installShell({
    on() {}, registerMessageRenderer() {},
    registerEntryRenderer(type, renderer) { renderers[type] = renderer; },
  }, () => ({ cwd: "/work", ui: { notify() {} }, isIdle: () => true }), { folds, working() {}, exec: async () => ({ exitCode: 0 }), env: () => ({}) });
  initTheme("dark");
  const mode = Object.create(InteractiveMode.prototype);
  Object.defineProperty(mode, "session", { value: { extensionRunner: { getEntryRenderer: type => renderers[type] } } });
  mode.chatContainer = new Container();
  mode.toolOutputExpanded = false;
  const details = { command: "x", output: "a\nb\nc\nd\ne\nf", exitCode: 0 };
  mode.addCustomEntryToChat({ customType: "workflow-shell", data: details });
  assert.equal(mode.chatContainer.children.length, 1);
  const host = mode.chatContainer.children[0];
  assert.equal(host.children.length, 2, "one host spacer and one renderer child");
  const render = width => host.render(width).map(strip);
  assert.equal(render(50)[0], "");
  assert.equal(render(50)[4], "");
  assert.equal(render(50)[5].startsWith("▸"), true);
  assert.equal(host.handleMouse({ type: "click", button: "left", x: 0, y: 4, width: 50, height: host.render(50).length }), undefined);
  assert.equal(host.handleMouse({ type: "click", button: "left", x: 0, y: 5, width: 50, height: host.render(50).length }).handled, true);
  assert.equal(repaints, 1);
  assert.equal(render(50)[5].startsWith("▾"), true);
  const dark = host.render(50).join("\n");
  initTheme("light");
  host.invalidate();
  assert.notEqual(host.render(50).join("\n"), dark, "host rebuild reads the live theme");
  assert.equal(render(15)[5].startsWith("▾"), true);
  assert.ok(host.render(15).every(line => visibleWidth(line) <= 15));
  host.setExpanded(true);
  assert.equal(host.children.length, 2);
  assert.equal(host.handleMouse({ type: "click", button: "left", x: 0, y: 5, width: 15, height: host.render(15).length }), undefined);
  host.setExpanded(false);
  assert.equal(render(15)[5].startsWith("▸"), true);
  assert.equal(host.handleMouse({ type: "click", button: "left", x: 0, y: 5, width: 15, height: host.render(15).length }).handled, true);
  assert.equal(render(15)[5].startsWith("▾"), true);
  initTheme("dark");
});

test("native in-memory safe boundary retains one visible entry and delays a cancelled !'s context until after the tool result; !! stays out", async () => {
  const manager = SessionManager.inMemory("/work");
  const events = [];
  const session = Object.create(AgentSession.prototype);
  session.sessionManager = manager;
  session.agent = { state: { messages: [] } };
  session._entryIdsByMessage = new WeakMap();
  session._isAgentRunActive = true;
  session._pendingCustomMessages = [];
  session._emit = event => events.push(event);
  session._startRun = () => { throw new Error("shell input must not start a model turn"); };
  session._refreshFinalizedContext = () => { session.agent.state.messages = manager.buildSessionContext().messages; };
  const pi = {
    on() {},
    appendEntry: (type, data) => manager.appendCustomEntry(type, data),
    sendMessage: (message, options) => session.sendCustomMessage(message, options),
  };
  let exec = (_command, _cwd, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const folds = createFolds();
  const runner = createShellRunner({ pi, folds, land: deliveryLanding(pi, folds).land, working() {}, cwd: () => "/work", notify() {}, env: () => ({}), exec: (...args) => exec(...args) });
  manager.appendMessage({ role: "assistant", content: [{ type: "toolCall", id: "t1", name: "bash", arguments: {} }], timestamp: Date.now() });
  runner.submit("!pwd");
  runner.abort();
  await runner.pending;
  assert.equal(manager.getEntries().filter(entry => entry.type === "custom").length, 1);
  assert.equal(manager.getEntries().filter(entry => entry.type === "custom_message").length, 0);
  assert.equal(session._pendingCustomMessages.length, 1);
  manager.appendMessage({ role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "result" }], isError: false, timestamp: Date.now() });
  session._flushPendingCustomMessages();
  assert.deepEqual(manager.getEntries().slice(-2).map(entry => entry.type), ["message", "custom_message"]);
  assert.equal(manager.buildSessionContext().messages.at(-1).display, false);
  assert.deepEqual(manager.buildSessionContext().messages.map(message => message.role), ["assistant", "toolResult", "custom"]);
  session._flushPendingCustomMessages();
  assert.equal(events.filter(event => event.type === "message_start").length, 1);
  session._isAgentRunActive = false;
  exec = async () => ({ exitCode: 0 });
  runner.submit("!!pwd");
  await runner.pending;
  assert.equal(manager.getEntries().filter(entry => entry.type === "custom").length, 2);
  assert.equal(manager.getEntries().filter(entry => entry.type === "custom_message").length, 1);
  assert.equal(manager.buildSessionContext().messages.filter(message => message.role === "custom").length, 1);
});

for (const exitCode of [0, 2]) test(`native steering delivers shell exit ${exitCode} after the blocked tool batch, without interrupting it`, { timeout: 5000 }, async t => {
  const manager = SessionManager.inMemory("/work");
  const requests = [];
  let releaseTool, toolStarted;
  const blocked = new Promise(resolve => { releaseTool = resolve; });
  const started = new Promise(resolve => { toolStarted = resolve; });
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const signals = [];
  const agent = new Agent({
    initialState: {
      model: { provider: "openai-codex", id: "fixture" },
      tools: [{ name: "blocked", description: "fixture", parameters: { type: "object", properties: {} }, async execute(_id, _args, signal) {
        signals.push(signal);
        toolStarted();
        await blocked;
        return { content: [{ type: "text", text: "tool finished" }] };
      } }],
    },
    steeringMode: "all",
    convertToLlm: messages => messages,
    streamFn: async (_model, context, options) => {
      signals.push(options.signal);
      requests.push(structuredClone(context.messages));
      const call = requests.length <= 2;
      const message = { role: "assistant", content: call ? [{ type: "toolCall", id: `t${requests.length}`, name: "blocked", arguments: {} }] : [{ type: "text", text: "done" }], api: "openai-codex-responses", provider: "openai-codex", model: "fixture", usage, stopReason: call ? "toolUse" : "stop", timestamp: Date.now() };
      return { async *[Symbol.asyncIterator]() { yield { type: "done" }; }, async result() { return message; } };
    },
  });
  t.after(() => { releaseTool(); agent.abort(); });
  const starts = [];
  agent.subscribe(event => {
    if (event.type === "message_start") starts.forEach(fn => fn(event));
    if (event.type === "message_end") {
      const message = event.message;
      if (message.role === "custom") manager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
      else manager.appendMessage(message);
    }
  });
  const session = Object.create(AgentSession.prototype);
  session.agent = agent;
  session._isAgentRunActive = true;
  session._steeringMessages = [];
  session._followUpMessages = [];
  session._emit = () => {};
  session._startRun = () => { throw new Error("must not start a competing run"); };
  const runStarts = [];
  const pi = { on: (name, fn) => { if (name === "message_start") starts.push(fn); if (name === "agent_start") runStarts.push(fn); }, appendEntry: (type, data) => manager.appendCustomEntry(type, data), sendMessage: (message, options) => session.sendCustomMessage(message, options) };
  const folds = createFolds();
  const runner = createShellRunner({
    pi, folds, land: deliveryLanding(pi, folds).land,
    working() {}, cwd: () => "/work", notify() {}, env: () => ({}), idle: () => false,
    exec: async (_command, _cwd, { onData }) => { onData(Buffer.from("shell result")); return { exitCode }; },
  });
  const running = agent.prompt("work through both batches");
  runStarts.forEach(fn => fn());
  await started;
  runner.submit("!fixture");
  await runner.pending;
  assert.equal(manager.getEntries().filter(entry => entry.type === "custom").length, 0, "the visible entry waits until the agent reads the result");
  assert.equal(runner.runs()[0].details.exitCode, exitCode, "meanwhile the finished run stays in the pending area");
  assert.equal(manager.getEntries().filter(entry => entry.type === "custom_message").length, 0, "context waits for the safe boundary");
  await session._queueSteer("human steering");
  await session.sendCustomMessage({ customType: "notification", content: "subsequent notification", display: false }, { triggerTurn: true, deliverAs: "steer" });
  assert.equal(requests.length, 1, "no new request before the running tool finishes");
  assert.ok(signals.every(signal => !signal?.aborted), "neither model nor tool was interrupted");
  releaseTool();
  await running;
  assert.equal(requests.length, 3, "the task continues through another tool batch");
  for (const request of requests.slice(1)) {
    const results = request.filter(message => message.customType === "workflow-shell");
    assert.equal(results.length, 1, "each later request contains the shell result exactly once");
    assert.equal(results[0].details.exitCode, exitCode);
    assert.equal(results[0].display, false);
    assert.equal(results[0].content, contextText(results[0].details));
  }
  const next = requests[1];
  const resultIndex = next.findIndex(message => message.customType === "workflow-shell");
  assert.ok(next.findIndex(message => message.role === "toolResult" && message.toolCallId === "t1") < resultIndex);
  assert.equal(next[resultIndex + 1].content[0].text, "human steering");
  assert.equal(next[resultIndex + 2].customType, "notification");
  assert.equal(manager.getEntries().filter(entry => entry.type === "custom_message" && entry.customType === "workflow-shell").length, 1);
  const types = manager.getEntries().map(entry => entry.type === "message" ? entry.message.toolCallId ?? entry.message.role : `${entry.type}:${entry.customType}`);
  assert.ok(types.indexOf("t1") < types.indexOf("custom:workflow-shell"), "the entry lands after the batch it waited behind");
  assert.equal(types.indexOf("custom:workflow-shell") + 1, types.indexOf("custom_message:workflow-shell"), "and where the steer is read, before any later reply");
  assert.deepEqual(runner.runs(), []);
  assert.ok(signals.every(signal => !signal?.aborted));
});

test("native InteractiveMode mounts a shell completed during streaming between the prior reply and the steered reply", { timeout: 5000 }, async t => {
  initTheme("dark");
  const manager = SessionManager.inMemory("/work");
  const handlers = {};
  const renderers = {};
  const requests = [];
  let releaseReply, streaming;
  const blocked = new Promise(resolve => { releaseReply = resolve; });
  const started = new Promise(resolve => { streaming = resolve; });
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const agent = new Agent({
    initialState: { model: { provider: "openai-codex", id: "fixture" } },
    convertToLlm: messages => messages,
    streamFn: async (_model, context, options) => {
      requests.push(structuredClone(context.messages));
      const first = requests.length === 1;
      const message = { role: "assistant", content: [{ type: "text", text: first ? "prior reply" : "next reply" }], api: "openai-codex-responses", provider: "openai-codex", model: "fixture", usage, stopReason: "stop", timestamp: Date.now() };
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: "start", partial: { ...message, content: [] } };
          yield { type: "text_delta", contentIndex: 0, delta: message.content[0].text, partial: message };
          if (first) { streaming(); await blocked; assert.equal(options.signal.aborted, false); }
          yield { type: "done" };
        },
        async result() { return message; },
      };
    },
  });
  t.after(() => { releaseReply(); agent.abort(); });
  // Keep native event dispatch and persistence; resource loading and automatic
  // compaction are outside this in-memory model/UI fixture.
  class FixtureSession extends AgentSession {
    _buildRuntime() {}
    _installAgentNextTurnRefresh() {}
  }
  const session = new FixtureSession({ agent, sessionManager: manager, cwd: "/work",
    settingsManager: { getRetrySettings: () => ({ enabled: false }), getCodeBlockIndent: () => 0, getShowCacheMissNotices: () => false, getShowTerminalProgress: () => false },
  });
  session._isAgentRunActive = true;
  session._startRun = () => assert.fail("no competing run while the reply streams");
  session._extensionRunner = {
    getEntryRenderer: type => renderers[type], getMarkdownTransformers: () => [], hasHandlers: () => false,
    async emit(event) { for (const fn of handlers[event.type] ?? []) await fn(event); },
    async emitMessageEnd(event) { await this.emit(event); },
  };
  const mode = Object.assign(Object.create(InteractiveMode.prototype), {
    runtimeHost: { session }, isInitialized: true, chatContainer: new Container(), pendingTools: new Map(),
    entriesRenderedByBoundaryCompaction: new Set(), outputPad: 0, toolOutputExpanded: false,
    footer: { invalidate() {} }, programStatus: { handleEvent() {} }, ui: { requestRender() {} },
    pendingMessagesContainer: new Container(), compactionQueuedMessages: [],
  });
  const pi = {
    on: (name, fn) => { (handlers[name] ??= []).push(fn); },
    registerMessageRenderer() {}, registerEntryRenderer: (type, renderer) => { renderers[type] = renderer; },
    appendEntry(type, data) {
      const id = manager.appendCustomEntry(type, data);
      session._emit({ type: "entry_appended", entry: manager.getEntry(id) });
    },
    sendMessage: (message, options) => session.sendCustomMessage(message, options),
  };
  const folds = createFolds();
  const runner = installShell(pi, () => ({ cwd: "/work", ui: { notify() {} }, isIdle: () => false }), {
    folds, land: deliveryLanding(pi, folds).land, working() {}, env: () => ({}),
    exec: async (_command, _cwd, { onData }) => { onData(Buffer.from("shell result")); return { exitCode: 0 }; },
  });
  session.subscribe(event => mode.handleEvent(event));
  // User input and end-of-run chrome are outside this fixture's transcript seam.
  mode.updatePendingMessagesDisplay = () => {};
  mode.clearStatusIndicator = () => {};
  const draw = () => mode.chatContainer.render(80).map(strip).join("\n");
  const running = agent.prompt("work");
  await started;
  assert.ok(mode.streamingComponent, "native message events mounted an in-flight assistant component");
  runner.submit("!fixture");
  await runner.pending;
  assert.match(draw(), /prior reply/);
  assert.doesNotMatch(draw(), /! fixture|shell result/, "completion cannot mount above the streaming reply");
  assert.equal(requests.length, 1);
  assert.equal(runner.runs().length, 1, "the completed block waits in the pending area");
  releaseReply();
  await running;
  assert.equal(requests.length, 2, "the steer reaches the next safe model request");
  assert.equal(requests[1].filter(message => message.customType === "workflow-shell").length, 1);
  const transcript = draw();
  assert.ok(transcript.indexOf("prior reply") < transcript.indexOf("! fixture"), transcript);
  assert.ok(transcript.indexOf("! fixture") < transcript.indexOf("shell result"), transcript);
  assert.ok(transcript.indexOf("shell result") < transcript.indexOf("next reply"), transcript);
  assert.deepEqual(runner.runs(), []);
});

test("native idle delivery wakes once with the hidden shell context", async () => {
  const session = Object.create(AgentSession.prototype);
  session._isAgentRunActive = false;
  const starts = [];
  session._startRun = async input => { starts.push(input); };
  const h = harness();
  h.pi.sendMessage = (message, options) => session.sendCustomMessage(message, options);
  h.runner.submit("!pwd");
  await h.runner.pending;
  assert.equal(starts.length, 1);
  assert.equal(starts[0].messageType, "custom");
  assert.equal(starts[0].message.display, false);
  assert.equal(starts[0].message.content, contextText(h.appended[0].data));
});

test("a wide output line wraps instead of overflowing the render width", () => {
  const output = "x".repeat(100);
  const lines = shellLines({ command: "ls", output }, {}, theme, 40);
  assert.ok(lines.length > 3, "the one logical line became several visual ones");
  for (const line of lines) assert.ok(visibleWidth(strip(line)) <= 40, `${visibleWidth(strip(line))} > 40: ${strip(line)}`);
});

test("header and status rows stay within a narrow width too", () => {
  const lines = shellLines({ command: "a very long command that needs wrapping", output: "", exitCode: 1 }, {}, theme, 12);
  assert.ok(lines.length > 4);
  for (const line of lines) assert.ok(visibleWidth(strip(line)) <= 12, `${visibleWidth(strip(line))} > 12: ${strip(line)}`);
});

test("a run of exactly four newline-terminated lines shows all four with no more-lines line", async () => {
  const output = Array.from({ length: 4 }, (_, i) => `l${i}`).join("\n") + "\n";
  const h = harness({ exec: async (_command, _cwd, { onData }) => { onData(Buffer.from(output)); return { exitCode: 0 }; } });
  h.runner.submit("!ls");
  await h.runner.pending;
  const details = h.sent[0].message.details;
  assert.equal(details.output.split("\n").length, 4);
  const lines = shellLines(details, { expanded: false }, theme, 30);
  assert.equal(strip(lines[5]), "  l0");
  assert.ok(!lines.some(line => /more lines/.test(strip(line))));
});

// The runner: dependencies are injected, so no real shell ever spawns.
function harness({ exec = async () => ({ exitCode: 0 }), folds = createFolds(), prefix, idle, tasks } = {}) {
  const sent = [];
  const appended = [];
  const notices = [];
  const workingCalls = [];
  const handlers = {};
  const pi = { on: (name, fn) => { (handlers[name] ??= []).push(fn); }, sendMessage: (message, options) => sent.push({ message, options }), appendEntry: (type, data) => appended.push({ type, data }) };
  const fire = (name, event) => (handlers[name] ?? []).forEach(fn => fn(event));
  let changes = 0;
  const runner = createShellRunner({
    pi, folds, exec, prefix, idle, tasks,
    land: deliveryLanding(pi, folds).land,
    changed: () => { changes++; },
    cwd: () => "/work",
    notify: (text, level) => notices.push({ text, level }),
    env: () => ({ PATH: "/bin" }),
    working: state => workingCalls.push(state),
    now: () => 1000,
  });
  return { runner, sent, appended, notices, workingCalls, folds, pi, fire, changes: () => changes };
}

test("a shell prefix runs before the command, which reaches exec in an eval, but details.command stays the typed command", async () => {
  const execCalls = [];
  const exec = async (command, _cwd, { onData }) => { execCalls.push(command); onData(Buffer.from("hi\n")); return { exitCode: 0 }; };
  const h = harness({ exec, prefix: () => "source ~/.zshrc" });
  h.runner.submit("!echo hi");
  await h.runner.pending;
  assert.deepEqual(execCalls, ["source ~/.zshrc\neval 'echo hi'"]);
  assert.equal(h.sent[0].message.details.command, "echo hi");
});

test("!! joins the prefix too, and its recorded command also stays typed", async () => {
  const execCalls = [];
  const exec = async (command) => { execCalls.push(command); return { exitCode: 0 }; };
  const h = harness({ exec, prefix: () => "export CI=1" });
  h.runner.submit("!!pwd");
  await h.runner.pending;
  assert.deepEqual(execCalls, ["export CI=1\neval 'pwd'"]);
  assert.equal(h.appended[0].data.command, "pwd");
});

test("a single quote in the command is escaped for the eval's quoting", async () => {
  const execCalls = [];
  const exec = async command => { execCalls.push(command); return { exitCode: 0 }; };
  const h = harness({ exec, prefix: () => "export CI=1" });
  h.runner.submit("!echo 'x'");
  await h.runner.pending;
  assert.deepEqual(execCalls, ["export CI=1\neval 'echo '\\''x'\\'''"]);
  assert.equal(h.appended[0].data.command, "echo 'x'");
});

// zsh -c parses its whole string before running any of it: an alias the
// prefix defines reaches the command only when the command is a later parse.
test("in zsh an alias the prefix defines expands in the command, quotes intact", { skip: !existsSync("/bin/zsh") && "no /bin/zsh" }, async () => {
  const ops = createLocalBashOperations({ shellPath: "/bin/zsh" });
  const h = harness({ exec: (command, _cwd, options) => ops.exec(command, process.cwd(), options), prefix: () => "alias greet='echo aliased'" });
  h.runner.submit(`!greet "it's" 'a "b"'`);
  await h.runner.pending;
  assert.equal(h.appended[0].data.exitCode, 0);
  assert.equal(h.appended[0].data.output, `aliased it's a "b"`);
});

test("with no prefix the command reaches exec verbatim", async () => {
  const execCalls = [];
  const exec = async command => { execCalls.push(command); return { exitCode: 0 }; };
  const h = harness({ exec });
  h.runner.submit("!ls");
  await h.runner.pending;
  assert.deepEqual(execCalls, ["ls"]);
});

test("! immediately appends a visible entry and defers only its hidden context", async () => {
  const h = harness({ exec: async () => ({ exitCode: 0 }) });
  h.runner.submit("!pwd");
  await h.runner.pending;
  assert.equal(h.appended.length, 1);
  assert.equal(h.appended[0].type, "workflow-shell");
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].message.display, false);
  assert.deepEqual(h.sent[0].message.details, h.appended[0].data);
  assert.equal(h.sent[0].message.content, contextText(h.appended[0].data));
});

test("! sends a hidden custom message carrying its contextText", async () => {
  const h = harness({ exec: async (_command, _cwd, { onData }) => { onData(Buffer.from("hi\n")); return { exitCode: 0 }; } });
  assert.equal(h.runner.submit("!echo hi"), true);
  await h.runner.pending;
  assert.equal(h.sent.length, 1);
  const { message } = h.sent[0];
  assert.equal(message.customType, "workflow-shell");
  assert.equal(message.display, false);
  assert.equal(message.content, contextText(message.details));
  assert.equal(message.details.output, "hi");
  assert.equal(message.details.truncated, false);
  assert.equal(message.details.fullOutputPath, undefined);
  assert.equal(h.appended.length, 1);
});

test("! wakes idle or steers busy; a cancelled ! starts none; !! sends nothing", async () => {
  const hang = (_command, _cwd, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const turn = { triggerTurn: true, deliverAs: "steer" };
  for (const [input, idle, cancel, expected] of [["!pwd", true, false, turn], ["!pwd", false, false, turn], ["!pwd", true, true, { triggerTurn: false }], ["!!pwd", true, false, undefined]]) {
    const h = harness({ exec: cancel ? hang : undefined, idle: () => idle });
    if (!idle) h.fire("agent_start");
    h.runner.submit(input);
    if (cancel) h.runner.abort();
    await h.runner.pending;
    assert.deepEqual(h.sent[0]?.options, expected, `${input} idle=${idle} cancelled=${cancel}`);
  }
});

test("!! records a visible custom entry instead of a message", async () => {
  const h = harness({ exec: async () => ({ exitCode: 0 }) });
  assert.equal(h.runner.submit("!!pwd"), true);
  await h.runner.pending;
  assert.equal(h.sent.length, 0);
  assert.equal(h.appended.length, 1);
  assert.equal(h.appended[0].type, "workflow-shell");
  assert.equal(h.appended[0].data.command, "pwd");
});

test("folds close synchronously at submit, before the command settles", async () => {
  const folds = createFolds();
  folds.timeline.push({ kind: "activity", source: "tool", id: "a", key: "read", tool: "read", outcome: "success" });
  let resolveExec;
  const exec = () => new Promise(resolve => { resolveExec = () => resolve({ exitCode: 0 }); });
  const h = harness({ exec, folds });
  h.runner.submit("!pwd");
  assert.equal(folds.timeline.at(-1).kind, "boundary");
  resolveExec();
  await h.runner.pending;
});

test("a ! submitted while a tool runs seals the settled rows above it, leaving the running one outside", async () => {
  const folds = createFolds();
  for (const id of ["a", "b", "c"]) addFold(folds, id, "read");
  settleFold(folds, "a", false);
  settleFold(folds, "b", false);
  const h = harness({ folds });
  h.runner.submit("!pwd");
  assert.equal(foldGroup(folds, "a")?.sealed, true);
  assert.deepEqual(foldGroup(folds, "a").entries.map(entry => entry.id), ["a", "b"]);
  assert.equal(foldGroup(folds, "c") ?? liveGroup(folds, "c"), null);
  await h.runner.pending;
});

test("plain text is not shell input: submit answers false and nothing runs", () => {
  const h = harness();
  assert.equal(h.runner.submit("just talking"), false);
  assert.equal(h.workingCalls.length, 0);
});

test("working is set with the command and cleared once settled", async () => {
  const h = harness({ exec: async () => ({ exitCode: 0 }) });
  h.runner.submit("!ls");
  assert.deepEqual(h.workingCalls[0], { command: "ls", startedAt: 1000 });
  await h.runner.pending;
  assert.equal(h.workingCalls.at(-1), null);
});

// Each exec waits for its own release, so the tests decide when a run ends.
function gated() {
  const calls = [];
  const exec = (command, _cwd, { signal, onData }) => new Promise((resolve, reject) => {
    calls.push({ command, signal, resolve: (exitCode = 0) => resolve({ exitCode }), onData });
    signal.addEventListener("abort", () => reject(new Error("aborted")));
  });
  return { calls, exec };
}

test("runs submitted while one is running queue in submit order, one at a time", async () => {
  const { calls, exec } = gated();
  const h = harness({ exec });
  assert.equal(h.runner.submit("!npm install"), true);
  assert.equal(h.runner.submit("!npm test"), true);
  assert.equal(h.runner.submit("!!ls"), true);
  assert.deepEqual(calls.map(call => call.command), ["npm install"], "the rest wait for the head");
  assert.deepEqual(h.runner.runs().map(run => run.state), ["running", "queued", "queued"]);
  assert.equal(h.notices.length, 0);
  calls[0].resolve();
  await sleep(0);
  assert.deepEqual(calls.map(call => call.command), ["npm install", "npm test"]);
  calls[1].resolve(1);
  await sleep(0);
  calls[2].resolve();
  await h.runner.pending;
  assert.deepEqual(h.appended.map(entry => entry.data.command), ["npm install", "npm test", "ls"]);
  assert.deepEqual(h.sent.map(entry => entry.message.details.exitCode), [0, 1], "!! sends nothing");
  assert.deepEqual(h.workingCalls.map(call => call?.command ?? null), ["npm install", "npm test", "ls", null]);
  assert.deepEqual(h.runner.runs(), []);
});

test("Ctrl+B hands the running head to a user task, lands its launch and starts the next run", async () => {
  const { calls, exec } = gated();
  const notified = [];
  let runner;
  const tasks = createTasks({ notify: (text, options) => notified.push({ text, options }), record: entry => runner.taskEnded(entry) });
  const h = harness({ exec, tasks });
  runner = h.runner;
  h.runner.submit("!npm run dev");
  h.runner.submit("!echo next");
  calls[0].onData(Buffer.from("listening\n"));
  h.runner.background();
  assert.equal(tasks.live(), 1);
  assert.equal(tasks.live({ leased: true }), 0, "a user task holds no lease");
  assert.deepEqual(tasks.list(), [{ id: "t1", status: "running", command: "npm run dev" }]);
  assert.deepEqual(h.appended[0].data, { command: "npm run dev", task: "t1", running: true });
  assert.equal(strip(shellLines(h.appended[0].data, {}, theme, 40).at(-1)), "  ↳ task t1 · running");
  assert.deepEqual(calls.map(call => call.command), ["npm run dev", "echo next"]);
  assert.deepEqual(h.runner.runs().map(run => run.command), ["echo next"]);
  calls[1].resolve();
  await h.runner.pending;
  calls[0].onData(Buffer.from("served\n"));
  calls[0].resolve();
  await sleep(0);
  await sleep(0);
  const ended = h.appended.at(-1).data;
  assert.equal(ended.task, "t1");
  assert.equal(ended.output, "listening\nserved", "output before and after the hand-over");
  assert.equal(ended.exitCode, 0);
  assert.match(strip(shellLines(ended, {}, theme, 80)[4]), /exit 0 · task t1 · 0s$/);
  assert.match(notified[0].text, /^Background task t1 completed \(exit 0\): npm run dev/);
  assert.equal(notified[0].options.details.id, "t1");
  assert.equal(h.sent.length, 1, "only the foreground run sends its own context");
});

test("a task stop kills a backgrounded run, whose block lands cancelled with no exit code", async () => {
  const { calls, exec } = gated();
  let runner;
  const tasks = createTasks({ notify() {}, record: entry => runner.taskEnded(entry) });
  const h = harness({ exec, tasks });
  runner = h.runner;
  h.runner.submit("!npm run dev");
  h.runner.background();
  assert.equal(tasks.stop("t1"), true);
  assert.equal(calls[0].signal.aborted, true);
  await sleep(0);
  await sleep(0);
  const ended = h.appended.at(-1).data;
  assert.equal(ended.task, "t1");
  assert.equal(ended.cancelled, true);
  assert.equal(ended.exitCode, undefined);
});

test("a backgrounded !! stays hidden from the model and lands without a message", async () => {
  const { calls, exec } = gated();
  const notified = [];
  let runner;
  const tasks = createTasks({ notify: text => notified.push(text), record: entry => runner.taskEnded(entry) });
  const h = harness({ exec, tasks });
  runner = h.runner;
  h.runner.submit("!!sleep 9");
  h.runner.background();
  assert.deepEqual(tasks.list(), []);
  calls[0].resolve();
  await sleep(0);
  await sleep(0);
  assert.equal(h.appended.at(-1).data.task, "t1");
  assert.deepEqual(notified, []);
});

test("Esc cancels the running head and drops the queue with one notice; the head's result still lands", async () => {
  const { calls, exec } = gated();
  const h = harness({ exec });
  h.runner.submit("!npm install");
  h.runner.submit("!npm test");
  h.runner.submit("!!ls");
  h.runner.abort();
  await h.runner.pending;
  assert.equal(calls.length, 1, "nothing queued ever runs");
  assert.equal(h.notices.length, 1);
  assert.deepEqual(h.notices[0], { text: "Dropped 2 queued shell commands: !npm test, !!ls", level: "info" });
  assert.deepEqual(h.appended.map(entry => [entry.data.command, entry.data.cancelled]), [["npm install", true]]);
  assert.deepEqual(h.sent[0].options, { triggerTurn: false });
});

test("while the agent is busy a result lands at its steer's message_start, not at completion", async () => {
  const h = harness({ idle: () => false });
  h.fire("agent_start");
  h.runner.submit("!pwd");
  await h.runner.pending;
  assert.equal(h.appended.length, 0);
  assert.equal(h.runner.runs().length, 1, "done but unwritten, it stays in the pending area");
  const changes = h.changes();
  h.fire("message_start", { message: { role: "custom", customType: "workflow-shell", details: { ...h.sent[0].message.details } } });
  assert.equal(h.appended.length, 0, "another message with equal details is not this one");
  h.fire("message_start", { message: h.sent[0].message });
  assert.equal(h.appended.length, 1);
  assert.equal(h.appended[0].data, h.sent[0].message.details);
  assert.deepEqual(h.runner.runs(), []);
  assert.ok(h.changes() > changes, "landing redraws the pending area");
  h.fire("agent_settled");
  assert.equal(h.appended.length, 1, "landed once");
});

test("while busy, !! and a cancelled run land at agent_settled", async () => {
  const { exec } = gated();
  for (const [input, cancel] of [["!!pwd", false], ["!pwd", true]]) {
    const h = harness({ idle: () => false, exec: cancel ? exec : undefined });
    h.fire("agent_start");
    h.runner.submit(input);
    if (cancel) h.runner.abort();
    await h.runner.pending;
    for (const sent of h.sent) h.fire("message_start", { message: sent.message });
    assert.equal(h.appended.length, 0, input);
    h.fire("agent_settled");
    assert.equal(h.appended.length, 1, input);
  }
});

test("while busy, a ! landing at its steer's message_start writes an earlier !! first", async () => {
  const { calls, exec } = gated();
  const h = harness({ idle: () => false, exec });
  h.fire("agent_start");
  h.runner.submit("!!a");
  h.runner.submit("!b");
  calls[0].resolve();
  await sleep(0);
  calls[1].resolve();
  await h.runner.pending;
  assert.equal(h.appended.length, 0);
  h.fire("message_start", { message: h.sent[0].message });
  assert.deepEqual(h.appended.map(entry => entry.data.command), ["a", "b"]);
});

test("while busy, a backgrounded ! lands at its task notice's message_start, a backgrounded !! at agent_settled", async () => {
  const { calls, exec } = gated();
  const notified = [];
  let runner;
  const tasks = createTasks({ notify: (text, options) => notified.push(options.details), record: entry => runner.taskEnded(entry) });
  const h = harness({ idle: () => false, exec, tasks });
  runner = h.runner;
  h.fire("agent_start");
  h.runner.submit("!npm run dev");
  h.runner.background();
  h.runner.submit("!!sleep 9");
  h.runner.background();
  assert.equal(h.appended.length, 2, "the launches land at once");
  calls[0].resolve();
  calls[1].resolve();
  await sleep(0);
  await sleep(0);
  assert.equal(notified.length, 1);
  assert.equal(h.appended.length, 2);
  h.fire("message_start", { message: { role: "custom", details: { ...notified[0] } } });
  assert.equal(h.appended.length, 2, "another message with equal details is not this one");
  h.fire("message_start", { message: { role: "custom", details: notified[0] } });
  assert.deepEqual(h.appended.slice(2).map(entry => entry.data.task), ["t1"]);
  h.fire("agent_settled");
  assert.deepEqual(h.appended.slice(2).map(entry => entry.data.task), ["t1", "t2"]);
});

test("while busy, a ! whose steer never starts a message lands at agent_settled", async () => {
  const h = harness({ idle: () => false });
  h.fire("agent_start");
  h.runner.submit("!pwd");
  await h.runner.pending;
  assert.equal(h.appended.length, 0);
  h.fire("agent_settled");
  assert.equal(h.appended.length, 1);
  assert.equal(h.appended[0].data, h.sent[0].message.details);
  assert.deepEqual(h.runner.runs(), []);
});

test("with no run active a !! lands at once, though isIdle() reads false through a compaction", async () => {
  const h = harness({ idle: () => false });
  h.fire("agent_start");
  h.fire("agent_settled");
  h.runner.submit("!!pwd");
  await h.runner.pending;
  assert.equal(h.appended.length, 1);
  assert.deepEqual(h.runner.runs(), []);
});

test("pending blocks read queued, running and the done result", async () => {
  const { calls, exec } = gated();
  const h = harness({ exec, idle: () => false });
  h.fire("agent_start");
  h.runner.submit("!first");
  h.runner.submit("!second");
  const notes = () => h.runner.runs().map(run => strip(pendingShellLines(run, theme, 60).at(-1)));
  assert.deepEqual(notes(), ["  ↳ running · ctrl+b to background", "  ↳ queued"]);
  calls[0].onData(Buffer.from("out\n"));
  calls[0].resolve();
  await sleep(0);
  assert.deepEqual(notes(), ["  out", "  ↳ running · ctrl+b to background"]);
  assert.match(strip(pendingShellLines(h.runner.runs()[0], theme, 60)[4]), /^• Output · 1 line · exit 0/);
  calls[1].resolve();
  await h.runner.pending;
});

test("abort cancels the signal and the recorded run is marked cancelled with no exit code", async () => {
  const exec = (_command, _cwd, { signal, onData }) => new Promise((resolve, reject) => {
    onData(Buffer.from("partial\n"));
    signal.addEventListener("abort", () => reject(new Error("aborted")));
  });
  const h = harness({ exec });
  h.runner.submit("!sleep 5");
  assert.equal(h.runner.running(), true);
  h.runner.abort();
  await h.runner.pending;
  assert.equal(h.runner.running(), false);
  const details = h.sent[0].message.details;
  assert.equal(details.cancelled, true);
  assert.equal(details.exitCode, undefined);
  assert.equal(details.output, "partial");
});

test("abort with nothing running is a no-op", () => {
  const h = harness();
  assert.doesNotThrow(() => h.runner.abort());
});

test("an exec rejection (not our own abort) notifies and records nothing", async () => {
  const h = harness({ exec: async () => { throw new Error("spawn failed"); } });
  h.runner.submit("!ls");
  await h.runner.pending;
  assert.equal(h.sent.length, 0);
  assert.equal(h.appended.length, 0);
  assert.match(h.notices.at(-1).text, /Shell command failed: spawn failed/);
  assert.equal(h.notices.at(-1).level, "error");
});

test("output arrives with \\r\\n and ANSI colour codes and is recorded clean", async () => {
  const exec = async (_command, _cwd, { onData }) => {
    onData(Buffer.from("\x1b[32mgreen\x1b[0m\r\nsecond\r"));
    return { exitCode: 0 };
  };
  const h = harness({ exec });
  h.runner.submit("!ls");
  await h.runner.pending;
  assert.equal(h.sent[0].message.details.output, "green\nsecond");
});

test("control bytes the ANSI stripper does not know (bare ESC, BEL, backspace) are dropped, their neighbours and tabs kept", async () => {
  const exec = async (_command, _cwd, { onData }) => { onData(Buffer.from("a\x1bcb\x07c\x08d\te\n")); return { exitCode: 0 }; };
  const h = harness({ exec });
  h.runner.submit("!printf");
  await h.runner.pending;
  assert.equal(h.sent[0].message.details.output, "acbcd\te");
});

test("output beyond the default cap is truncated and flagged, and the context names the full output file", async t => {
  const output = Array.from({ length: 2500 }, (_, i) => `line ${i}`).join("\n");
  const exec = async (_command, _cwd, { onData }) => { onData(Buffer.from(output)); return { exitCode: 0 }; };
  const h = harness({ exec });
  h.runner.submit("!ls");
  await h.runner.pending;
  const details = h.sent[0].message.details;
  // Only the file: the process's one log directory serves later tests too.
  t.after(() => rmSync(details.fullOutputPath, { force: true }));
  assert.equal(details.truncated, true);
  assert.ok(details.output.split("\n").length <= 2000);
  assert.ok(h.sent[0].message.content.endsWith(`[Output truncated]\nFull output: ${details.fullOutputPath}`));
  assert.equal(readFileSync(details.fullOutputPath, "utf8"), output);
});

for (const marker of ["!", "!!"]) test(`${marker} flags an evicted prefix even when the retained tail cleans to empty`, async t => {
  const output = "meaningful output\n" + "\n".repeat(256 * 1024 + 1);
  const h = harness({ exec: async (_command, _cwd, { onData }) => { onData(Buffer.from(output)); return { exitCode: 0 }; } });
  h.runner.submit(`${marker}fixture`);
  await h.runner.pending;
  const details = h.appended[0].data;
  if (details.fullOutputPath) t.after(() => rmSync(details.fullOutputPath, { force: true }));
  assert.equal(details.output, "");
  assert.equal(details.truncated, true);
  assert.match(shellLines(details, {}, theme, 80).map(strip).join("\n"), /output truncated/);
  if (marker === "!!") {
    assert.equal(details.fullOutputPath, undefined);
    assert.deepEqual(h.sent, []);
  } else {
    assert.equal(readFileSync(details.fullOutputPath, "utf8"), output);
    assert.match(h.sent[0].message.content, /\[Output truncated\]/);
    assert.ok(h.sent[0].message.content.endsWith(`Full output: ${details.fullOutputPath}`));
  }
});

test("output past the inline byte cap marks the run truncated", async t => {
  const chunk = "x".repeat(1024);
  const chunkCount = 300;
  const exec = async (_command, _cwd, { onData }) => {
    for (let i = 0; i < chunkCount; i++) onData(Buffer.from(chunk));
    return { exitCode: 0 };
  };
  const h = harness({ exec });
  h.runner.submit("!ls");
  await h.runner.pending;
  const details = h.sent[0].message.details;
  t.after(() => rmSync(details.fullOutputPath, { force: true }));
  assert.equal(details.truncated, true);
});

test("a multi-byte UTF-8 character split across two chunks decodes intact", async () => {
  const encoded = Buffer.from("café\n", "utf8"); // é is two bytes in UTF-8
  const splitAt = encoded.length - 1; // splits the é's two bytes apart
  const exec = async (_command, _cwd, { onData }) => {
    onData(encoded.subarray(0, splitAt));
    onData(encoded.subarray(splitAt));
    return { exitCode: 0 };
  };
  const h = harness({ exec });
  h.runner.submit("!ls");
  await h.runner.pending;
  assert.equal(h.sent[0].message.details.output, "café");
});

test("a rejection from a replaced session (sendMessage throwing) does not escape as an unhandled rejection", async () => {
  const h = harness();
  h.pi.sendMessage = () => { throw new Error("session no longer active"); };
  h.runner.submit("!ls");
  await assert.doesNotReject(() => h.runner.pending);
});

test("stop() at shutdown aborts the head, and a run finishing while shutdown awaits starts nothing and lands nothing", async () => {
  const calls = [];
  const exec = (command, _cwd, { signal }) => new Promise(resolve => {
    calls.push({ command, signal, resolve: () => resolve({ exitCode: 0 }) });
  });
  const h = harness({ exec });
  h.runner.submit("!sleep 5");
  h.runner.submit("!echo next");
  const changes = h.changes();
  h.runner.stop();
  assert.ok(h.changes() > changes, "the pending area redraws without the discarded runs");
  assert.equal(calls[0].signal.aborted, true);
  // The shell ignored the kill long enough to finish normally.
  calls[0].resolve();
  await h.runner.pending;
  await sleep(0);
  h.fire("agent_settled");
  assert.deepEqual(calls.map(call => call.command), ["sleep 5"], "the queued run never starts");
  assert.deepEqual(h.appended, []);
  assert.deepEqual(h.sent, []);
  assert.deepEqual(h.runner.runs(), []);
  assert.equal(h.workingCalls.at(-1), null);
});

test("a landing pushed between shutdown and the next session start is dropped", () => {
  const handlers = {};
  const appended = [];
  const pi = { on: (name, fn) => { handlers[name] = fn; }, appendEntry: (type, data) => appended.push({ type, data }) };
  const landing = deliveryLanding(pi, createFolds());
  handlers.agent_start();
  landing.land("workflow-shell", { command: "waiting" });
  landing.close();
  landing.land("workflow-shell", { command: "late" });
  landing.open();
  handlers.agent_settled();
  assert.deepEqual(appended, []);
  landing.land("workflow-shell", { command: "fresh" });
  assert.deepEqual(appended.map(entry => entry.data.command), ["fresh"]);
});

test("a !! run keeps no log file, however long its output", async () => {
  const output = "x".repeat(200 * 1024);
  const h = harness({ exec: async (_command, _cwd, { onData }) => { onData(Buffer.from(output)); return { exitCode: 0 }; } });
  h.runner.submit("!!cat big");
  await h.runner.pending;
  assert.equal(h.appended[0].data.truncated, true);
  assert.equal(h.appended[0].data.fullOutputPath, undefined);
});

test("\\r progress output that truncates once cleaned names its full output file", async t => {
  const output = Array.from({ length: 2500 }, (_, i) => `${i}%`).join("\r");
  const h = harness({ exec: async (_command, _cwd, { onData }) => { onData(Buffer.from(output)); return { exitCode: 0 }; } });
  h.runner.submit("!curl -O big");
  await h.runner.pending;
  const details = h.sent[0].message.details;
  t.after(() => rmSync(details.fullOutputPath, { force: true }));
  assert.equal(details.truncated, true);
  assert.equal(readFileSync(details.fullOutputPath, "utf8"), output);
});

test("installShell reads the context fresh on each submit, not one captured at install time", async () => {
  const pi = { on() {}, registerMessageRenderer() {}, registerEntryRenderer() {}, sendMessage() {}, appendEntry() {} };
  const cwds = [];
  const exec = (_command, cwd) => { cwds.push(cwd); return Promise.resolve({ exitCode: 0 }); };
  let context = { cwd: "/first", ui: { notify() {} }, isIdle: () => true };
  const runner = installShell(pi, () => context, { working() {}, exec, env: () => ({}) });
  runner.submit("!ls");
  await runner.pending;
  context = { cwd: "/second", ui: { notify() {} }, isIdle: () => true };
  runner.submit("!ls");
  await runner.pending;
  assert.deepEqual(cwds, ["/first", "/second"]);
});

// A slow exec that never settles keeps `running()` true for a real clock
// tick, exercising the AbortController path end to end without a real shell.
test("running() reflects an in-flight command", async () => {
  const h = harness({ exec: () => sleep(5).then(() => ({ exitCode: 0 })) });
  h.runner.submit("!sleep");
  assert.equal(h.runner.running(), true);
  await h.runner.pending;
  assert.equal(h.runner.running(), false);
});

test("abortable() is false while the agent is not idle, even though the command is running", async () => {
  let resolveExec;
  const pi = { on() {}, sendMessage() {}, appendEntry() {} };
  const runner = createShellRunner({
    pi,
    folds: createFolds(),
    land: deliveryLanding(pi).land,
    exec: (_command, _cwd, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")));
      resolveExec = () => resolve({ exitCode: 0 });
    }),
    cwd: () => "/work",
    notify: () => {},
    env: () => ({}),
    working: () => {},
    idle: () => false,
  });
  runner.submit("!sleep 5");
  assert.equal(runner.running(), true);
  assert.equal(runner.abortable(), false);
  runner.abort();
  await runner.pending;
  void resolveExec;
});
