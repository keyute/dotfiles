import test from "node:test";
import assert from "node:assert/strict";
import { addFold, answerLines, bodyLines, bulletMarkdown, callTitle, closeFolds, createFolds, createTurnClock, formatDuration, formatTurn, glyph, installFolding, resultSummary, summarise, toolRenderers } from "./rows.mjs";

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

test("the summary line says what the result was", () => {
  assert.equal(resultSummary("edit", result("ok", { diff: "-  1 old\n+  1 new\n+  2 more\n   3 same" })), "+2 −1");
  assert.equal(resultSummary("grep", result("a.mjs:3: x\na.mjs-4- y\nb.mjs:9: z")), "2 matches");
  assert.equal(resultSummary("grep", result("No matches found")), "0 matches");
  assert.equal(resultSummary("find", result("a\nb\nc")), "3 entries");
  assert.equal(resultSummary("find", result("No files found")), "");
  assert.equal(resultSummary("bash", result("one\ntwo")), "2 lines");
  assert.equal(resultSummary("bash", result("")), "");
});

test("bodies show nothing until expanded; errors show in full", () => {
  const lines = Array.from({ length: 9 }, (_, i) => `l${i + 1}`).join("\n");
  assert.deepEqual(bodyLines("bash", result(lines)), []);
  assert.equal(bodyLines("bash", result(lines), { expanded: true }).length, 9);
  assert.deepEqual(bodyLines("write", result("wrote"), { expanded: true }), []);
  assert.deepEqual(bodyLines("bash", result("boom\n\nCommand exited with code 1"), { isError: true }), ["boom", "Command exited with code 1"]);
});

test("a row is a title and one ↳ line", () => {
  const renderers = toolRenderers("edit", createFolds());
  const context = { toolCallId: "c1", isPartial: false, isError: false, expanded: false, invalidate() {} };
  assert.match(renderers.renderCall({ path: "f" }, theme, context).render(80)[0], /^<success>• <toolTitle>Edited f/);
  assert.deepEqual(renderers.renderResult(result("ok", { diff: "+  1 a" }), { expanded: false }, theme, context).render(80).map(l => l.trimEnd()), ["  <muted>↳ +1 −0"]);
});

test("folded rows render nothing and the last row carries the summary; ctrl+o unfolds", () => {
  const folds = createFolds();
  const rows = [["read", "a"], ["read", "b"], ["bash", "c"]].map(([tool, id]) => ({ tool, id, renderers: toolRenderers(tool, folds), invalidated: 0 }));
  const contextFor = (row, expanded = false) => ({ toolCallId: row.id, isPartial: false, isError: false, expanded, invalidate: () => row.invalidated++ });
  for (const row of rows) {
    row.renderers.renderCall({}, theme, contextFor(row)); // first render precedes registration
    addFold(folds, row.id, row.tool);
  }
  closeFolds(folds);
  assert.deepEqual(rows.map(row => row.invalidated), [1, 1, 1]);
  assert.deepEqual(rows[0].renderers.renderCall({}, theme, contextFor(rows[0])).render(80), []);
  assert.deepEqual(rows[0].renderers.renderResult(result("x"), { expanded: false }, theme, contextFor(rows[0])).render(80), []);
  assert.deepEqual(rows[2].renderers.renderCall({}, theme, contextFor(rows[2])).render(80).map(l => l.trimEnd()), ["<muted>Read 2 files, ran 1 shell command"]);
  assert.match(rows[0].renderers.renderCall({ path: "a" }, theme, contextFor(rows[0], true)).render(80)[0], /Read a/);
  closeFolds(folds); // nothing open: no re-invalidation
  assert.deepEqual(rows.map(row => row.invalidated), [1, 1, 1]);
  addFold(folds, "d", "grep");
  assert.equal(folds.byId.get("d").collapsed, false);
  assert.equal(folds.byId.get("a").collapsed, true);
});

test("summary wording", () => {
  assert.equal(summarise({ read: 3, bash: 9, grep: 1, edit: 2, list: 1 }), "Read 3 files, ran 9 shell commands, searched for 1 pattern, edited 2 files, listed 1 path");
  assert.equal(summarise({ write: 1 }), "Wrote 1 file");
  assert.equal(summarise({}), "");
});

test("folding closes on the first non-empty assistant text, streaming or not", () => {
  const folds = createFolds();
  const handlers = {};
  installFolding({ on: (name, fn) => { handlers[name] = fn; } }, folds);
  handlers.tool_execution_start({ toolName: "workspace_read", toolCallId: "r1" });
  handlers.tool_execution_start({ toolName: "subagent", toolCallId: "s1" });
  handlers.message_update({ message: { role: "assistant", content: [{ type: "thinking", thinking: "hm" }, { type: "text", text: " " }] } });
  handlers.message_update({ message: { role: "user", content: [{ type: "text", text: "hi" }] } });
  assert.equal(folds.byId.get("r1").collapsed, false);
  assert.equal(folds.byId.has("s1"), false);
  handlers.message_update({ message: { role: "assistant", content: [{ type: "text", text: "Done" }] } });
  assert.equal(folds.byId.get("r1").collapsed, true);
  handlers.tool_execution_start({ toolName: "workspace_bash", toolCallId: "b1" });
  handlers.message_end({ message: { role: "assistant", content: [{ type: "text", text: "Ok" }] } });
  assert.equal(folds.byId.get("b1").collapsed, true);
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
  assert.equal(formatTurn({ verb: "Integrated", ms: 214_000, endedAt: 0, aborted: true }, theme), "<accent>π <muted>Interrupted after 3m 34s");
});

test("the turn clock draws one verb per turn and ignores nested starts", () => {
  const clock = createTurnClock([["Iterating", "Iterated"]], () => 0);
  assert.equal(clock.label(), "");
  assert.equal(clock.running(), false);
  clock.start(1000);
  clock.start(5000);
  assert.equal(clock.running(), true);
  assert.equal(clock.label(13_000), "Iterating… 12s");
  assert.deepEqual(clock.stop(61_000), { verb: "Iterated", ms: 60_000, endedAt: 61_000, aborted: false });
  assert.equal(clock.stop(), null);
  clock.start(0);
  assert.equal(clock.stop(1000, { aborted: true }).aborted, true);
});

test("a failed row stays visible inside a fold, with the summary when it is the last row", () => {
  const folds = createFolds();
  const renderers = toolRenderers("bash", folds);
  const context = { toolCallId: "e1", isPartial: false, isError: true, expanded: false, invalidate() {} };
  renderers.renderCall({ command: "false" }, theme, context);
  addFold(folds, "e1", "bash");
  closeFolds(folds);
  assert.deepEqual(renderers.renderCall({ command: "false" }, theme, context).render(80).map(l => l.trimEnd()), ["<muted>Ran 1 shell command", "<error>• <toolTitle>Ran false"]);
  assert.deepEqual(renderers.renderResult(result("boom"), { expanded: false }, theme, context).render(80).map(l => l.trimEnd()), ["  <error>boom"]);
});
