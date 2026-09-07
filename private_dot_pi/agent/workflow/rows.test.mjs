import test from "node:test";
import assert from "node:assert/strict";
import { answerLines, bodyLines, bulletMarkdown, callTitle, createTurnClock, formatDuration, formatTurn, glyph, resultSuffix, toolRenderers } from "./rows.mjs";

const theme = { fg: (color, text) => `<${color}>${text}`, bold: text => text };
const result = (text, details) => ({ content: [{ type: "text", text }], details });

test("row titles name the action and the target", () => {
  assert.equal(callTitle("bash", { command: "git status\n# trailing" }), "Ran git status");
  assert.equal(callTitle("read", { path: "a.mjs", offset: 40 }), "Read a.mjs:40");
  assert.equal(callTitle("grep", { pattern: "paddingX", path: "src" }), 'Search "paddingX" in src');
  assert.equal(callTitle("ls", {}), "List .");
});

test("glyph colour follows the row state", () => {
  assert.equal(glyph(theme, { isPartial: true, isError: false }), "•");
  assert.equal(glyph(theme, { isPartial: false, isError: false }), "<success>•");
  assert.equal(glyph(theme, { isPartial: false, isError: true }), "<error>•");
});

test("collapsed suffixes summarise edits, matches and entries", () => {
  assert.equal(resultSuffix("edit", result("ok", { diff: "-  1 old\n+  1 new\n+  2 more\n   3 same" })), "+2 −1");
  assert.equal(resultSuffix("grep", result("a.mjs:3: x\na.mjs-4- y\nb.mjs:9: z")), "(2 matches)");
  assert.equal(resultSuffix("find", result("a\nb\nc")), "(3 entries)");
  assert.equal(resultSuffix("find", result("No files found")), "");
  assert.equal(resultSuffix("bash", result("out")), "");
  assert.equal(resultSuffix("edit", result("failed"), true), "");
});

test("shell bodies keep head and tail until expanded; other tools show nothing collapsed", () => {
  const lines = Array.from({ length: 9 }, (_, i) => `l${i + 1}`).join("\n");
  assert.deepEqual(bodyLines("bash", result(lines)), ["l1", "l2", { hidden: 5 }, "l8", "l9"]);
  assert.deepEqual(bodyLines("bash", result("l1\nl2\nl3")), ["l1", "l2", "l3"]);
  assert.equal(bodyLines("bash", result(lines), { expanded: true }).length, 9);
  assert.deepEqual(bodyLines("read", result(lines)), []);
  assert.equal(bodyLines("read", result(lines), { expanded: true }).length, 9);
  assert.deepEqual(bodyLines("bash", result("boom\n\nCommand exited with code 1"), { isError: true }), ["boom", "Command exited with code 1"]);
});

test("the result suffix reaches the title through one deferred re-render", async () => {
  const renderers = toolRenderers("edit");
  const state = {};
  let invalidated = 0;
  const context = { state, isPartial: false, isError: false, invalidate: () => invalidated++ };
  renderers.renderResult(result("ok", { diff: "+  1 a" }), { expanded: false }, theme, context);
  renderers.renderResult(result("ok", { diff: "+  1 a" }), { expanded: false }, theme, context);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(invalidated, 1);
  assert.match(renderers.renderCall({ path: "f" }, theme, context).render(80)[0].trimEnd(), /Edited f<muted> \+1 −0$/);
});

test("assistant bullets keep block syntax intact", () => {
  assert.equal(bulletMarkdown("Done.", { messageType: "assistant" }), "• Done.");
  assert.equal(bulletMarkdown("# Title\nbody", { messageType: "assistant" }), "•\n\n# Title\nbody");
  assert.equal(bulletMarkdown("plain", { messageType: "user" }), "plain");
  assert.equal(bulletMarkdown("  ", { messageType: "assistant" }), "  ");
});

test("answers and turn lines format", () => {
  assert.deepEqual(answerLines([{ question: "Pad both sides?", answer: "yes" }], theme), [
    "<success>• <toolTitle>User answered pi's question",
    "  <muted>↳ Pad both sides? <muted>→ yes",
  ]);
  assert.equal(formatDuration(512_000), "8m 32s");
  assert.equal(formatDuration(45_000), "45s");
  assert.equal(formatDuration(3_720_000), "1h 02m");
  assert.match(formatTurn({ verb: "Integrated", ms: 512_000, endedAt: Date.UTC(2026, 8, 7, 10, 50) }, theme), /^<accent>π <muted>Integrated for 8m 32s · done \d{1,2}:\d{2} [ap]m$/);
});

test("the turn clock draws one verb per turn and ignores nested starts", () => {
  const clock = createTurnClock([["Iterating", "Iterated"]], () => 0);
  assert.equal(clock.label(), "");
  clock.start(1000);
  clock.start(5000);
  assert.equal(clock.label(13_000), "π Iterating… 12s");
  assert.deepEqual(clock.stop(61_000), { verb: "Iterated", ms: 60_000, endedAt: 61_000 });
  assert.equal(clock.stop(), null);
});
