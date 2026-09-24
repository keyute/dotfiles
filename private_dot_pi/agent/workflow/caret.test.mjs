import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Theme } from "@earendil-works/pi-coding-agent";
import { CombinedAutocompleteProvider, CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { CaretEditor, argumentCompletions } from "./index.mjs";

const keybindings = { matches: (data, id) => ({ "app.interrupt": "\x1b", "tui.editor.cursorUp": "\x1b[A", "tui.editor.cursorDown": "\x1b[B", "tui.editor.cursorLineStart": "\x01", "tui.editor.deleteCharBackward": "\x7f", "tui.select.down": "\x1b[B", "tui.select.up": "\x1b[A", "tui.select.confirm": "\r", "tui.select.cancel": "\x1b", "tui.input.submit": "\r", "app.message.followUp": "\x1b\r", "tui.input.tab": "\t" })[id] === data };
// The host hands the editor factory an EditorTheme; the full palette arrives
// separately, so the mocks stay split or the test stops matching the runtime.
const editorTheme = { borderColor: text => `<border>${text}`, selectList: { selectedText: text => text, unselectedText: text => text, description: text => text, noMatch: text => text, scrollInfo: text => text } };
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

test("the working status is not embedded: the top shaded row is blank, or the scroll count", () => {
  const caret = editor();
  // pi hands the indicator to the editor only when it asks for it; the row
  // above the composer is the footer's own (docs/pi-design.md rule 3).
  assert.equal(caret.embedWorkingStatus, false);
  assert.equal(caret.render(40)[0], `${BG}${" ".repeat(40)}\x1b[49m`);
  assert.equal(caret.renderTopBorder(40, 3), `${BG}${"  ↑ 3 more".padEnd(40)}\x1b[49m`);
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

test("the prompt glyph becomes a red shell marker while the text is in ! mode", () => {
  const caret = editor();
  caret.setText("!ls");
  assert.match(caret.render(40)[1], /<error>! /);
  caret.setText("ls");
  assert.ok(caret.render(40)[1].startsWith(`${BG}<accent>❯ `));
});

test("leading ! is a shell composer mode without becoming command text", () => {
  const caret = editor();
  caret.handleInput("!");
  caret.handleInput("l");
  caret.handleInput("s");
  const rendered = caret.render(40)[1];
  assert.match(rendered, /<error>! /);
  assert.doesNotMatch(rendered, />!ls/);
  assert.match(rendered, /<userMessageText>/);
  assert.match(rendered.replace(/<\w+>/g, ""), /! ls/);
  assert.equal(caret.getText(), "!ls");
});

test("a configured shell intercepts ! input: submits, records history, clears the text, and never reaches native onSubmit", () => {
  const submitted = [];
  const shell = { submit: text => { submitted.push(text); return true; }, abortable: () => false, abort() {} };
  const caret = editor({ shell });
  const native = [];
  caret.onSubmit = text => native.push(text);
  caret.setText("!ls");
  caret.handleInput("\r");
  assert.deepEqual(submitted, ["!ls"]);
  assert.deepEqual(native, []);
  assert.equal(caret.getText(), "");
  caret.handleInput("\x1b[A");
  assert.equal(caret.getText(), "!ls", "addToHistory ran, so Up recalls the submitted command");
});

test("a runner that declines the input (plain text, or ! alone) still reaches native onSubmit", () => {
  const shell = { submit: () => false, abortable: () => false, abort() {} };
  const caret = editor({ shell });
  const native = [];
  caret.onSubmit = text => native.push(text);
  caret.setText("hello");
  caret.handleInput("\r");
  assert.deepEqual(native, ["hello"]);
});

test("streaming Alt+Enter submits a shell command instead of queueing it as a native follow-up", () => {
  const submitted = [];
  const caret = editor({ shell: { submit: text => { submitted.push(text); return true; }, abortable: () => false } });
  const followUps = [];
  caret.actionHandlers.set("app.message.followUp", () => followUps.push(caret.getText()));
  caret.onSubmit = () => { throw new Error("must not reach native submit"); };
  caret.setText("!echo streaming");
  caret.handleInput("\x1b\r");
  assert.deepEqual(submitted, ["!echo streaming"]);
  assert.deepEqual(followUps, []);
  assert.equal(caret.getText(), "");
  caret.handleInput("\x1b[A");
  assert.equal(caret.getText(), "!echo streaming");
});

test("Alt+Enter submits expanded pasted shell text and cancels an open completion menu", async () => {
  for (const prefix of ["!", "!!"]) {
    const submitted = [];
    const followUps = [];
    const caret = editor({ shell: { submit: text => { submitted.push(text); return true; }, abortable: () => false } });
    caret.actionHandlers.set("app.message.followUp", () => followUps.push(caret.getText()));
    caret.setAutocompleteProvider({
      getSuggestions: async () => ({ items: [{ value: "one", label: "one" }, { value: "two", label: "two" }], prefix: "" }),
      applyCompletion() { throw new Error("completion must not be accepted"); },
    });
    caret.setText(prefix);
    const command = "echo pasted\n".repeat(15);
    caret.handleInput(`\x1b[200~${command}\x1b[201~`);
    assert.equal(caret.getExpandedText(), prefix + command);
    caret.handleInput("\t");
    await settle();
    assert.equal(caret.isShowingAutocomplete(), true);
    caret.handleInput("\x1b\r");
    assert.deepEqual(submitted, [(prefix + command).trim()]);
    assert.deepEqual(followUps, []);
    assert.equal(caret.getText(), "");
    assert.equal(caret.isShowingAutocomplete(), false);
  }
});

test("Alt+Enter preserves busy shell text and leaves non-shell follow-ups native", () => {
  const submitted = [];
  const followUps = [];
  const caret = editor({ shell: { submit: text => { submitted.push(text); return "busy"; }, abortable: () => false } });
  caret.actionHandlers.set("app.message.followUp", () => followUps.push(caret.getText()));
  caret.setText("!!echo busy");
  caret.handleInput("\x1b\r");
  assert.deepEqual(submitted, ["!!echo busy"]);
  assert.equal(caret.getText(), "!!echo busy");
  for (const text of ["plain follow-up", "!"]) {
    caret.setText(text);
    caret.handleInput("\x1b\r");
  }
  assert.deepEqual(followUps, ["plain follow-up", "!"]);
});

test("a busy runner keeps the composer text instead of clearing it", () => {
  const shell = { submit: () => "busy", abortable: () => false, abort() {} };
  const caret = editor({ shell });
  caret.onSubmit = () => { throw new Error("must not reach native submit"); };
  caret.setText("!ls");
  caret.handleInput("\r");
  assert.equal(caret.getText(), "!ls");
});

test("Esc with a running, abortable shell command aborts it instead of falling through", () => {
  let aborted = false;
  const shell = { submit: () => false, abortable: () => true, abort: () => { aborted = true; } };
  const caret = editor({ shell });
  let escaped = false;
  caret.onEscape = () => { escaped = true; };
  caret.handleInput("\x1b");
  assert.ok(aborted);
  assert.ok(!escaped, "native escape handling did not also run");
});

test("Esc with nothing abortable falls through to native handling", () => {
  const shell = { submit: () => false, abortable: () => false, abort() { throw new Error("must not be called"); } };
  const caret = editor({ shell });
  let escaped = false;
  caret.onEscape = () => { escaped = true; };
  caret.handleInput("\x1b");
  assert.ok(escaped);
});

test("Esc with autocomplete open falls through instead of aborting", () => {
  const shell = { submit: () => false, abortable: () => true, abort() { throw new Error("must not be called"); } };
  const caret = editor({ shell });
  caret.isShowingAutocomplete = () => true;
  // pi's own handling of Escape over an open menu cancels the menu, not
  // onEscape; the only thing this checks is that the shell intercept yields.
  assert.doesNotThrow(() => caret.handleInput("\x1b"));
});

test("Esc with the fleet focused falls through instead of aborting the shell", () => {
  const fleet = { focused: () => true, handleKey: () => false };
  const shell = { submit: () => false, abortable: () => true, abort() { throw new Error("must not be called"); } };
  const caret = editor({ fleet, shell });
  assert.doesNotThrow(() => caret.handleInput("\x1b"));
});

test("ctrl+c never aborts the shell, only plain Escape does", () => {
  const shell = { submit: () => false, abortable: () => true, abort() { throw new Error("must not be called"); } };
  // A real keybindings config carries ctrl+c on tui.select.cancel alongside
  // pi's own Escape on app.interrupt; only the latter reaches this editor's
  // abort check, so a fixture where they are distinct bytes has to prove it.
  const ctrlC = "\x03";
  const kb = { matches: (data, id) => (id === "tui.select.cancel" && data === ctrlC) };
  const caret = new CaretEditor({ terminal: { rows: 24 }, requestRender: () => {} }, editorTheme, kb, { palette, shell });
  assert.doesNotThrow(() => caret.handleInput(ctrlC));
});

test("shell mode leaves native submission, history text, and backspace semantics intact", () => {
  const caret = editor();
  const changes = [];
  const submitted = [];
  caret.onChange = text => changes.push(text);
  caret.onSubmit = text => submitted.push(text);
  caret.setText("!!pwd");
  assert.equal(caret.getText(), "!!pwd");
  assert.doesNotMatch(caret.render(40)[1], /!pwd/);
  caret.handleInput("\r");
  assert.deepEqual(submitted, ["!!pwd"]);
  assert.equal(changes.at(-1), "");
  caret.setText("!ls");
  caret.handleInput("\x1b[D");
  caret.handleInput("\x1b[D");
  caret.handleInput("\x7f");
  assert.equal(caret.getText(), "ls");
  assert.match(caret.render(40)[1], /<accent>❯ /);
  caret.setText("say !later");
  assert.match(caret.render(40)[1], /<accent>❯ /);
});

test("shell prefixes consume no layout columns, including wrapping, scrolling and the native cursor", () => {
  const plain = { fg: (_color, text) => text, bg: (_color, text) => text };
  for (const prefix of ["!", "!!"]) {
    for (const width of [8, 14, 40]) {
      const command = "界abcdef ghijkl mnopqrstuvwxyz\nsecond line";
      const regular = editor({ palette: plain });
      const shell = editor({ palette: plain });
      regular.focused = shell.focused = true;
      regular.setText(command);
      shell.setText(prefix + command);
      const draw = caret => caret.render(width).map(row => row.replace(/^[!❯]/, ">"));
      assert.deepEqual(draw(shell), draw(regular));
      for (const key of ["\x1b[A", "\x01", "\x1b[D", "\x1b[B", "\x1b[A"]) {
        regular.handleInput(key);
        shell.handleInput(key);
        assert.deepEqual(draw(shell), draw(regular), `${prefix} width ${width}, key ${JSON.stringify(key)}`);
      }
      assert.ok(draw(shell).some(row => row.includes(CURSOR_MARKER)));
      assert.ok(draw(shell).every(row => visibleWidth(row) === width));
    }
  }
});

test("Home and Backspace exit either shell prefix without deleting the command", () => {
  const caret = editor();
  for (const prefix of ["!", "!!"]) {
    caret.setText(`${prefix}pwd`);
    caret.handleInput("\x01");
    caret.handleInput("\x7f");
    assert.equal(caret.getText(), "pwd");
    caret.handleInput("\x1f");
    assert.equal(caret.getText(), `${prefix}pwd`, "native undo restores shell mode");
  }
});

test("history, paste expansion, external-editor text and clear retain native shell semantics", () => {
  const caret = editor();
  caret.addToHistory("!!pwd");
  caret.handleInput("\x1b[A");
  assert.equal(caret.getText(), "!!pwd");
  caret.setText("!");
  const command = "printf test\n".repeat(15);
  caret.handleInput(`\x1b[200~${command}\x1b[201~`);
  assert.equal(caret.getExpandedText(), "!" + command);
  let submitted;
  caret.onSubmit = text => { submitted = text; };
  caret.handleInput("\r");
  assert.equal(submitted, ("!" + command).trim());
  assert.equal(caret.getText(), "");
  caret.setText("!!echo restored");
  assert.equal(caret.getExpandedText(), "!!echo restored");
  caret.onEscape = () => caret.setText("");
  caret.handleInput("\x1b");
  assert.equal(caret.shellMode(), false);
});

test("Up at the visible shell-command start recalls history and Down restores its draft", () => {
  const caret = editor();
  caret.addToHistory("!!older");
  caret.setText("!current");
  caret.handleInput("\x01");
  caret.handleInput("\x1b[A");
  assert.equal(caret.getText(), "!!older");
  caret.handleInput("\x1b[B");
  assert.equal(caret.getText(), "!current");
});

test("both Catppuccin variants tint the whole shell box and keep command text readable after a theme switch", () => {
  const caret = editor();
  caret.setText("!echo hi");
  for (const name of ["mocha", "latte"]) {
    const { colors } = JSON.parse(readFileSync(new URL(`../../../node_modules/catppuccin-pi-theme/themes/catppuccin-${name}.json`, import.meta.url), "utf8"));
    const theme = new Theme(colors, colors, "truecolor");
    caret.palette = theme;
    caret.invalidate();
    const rows = caret.render(40);
    assert.ok(rows.every(row => row.startsWith(theme.getBgAnsi("toolErrorBg"))));
    assert.ok(rows[1].includes(theme.fg("error", "! ")));
    assert.ok(rows[1].includes(theme.getFgAnsi("userMessageText") + "echo hi"));
    assert.ok(rows.every(row => visibleWidth(row) === 40));
  }
});

test("shell-mode command text keeps its colour after the cursor's reset mid-command", () => {
  const caret = editor();
  caret.setText("!echo hi");
  caret.handleInput("\x1b[D");
  caret.handleInput("\x1b[D");
  const { colors } = JSON.parse(readFileSync(new URL("../../../node_modules/catppuccin-pi-theme/themes/catppuccin-mocha.json", import.meta.url), "utf8"));
  const theme = new Theme(colors, colors, "truecolor");
  caret.palette = theme;
  caret.invalidate();
  const row = caret.render(40)[1];
  assert.ok(row.includes(`\x1b[0m${theme.getBgAnsi("toolErrorBg")}${theme.getFgAnsi("userMessageText")}i`), row);
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

// The real provider, so the command lookup, the prefix it returns and the
// insertion its applyCompletion performs are pi's own.
const dirs = { "": ["../one/", "../two/"], "../one/": ["../one/", "../one/a/", "../one/b/"], "../one/a/": ["../one/a/", "../one/a/child/"], "../two/": ["../two/only/"], "~/": ["~/p/", "~/q/"] };
const commands = [
  { name: "add-dir", description: "Add a directory", getArgumentCompletions: prefix => (dirs[prefix] ?? []).map(value => ({ value, label: value })) },
  { name: "remove-dir", description: "Remove a directory", getArgumentCompletions: prefix => ["/tmp/added", "/tmp/other"].filter(root => root.startsWith(prefix)).map(value => ({ value, label: value })) },
  { name: "new", description: "Start a new session" },
];
const completing = () => {
  const caret = editor();
  caret.setAutocompleteProvider(argumentCompletions(new CombinedAutocompleteProvider(commands, process.cwd())));
  return caret;
};
// The request runs off the keystroke, and a re-issued tab queues behind the one
// before it.
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
// One chunk, as a terminal sends an encoded key.
const keys = async (caret, data) => { caret.handleInput(data); await settle(); };
const tab = caret => keys(caret, "\t");
const type = async (caret, text) => { for (const char of text) caret.handleInput(char); await settle(); };
// The rows under the composer, without the highlight marker.
const menu = caret => caret.render(40).slice(3).map(line => line.replace(/\x1b\[[0-9;]*m/g, "").trim().replace(/^→ /, "")).filter(Boolean);

test("tab offers the command's own completions and, after accepting, the next level", async t => {
  const caret = completing();
  caret.setText("/add-d");
  await tab(caret);
  assert.deepEqual(menu(caret), ["add-dir"]);
  await tab(caret);
  assert.equal(caret.getText(), "/add-dir ");
  assert.deepEqual(menu(caret), ["../one/", "../two/"]);
  await tab(caret);
  assert.equal(caret.getText(), "/add-dir ../one/");
  assert.deepEqual(menu(caret), ["../one/", "../one/a/", "../one/b/"]);
});

test("accepting a value that is not a directory ends the walk", async () => {
  const caret = completing();
  caret.setText("/remove-dir /tmp");
  await tab(caret);
  assert.deepEqual(menu(caret), ["/tmp/added", "/tmp/other"]);
  await tab(caret);
  assert.equal(caret.getText(), "/remove-dir /tmp/added");
  assert.deepEqual(menu(caret), []);
});

test("a single candidate completes on the tab that asked for it", async () => {
  const caret = completing();
  caret.setText("/remove-dir /tmp/o");
  await tab(caret);
  assert.equal(caret.getText(), "/remove-dir /tmp/other");
  assert.deepEqual(menu(caret), []);
});

test("a command that takes no argument opens nothing, so accepting its name ends there", async () => {
  const caret = completing();
  caret.setText("/ne");
  await tab(caret);
  assert.deepEqual(menu(caret), ["new"]);
  // Accepting a name appends a space, which the walk's replay reads as an
  // argument position; the command declares no candidates, so nothing opens.
  await tab(caret);
  assert.equal(caret.getText(), "/new ");
  assert.deepEqual(menu(caret), []);
});

test("typing a path separator opens the argument menu pi leaves closed", async () => {
  const caret = completing();
  // pi asks on the letters, and `~` answers with nothing, which closes the menu.
  await type(caret, "/add-dir ~");
  assert.deepEqual(menu(caret), []);
  await type(caret, "/");
  assert.deepEqual(menu(caret), ["~/p/", "~/q/"]);
});

test("a separator outside a command's arguments opens nothing", async () => {
  const caret = completing();
  await type(caret, "see ~/one and / or ../two");
  assert.deepEqual(menu(caret), []);
});

test("a separator under an open menu is pi's own update, not a second request", async () => {
  let calls = 0;
  const caret = editor();
  const provider = argumentCompletions(new CombinedAutocompleteProvider(commands, process.cwd()));
  caret.setAutocompleteProvider({ ...provider, getSuggestions: (...args) => { calls++; return provider.getSuggestions(...args); } });
  await type(caret, "/add-dir");
  const asked = calls;
  await type(caret, " ");
  assert.deepEqual(menu(caret), ["../one/", "../two/"]);
  assert.equal(calls - asked, 1);
});

test("a separator reaches the menu through the character pi inserted, not the bytes that carried it", async () => {
  const caret = completing();
  await type(caret, "/add-dir ~");
  // kitty's encoding of "/", as one chunk: pi decodes it before inserting, so
  // matching the sequence would miss the keystroke entirely.
  await keys(caret, "\x1b[47;1u");
  assert.deepEqual(menu(caret), ["~/p/", "~/q/"]);
});

test("a slash command is the first line's, so a separator on a later line opens nothing", async () => {
  const caret = completing();
  await type(caret, "look at");
  await keys(caret, "\x1b\r"); // pi's newline
  await type(caret, "/add-dir ~/");
  assert.equal(caret.getLines().length, 2);
  assert.deepEqual(menu(caret), []);
});

test("moving the cursor across a separator is not typing one", async () => {
  const caret = completing();
  caret.setText("/add-dir ~/");
  await keys(caret, "\x1b[D"); // left, back over the "/"
  await keys(caret, "\x1b[C"); // right, across it again
  assert.deepEqual(menu(caret), []);
});

test("accepting an exact directory leaves its text and closes the menu", async () => {
  for (const accept of [async caret => keys(caret, "\r"), tab]) {
    const caret = completing();
    caret.setText("/add-dir ../one/");
    await tab(caret);
    assert.deepEqual(menu(caret), ["../one/", "../one/a/", "../one/b/"]);
    await accept(caret);
    assert.equal(caret.getText(), "/add-dir ../one/");
    assert.deepEqual(menu(caret), []);
  }
});

test("an accept shows the next level and stops there, even when that level holds one entry", async () => {
  const caret = completing();
  caret.setText("/add-dir ");
  await tab(caret);
  assert.deepEqual(menu(caret), ["../one/", "../two/"]);
  caret.handleInput("\x1b[B"); // highlight ../two/
  await tab(caret);
  assert.equal(caret.getText(), "/add-dir ../two/");
  assert.deepEqual(menu(caret), ["../two/only/"]);
});

test("accepting a child directory reopens at its next level", async () => {
  const caret = completing();
  caret.setText("/add-dir ../one/");
  await tab(caret);
  caret.handleInput("\x1b[B"); // highlight ../one/a/
  await tab(caret);
  assert.equal(caret.getText(), "/add-dir ../one/a/");
  assert.deepEqual(menu(caret), ["../one/a/", "../one/a/child/"]);
});
