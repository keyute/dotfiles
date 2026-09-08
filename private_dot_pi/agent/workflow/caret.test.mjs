import test from "node:test";
import assert from "node:assert/strict";
import { CaretEditor } from "./index.mjs";

const keybindings = { matches: (data, id) => ({ "tui.editor.cursorDown": "\x1b[B", "tui.select.down": "\x1b[B", "tui.select.up": "\x1b[A", "tui.select.confirm": "\r", "tui.select.cancel": "\x1b" })[id] === data };
// The host hands the editor factory an EditorTheme; the full palette arrives
// separately, so the mocks stay split or the test stops matching the runtime.
const editorTheme = { borderColor: text => `<border>${text}`, selectList: {} };
const BG = "\x1b[48;5;1m";
const palette = { fg: (color, text) => `<${color}>${text}`, bg: (_color, text) => `${BG}${text}\x1b[49m` };
const editor = options => new CaretEditor({ terminal: { rows: 24 }, requestRender: () => {} }, editorTheme, keybindings, { palette, ...options });

test("composer is the user box's shape: shaded rows instead of rules, the prompt at column 0, bg re-opened after the cursor reset", () => {
  const lines = editor().render(40);
  assert.equal(lines[0], `${BG}${" ".repeat(40)}\x1b[49m`);
  assert.equal(lines.at(-1), lines[0]);
  assert.equal(lines.length, 3);
  assert.ok(lines[1].startsWith(`${BG}<accent>❯ `), lines[1]);
  assert.match(lines[1], /\x1b\[0m\x1b\[48;5;1m/);
  assert.ok(lines[1].endsWith("\x1b[49m"));
});

test("the working status rides the top shaded row at column 0 while a turn runs", () => {
  const caret = editor();
  assert.equal(caret.embedWorkingStatus, true);
  caret.setWorkingStatusIndicator({ renderInBorder: () => "⠋ Deriving… 2s" });
  assert.equal(caret.render(40)[0], `${BG}${"⠋ Deriving… 2s".padEnd(40)}\x1b[49m`);
  caret.setWorkingStatusIndicator(undefined);
  assert.equal(caret.render(40)[0], `${BG}${" ".repeat(40)}\x1b[49m`);
});

test("prompt survives the host copying the default editor's paddingX onto the custom editor", () => {
  const caret = editor();
  caret.setPaddingX(0);
  assert.ok(caret.render(40)[1].startsWith(`${BG}<accent>❯ `));
});

test("padding clamp still honours a larger configured padding", () => {
  const caret = editor();
  caret.setPaddingX(5);
  assert.equal(caret.getPaddingX(), 5);
  assert.ok(caret.render(40)[1].startsWith(`${BG}<accent>❯    `));
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
