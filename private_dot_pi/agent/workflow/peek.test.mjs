import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PeekDialog, openPeek } from "./peek.mjs";
import { PROMPT } from "./rows.mjs";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { Theme } from "@earendil-works/pi-coding-agent";

const theme = { fg: (c, t) => `\x1b[36m${t}\x1b[0m`, bg: (c, t) => `[${c}]${t}`, bold: t => t };
const KEYS = {
  "tui.select.up": "\x1b[A",
  "tui.select.down": "\x1b[B",
  "tui.select.confirm": "\r",
  "tui.input.submit": "\r",
  "tui.select.cancel": "\x1b",
  "app.tools.expand": "\x0f",
  "tui.input.tab": "\t",
  "tui.input.newLine": "\x1b\r",
};
const keybindings = { matches: (data, action) => KEYS[action] === data };

function line(record) { return `${JSON.stringify(record)}\n`; }

function makeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "peek-"));
}

function makeDialog({ dir, describeState, rpcCall, tui, palette = theme } = {}) {
  let renders = 0;
  const doneCalls = [];
  const stubTui = tui ?? { requestRender: () => renders++, terminal: { rows: 40 } };
  const base = { agent: "reviewer", task: "Review the diff", model: "anthropic/claude:high", effort: "high", tokens: { total: 12400 }, startedAt: Date.now() - 134_000, state: "running", terminal: false };
  const info = describeState ?? base;
  const dialog = new PeekDialog(stubTui, palette, keybindings, value => doneCalls.push(value), {
    id: "run1",
    asyncDir: dir,
    describe: () => (describeState ? { ...base, ...info } : info),
    events: {},
    rpcCall: rpcCall ?? (async () => null),
    timeoutMs: 2_000,
    steerTimeoutMs: 5_000,
    tickMs: 1e9,
  });
  return { dialog, info, doneCalls, renderCount: () => renders };
}

function type(dialog, text) {
  for (const ch of text) dialog.handleInput(ch);
}

test("open shows the live header and replayed rows", async () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, "events.jsonl"),
    line({ type: "tool_execution_start", toolCallId: "c1", toolName: "workspace_bash", args: { command: "npm test" } }) +
    line({ type: "tool_execution_end", toolCallId: "c1", toolName: "workspace_bash", isError: false, result: { content: [{ type: "text", text: "ok" }] } }) +
    line({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Done." }] } }));
  const { dialog } = makeDialog({ dir });
  await dialog.ready;
  const lines = dialog.render(160);
  const header = lines[1];
  assert.match(header, /reviewer/);
  assert.match(header, /Review the diff/);
  assert.match(header, /claude high/);
  assert.match(header, /12\.4k tokens/);
  // Rule 3: the current tool and the elapsed time are the pending row's and
  // the working row's, never the header's.
  assert.doesNotMatch(header, /bash/);
  assert.doesNotMatch(header.replace(/\x1b\[[0-9;]*m/g, ""), /\d+[ms]\b/);
  const body = lines.join("\n");
  assert.match(body, /↳/);
  assert.match(body, /Done\./);
});

test("working progress has a blank separator above it and a trailing gap before the composer", async () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, "events.jsonl"),
    Array.from({ length: 30 }, (_, i) => line({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: `note ${i}` }] } })).join("") +
    line({ type: "agent_start", observedAt: Date.now() }));
  const { dialog } = makeDialog({ dir, tui: { requestRender: () => {}, terminal: { rows: 24 } } });
  await dialog.ready;
  const lines = dialog.render(80);
  const progress = lines.findIndex(l => /… \d+[ms]/.test(l));
  assert.ok(progress > 0);
  assert.equal(lines[progress - 1].trim(), "");
  assert.equal(lines[progress + 1].trim(), "");
  dialog.dispose();
});

