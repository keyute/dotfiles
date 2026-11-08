import test from "node:test";
import assert from "node:assert/strict";
import { CURSOR_MARKER, TuiAltScreen, TuiMainScreen, Container } from "@earendil-works/pi-tui";
import { CaretEditor } from "./editor.mjs";

const keybindings = { matches: (key, action) => ({ "tui.editor.cursorLineStart": "\x01", "tui.editor.deleteCharBackward": "\x7f", "tui.editor.cursorUp": "\x1b[A", "tui.editor.cursorDown": "\x1b[B" })[action] === key };
const theme = { borderColor: text => text, selectList: {} };
const palette = { fg: (_color, text) => text, bg: (_color, text) => text, inverse: text => `\x1b[7m${text}\x1b[27m` };
const editor = (options = {}) => new CaretEditor({ terminal: { rows: 24 }, requestRender() {} }, theme, keybindings, { palette, ...options });

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

const paste = (caret, text) => caret.handleInput(`\x1b[200~${text}\x1b[201~`);

test("large leading-shell paste stays collapsed and repeat expands only that block, with atomic undo", () => {
  for (const prefix of ["", "!", "!! "]) {
    const caret = editor();
    const text = prefix + "echo 界\n".repeat(20);
    paste(caret, text);
    const collapsed = caret.getText();
    assert.match(collapsed, /\[paste #/);
    assert.equal(caret.shellMode(), Boolean(prefix));
    assert.equal(caret.getExpandedText(), text);
    paste(caret, text);
    assert.equal(caret.getText(), text);
    assert.equal(caret.getExpandedText(), text);
    caret.handleInput("\x1f");
    assert.equal(caret.getText(), collapsed);
    paste(caret, text);
    paste(caret, text);
    assert.equal(caret.getExpandedText(), text + text);
  }
});

test("repeat retires literal-marker registry entries and undo restores exact expanded and submitted payloads", () => {
  for (const prefix of ["", "/"]) {
    for (const stage of ["collapsed", "repeated", "undone"]) {
      const caret = editor(), text = prefix + "[paste #1 1100 chars]" + "x".repeat(1100);
      const before = prefix ? "hello" : "";
      caret.setText(before);
      paste(caret, text);
      const collapsed = caret.getText(), stored = caret.pastes.get(1);
      if (stage !== "collapsed") paste(caret, text);
      if (stage === "undone") caret.handleInput("\x1f");
      const repeated = stage === "repeated";
      const expected = before + (prefix ? " " : "") + text;
      assert.equal(caret.getText(), repeated ? expected : collapsed);
      assert.equal(caret.getExpandedText(), expected, `${prefix || "literal"}: ${stage}`);
      assert.equal(caret.pastes.has(1), !repeated);
      assert.equal(caret.state.pasteSeparators.has(1), Boolean(prefix) && !repeated);
      assert.equal(caret.pasteCounter, repeated ? 2 : 1);
      if (!repeated) assert.equal(caret.pastes.get(1), stored);
      const submitted = [];
      caret.onSubmit = value => submitted.push(value);
      caret.submitValue();
      assert.deepEqual(submitted, [expected]);
    }
  }
});

test("repeat preserves literal references to other live pastes and restores the registry in one undo", () => {
  for (const prefix of ["", "/"]) {
    for (const marker of ["[paste #1]", "[paste #1 1100 chars]", "[paste #1 +12 lines]"]) {
      const caret = editor(), first = prefix + "x".repeat(1100), second = marker + "y".repeat(1100);
      caret.setText(prefix ? "word" : "");
      paste(caret, first);
      paste(caret, second);
      const expected = (prefix ? "word " : "") + first + second;
      const before = structuredClone({ state: caret.state, pastes: caret.pastes, counter: caret.pasteCounter });
      assert.equal(caret.getExpandedText(), expected);
      paste(caret, second);
      assert.equal(caret.getExpandedText(), expected);
      assert.ok(caret.getText().endsWith(second));
      assert.equal(caret.pastes.size, 1, "the unrelated block stays collapsed");
      const [id] = caret.pastes.keys();
      assert.notEqual(id, 1, "the literal id is no longer registered");
      assert.equal(caret.state.pasteSeparators.has(id), Boolean(prefix));
      assert.equal(caret.getCursor().col, caret.getText().length);
      caret.handleInput("\x1f");
      assert.deepEqual({ state: caret.state, pastes: caret.pastes, counter: caret.pasteCounter }, before);
      paste(caret, second);
      const submitted = [];
      caret.onSubmit = text => submitted.push(text);
      caret.submitValue();
      assert.deepEqual(submitted, [expected]);
    }
  }
});

test("exposed literal ids survive subsequent allocation, Backspace and undo", () => {
  const caret = editor(), first = "x".repeat(1100);
  const second = "[paste #1 1100 chars][paste #5][paste #6]" + "y".repeat(1100), third = "z".repeat(1100);
  paste(caret, first);
  paste(caret, second);
  paste(caret, second);
  const expanded = caret.getText(), counter = caret.pasteCounter;
  paste(caret, third);
  assert.equal(caret.getExpandedText(), first + second + third);
  caret.handleInput("\x1f");
  assert.equal(caret.getText(), expanded);
  assert.equal(caret.pasteCounter, counter);
  paste(caret, third);
  const all = caret.getText(), firstMarker = all.match(/^\[paste #\d+ [^\]]+\]/)[0];
  caret.state.cursorCol = firstMarker.length;
  caret.handleInput("\x7f");
  assert.equal(caret.getText(), all.slice(firstMarker.length), "deleting a block must not renumber literal text");
  assert.equal(caret.getExpandedText(), second + third);
  caret.handleInput("\x1f");
  assert.equal(caret.getText(), all);
  assert.equal(caret.getExpandedText(), first + second + third);
  caret.state.cursorCol = all.length;
  caret.handleInput("\x7f");
  assert.equal(caret.getExpandedText(), first + second);
});

test("subsequent paste reserves literal ids inside unrelated collapsed payloads", () => {
  const caret = editor(), first = "[paste #5]" + "x".repeat(1100);
  const second = "[paste #1]" + "y".repeat(1100), third = "z".repeat(1100);
  paste(caret, first);
  paste(caret, second);
  paste(caret, second);
  assert.equal(caret.getExpandedText(), first + second);
  const before = structuredClone({ state: caret.state, pastes: caret.pastes, counter: caret.pasteCounter });
  paste(caret, third);
  assert.equal(caret.getExpandedText(), first + second + third);
  assert.equal(caret.pastes.size, 2);
  assert.equal(caret.pastes.has(5), false);
  caret.handleInput("\x1f");
  assert.deepEqual({ state: caret.state, pastes: caret.pastes, counter: caret.pasteCounter }, before);
  paste(caret, third);
  const submitted = [];
  caret.onSubmit = text => submitted.push(text);
  caret.submitValue();
  assert.deepEqual(submitted, [first + second + third]);
});

test("small literal pastes stay literal when the next registry id is reserved", () => {
  const caret = editor(), text = "[paste #3]" + "x".repeat(1100), small = "[paste #3 42 chars]";
  paste(caret, text);
  paste(caret, text);
  paste(caret, small);
  assert.equal(caret.getText(), text + small);
  assert.equal(caret.getExpandedText(), text + small);
  assert.equal(caret.pastes.size, 0);
  caret.handleInput("\x1f");
  assert.equal(caret.getText(), text);
  assert.equal(caret.pasteCounter, 2);
});

test("repeat rekeys a wider id before the cursor without moving the insertion point", () => {
  const caret = editor();
  const payloads = Array.from({ length: 8 }, (_, index) => String(index).repeat(1100));
  for (const text of payloads) paste(caret, text);
  const second = "[paste #1 1100 chars]" + "y".repeat(1100);
  paste(caret, second);
  caret.handleInput("tail");
  caret.state.cursorCol -= 4;
  paste(caret, second);
  assert.equal(caret.getExpandedText(), payloads.join("") + second + "tail");
  assert.equal(caret.getCursor().col, caret.getText().length - 4);
  assert.equal(caret.pastes.size, 8);
});

test("path paste repeats after word characters expand the first native payload with one undo", () => {
  for (const prefix of ["/", "~", "."]) {
    const caret = editor(), text = prefix + "x".repeat(1100);
    caret.setText("hello");
    paste(caret, text);
    const collapsed = caret.getText();
    assert.equal(caret.getExpandedText(), "hello " + text);
    paste(caret, text);
    assert.equal(caret.getText(), "hello " + text);
    caret.handleInput("\x1f");
    assert.equal(caret.getText(), collapsed);
    assert.equal(caret.getExpandedText(), "hello " + text);
    paste(caret, text);
    paste(caret, text);
    assert.equal(caret.getExpandedText(), "hello " + text + " " + text);
  }
});

test("path paste repeat does not conflate clipboard whitespace with a native separator", () => {
  for (const firstSpace of ["", " ", "  "]) {
    for (const secondSpace of ["", " ", "  "]) {
      if (firstSpace === secondSpace) continue;
      const caret = editor(), text = "/" + "x".repeat(1100);
      caret.setText("hello");
      paste(caret, firstSpace + text);
      const first = caret.getExpandedText();
      paste(caret, secondSpace + text);
      assert.equal(caret.getExpandedText(), first + secondSpace + text);
      assert.equal((caret.getText().match(/\[paste #/g) ?? []).length, 2);
    }
  }
});

test("undoing the first path paste clears separator provenance before its id is reused", () => {
  for (const prefix of ["/", "~", "."]) {
    const caret = editor(), text = prefix + "x".repeat(1100);
    caret.setText("hello");
    paste(caret, text);
    caret.handleInput("\x1f");
    assert.equal(caret.getText(), "hello");
    paste(caret, " " + text);
    const collapsed = caret.getText();
    paste(caret, " " + text);
    assert.equal(caret.getText(), "hello " + text);
    caret.handleInput("\x1f");
    assert.equal(caret.getText(), collapsed);
    paste(caret, text);
    assert.equal(caret.getExpandedText(), "hello " + text + text);
  }
});

test("native separator alone can cross the collapse threshold and repeat still expands", () => {
  for (const prefix of ["/", "~", "."]) {
    for (const size of [999, 1000, 1001]) {
      const caret = editor(), text = prefix + "x".repeat(size - 1);
      caret.setText("hello");
      paste(caret, text);
      const collapsed = caret.getText();
      assert.equal(collapsed.includes("[paste #"), size >= 1000);
      paste(caret, text);
      assert.equal(caret.getText(), size >= 1000 ? "hello " + text : "hello " + text + " " + text);
      caret.handleInput("\x1f");
      assert.equal(caret.getText(), collapsed);
    }
  }
});

test("separator provenance follows native decoding, normalization, filtering and marker renumbering", () => {
  for (const raw of ["\x01/" + "x".repeat(1100), "\x1b[97;5u~/" + "x".repeat(1100), "./\t" + "x".repeat(1100), "\n/" + "x".repeat(1100)]) {
    const caret = editor();
    caret.setText("hello");
    paste(caret, raw);
    const expanded = caret.getExpandedText();
    paste(caret, raw);
    assert.equal(caret.getText(), expanded);
  }
  const caret = editor(), text = "/" + "x".repeat(1100);
  paste(caret, "unrelated\n".repeat(20));
  const first = caret.getText();
  caret.handleInput("a");
  paste(caret, text);
  const second = caret.getText();
  caret.state.cursorCol = first.length;
  caret.handleInput("\x7f");
  assert.match(caret.getText(), /^a\[paste #1 /);
  caret.state.cursorCol = caret.getText().length;
  paste(caret, text);
  assert.equal(caret.getText(), "a " + text);
  caret.handleInput("\x1f");
  caret.handleInput("\x1f");
  assert.equal(caret.getText(), second);
  caret.state.cursorCol = second.length;
  paste(caret, text);
  assert.equal(caret.getText(), first + "a " + text);
});

test("repeated small literal pastes concatenate without registry-backed expansion and undo atomically", () => {
  for (const text of ["ordinary literal", "[paste #99 1234 chars]"]) {
    const caret = editor();
    paste(caret, text);
    paste(caret, text);
    assert.equal(caret.getText(), text + text);
    assert.equal(caret.getExpandedText(), text + text);
    caret.handleInput("\x1f");
    assert.equal(caret.getText(), text);
    assert.equal(caret.getExpandedText(), text);
  }
});

test("Backspace at a collapsed shell command start exits shell mode undoably", () => {
  const caret = editor(), command = "echo test\n".repeat(15);
  paste(caret, "!! " + command);
  caret.handleInput("\x01"); caret.handleInput("\x7f");
  assert.equal(caret.shellMode(), false);
  assert.equal(caret.getExpandedText(), command);
  assert.match(caret.getText(), /\[paste #/);
  caret.handleInput("\x1f");
  assert.equal(caret.shellMode(), true);
  assert.equal(caret.getExpandedText(), "!! " + command);
});

test("a paste differing only by the shell prefix inserts rather than expanding", () => {
  for (const prefix of ["!", "! ", "!! "]) {
    const caret = editor(), command = "echo test\n".repeat(15);
    paste(caret, prefix + command);
    const first = caret.getText();
    paste(caret, command);
    assert.equal(caret.getExpandedText(), prefix + command + command);
    caret.handleInput("\x1f");
    assert.equal(caret.getText(), first);
    assert.equal(caret.getExpandedText(), prefix + command);
  }
});

test("repeat preserves unrelated paste blocks; different content and interior ! insert normally", () => {
  const caret = editor();
  const first = "first\n".repeat(20), second = "!second\n".repeat(20);
  paste(caret, first);
  const block = caret.getText();
  paste(caret, second);
  assert.equal(caret.shellMode(), false);
  paste(caret, second);
  assert.equal(caret.getText(), block + second);
  assert.equal(caret.getExpandedText(), first + second);
});

const mouse = (caret, type, x, y, width = 30) => caret.handleMouse({ type, button: "left", x, y, width, height: 10 });
test("composer drag is a visible editable range, reverse/multiline deletion is one undo", () => {
  for (const key of ["\x7f", "\x1b[3~"]) {
    const caret = editor();
    caret.setText("abc\ndef");
    caret.render(30);
    assert.equal(mouse(caret, "press", 4, 2).capture, true);
    mouse(caret, "drag", 3, 1);
    mouse(caret, "release", 3, 1);
    assert.match(caret.render(30).join("\n"), /\x1b\[7m/);
    caret.handleInput(key);
    assert.equal(caret.getText(), "af");
    caret.handleInput("\x1f");
    assert.equal(caret.getText(), "abc\ndef");
  }
});

test("reverse range stays highlighted after native software-cursor resolution", () => {
  const caret = editor();
  caret.focused = true;
  caret.setText("abcdefghij"); caret.render(30);
  mouse(caret, "press", 8, 1); mouse(caret, "drag", 3, 1); mouse(caret, "release", 3, 1);
  for (const showHardwareCursor of [false, true]) {
    const lines = TuiMainScreen.prototype.resolveFakeCursors.call({ showHardwareCursor }, caret.render(30));
    assert.ok(lines[1].includes(CURSOR_MARKER), "IME cursor position is retained");
    assert.match(lines[1].replaceAll(CURSOR_MARKER, ""), /\x1b\[7mbcdef\x1b\[27m/);
  }
});

test("the copy shortcut uses the composer range before the last-message action", () => {
  const caret = editor(), copies = [];
  caret.tui.getCopyOnSelect = () => false;
  caret.copySelection = text => copies.push(text);
  caret.keybindings = { matches: (data, action) => action === "app.message.copy" ? data === "\x18" : keybindings.matches(data, action) };
  let fallback = 0;
  caret.actionHandlers.set("app.message.copy", () => fallback++);
  caret.setText("abcdef"); caret.render(30);
  mouse(caret, "press", 2, 1); mouse(caret, "drag", 5, 1); mouse(caret, "release", 5, 1);
  caret.handleInput("\x18");
  assert.deepEqual(copies, ["abc"]);
  assert.equal(fallback, 0);
  caret.handleInput("\x7f");
  assert.equal(caret.getText(), "def");
  caret.handleInput("\x18");
  assert.equal(fallback, 1);
});

for (const copyOnSelect of [false, true]) {
  test(`clipboard rejection is nonfatal for ${copyOnSelect ? "mouse copy-on-select" : "the copy shortcut"}`, async () => {
    const copies = [], notices = [], unhandled = [];
    const onUnhandled = error => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    try {
      const caret = editor({
        copyToClipboard: async text => { copies.push(text); throw new Error("Clipboard unavailable"); },
        notify: (text, type) => notices.push({ text, type }),
      });
      caret.tui.getCopyOnSelect = () => copyOnSelect;
      caret.keybindings = { matches: (data, action) => action === "app.message.copy" ? data === "\x18" : keybindings.matches(data, action) };
      caret.setText("abcdef"); caret.render(30);
      mouse(caret, "press", 2, 1); mouse(caret, "drag", 5, 1); mouse(caret, "release", 5, 1);
      const selection = structuredClone(caret.selection);
      const cursor = caret.getCursor();
      if (!copyOnSelect) caret.handleInput("\x18");
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(copies, ["abc"]);
      assert.deepEqual(notices, [{ text: "Copy failed: Clipboard unavailable", type: "error" }]);
      assert.deepEqual(unhandled, []);
      assert.equal(caret.getText(), "abcdef");
      assert.deepEqual(caret.selection, selection);
      assert.deepEqual(caret.getCursor(), cursor);
      caret.handleInput("\x7f");
      assert.equal(caret.getText(), "def", "selection remains editable after copy failure");
      caret.handleInput("\x1f");
      assert.equal(caret.getText(), "abcdef");
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
}

test("range cannot delete replacement drafts or survive cursor navigation", () => {
  const caret = editor();
  caret.setText("abcdef"); caret.render(30);
  mouse(caret, "press", 2, 1); mouse(caret, "drag", 5, 1); mouse(caret, "release", 5, 1);
  caret.setText("new draft"); caret.handleInput("\x7f");
  assert.equal(caret.getText(), "new draf");
});

test("native normalization and chunk buffering precede shell collapse and repeat comparison", () => {
  const caret = editor();
  const raw = "!! echo\r\n\t界\x01".repeat(12);
  caret.handleInput("\x1b[200~" + raw.slice(0, 35));
  caret.handleInput(raw.slice(35) + "\x1b[201~");
  const expanded = caret.getExpandedText();
  assert.equal(caret.shellMode(), true);
  assert.doesNotMatch(expanded, /\r|\t|\x01/);
  paste(caret, raw);
  assert.equal(caret.getText(), expanded);
});

test("large paste thresholds stay native, and shell repeat after a separately typed marker keeps it", () => {
  for (const size of [999, 1000, 1001]) {
    const caret = editor();
    paste(caret, "!" + "x".repeat(size - 1));
    assert.equal(caret.getText().includes("[paste #"), size > 1000);
    assert.equal(caret.getExpandedText(), "!" + "x".repeat(size - 1));
  }
  const caret = editor();
  caret.setText("! ");
  const text = "echo test\n".repeat(15);
  paste(caret, text); paste(caret, text);
  assert.equal(caret.getText(), "! " + text);
});

test("wrapped Unicode shell ranges use native grapheme mapping, including a scrolled composer", () => {
  const caret = editor();
  caret.setText("!! 界e\u0301😀 abcdefghijklmnopqrstuvwxyz\n" + "line\n".repeat(12));
  caret.render(14);
  assert.ok(caret.scrollOffset > 0);
  const initial = caret.getText();
  mouse(caret, "press", 2, 1, 14);
  const start = caret.getCursor();
  mouse(caret, "drag", 5, 3, 14);
  const end = caret.getCursor();
  mouse(caret, "release", 5, 3, 14);
  const lines = initial.split("\n");
  const expected = [...lines.slice(0, start.line), lines[start.line].slice(0, start.col) + lines[end.line].slice(end.col), ...lines.slice(end.line + 1)].join("\n");
  caret.handleInput("\x7f");
  assert.equal(caret.getText(), expected);
  caret.handleInput("\x1f");
  assert.equal(caret.getText(), initial);
  caret.setText("!! 界e\u0301😀abc"); caret.render(30);
  mouse(caret, "press", 2, 1); mouse(caret, "drag", 7, 1); mouse(caret, "release", 7, 1);
  caret.handleInput("\x7f");
  assert.equal(caret.getText(), "!! abc");
});

test("composer capture respects copy-on-select without clipboard effects; outside gestures stay unhandled", () => {
  const caret = editor();
  const copies = [];
  caret.copySelection = text => copies.push(text);
  caret.setText("abcdef"); caret.render(30);
  assert.equal(mouse(caret, "press", 2, 0), undefined);
  for (const enabled of [false, true]) {
    caret.tui.getCopyOnSelect = () => enabled;
    mouse(caret, "press", 2, 1); mouse(caret, "drag", 5, 1); mouse(caret, "release", 5, 1);
  }
  assert.deepEqual(copies, ["abc"]);
  caret.handleInput("\x1b[C");
  caret.handleInput("\x7f");
  assert.equal(caret.getText(), "abcef");
});

test("captured releases without a button finish selection at the released cell", () => {
  const caret = editor(), copies = [];
  caret.tui.getCopyOnSelect = () => true;
  caret.copySelection = text => copies.push(text);
  caret.setText("abcdef"); caret.render(30);
  mouse(caret, "press", 2, 1); mouse(caret, "drag", 4, 1);
  const result = caret.handleMouse({ type: "release", button: "none", x: 5, y: 1, width: 30, height: 10 });
  assert.equal(result?.handled, true);
  assert.equal(caret.dragging, false);
  assert.deepEqual(copies, ["abc"]);
  caret.handleInput("\x7f");
  assert.equal(caret.getText(), "def");
});

test("range deletion retires collapsed markers; literals cannot expand or submit deleted payloads", () => {
  for (const key of ["\x7f", "\x1b[3~"]) {
    const caret = editor(), text = "sensitive draft\n".repeat(20);
    paste(caret, text);
    const marker = caret.getText();
    caret.render(40);
    mouse(caret, "press", 2, 1, 40); mouse(caret, "drag", 35, 1, 40); mouse(caret, "release", 35, 1, 40);
    caret.handleInput(key);
    assert.equal(caret.getText(), "");
    assert.equal(caret.pastes.has(1), false);
    caret.handleInput("\x1f");
    assert.equal(caret.getText(), marker);
    assert.equal(caret.getExpandedText(), text);
    caret.render(40);
    mouse(caret, "press", 2, 1, 40); mouse(caret, "drag", 35, 1, 40); mouse(caret, "release", 35, 1, 40);
    caret.handleInput(key);
    paste(caret, marker);
    assert.equal(caret.getExpandedText(), marker);
    const submitted = [];
    caret.onSubmit = value => submitted.push(value);
    caret.submitValue();
    assert.deepEqual(submitted, [marker]);
  }
});

test("multi-marker range deletion preserves surviving ids, path provenance and repeat through undo", () => {
  for (const key of ["\x7f", "\x1b[3~"]) {
    const caret = editor(), first = "/" + "x".repeat(1100), second = "second\n".repeat(20), survivor = "/" + "y".repeat(1100);
    caret.setText("hello");
    paste(caret, first);
    paste(caret, second);
    const removedEnd = caret.getText().length;
    caret.handleInput("a");
    paste(caret, survivor);
    const original = caret.getText(), stored = new Map(caret.pastes);
    for (const undo of [true, false]) {
      caret.render(200);
      mouse(caret, "press", 7, 1, 200); mouse(caret, "drag", 2 + removedEnd, 1, 200); mouse(caret, "release", 2 + removedEnd, 1, 200);
      caret.handleInput(key);
      assert.deepEqual([...caret.pastes], [[3, stored.get(3)]]);
      assert.deepEqual([...caret.state.pasteSeparators], [3]);
      assert.equal(caret.getText(), "helloa" + original.slice(removedEnd + 1));
      assert.equal(caret.getExpandedText(), "helloa " + survivor);
      assert.equal(caret.pasteCounter, 3);
      if (undo) {
        caret.handleInput("\x1f");
        assert.equal(caret.getText(), original);
        assert.deepEqual(caret.pastes, stored);
        assert.deepEqual([...caret.state.pasteSeparators], [1, 3]);
        assert.equal(caret.getExpandedText(), "hello " + first + second + "a " + survivor);
      }
    }
    caret.state.cursorCol = caret.getText().length;
    paste(caret, survivor);
    assert.equal(caret.getText(), "helloa " + survivor);
    caret.handleInput("\x1f");
    assert.deepEqual([...caret.state.pasteSeparators], [3]);
    paste(caret, second);
    assert.ok(caret.pastes.has(4), "new paste cannot collide with surviving ids");
    assert.equal(caret.getExpandedText(), "helloa " + survivor + second);
  }
});

test("repeat expands only its target while shared references retain payload and provenance through undo", () => {
  for (const prefix of ["", "/"]) {
    for (const separator of ["", "\n"]) {
      const caret = editor(), text = prefix + "x".repeat(1100);
      caret.setText("hello");
      paste(caret, text);
      const marker = caret.getText().slice(5), stored = caret.pastes.get(1);
      paste(caret, separator + marker);
      const collapsed = caret.getText(), cursor = caret.getCursor();
      const registry = new Map(caret.pastes), provenance = new Set(caret.state.pasteSeparators);
      const expected = "hello" + stored + separator + stored;
      assert.equal(caret.getExpandedText(), expected);
      paste(caret, text);
      assert.equal(caret.getText(), "hello" + marker + separator + stored);
      assert.equal(caret.getExpandedText(), expected);
      assert.deepEqual(caret.pastes, registry);
      assert.deepEqual(caret.state.pasteSeparators, provenance);
      caret.handleInput("\x1f");
      assert.equal(caret.getText(), collapsed);
      assert.equal(caret.getExpandedText(), expected);
      assert.deepEqual(caret.getCursor(), cursor);
      assert.deepEqual(caret.pastes, registry);
      assert.deepEqual(caret.state.pasteSeparators, provenance);
      assert.equal(caret.pasteCounter, 1);
      paste(caret, text);
      const submitted = [];
      caret.onSubmit = value => submitted.push(value);
      caret.submitValue();
      assert.deepEqual(submitted, [expected]);
    }
  }
});

test("deleting one reference retains a shared marker payload and separator provenance", () => {
  for (const key of ["\x7f", "\x1b[3~"]) {
    const caret = editor(), text = "/" + "x".repeat(1100);
    caret.setText("hello");
    paste(caret, text);
    const marker = caret.getText().slice(5);
    paste(caret, marker);
    caret.render(100);
    mouse(caret, "press", 7, 1, 100); mouse(caret, "drag", 7 + marker.length, 1, 100); mouse(caret, "release", 7 + marker.length, 1, 100);
    caret.handleInput(key);
    assert.equal(caret.getText(), "hello" + marker);
    assert.equal(caret.getExpandedText(), "hello " + text);
    assert.equal(caret.state.pasteSeparators.has(1), true);
    caret.state.cursorCol = caret.getText().length;
    paste(caret, text);
    assert.equal(caret.getText(), "hello " + text);
  }
});

test("a newline-only range is visible and deletes the line break", () => {
  const caret = editor();
  caret.setText("a\nb"); caret.render(30);
  mouse(caret, "press", 3, 1); mouse(caret, "drag", 2, 2); mouse(caret, "release", 2, 2);
  assert.match(caret.render(30)[1], /\x1b\[7m/);
  caret.handleInput("\x7f");
  assert.equal(caret.getText(), "ab");
});

// Exercise the renderer's actual press -> release -> synthesized click order.
const fullscreen = (caret, width = 40) => {
  const tui = new TuiAltScreen({ rows: 24, columns: width });
  tui.requestRender = () => {};
  const container = new Container();
  container.addChild(caret);
  tui.dispatchMouseToLayout = event => container.handleMouse(event);
  tui.handleScrollbarMouseEvent = () => false;
  tui.updateScrollbarHover = () => {};
  caret.tui = tui;
  return (x, y, { shift = false, release = false, drag = false } = {}) =>
    tui.handleMouseEvent({ x, y, button: (shift ? 4 : 0) | (drag ? 32 : 0), release });
};

test("native fullscreen dispatch preserves double/triple click, Shift-click and captured drag ranges", () => {
  const caret = editor(), copies = [];
  caret.copySelection = text => copies.push(text);
  caret.setText("hello world\nnext"); caret.render(40);
  const send = fullscreen(caret);
  const click = (x, y, options = {}) => { send(x, y, options); send(x, y, { ...options, release: true }); };
  click(9, 1);
  assert.equal(caret.selectionText(), "");
  click(9, 1);
  assert.equal(caret.selectionText(), "world");
  click(9, 1);
  assert.equal(caret.selectionText(), "hello world");
  click(4, 2, { shift: true });
  assert.equal(caret.selectionText(), "hello world\nne");
  send(2, 1); send(6, 1, { drag: true }); send(6, 1, { release: true });
  assert.equal(caret.selectionText(), "hell");
  assert.equal(caret.dragging, false);
  assert.ok(copies.includes("world"));
  caret.handleInput("X");
  assert.equal(caret.getText(), "Xo world\nnext");
  caret.handleInput("\x1f");
  assert.equal(caret.getText(), "hello world\nnext");
});

test("native double-click uses wrapped marker hit provenance rather than its snapped end", () => {
  for (const prefix of ["", "! ", "!! "]) {
    for (const suffix of ["", "tail", "marker"]) {
      for (const [x, y] of [[6, 2], [3, 3]]) {
        const caret = editor(), payload = "large\n".repeat(20), survivor = "other\n".repeat(20);
        caret.setText(prefix);
        paste(caret, payload);
        const markerEnd = caret.getText().length;
        if (suffix === "marker") paste(caret, survivor);
        else if (suffix) caret.handleInput(suffix);
        const original = caret.getText(), registry = new Map(caret.pastes), counter = caret.pasteCounter;
        caret.state.cursorCol = prefix.length;
        caret.render(12);
        const send = fullscreen(caret, 12);
        for (let count = 0; count < 2; count++) {
          send(x, y); send(x, y, { release: true });
        }
        assert.equal(caret.selectionText(), payload, `${prefix}/${suffix} at ${x},${y}`);
        assert.deepEqual(caret.selectionRange(), [{ line: 0, col: prefix.length }, { line: 0, col: markerEnd }]);
        const before = structuredClone({ state: caret.state, pastes: caret.pastes, counter: caret.pasteCounter });
        caret.handleInput("X");
        assert.equal(caret.getText(), prefix + "X" + original.slice(markerEnd));
        assert.equal(caret.getExpandedText(), prefix + "X" + (suffix === "marker" ? survivor : suffix));
        assert.equal(caret.pastes.has(1), false);
        if (suffix === "marker") assert.equal(caret.pastes.get(2), registry.get(2));
        caret.handleInput("\x1f");
        assert.deepEqual({ state: caret.state, pastes: caret.pastes, counter: caret.pasteCounter }, before);
        assert.equal(caret.getText(), original);
        assert.deepEqual(caret.pastes, registry);
        assert.equal(caret.pasteCounter, counter);
      }
    }
  }
});

test("native double-click at a marker end targets following text, another marker or blank space", () => {
  for (const suffix of ["", "tail", "marker"]) {
    const caret = editor(), payload = "large\n".repeat(20), survivor = "other\n".repeat(20);
    paste(caret, payload);
    const x = 2 + caret.getText().length;
    if (suffix === "marker") paste(caret, survivor);
    else if (suffix) caret.handleInput(suffix);
    caret.render(60);
    const send = fullscreen(caret, 60);
    for (let count = 0; count < 2; count++) {
      send(x, 1); send(x, 1, { release: true });
    }
    assert.equal(caret.selectionText(), suffix === "marker" ? survivor : suffix);
  }
});

test("selected Unicode and collapsed markers replace atomically without renumbering surviving registry ids", () => {
  for (const replacement of ["Z", "\x1b[90;1u", "\x1b[200~replacement\x1b[201~", "\x1b[200~" + "new\n".repeat(20) + "\x1b[201~"]) {
    const caret = editor();
    caret.setText("!! 界e\u0301😀 ");
    paste(caret, "first\n".repeat(20));
    const end = caret.getCursor();
    paste(caret, "survivor\n".repeat(20));
    const before = structuredClone({ state: caret.state, pastes: caret.pastes, counter: caret.pasteCounter });
    caret.selection = { anchor: { line: 0, col: 3 }, focus: end, text: caret.getText() };
    caret.handleInput(replacement);
    assert.ok(caret.getText().startsWith("!! "));
    assert.ok(caret.pastes.has(2));
    assert.equal(caret.pastes.has(1), false);
    assert.ok(!caret.getExpandedText().includes("first"));
    caret.handleInput("\x1f");
    assert.deepEqual({ state: caret.state, pastes: caret.pastes, counter: caret.pasteCounter }, before);
    caret.handleInput("\x1f");
    assert.equal(caret.pastes.has(2), false, "no intermediate deletion-only undo state");
  }
});

test("newline entrypoints replace a selected range in one undo", () => {
  for (const insert of [caret => caret.handleInput("\x1b[13;2u"), caret => caret.handleInput("\n"), caret => caret.addNewLine()]) {
    const caret = editor();
    caret.setText("abc def");
    caret.state.cursorCol = 3;
    caret.selection = { anchor: { line: 0, col: 0 }, focus: caret.getCursor(), text: caret.getText() };
    insert(caret);
    assert.equal(caret.getText(), "\n def");
    caret.handleInput("\x1f");
    assert.equal(caret.getText(), "abc def");
    caret.handleInput("\x1f");
    assert.equal(caret.getText(), "", "replacement has no deletion-only undo state");
  }
});

test("public insertion replaces selection while empty insertion is a no-op", () => {
  const caret = editor();
  caret.setText("abc def");
  caret.state.cursorCol = 3;
  caret.selection = { anchor: { line: 0, col: 0 }, focus: caret.getCursor(), text: caret.getText() };
  const selection = structuredClone(caret.selection);
  caret.insertTextAtCursor("");
  assert.equal(caret.getText(), "abc def");
  assert.deepEqual(caret.selection, selection);
  caret.insertTextAtCursor("X");
  assert.equal(caret.getText(), "X def");
  caret.handleInput("\x1f");
  assert.equal(caret.getText(), "abc def");
  caret.handleInput("\x1f");
  assert.equal(caret.getText(), "");
});

test("native clipboard shortcut retains selection until asynchronous public insertion", async () => {
  const caret = editor();
  caret.keybindings = { matches: (data, action) => action === "app.clipboard.pasteImage" ? data === "\x16" : keybindings.matches(data, action) };
  caret.setText("abc def");
  caret.state.cursorCol = 3;
  caret.selection = { anchor: { line: 0, col: 0 }, focus: caret.getCursor(), text: caret.getText() };
  let completion;
  caret.onPasteImage = () => { completion = Promise.resolve().then(() => caret.insertTextAtCursor("X")); };
  caret.handleInput("\x16");
  await completion;
  assert.equal(caret.getText(), "X def");
  caret.handleInput("\x1f");
  assert.equal(caret.getText(), "abc def");
});

test("newline and public insertion retire selected markers and undo restores registry and provenance", () => {
  for (const insert of [caret => caret.handleInput("\x1b[13;2u"), caret => caret.insertTextAtCursor("X")]) {
    const caret = editor();
    caret.setText("word");
    paste(caret, "/" + "x".repeat(1100));
    const end = caret.getCursor();
    paste(caret, "survivor\n".repeat(15));
    const before = structuredClone({ state: caret.state, pastes: caret.pastes, counter: caret.pasteCounter });
    caret.selection = { anchor: { line: 0, col: 4 }, focus: end, text: caret.getText() };
    insert(caret);
    assert.equal(caret.pastes.has(1), false);
    assert.equal(caret.state.pasteSeparators.has(1), false);
    assert.equal(caret.pastes.has(2), true);
    assert.equal(caret.getExpandedText(), "word" + (caret.getText().includes("X") ? "X" : "\n") + "survivor\n".repeat(15));
    caret.handleInput("\x1f");
    assert.deepEqual({ state: caret.state, pastes: caret.pastes, counter: caret.pasteCounter }, before);
    caret.handleInput("\x1f");
    assert.equal(caret.pastes.has(2), false);
  }
});

test("identical adjacent paste replaces a selected range instead of consuming it to expand", () => {
  for (const body of ["long\n".repeat(15), "/" + "x".repeat(1100)]) {
    const caret = editor();
    caret.setText("word");
    paste(caret, body);
    const start = caret.getCursor();
    caret.handleInput("abc");
    const before = structuredClone({ state: caret.state, pastes: caret.pastes, counter: caret.pasteCounter });
    caret.selection = { anchor: start, focus: caret.getCursor(), text: caret.getText() };
    paste(caret, body);
    const expected = "word" + (body.startsWith("/") ? " " : "") + body + body;
    assert.equal(caret.getExpandedText(), expected);
    assert.equal(caret.pastes.size, 2);
    assert.equal(caret.state.pasteSeparators.has(1), body.startsWith("/"));
    assert.equal(caret.state.pasteSeparators.has(2), false);
    caret.handleInput("\x1f");
    assert.deepEqual({ state: caret.state, pastes: caret.pastes, counter: caret.pasteCounter }, before);
    caret.handleInput("\x1f");
    assert.equal(caret.getExpandedText(), expected.slice(0, -body.length));
  }
});

test("chunked paste retains the range until native paste completion", () => {
  const caret = editor();
  caret.setText("abcdef"); caret.render(30);
  mouse(caret, "press", 3, 1); mouse(caret, "drag", 6, 1); mouse(caret, "release", 6, 1);
  caret.handleInput("\x1b[200~new");
  assert.equal(caret.getText(), "abcdef");
  caret.handleInput(" text\x1b[201~");
  assert.equal(caret.getText(), "anew textef");
  caret.handleInput("\x1f");
  assert.equal(caret.getText(), "abcdef");
});

test("multi-click treats a wrapped paste marker atomically and selects a logical rather than visual line", () => {
  const caret = editor();
  paste(caret, "large\n".repeat(20));
  const marker = caret.getText();
  caret.state.cursorCol = 0; caret.render(12);
  const click = count => caret.handleMouse({ type: "click", button: "left", clickCount: count, x: 3, y: 1, width: 12 });
  click(2);
  assert.equal(caret.selectionText(), "large\n".repeat(20));
  caret.setText("!! abcdefghijklmnop\nnext"); caret.state.cursorLine = 0; caret.state.cursorCol = 3; caret.render(12);
  click(3);
  assert.equal(caret.selectionText(), "abcdefghijklmnop");
  assert.ok(marker.startsWith("[paste #"));
});

test("edge drag scrolls both ways and stops on release, draft replacement, keyboard cancellation, focus loss and disposal", async () => {
  for (const stop of [caret => mouse(caret, "release", 4, 99), caret => caret.setText("draft"), caret => caret.handleInput("\x1b[D"), caret => { caret.focused = false; }, caret => caret.dispose()]) {
    const caret = editor();
    caret.focused = true;
    caret.setText(Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n"));
    caret.state.cursorLine = 15; caret.state.cursorCol = 0; caret.render(30);
    const initial = caret.scrollOffset;
    mouse(caret, "press", 2, 2); mouse(caret, "drag", 4, 0);
    await new Promise(resolve => setTimeout(resolve, 140));
    assert.ok(caret.scrollOffset < initial);
    mouse(caret, "drag", 4, 99);
    const upper = caret.scrollOffset;
    await new Promise(resolve => setTimeout(resolve, 140));
    assert.ok(caret.scrollOffset > upper);
    stop(caret);
    await Promise.resolve();
    assert.equal(caret.dragTimer, undefined);
    const cursor = caret.getCursor();
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.deepEqual(caret.getCursor(), cursor);
    assert.equal(caret.dragging, false);
  }
});

test("native fullscreen focusout cancels edge scrolling on its next tick without mutation", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const caret = editor();
  caret.setText(Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n"));
  caret.state.cursorLine = 15; caret.state.cursorCol = 0; caret.render(40);
  const send = fullscreen(caret);
  send(2, 2); send(4, 0, { drag: true });
  await Promise.resolve();
  assert.equal(caret.tui.mouseCapture.component, caret);
  t.mock.timers.tick(60);
  assert.ok(caret.dragTimer, "the captured drag continues scrolling");
  const before = structuredClone({ cursor: caret.getCursor(), selection: caret.selection, offset: caret.scrollOffset, text: caret.getText() });
  assert.deepEqual(caret.tui.handleViewportInput("\x1b[O"), { consume: true });
  assert.equal(caret.tui.mouseCapture, undefined);
  t.mock.timers.tick(60);
  assert.equal(caret.dragTimer, undefined);
  assert.equal(caret.dragging, false);
  assert.equal(caret.dragEvent, undefined);
  t.mock.timers.tick(600);
  assert.deepEqual({ cursor: caret.getCursor(), selection: caret.selection, offset: caret.scrollOffset, text: caret.getText() }, before);
});

test("Ctrl+B backgrounds a live ! and agent bash calls, and is cursor-left otherwise", () => {
  const kb = { matches: (key, action) => action === "tui.editor.cursorLeft" && ["\x1b[D", "\x02"].includes(key) };
  let running = false, live = 0;
  const moved = [];
  const shell = { submit: () => false, abortable: () => false, running: () => running, background: () => moved.push("shell") };
  const agentBash = { live: () => live, detachAll: () => moved.push("agent") };
  const caret = new CaretEditor({ terminal: { rows: 24 }, requestRender() {} }, theme, kb, { palette, shell, agentBash });
  caret.setText("abc");
  caret.handleInput("\x02");
  assert.equal(caret.getCursor().col, 2, "nothing to background: the native alias moves the cursor");
  assert.deepEqual(moved, []);
  for ([running, live] of [[true, 0], [false, 1], [true, 2]]) {
    moved.length = 0;
    caret.handleInput("\x02");
    assert.equal(caret.getCursor().col, 2, "consumed, not a cursor move");
    assert.deepEqual(moved, ["shell", "agent"]);
  }
});
