import test from "node:test";
import assert from "node:assert/strict";
import { CaretEditor } from "./index.mjs";

const keybindings = { matches: (data, id) => ({ "tui.editor.cursorDown": "\x1b[B", "tui.select.down": "\x1b[B", "tui.select.up": "\x1b[A", "tui.select.confirm": "\r", "tui.select.cancel": "\x1b" })[id] === data };
const editor = options => new CaretEditor({ terminal: { rows: 24 }, requestRender: () => {} }, { borderColor: text => text, selectList: {} }, keybindings, options);

test("caret survives the host copying the default editor's paddingX onto the custom editor", () => {
  const caret = editor();
  caret.setPaddingX(0);
  const lines = caret.render(40);
  assert.ok(lines[1].startsWith("❯ "), lines.join("\n"));
});

test("caret clamp still honours a larger configured padding", () => {
  const caret = editor();
  caret.setPaddingX(3);
  assert.equal(caret.getPaddingX(), 3);
  assert.ok(caret.render(40)[1].startsWith("❯ "));
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