test("long task yields to model, tokens and terminal state in a narrow header", async () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, "events.jsonl"), "");
  const { dialog } = makeDialog({ dir, describeState: { task: "A long and complicated task with many unnecessary words and details", state: "completed", terminal: true } });
  await dialog.ready;
  const header = dialog.render(74)[1];
  assert.match(header, /peek/);
  assert.match(header, /reviewer/);
  assert.match(header, /…/);
  assert.match(header, /claude high/);
  assert.match(header, /12\.4k tokens/);
  assert.match(header, /completed/);
  assert.match(header, /esc back/);
  assert.ok(visibleWidth(header) <= 74);
  const compact = dialog.render(40)[1];
  assert.match(compact, /completed/);
  assert.match(compact, /esc back/);
  assert.ok(visibleWidth(compact) <= 40);
  dialog.dispose();
});

test("tick appends new lines and re-renders once; a no-op tick renders nothing", async () => {
  const dir = makeDir();
  const file = path.join(dir, "events.jsonl");
  fs.writeFileSync(file, "");
  const { dialog, renderCount } = makeDialog({ dir });
  await dialog.ready;
  const before = renderCount();
  fs.appendFileSync(file,
    line({ type: "tool_execution_start", toolCallId: "c1", toolName: "workspace_ls", args: { path: "." } }) +
    line({ type: "tool_execution_end", toolCallId: "c1", toolName: "workspace_ls", isError: false, result: { content: [{ type: "text", text: "a\nb" }] } }));
  await dialog.tick();
  assert.equal(renderCount(), before + 1);
  assert.ok(dialog.render(160).some(l => /List/.test(l)));
  const afterFirstTick = renderCount();
  await dialog.tick();
  assert.equal(renderCount(), afterFirstTick);
});

test("a replaced (shrunk) file rebuilds the replay from its new contents", async () => {
  const dir = makeDir();
  const file = path.join(dir, "events.jsonl");
  fs.writeFileSync(file, line({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Old note that is longer" }] } }));
  const { dialog } = makeDialog({ dir });
  await dialog.ready;
  assert.ok(dialog.replay.rows.some(r => r.text?.includes("Old note")));
  fs.writeFileSync(file, line({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "New note" }] } }));
  await dialog.tick();
  assert.ok(dialog.replay.rows.some(r => r.text?.includes("New note")));
  assert.ok(!dialog.replay.rows.some(r => r.text?.includes("Old note")));
  assert.equal(dialog.offset, fs.statSync(file).size);
});

test("a journal over one read chunk reads in full across the boundary: every record renders once", async () => {
  const dir = makeDir();
  const file = path.join(dir, "events.jsonl");
  const junk = "x".repeat(2000);
  const stream = fs.createWriteStream(file);
  stream.write(line({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "The very first note" }] } }));
  for (let i = 0; i < 600; i++) stream.write(line({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: `${junk} ${i}` }] } }));
  await new Promise((resolve, reject) => stream.end(err => (err ? reject(err) : resolve())));
  assert.ok(fs.statSync(file).size > 1024 * 1024);
  const { dialog } = makeDialog({ dir });
  await dialog.ready;
  const notes = dialog.replay.rows.filter(r => r.kind === "assistant");
  assert.equal(notes.length, 601);
  assert.ok(notes[0].text.includes("The very first note"));
  assert.equal(new Set(notes.map(r => r.text)).size, 601);
  assert.ok(!dialog.replay.rows.some(r => r.text === "earlier activity not shown"));
  assert.equal(dialog.offset, fs.statSync(file).size);
});

test("a journal with more rows than the cap renders the earlier-activity note", async () => {
  const dir = makeDir();
  const file = path.join(dir, "events.jsonl");
  const stream = fs.createWriteStream(file);
  for (let i = 0; i < 1100; i++) stream.write(line({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: `note ${i}` }] } }));
  await new Promise((resolve, reject) => stream.end(err => (err ? reject(err) : resolve())));
  const { dialog } = makeDialog({ dir });
  await dialog.ready;
  assert.equal(dialog.replay.rows[0].kind, "note");
  assert.equal(dialog.replay.rows[0].text, "earlier activity not shown");
  assert.ok(dialog.replay.rows.some(r => r.kind === "assistant" && r.text === "note 1099"));
});

