import test from "node:test";
import assert from "node:assert/strict";
import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";
import { CaretEditor, argumentCompletions } from "./index.mjs";

const keybindings = { matches: (data, id) => ({ "tui.editor.cursorDown": "\x1b[B", "tui.select.down": "\x1b[B", "tui.select.up": "\x1b[A", "tui.select.confirm": "\r", "tui.select.cancel": "\x1b", "tui.input.tab": "\t" })[id] === data };
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
const dirs = { "": ["../one/", "../two/"], "../one/": ["../one/a/", "../one/b/"], "../two/": ["../two/only/"], "~/": ["~/p/", "~/q/"] };
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
  assert.deepEqual(menu(caret), ["../one/a/", "../one/b/"]);
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
