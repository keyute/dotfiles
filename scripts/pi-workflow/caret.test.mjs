import test from "node:test";
import assert from "node:assert/strict";
import { CaretEditor } from "./index.mjs";

const BG = "\x1b[48;5;1m";
const keybindings = { matches: (data, id) => ({ "tui.editor.cursorDown": "\x1b[B", "tui.select.down": "\x1b[B", "tui.select.up": "\x1b[A", "tui.select.confirm": "\r", "tui.select.cancel": "\x1b" })[id] === data };
const theme = { borderColor: text => text, selectList: {}, fg: (_color, text) => text, bg: (_color, text) => `${BG}${text}\x1b[49m` };
const editor = options => new CaretEditor({ terminal: { rows: 24 }, requestRender: () => {} }, theme, keybindings, options);

test("composer is a shaded block: blank shaded rows instead of rules, a prompt, bg re-opened after the cursor reset", () => {
  const lines = editor().render(40);
  assert.equal(lines[0], `${BG}${" ".repeat(40)}\x1b[49m`);
  assert.equal(lines.at(-1), lines[0]);
  assert.ok(lines[1].startsWith(`${BG}› `), lines[1]);
  assert.match(lines[1], /\x1b\[0m\x1b\[48;5;1m/);
  assert.ok(lines[1].endsWith("\x1b[49m"));
});

test("prompt survives the host copying the default editor's paddingX onto the custom editor", () => {
  const caret = editor();
  caret.setPaddingX(0);
  assert.ok(caret.render(40)[1].startsWith(`${BG}› `));
});

test("padding clamp still honours a larger configured padding", () => {
  const caret = editor();
  caret.setPaddingX(3);
  assert.equal(caret.getPaddingX(), 3);
  assert.ok(caret.render(40)[1].startsWith(`${BG}› `));
});

test("down enters fleet navigation only when the editor could not move, and other keys fall back to typing", () => {
  const actions = [];
  let focused = false;
  const fleet = { focused: () => focused, handleKey: action => { actions.push(action); if (action === "enter") focused = true; if (action === "other") { focused = false; return false; } return true; } };
  const caret = editor({ fleet });
  caret.setText("one\ntwo");
  caret.handleInput("\x1b[A");
  caret.handleInput("\x1b[B");
  assert.deepEqual(actions, []);
  caret.handleInput("\x1b[B");
  assert.deepEqual(actions, ["enter"]);
  caret.handleInput("\x1b[B");
  caret.handleInput("\r");
  assert.deepEqual(actions, ["enter", "down", "confirm"]);
  caret.handleInput("x");
  assert.deepEqual(actions, ["enter", "down", "confirm", "other"]);
  assert.equal(caret.getText(), "one\ntwox");
  assert.equal(editor().getText(), "");
});