test("up scrolls on an empty draft; typed lines move the editor first, then scroll; PgDn always scrolls", async () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, "events.jsonl"), "");
  const { dialog } = makeDialog({ dir, tui: { requestRender: () => {}, terminal: { rows: 10 } } });
  await dialog.ready;
  dialog.render(160);
  dialog.scroll = 2;
  dialog.follow = false;
  dialog.maxScroll = 5;
  dialog.handleInput(KEYS["tui.select.up"]);
  assert.equal(dialog.scroll, 1);

  type(dialog, "a");
  dialog.handleInput(KEYS["tui.input.newLine"]);
  type(dialog, "b");
  assert.equal(dialog.editor.getLines().length, 2);
  assert.equal(dialog.editor.getCursor().line, 1);
  const scrollBefore = dialog.scroll;
  dialog.handleInput(KEYS["tui.select.up"]);
  assert.equal(dialog.editor.getCursor().line, 0);
  assert.equal(dialog.scroll, scrollBefore);
  dialog.handleInput(KEYS["tui.select.up"]);
  assert.equal(dialog.scroll, scrollBefore - 1);

  const before = dialog.scroll;
  dialog.maxScroll = 10;
  dialog.windowHeight = 3;
  dialog.handleInput("\x1b[6~");
  assert.equal(dialog.scroll, Math.min(10, before + 3));
});

test("Enter sends a steer, clears the draft, and shows the delivered note; a failed steer keeps the draft", async () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, "events.jsonl"), "");
  const calls = [];
  const rpcCall = async (events, method, params, timeout) => {
    calls.push([method, params, timeout]);
    return { text: "Steering delivered", details: { mode: "management", results: [], steering: { requestId: "r1", deliveryStatus: "delivered" } } };
  };
  const { dialog } = makeDialog({ dir, rpcCall });
  await dialog.ready;
  type(dialog, "focus on tests");
  await dialog.handleInput(KEYS["tui.select.confirm"]);
  await dialog.pending;
  assert.deepEqual(calls[0][0], "steer");
  assert.deepEqual(calls[0][1], { id: "run1", message: "focus on tests", mode: "steer" });
  assert.equal(calls[0][2], 5_000);
  assert.equal(dialog.editor.getText(), "");
  assert.ok(dialog.render(160).some(l => l.includes("steer delivered")));

  const failing = makeDialog({ dir, rpcCall: async () => null });
  await failing.dialog.ready;
  type(failing.dialog, "focus on tests");
  failing.dialog.handleInput(KEYS["tui.select.confirm"]);
  await failing.dialog.pending;
  assert.equal(failing.dialog.editor.getText(), "focus on tests");
  assert.ok(failing.dialog.render(160).some(l => l.includes("steer failed")));
});

test("native stop menu is first-line only, unshaded, and takes arrows and Esc before scrolling or closing", async () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, "events.jsonl"), "");
  const { dialog, doneCalls } = makeDialog({ dir });
  await dialog.ready;
  type(dialog, "/st");
  await dialog.editor.autocompleteRequestTask;
  assert.equal(dialog.editor.isShowingAutocomplete(), true);
  const lines = dialog.render(80);
  const menu = lines.findIndex(l => l.includes("/stop") && !l.includes(PROMPT));
  assert.ok(menu > 0);
  assert.ok(!lines[menu].startsWith("[userMessageBg]"));
  const before = dialog.scroll;
  dialog.handleInput(KEYS["tui.select.down"]);
  assert.equal(dialog.scroll, before);
  dialog.handleInput(KEYS["tui.select.cancel"]);
  assert.equal(dialog.editor.isShowingAutocomplete(), false);
  assert.deepEqual(doneCalls, []);
  dialog.handleInput(KEYS["tui.input.tab"]);
  await dialog.editor.autocompleteRequestTask;
  assert.equal(dialog.editor.isShowingAutocomplete(), true);
  dialog.handleInput(KEYS["tui.input.tab"]);
  assert.equal(dialog.editor.getText(), "/stop");
  assert.deepEqual(doneCalls, []);
  dialog.editor.setText("/st\n/sto");
  dialog.handleInput(KEYS["tui.input.tab"]);
  await dialog.editor.autocompleteRequestTask;
  assert.equal(dialog.editor.isShowingAutocomplete(), false);
  dialog.editor.setText("/st");
  dialog.handleInput(KEYS["tui.input.tab"]);
  await dialog.editor.autocompleteRequestTask;
  dialog.handleInput(KEYS["tui.select.confirm"]);
  assert.equal(dialog.mode, "confirm");
  assert.equal(dialog.editor.getText(), "/stop");
  assert.deepEqual(doneCalls, []);
  dialog.dispose();
});

