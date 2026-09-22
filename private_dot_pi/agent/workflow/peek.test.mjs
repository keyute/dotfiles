import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PeekDialog, openPeek } from "./peek.mjs";

const theme = { fg: (c, t) => `<${c}>${t}`, bg: (c, t) => `[${c}]${t}`, bold: t => t };
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

function makeDialog({ dir, describeState, rpcCall, tui } = {}) {
  let renders = 0;
  const doneCalls = [];
  const stubTui = tui ?? { requestRender: () => renders++, terminal: { rows: 40 } };
  const base = { agent: "reviewer", task: "Review the diff", model: "anthropic/claude:high", effort: "high", tokens: { total: 12400 }, startedAt: Date.now() - 134_000, state: "running", currentTool: "workspace_bash", terminal: false };
  const info = describeState ?? base;
  const dialog = new PeekDialog(stubTui, theme, keybindings, value => doneCalls.push(value), {
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
  const header = lines.join("\n");
  assert.match(header, /reviewer/);
  assert.match(header, /Review the diff/);
  assert.match(header, /claude high/);
  assert.match(header, /12\.4k tokens/);
  assert.match(header, /\d+[ms]/);
  assert.match(header, /bash/);
  assert.match(header, /↳/);
  assert.match(header, /Done\./);
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

test("a file over 256 KiB keeps only the tail plus a note", async () => {
  const dir = makeDir();
  const file = path.join(dir, "events.jsonl");
  const junk = "x".repeat(2000);
  const stream = fs.createWriteStream(file);
  for (let i = 0; i < 200; i++) stream.write(line({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: junk }] } }));
  stream.write(line({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Recent note" }] } }));
  await new Promise((resolve, reject) => stream.end(err => (err ? reject(err) : resolve())));
  assert.ok(fs.statSync(file).size > 256 * 1024);
  const { dialog } = makeDialog({ dir });
  await dialog.ready;
  assert.equal(dialog.replay.rows[0].kind, "note");
  assert.equal(dialog.replay.rows[0].text, "earlier activity not shown");
  assert.ok(dialog.replay.rows.some(r => r.kind === "assistant" && r.text.includes("Recent note")));
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

test("openPeek opens an overlay through ctx.ui.custom with the factory's tui/theme/keybindings", async () => {
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
  assert.equal(seenOpts.overlay, true);
  assert.equal(typeof seenOpts.overlayOptions, "function");
  assert.deepEqual(seenOpts.overlayOptions(), { anchor: "center", width: "90%", maxHeight: "80%", margin: 1 });
  assert.ok(built instanceof PeekDialog);
  built.dispose();
});
