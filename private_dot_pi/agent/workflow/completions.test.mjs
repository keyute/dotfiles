import test from "node:test";
import assert from "node:assert/strict";
import { argumentCompletions } from "./index.mjs";

// The built-in provider, as far as the wrapper sees it: a forced request skips
// the slash branch and answers with file paths, an unforced one runs the
// command's own completions.
function base(commands) {
  const calls = [];
  return { calls, applyCompletion: (...args) => ({ applied: args }), shouldTriggerFileCompletion: () => "asked",
    getSuggestions(lines, cursorLine, cursorCol, options) {
      const text = (lines[cursorLine] ?? "").slice(0, cursorCol);
      calls.push({ text, force: options.force });
      if (options.force) return { items: [{ value: "notes.md", label: "notes.md" }], prefix: text.split(" ").at(-1) };
      const [, name, prefix] = text.match(/^\/(\S+) (.*)$/) ?? [];
      const items = commands[name]?.(prefix);
      return items?.length ? { items, prefix } : null;
    } };
}
const items = prefix => prefix.startsWith(".") ? [{ value: `${prefix}x/`, label: `${prefix}x/` }] : [];
const suggest = (provider, text, options = { force: true }) => provider.getSuggestions([text], 0, text.length, options);

test("a forced request in a command's arguments is asked again unforced, so the command's completions run", async () => {
  const current = base({ "add-dir": items });
  const wrapped = argumentCompletions(current);
  assert.deepEqual(await suggest(wrapped, "/add-dir ../pro"), { items: [{ value: "../prox/", label: "../prox/" }], prefix: "../pro" });
  assert.deepEqual(current.calls, [{ text: "/add-dir ../pro", force: false }]);
});

test("a command registered twice keeps its completions under the :N invocation suffix", async () => {
  const wrapped = argumentCompletions(base({ "add-dir:1": items }));
  assert.equal((await suggest(wrapped, "/add-dir:1 ../pro")).items[0].value, "../prox/");
});

test("a command that declares no candidates offers nothing, never a file path", async () => {
  const wrapped = argumentCompletions(base({ "add-dir": items }));
  assert.equal(await suggest(wrapped, "/add-dir nope"), null);
  // Typing "/new " and pressing Tab reaches this without any accept, which is
  // why the gate is here and not in the editor's replay.
  assert.equal(await suggest(wrapped, "/new "), null);
});

test("everything outside a forced request in a command's arguments is delegated untouched", async () => {
  const current = base({ "add-dir": items });
  const wrapped = argumentCompletions(current);
  await suggest(wrapped, "/add-dir ../pro", { force: false });
  await suggest(wrapped, "/add-d");
  await suggest(wrapped, "@../pro");
  assert.deepEqual(current.calls, [{ text: "/add-dir ../pro", force: false }, { text: "/add-d", force: true }, { text: "@../pro", force: true }]);
  assert.deepEqual(wrapped.applyCompletion(1, 2), { applied: [1, 2] });
  // Prose is not a command argument, so Tab forces nothing there.
  assert.equal(wrapped.shouldTriggerFileCompletion(["see ../pro"], 0, 10), false);
});

test("a command's argument is a forced request pi would otherwise refuse", () => {
  const wrapped = argumentCompletions(base({}));
  // "/add-dir " trims to a slash command, which pi refuses to force-complete.
  assert.equal(wrapped.shouldTriggerFileCompletion(["/add-dir "], 0, 9), true);
  assert.equal(wrapped.shouldTriggerFileCompletion(["/add-d"], 0, 6), false);
});

test("wrapping an already wrapped provider returns it, so /reload cannot stack copies", () => {
  const wrapped = argumentCompletions(base({}));
  assert.equal(argumentCompletions(wrapped), wrapped);
});