test("accepting stop with the cursor inside its token replaces the whole command before confirmation", async t => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, "events.jsonl"), "");
  const calls = [];
  const { dialog } = makeDialog({ dir, rpcCall: async (...args) => { calls.push(args); return null; } });
  t.after(() => dialog.dispose());
  await dialog.ready;
  dialog.editor.setText("/stp");
  dialog.handleInput("\x1b[D");
  assert.equal(dialog.editor.getCursor().col, 3);
  dialog.handleInput(KEYS["tui.input.tab"]);
  await dialog.editor.autocompleteRequestTask;
  assert.equal(dialog.editor.isShowingAutocomplete(), true);
  dialog.handleInput(KEYS["tui.select.confirm"]);
  assert.equal(dialog.editor.getText(), "/stop");
  assert.equal(dialog.editor.getCursor().col, 5);
  assert.equal(dialog.mode, "confirm");
  assert.equal(calls.length, 0);
});

test("stop completion retains text after the command and later lines", async t => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, "events.jsonl"), "");
  const { dialog } = makeDialog({ dir });
  t.after(() => dialog.dispose());
  await dialog.ready;
  const result = dialog.editor.autocompleteProvider.applyCompletion(["/stp  follow-up", "other line"], 0, 3);
  assert.deepEqual(result, { lines: ["/stop  follow-up", "other line"], cursorLine: 0, cursorCol: 5 });
});

test("slash discovery describes only the local stop command and cannot stop before confirmation", async t => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, "events.jsonl"), "");
  const calls = [];
  const { dialog } = makeDialog({ dir, rpcCall: async (...args) => { calls.push(args); return null; } });
  t.after(() => dialog.dispose());
  await dialog.ready;
  type(dialog, "/");
  await dialog.editor.autocompleteRequestTask;
  assert.equal(dialog.editor.isShowingAutocomplete(), true);
  assert.match(dialog.render(100).join("\n"), /after confirmation/i);
  dialog.handleInput(KEYS["tui.select.confirm"]);
  assert.equal(dialog.mode, "confirm");
  assert.equal(calls.length, 0);
  dialog.handleInput(KEYS["tui.select.cancel"]);
  for (const text of ["/model", "ordinary text", "@path", "/stop "]) {
    dialog.editor.setText(text);
    dialog.handleInput(KEYS["tui.input.tab"]);
    await dialog.editor.autocompleteRequestTask;
    assert.equal(dialog.editor.isShowingAutocomplete(), false, text);
  }
  dialog.dispose();
});

test("real ANSI themes retain the cursor and both shaded rows when a long draft is clipped", async t => {
  const palette = new Theme(Object.fromEntries(["accent", "muted", "dim", "warning", "borderMuted", "borderAccent", "text", "thinkingXhigh"].map(key => [key, "#abcdef"])), { userMessageBg: "#123456", selectedBg: "#123456" }, "truecolor");
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, "events.jsonl"), "");
  const { dialog } = makeDialog({ dir, palette, tui: { requestRender() {}, terminal: { rows: 24 } } });
  t.after(() => dialog.dispose());
  await dialog.ready;
  const draft = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
  dialog.editor.setText(draft);
  for (const atStart of [false, true]) {
    if (atStart) {
      for (let i = 0; i < 35; i++) dialog.editor.handleInput(KEYS["tui.select.up"]);
      assert.equal(dialog.editor.getCursor().line, 0);
    }
    const lines = dialog.render(40);
    assert.equal(lines.length, 12);
    assert.equal(lines.filter(line => line.includes(CURSOR_MARKER)).length, 1);
    const shaded = lines.filter(line => line.includes("\x1b[48;2;18;52;86m"));
    assert.ok(shaded.length >= 3);
    const plain = text => text.replace(/\x1b\[[0-9;]*m/g, "").trim();
    assert.equal(plain(shaded[0]), "");
    assert.equal(plain(shaded.at(-1)), "");
    assert.ok(shaded.some(line => line.includes(PROMPT)));
  }
  dialog.dispose();
});

