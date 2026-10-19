import test from "node:test";
import assert from "node:assert/strict";
import { CURSOR_MARKER, renderFakeCursor } from "@earendil-works/pi-tui";
import { createUltrathink, highlightKeywords, highlightProse, saysUltracode, saysUltrathink } from "./keywords.mjs";

const palette = { fg: (color, text) => `<${color}>${text}</>` };

test("highlight accents whole keywords only, in any case", () => {
  assert.equal(highlightKeywords(palette, "ULTRACODE it, then ultrathink"), "<accent>ULTRACODE</> it, then <accent>ultrathink</>");
  assert.equal(highlightKeywords(palette, "ultracoder xultrathink"), "ultracoder xultrathink");
});

test("highlight takes sentence punctuation as a boundary but not URL or path neighbours", () => {
  assert.equal(highlightKeywords(palette, "please ultrathink. ultracode, now: ultrathink"), "please <accent>ultrathink</>. <accent>ultracode</>, now: <accent>ultrathink</>");
  for (const text of ["x.io/ultracode", "ultracode.dev", "https://ultracode", "ultrathink/x", "a-ultrathink", "ultrathink-b", "ultracode:8080", "ultracode@x.com", "me@ultracode", "?q=ultracode", "a&ultrathink", "#ultrathink"]) assert.equal(highlightKeywords(palette, text), text);
});

test("prose highlighting and the triggers skip code and links alike", () => {
  const skipped = ["```js\nconst ultrathink = 1;\n```", "~~~\nultrathink", "run `ultrathink` now", "see https://x.io/ultrathink", "see [ultrathink](https://x.io)", "see [x](https://x.io/ultrathink)", "see [ultrathink][a]", "[a]: https://x.io/ultrathink", "<https://x.io/ultrathink>", "intro\n\n    const ultrathink = 1;\n    ultrathink()"];
  for (const text of skipped) {
    assert.equal(highlightProse(palette, text), text);
    assert.equal(saysUltrathink(text), false, text);
  }
  assert.equal(highlightProse(palette, "`x` then ultrathink [y](z)"), "`x` then <accent>ultrathink</> [y](z)");
  assert.equal(highlightProse(undefined, "ultrathink"), "ultrathink");
  // A fence opener with a backtick later on its line is not a fence; a code span ends at a blank line.
  assert.equal(highlightProse(palette, "```x``` ultrathink"), "```x``` <accent>ultrathink</>");
  assert.equal(highlightProse(palette, "use `a\n\nnew ultrathink `b`"), "use `a\n\nnew <accent>ultrathink</> `b`");
  assert.ok(saysUltracode("```x``` ultracode") && saysUltracode("use `a\n\nnew para ultracode `b`") && saysUltracode("intro\n    ultracode"));
  assert.ok(saysUltrathink("```\nx\n```\nplease ultrathink.") && saysUltracode("ULTRACODE: run it"));
  assert.ok(!saysUltracode("ultracoder") && !saysUltracode("ultrathink"));
  // A global pattern's lastIndex would make a repeated call alternate.
  assert.ok(saysUltrathink("ultrathink") && saysUltrathink("ultrathink"));
});

test("highlight survives the cursor inside the word, and not past a word boundary", () => {
  const word = `ultra${CURSOR_MARKER}${renderFakeCursor("c")}ode`;
  assert.equal(highlightKeywords(palette, `${word} x`), `<accent>${word}</> x`);
  assert.equal(highlightKeywords(palette, `ultracode${CURSOR_MARKER}r`), `ultracode${CURSOR_MARKER}r`);
});

test("restore re-opens the foreground after the accent's reset", () => {
  const ansi = { fg: (color, text) => `\x1b[${color === "accent" ? 35 : 37}m${text}\x1b[39m` };
  assert.equal(highlightKeywords(ansi, "a ultrathink b", "userMessageText"), "a \x1b[35multrathink\x1b[39m\x1b[37m b");
});

test("ultrathink raises per message, restores on a message without it and at the end, and keeps a level the user set", () => {
  let level = "low";
  const pi = { getThinkingLevel: () => level, setThinkingLevel: next => { level = next === "max" ? "high" : next; } };
  const ultrathink = createUltrathink(pi);
  ultrathink.delivered("plain");
  assert.equal(level, "low");
  ultrathink.delivered("ULTRATHINK this");
  assert.equal(level, "high");
  ultrathink.delivered("ultrathink again");
  ultrathink.delivered("follow-up");
  assert.equal(level, "low");
  ultrathink.delivered("ultrathink");
  ultrathink.end();
  assert.equal(level, "low");
  ultrathink.delivered("ultrathink");
  level = "medium";
  ultrathink.end();
  assert.equal(level, "medium");
  ultrathink.end();
  assert.equal(level, "medium");
});
