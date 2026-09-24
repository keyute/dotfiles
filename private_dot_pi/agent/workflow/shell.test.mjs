import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { Container, visibleWidth } from "@earendil-works/pi-tui";
import { AgentSession, InteractiveMode, SessionManager, initTheme } from "@earendil-works/pi-coding-agent";
import { createFolds } from "./rows.mjs";
import { contextText, createShellRunner, installShell, parseShellInput, shellComponent, shellLines } from "./shell.mjs";

// Real ANSI codes (not the readable `<color>` tags other suites use) so
// visibleWidth/wrapTextWithAnsi/pad, which this row depends on, measure the
// rendered lines the way a real theme would.
const CODES = { error: 31, warning: 33, success: 32, muted: 90, userMessageText: 97 };
const fg = (color, text) => `\x1b[${CODES[color]}m${text}\x1b[39m`;
const BG = "\x1b[48;5;1m";
const theme = { fg, bg: (_color, text) => `${BG}${text}\x1b[49m` };
const strip = text => text.replace(/\x1b\[[0-9;]*m/g, "");

test("parseShellInput mirrors pi's own !/!! branch", () => {
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

test("contextText matches pi's bashExecutionToText's shape for every case", () => {
  assert.equal(contextText({ command: "ls", output: "a\nb", exitCode: 0, cancelled: false }), "Ran `ls`\n```\na\nb\n```");
  assert.equal(contextText({ command: "ls", output: "", exitCode: 0, cancelled: false }), "Ran `ls`\n(no output)");
  assert.equal(contextText({ command: "false", output: "", exitCode: 2, cancelled: false }), "Ran `false`\n(no output)\n\nCommand exited with code 2");
  assert.equal(contextText({ command: "sleep 5", output: "", exitCode: undefined, cancelled: true }), "Ran `sleep 5`\n(no output)\n\n(command cancelled)");
  assert.equal(contextText({ command: "x", output: "", exitCode: null, cancelled: false }), "Ran `x`\n(no output)");
  assert.equal(contextText({ command: "x", output: "a", exitCode: 0, cancelled: false, truncated: true }), "Ran `x`\n```\na\n```\n\n[Output truncated]");
  assert.equal(contextText({ command: "x", output: "", exitCode: 1, cancelled: false, truncated: true }), "Ran `x`\n(no output)\n\nCommand exited with code 1\n\n[Output truncated]");
});

test("shellLines: three shaded rows, the ! and command coloured like the composer", () => {
  const lines = shellLines({ command: "ls -la", output: "" }, {}, theme, 20);
  assert.equal(lines.length, 6);
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
  assert.equal(lines.length, 7);
  assert.match(strip(lines[1]), /^! echo one */);
  assert.match(strip(lines[2]), /^ {2}echo two */);
});

test("output lines sit two in, muted; empty output is explicit", () => {
  assert.equal(strip(shellLines({ command: "x", output: "" }, {}, theme, 30).at(-1)), "  no output");
  const lines = shellLines({ command: "x", output: "a\nb", exitCode: 0 }, {}, theme, 30);
  assert.equal(strip(lines[3]), "• Output · 2 lines · exit 0");
  assert.ok(lines[3].includes(fg("success", "•")));
  assert.equal(strip(lines[4]), "  a");
  assert.equal(strip(lines[5]), "  b");
  assert.ok(lines[4].includes(fg("muted", "a")));
});

test("long success shows last four; failure and cancellation show first two and last two", () => {
  const output = Array.from({ length: 9 }, (_, i) => `l${i}`).join("\n");
  const success = shellLines({ command: "x", output, exitCode: 0 }, {}, theme, 40);
  assert.equal(strip(success[3]), "▸ Output · 9 lines · exit 0");
  assert.ok(success[3].includes(fg("success", "▸")));
  assert.deepEqual(success.slice(4).map(strip), ["  … 5 more lines", "  l5", "  l6", "  l7", "  l8"]);
  for (const details of [{ exitCode: 2 }, { cancelled: true }]) {
    const lines = shellLines({ command: "x", output, ...details }, {}, theme, 40);
    assert.deepEqual(lines.slice(4).map(strip), ["  l0", "  l1", "  … 5 more lines", "  l7", "  l8"]);
  }
  const expanded = shellLines({ command: "x", output, exitCode: 0 }, { expanded: true }, theme, 40);
  assert.equal(strip(expanded[3]), "▾ Output · 9 lines · exit 0");
  assert.deepEqual(expanded.slice(4).map(strip), output.split("\n").map(line => `  ${line}`));
});

test("outcome summary uses semantic colours and calls out truncation", () => {
  for (const [details, color, label] of [
    [{ exitCode: 0 }, "success", "exit 0"],
    [{ exitCode: 1 }, "error", "exit 1"],
    [{ cancelled: true }, "warning", "cancelled"],
  ]) {
    const summary = shellLines({ command: "x", output: "", ...details }, {}, theme, 50)[3];
    assert.ok(summary.includes(fg(color, label)));
    assert.ok(summary.includes(fg(color, "•")));
  }
  const truncated = shellLines({ command: "x", output: "", exitCode: 0, truncated: true }, {}, theme, 50);
  assert.match(strip(truncated[3]), /output truncated/);
  assert.ok(truncated[3].includes(fg("warning", "output truncated")));
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
  assert.equal(strip(child.render(50)[3]).startsWith("▸"), true);
  assert.equal(child.handleMouse({ type: "click", button: "left", y: 3 }).handled, true);
  assert.equal(repaints, 1);
  child = renderers.entry(entry, { expanded: false }, theme);
  assert.equal(strip(child.render(50)[3]).startsWith("▾"), true);
  assert.equal(child.handleMouse({ type: "click", button: "left", y: 4 }), undefined);
  child = renderers.entry(entry, { expanded: true }, theme);
  assert.equal(child.render(50).length, 10);
  assert.equal(child.handleMouse({ type: "click", button: "left", y: 3 }), undefined);
  child = renderers.entry(entry, { expanded: false }, theme);
  assert.equal(strip(child.render(50)[3]).startsWith("▸"), true);
  const message = { details };
  let history = renderers.message(message, { expanded: false }, theme);
  history.render(50);
  assert.equal(history.handleMouse({ type: "click", button: "left", y: 3 }).handled, true);
  history = renderers.message(message, { expanded: false }, theme);
  assert.equal(strip(history.render(50)[3]).startsWith("▾"), true);
  history = renderers.message(message, { expanded: true }, theme);
  assert.equal(history.render(50).length, 10);
  history = renderers.message(message, { expanded: false }, theme);
  assert.equal(strip(history.render(50)[3]).startsWith("▸"), true);
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
  assert.equal(render(50)[4].startsWith("▸"), true);
  assert.equal(host.handleMouse({ type: "click", button: "left", x: 0, y: 4, width: 50, height: host.render(50).length }).handled, true);
  assert.equal(repaints, 1);
  assert.equal(render(50)[4].startsWith("▾"), true);
  const dark = host.render(50).join("\n");
  initTheme("light");
  host.invalidate();
  assert.notEqual(host.render(50).join("\n"), dark, "host rebuild reads the live theme");
  assert.equal(render(15)[4].startsWith("▾"), true);
  assert.ok(host.render(15).every(line => visibleWidth(line) <= 15));
  host.setExpanded(true);
  assert.equal(host.children.length, 2);
  assert.equal(host.handleMouse({ type: "click", button: "left", x: 0, y: 4, width: 15, height: host.render(15).length }), undefined);
  host.setExpanded(false);
  assert.equal(render(15)[4].startsWith("▸"), true);
  assert.equal(host.handleMouse({ type: "click", button: "left", x: 0, y: 4, width: 15, height: host.render(15).length }).handled, true);
  assert.equal(render(15)[4].startsWith("▾"), true);
  initTheme("dark");
});

test("native in-memory safe boundary retains one visible entry and delays ! context until after the tool result; !! stays out", async () => {
  const manager = SessionManager.inMemory("/work");
  const events = [];
  const session = Object.create(AgentSession.prototype);
  session.sessionManager = manager;
  session.agent = { state: { messages: [] } };
  session._entryIdsByMessage = new WeakMap();
  session._isAgentRunActive = true;
  session._pendingCustomMessages = [];
  session._emit = event => events.push(event);
  session._runAgentPrompt = () => { throw new Error("shell input must not start a model turn"); };
  session._refreshFinalizedContext = () => { session.agent.state.messages = manager.buildSessionContext().messages; };
  const pi = {
    appendEntry: (type, data) => manager.appendCustomEntry(type, data),
    sendMessage: (message, options) => session.sendCustomMessage(message, options),
  };
  const runner = createShellRunner({ pi, folds: createFolds(), working() {}, cwd: () => "/work", notify() {}, env: () => ({}), exec: async () => ({ exitCode: 0 }) });
  manager.appendMessage({ role: "assistant", content: [{ type: "toolCall", id: "t1", name: "bash", arguments: {} }], timestamp: Date.now() });
  runner.submit("!pwd");
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
  runner.submit("!!pwd");
  await runner.pending;
  assert.equal(manager.getEntries().filter(entry => entry.type === "custom").length, 2);
  assert.equal(manager.getEntries().filter(entry => entry.type === "custom_message").length, 1);
  assert.equal(manager.buildSessionContext().messages.filter(message => message.role === "custom").length, 1);
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
  assert.equal(strip(lines[4]), "  l0");
  assert.ok(!lines.some(line => /more lines/.test(strip(line))));
});

// The runner: dependencies are injected, so no real shell ever spawns.
function harness({ exec = async () => ({ exitCode: 0 }), folds = createFolds(), prefix } = {}) {
  const sent = [];
  const appended = [];
  const notices = [];
  const workingCalls = [];
  const pi = { sendMessage: (message, options) => sent.push({ message, options }), appendEntry: (type, data) => appended.push({ type, data }) };
  const runner = createShellRunner({
    pi, folds, exec, prefix,
    cwd: () => "/work",
    notify: (text, level) => notices.push({ text, level }),
    env: () => ({ PATH: "/bin" }),
    working: state => workingCalls.push(state),
    now: () => 1000,
  });
  return { runner, sent, appended, notices, workingCalls, folds, pi };
}

test("a shellCommandPrefix is joined with the command for exec, pi's own composition, but details.command stays the typed command", async () => {
  const execCalls = [];
  const exec = async (command, _cwd, { onData }) => { execCalls.push(command); onData(Buffer.from("hi\n")); return { exitCode: 0 }; };
  const h = harness({ exec, prefix: () => "source ~/.zshrc" });
  h.runner.submit("!echo hi");
  await h.runner.pending;
  assert.deepEqual(execCalls, ["source ~/.zshrc\necho hi"]);
  assert.equal(h.sent[0].message.details.command, "echo hi");
});

test("!! joins the prefix too, and its recorded command also stays typed", async () => {
  const execCalls = [];
  const exec = async (command) => { execCalls.push(command); return { exitCode: 0 }; };
  const h = harness({ exec, prefix: () => "export CI=1" });
  h.runner.submit("!!pwd");
  await h.runner.pending;
  assert.deepEqual(execCalls, ["export CI=1\npwd"]);
  assert.equal(h.appended[0].data.command, "pwd");
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
  assert.equal(h.sent[0].options.triggerTurn, false);
  assert.deepEqual(h.sent[0].message.details, h.appended[0].data);
  assert.equal(h.sent[0].message.content, contextText(h.appended[0].data));
});

test("! sends a hidden custom message with the mirrored context text and no turn trigger", async () => {
  const h = harness({ exec: async (_command, _cwd, { onData }) => { onData(Buffer.from("hi\n")); return { exitCode: 0 }; } });
  assert.equal(h.runner.submit("!echo hi"), true);
  await h.runner.pending;
  assert.equal(h.sent.length, 1);
  const { message, options } = h.sent[0];
  assert.equal(message.customType, "workflow-shell");
  assert.equal(message.display, false);
  assert.equal(options.triggerTurn, false);
  assert.equal(message.content, contextText(message.details));
  assert.equal(message.details.output, "hi");
  assert.equal(h.appended.length, 1);
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

test("a second submit while one is running warns and keeps the composer text; no second exec", async () => {
  let calls = 0;
  let resolveExec;
  const exec = () => { calls++; return new Promise(resolve => { resolveExec = () => resolve({ exitCode: 0 }); }); };
  const h = harness({ exec });
  h.runner.submit("!sleep 1");
  const result = h.runner.submit("!ls");
  assert.equal(result, "busy");
  assert.equal(calls, 1);
  assert.equal(h.notices.at(-1).level, "warning");
  resolveExec();
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

test("output beyond the default cap is truncated and flagged", async () => {
  const output = Array.from({ length: 2500 }, (_, i) => `line ${i}`).join("\n");
  const exec = async (_command, _cwd, { onData }) => { onData(Buffer.from(output)); return { exitCode: 0 }; };
  const h = harness({ exec });
  h.runner.submit("!ls");
  await h.runner.pending;
  const details = h.sent[0].message.details;
  assert.equal(details.truncated, true);
  assert.ok(details.output.split("\n").length <= 2000);
});

test("a live buffer bound keeps memory bounded while a command runs and marks the run truncated", async () => {
  const chunk = "x".repeat(1024);
  // Comfortably more than DEFAULT_MAX_BYTES * 2 worth of chunks.
  const chunkCount = 200;
  const exec = async (_command, _cwd, { onData }) => {
    for (let i = 0; i < chunkCount; i++) onData(Buffer.from(chunk));
    return { exitCode: 0 };
  };
  const h = harness({ exec });
  h.runner.submit("!ls");
  await h.runner.pending;
  const details = h.sent[0].message.details;
  assert.equal(details.truncated, true);
  assert.ok(details.output.length < chunk.length * chunkCount, "the rolling buffer dropped from the front while the command ran");
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

test("installShell aborts a running command on session_shutdown", async () => {
  const handlers = {};
  const pi = {
    on: (name, fn) => { handlers[name] = fn; },
    registerMessageRenderer() {},
    registerEntryRenderer() {},
    sendMessage() {},
    appendEntry() {},
  };
  let resolveExec;
  let sawAbort = false;
  const exec = (_command, _cwd, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => { sawAbort = true; reject(new Error("aborted")); });
    resolveExec = () => resolve({ exitCode: 0 });
  });
  const ctx = { cwd: "/work", ui: { notify() {} }, isIdle: () => true };
  const runner = installShell(pi, () => ctx, { working() {}, exec, env: () => ({}) });
  runner.submit("!sleep 5");
  assert.ok(handlers.session_shutdown, "installShell registers a session_shutdown handler");
  handlers.session_shutdown();
  assert.equal(sawAbort, true);
  await runner.pending;
  void resolveExec;
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
  const runner = createShellRunner({
    pi: { sendMessage() {}, appendEntry() {} },
    folds: createFolds(),
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