test("steer feedback does not replace live progress", async t => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, "events.jsonl"), line({ type: "agent_start", observedAt: Date.now() }));
  const { dialog } = makeDialog({ dir });
  t.after(() => dialog.dispose());
  await dialog.ready;
  dialog.say("steer delivered", "success");
  const lines = dialog.render(100);
  assert.match(lines.join("\n"), /… \d+[ms]/);
  assert.match(lines.join("\n"), /steer delivered/);
  dialog.dispose();
});

test("/stop then confirm stops the run; Esc backs out keeping the draft", async () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, "events.jsonl"), "");
  const calls = [];
  const rpcCall = async (events, method, params) => { calls.push([method, params]); return { runId: "run1", state: "stopping" }; };
  const { dialog, doneCalls } = makeDialog({ dir, rpcCall });
  await dialog.ready;
  type(dialog, "/stop");
  dialog.handleInput(KEYS["tui.select.confirm"]);
  assert.equal(dialog.mode, "confirm");
  assert.ok(dialog.render(160).some(l => l.includes("Stop reviewer?")));

  dialog.handleInput(KEYS["tui.select.cancel"]);
  assert.equal(dialog.mode, "compose");
  assert.equal(dialog.editor.getText(), "/stop");

  dialog.handleInput(KEYS["tui.select.confirm"]);
  assert.equal(dialog.mode, "confirm");
  await dialog.handleInput(KEYS["tui.select.confirm"]);
  await dialog.pending;
  assert.deepEqual(calls[0], ["stop", { id: "run1" }]);
  assert.deepEqual(doneCalls, [undefined]);

  // A stop the plugin did not acknowledge leaves the child running: the peek
  // stays open and says so.
  const failing = makeDialog({ dir, rpcCall: async () => null });
  await failing.dialog.ready;
  type(failing.dialog, "/stop");
  failing.dialog.handleInput(KEYS["tui.select.confirm"]);
  await failing.dialog.handleInput(KEYS["tui.select.confirm"]);
  await failing.dialog.pending;
  assert.deepEqual(failing.doneCalls, []);
  assert.equal(failing.dialog.mode, "compose");
  assert.ok(failing.dialog.render(160).some(l => l.includes("stop failed")));
});

test("Esc from the composer closes the dialog; a blank Enter flashes a prompt", async () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, "events.jsonl"), "");
  const { dialog, doneCalls } = makeDialog({ dir });
  await dialog.ready;
  dialog.handleInput(KEYS["tui.select.confirm"]);
  assert.ok(dialog.render(160).some(l => l.includes("Type a message to steer")));

  dialog.handleInput(KEYS["tui.select.cancel"]);
  assert.deepEqual(doneCalls, [undefined]);
  assert.equal(dialog.timer, undefined);
});

test("the composer is a shaded block: a blank shaded row sits above and below the ❯ line", async () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, "events.jsonl"), "");
  const { dialog } = makeDialog({ dir });
  await dialog.ready;
  const lines = dialog.render(160);
  const idx = lines.findIndex(l => l.includes("❯"));
  assert.ok(idx > 0);
  assert.ok(lines[idx - 1].startsWith("[userMessageBg]"));
  assert.ok(lines[idx + 1].startsWith("[userMessageBg]"));
  const bare = l => l.replace("[userMessageBg]", "").replace(/\x1b\[[0-9;]*m/g, "").trim();
  assert.equal(bare(lines[idx - 1]), "");
  assert.equal(bare(lines[idx + 1]), "");
});

