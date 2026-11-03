import test from "node:test";
import assert from "node:assert/strict";
import { CaretEditor } from "./editor.mjs";

const keybindings = { matches: (key, action) => ({ "tui.editor.cursorLineStart": "\x01", "tui.editor.deleteCharBackward": "\x7f", "tui.editor.cursorUp": "\x1b[A", "tui.editor.cursorDown": "\x1b[B" })[action] === key };
const theme = { borderColor: text => text, selectList: {} };
const palette = { fg: (_color, text) => text, bg: (_color, text) => text };
const editor = () => new CaretEditor({ terminal: { rows: 24 }, requestRender() {} }, theme, keybindings, { palette });

test("one optional shell delimiter is display-only across paste, wrapping and cursor navigation", () => {
  for (const prefix of ["!", "!!"]) {
    for (const width of [8, 20, 60]) {
      const command = "echo 界abc def ghi\nsecond line";
      const regular = editor(), shell = editor();
      regular.focused = shell.focused = true;
      regular.setText(command);
      shell.handleInput(`\x1b[200~${prefix} ${command}\x1b[201~`);
      const draw = current => current.render(width).map(line => line.replace(/^[!❯]/, ">"));
      assert.equal(shell.getText(), `${prefix} ${command}`);
      assert.deepEqual(draw(shell), draw(regular));
      for (const key of ["\x1b[A", "\x01", "\x1b[D", "\x1b[B"]) {
        shell.handleInput(key);
        regular.handleInput(key);
        assert.deepEqual(draw(shell), draw(regular));
      }
      assert.equal(shell.getExpandedText(), `${prefix} ${command}`);
    }
  }
});

test("Home, history and Backspace map across the hidden delimiter without changing history or source", () => {
  const shell = editor();
  shell.addToHistory("!! older");
  shell.setText("! pwd");
  shell.handleInput("\x01");
  assert.equal(shell.getCursor().col, 2);
  shell.handleInput("\x1b[A");
  assert.equal(shell.getText(), "!! older");
  shell.handleInput("\x1b[B");
  assert.equal(shell.getText(), "! pwd");
  shell.handleInput("\x01");
  shell.handleInput("\x7f");
  assert.equal(shell.getText(), "pwd");
  shell.handleInput("\x1f");
  assert.equal(shell.getText(), "! pwd");
  shell.setText("!  pwd");
  assert.equal(shell.commandStart(), 2, "only one separator is hidden");
});