test("ctrl+o expands a tool body without moving the scroll", async () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, "events.jsonl"),
    line({ type: "tool_execution_start", toolCallId: "c1", toolName: "workspace_bash", args: { command: "npm test" } }) +
    line({ type: "tool_execution_end", toolCallId: "c1", toolName: "workspace_bash", isError: false, result: { content: [{ type: "text", text: "31 passing" }] } }));
  const { dialog } = makeDialog({ dir });
  await dialog.ready;
  dialog.render(160);
  dialog.follow = false;
  dialog.scroll = 0;
  dialog.handleInput(KEYS["app.tools.expand"]);
  assert.equal(dialog.scroll, 0);
  assert.ok(dialog.render(160).some(l => l.includes("31 passing")));
});

test("a terminal describe() prints the state word, stops the interval, and never calls done", async () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, "events.jsonl"), "");
  const state = { terminal: false };
  const { dialog, doneCalls } = makeDialog({ dir, describeState: state });
  await dialog.ready;
  state.terminal = true;
  state.state = "completed";
  await dialog.tick();
  assert.equal(dialog.timer, undefined);
  assert.ok(dialog.render(160).some(l => l.includes("completed")));
  assert.deepEqual(doneCalls, []);
});

test("the working row shows the spinner while a turn runs and a π line once it settles", async () => {
  const dir = makeDir();
  const file = path.join(dir, "events.jsonl");
  fs.writeFileSync(file, line({ type: "agent_start", observedAt: Date.now() }));
  const { dialog } = makeDialog({ dir });
  await dialog.ready;
  const running = dialog.render(160).join("\n");
  assert.match(running, /…/);
  assert.match(running, /\d+[ms]/);
  fs.appendFileSync(file, line({ type: "agent_settled", observedAt: Date.now() }));
  await dialog.tick();
  const settled = dialog.render(160).join("\n");
  assert.doesNotMatch(settled, /…/);
  assert.match(settled, /π/);
});

test("the working row starts once per turn, never from render, and stands down when the run is terminal without a settle", async () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, "events.jsonl"), line({ type: "agent_start", observedAt: Date.now() }));
  const state = { terminal: false };
  const { dialog, renderCount } = makeDialog({ dir, describeState: state });
  await dialog.ready;
  let starts = 0;
  const originalStart = dialog.working.start.bind(dialog.working);
  dialog.working.start = () => { starts++; originalStart(); };
  const before = renderCount();
  dialog.render(160); dialog.render(160); dialog.render(160);
  assert.equal(renderCount(), before, "render must not request another render");
  await dialog.tick();
  assert.equal(starts, 0, "an already running row is not restarted");
  assert.match(dialog.render(160).join("\n"), /…/);
  state.terminal = true;
  await dialog.tick();
  assert.doesNotMatch(dialog.render(160).join("\n"), /…/);
  dialog.dispose();
});

test("dispose stops the working row's own spinner", async () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, "events.jsonl"), line({ type: "agent_start", observedAt: Date.now() }));
  const { dialog } = makeDialog({ dir });
  await dialog.ready;
  dialog.render(160);
  let stopped = false;
  const originalStop = dialog.working.stop.bind(dialog.working);
  dialog.working.stop = () => { stopped = true; originalStop(); };
  dialog.dispose();
  assert.equal(stopped, true);
});

test("a dispose landing while a tick's read is in flight does not start the spinner", async () => {
  const dir = makeDir();
  const file = path.join(dir, "events.jsonl");
  fs.writeFileSync(file, line({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Before" }] } }));
  const { dialog } = makeDialog({ dir });
  await dialog.ready;
  assert.ok(!dialog.spinning);
  fs.appendFileSync(file, line({ type: "agent_start", observedAt: Date.now() }));
  let started = 0;
  const originalStart = dialog.working.start.bind(dialog.working);
  dialog.working.start = () => { started++; originalStart(); };
  const inFlight = dialog.tick();
  dialog.dispose();
  await inFlight;
  const leaked = dialog.working.intervalId ?? null;
  dialog.working.stop();
  assert.equal(started, 0);
  assert.equal(leaked, null);
});

test("openPeek opens in the slot through ctx.ui.custom with the factory's tui/theme/keybindings", async () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, "events.jsonl"), "");
  let seenOpts;
  let built;
  const stubTui = { requestRender: () => {}, terminal: { rows: 40 } };
  const ctx = {
    ui: {
      custom: (factory, opts) => {
        seenOpts = opts;
        built = factory(stubTui, theme, keybindings, () => {});
        return Promise.resolve();
      },
    },
  };
  await openPeek(ctx, { id: "run1", asyncDir: dir, describe: () => ({ agent: "reviewer", terminal: true }), events: {}, rpcCall: async () => null });
  assert.equal(seenOpts, undefined);
  assert.ok(built instanceof PeekDialog);
  built.dispose();
});

test("render is a fixed height, half the terminal's rows, that holds still as the journal grows", async () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, "events.jsonl"), "");
  const { dialog } = makeDialog({ dir, tui: { requestRender: () => {}, terminal: { rows: 40 } } });
  await dialog.ready;
  const before = dialog.render(80);
  assert.equal(before.length, 20);
  const promptIndex = before.findIndex(l => l.includes(PROMPT));
  assert.ok(promptIndex > 0);
  const nonBlankBefore = before.slice(2, promptIndex).filter(l => l.trim() !== "").length;

  fs.appendFileSync(path.join(dir, "events.jsonl"),
    line({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "First note" }] } }) +
    line({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Second note" }] } }) +
    line({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Third note" }] } }));
  await dialog.readChunk();
  const after = dialog.render(80);
  assert.equal(after.length, 20);
  assert.equal(after.findIndex(l => l.includes(PROMPT)), promptIndex);
  const nonBlankAfter = after.slice(2, promptIndex).filter(l => l.trim() !== "").length;
  assert.ok(nonBlankAfter > nonBlankBefore);
});

test("running and settled progress retain the composer row with a multiline draft and narrow width", async () => {
  const dir = makeDir();
  const file = path.join(dir, "events.jsonl");
  fs.writeFileSync(file, line({ type: "agent_start", observedAt: Date.now() }));
  const { dialog } = makeDialog({ dir, tui: { requestRender: () => {}, terminal: { rows: 40 } } });
  await dialog.ready;
  dialog.editor.setText("first line\nsecond line");
  const runningViews = [32, 80].map(width => dialog.render(width));
  fs.appendFileSync(file, line({ type: "agent_settled", observedAt: Date.now() }));
  await dialog.tick();
  for (const [index, width] of [32, 80].entries()) {
    const running = runningViews[index];
    const settled = dialog.render(width);
    assert.equal(running.length, 20);
    assert.equal(settled.length, 20);
    assert.equal(running.findIndex(l => l.includes(PROMPT)), settled.findIndex(l => l.includes(PROMPT)));
    assert.ok(settled.some(l => l.includes("second line")));
  }
  dialog.dispose();
});

test("theme invalidation drops local replay row render caches", async () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, "events.jsonl"), line({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } }));
  const { dialog } = makeDialog({ dir });
  await dialog.ready;
  dialog.render(80);
  const row = dialog.replay.rows[0];
  assert.ok(row._linesKey);
  dialog.invalidate();
  assert.equal(row._linesKey, undefined);
  assert.equal(row._lines, undefined);
  dialog.dispose();
});

test("a steer draft that wraps past the window keeps the frame at its fixed height", async () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, "events.jsonl"), "");
  const { dialog } = makeDialog({ dir, tui: { requestRender: () => {}, terminal: { rows: 40 } } });
  await dialog.ready;
  dialog.editor.setText(Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n"));
  const lines = dialog.render(80);
  assert.equal(lines.length, 20);
  assert.ok(lines.at(-2).startsWith("[userMessageBg]"));
  assert.doesNotMatch(lines.join("\n"), /enter steer · \/stop/);
  assert.ok(lines.some(l => l.includes("line 29")));
  dialog.dispose();
});
