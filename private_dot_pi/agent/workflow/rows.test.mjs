import test from "node:test";
import assert from "node:assert/strict";
import { Markdown } from "@earendil-works/pi-tui";
import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { addFold, answerLines, bodyLines, bulletMarkdown, callTitle, closeFolds, completionLine, createFolds, createTurnClock, formatDuration, formatTurn, glyph, installFolding, pluginRenderers, pluginTitle, resultSummary, summarise, toolRenderers } from "./rows.mjs";

// keyHint and the markdown theme read pi's theme; the default one is enough.
initTheme();

const theme = { fg: (color, text) => `<${color}>${text}`, bold: text => text };
const result =(text, details) => ({ content: [{ type: "text", text }], details });
const context = (overrides = {}) => ({ toolCallId: "c1", isPartial: false, isError: false, expanded: false, state: {}, invalidate() {}, ...overrides });
const rendered = component => component.render(80).map(line => line.trimEnd());

test("row titles name the action and the target", () => {
  assert.equal(callTitle("bash", { command: "git status\n# trailing" }), "Ran git status");
  assert.equal(callTitle("read", { path: "a.mjs", offset: 40 }), "Read a.mjs:40");
  assert.equal(callTitle("grep", { pattern: "paddingX", path: "src" }), 'Search "paddingX" in src');
  assert.equal(callTitle("ls", {}), "List .");
});

test("plugin titles name the server and tool, or the child and its task", () => {
  assert.equal(pluginTitle("mcp__exa_web_search_exa", { query: "pi tui MouseRegion", numResults: 5 }, ["exa"]), 'exa › web_search_exa "pi tui MouseRegion"');
  assert.equal(pluginTitle("mcp__my_srv_do_it", {}, ["my", "my_srv"]), "my_srv › do_it");
  assert.equal(pluginTitle("mcp__ctx_q", {}, []), "ctx › q");
  assert.equal(pluginTitle("mcp", { tool: "playwright_browser_click", args: { ref: "e1" } }, ["playwright"]), 'playwright › browser_click "e1"');
  assert.equal(pluginTitle("mcp", { search: "click" }), 'mcp search "click"');
  assert.equal(pluginTitle("subagent", { agent: "explore-deep", task: "Audit the\n last commits" }), "explore-deep › Audit the last commits");
  assert.equal(pluginTitle("subagent", { action: "status", id: "r1" }), "subagent status r1");
  assert.equal(pluginTitle("subagent", {}), "subagent");
});

test("glyph colour follows the row state", () => {
  assert.equal(glyph(theme, { isPartial: true, isError: false }), "•");
  assert.equal(glyph(theme, { isPartial: false, isError: false }), "<success>•");
  assert.equal(glyph(theme, { isPartial: false, isError: true }, "○"), "<error>○");
});

test("the summary line says what the result was", () => {
  assert.equal(resultSummary("edit", result("ok", { diff: "-  1 old\n+  1 new\n+  2 more\n   3 same" })), "+2 −1");
  assert.equal(resultSummary("grep", result("a.mjs:3: x\na.mjs-4- y\nb.mjs:9: z")), "2 matches");
  assert.equal(resultSummary("grep", result("No matches found")), "0 matches");
  assert.equal(resultSummary("find", result("a\nb\nc")), "3 entries");
  assert.equal(resultSummary("find", result("No files found")), "");
  assert.equal(resultSummary("bash", result("one\ntwo")), "2 lines");
  // The SDK bash tool's stand-in for empty output is not a line.
  assert.equal(resultSummary("bash", result("(no output)")), "no output");
  assert.equal(resultSummary("bash", result("")), "no output");
  assert.equal(resultSummary("read", result("")), "");
});

test("bodies show nothing until expanded; shell errors show head and tail, other errors in full", () => {
  const lines = Array.from({ length: 9 }, (_, i) => `l${i + 1}`).join("\n");
  assert.deepEqual(bodyLines("bash", result(lines)), []);
  assert.equal(bodyLines("bash", result(lines), { expanded: true }).length, 9);
  assert.deepEqual(bodyLines("bash", result("(no output)"), { expanded: true }), []);
  assert.deepEqual(bodyLines("write", result("wrote"), { expanded: true }), []);
  const failed = result("l1\nl2\nl3\nl4\nl5\nl6\n\nCommand exited with code 1");
  assert.deepEqual(bodyLines("bash", failed, { isError: true }), ["l1", "l2", "… 2 more lines", "l5", "l6", "Command exited with code 1"]);
  assert.equal(bodyLines("bash", failed, { isError: true, expanded: true }).length, 7);
  assert.deepEqual(bodyLines("bash", result("a\nb\nc\nd\ne\n\nCommand exited with code 1"), { isError: true }), ["a", "b", "c", "d", "e", "Command exited with code 1"]);
  assert.equal(bodyLines("mcp", result(lines), { isError: true }).length, 9);
});

test("a row is a title and one ↳ line at the shared inset; the hint appears only over a body", () => {
  const renderers = toolRenderers("edit", createFolds());
  assert.deepEqual(rendered(renderers.renderCall({ path: "f" }, theme, context())), ["  <success>• <toolTitle>Edited f"]);
  assert.deepEqual(rendered(renderers.renderResult(result("ok", { diff: "+  1 a" }), { expanded: false }, theme, context())), ["    <muted>↳ +1 −0"]);
  const bash = toolRenderers("bash", createFolds());
  assert.deepEqual(rendered(bash.renderResult(result("(no output)"), { expanded: false }, theme, context())), ["    <muted>↳ no output"]);
  assert.match(rendered(bash.renderResult(result("a\nb"), { expanded: false }, theme, context()))[0], /^    <muted>↳ 2 lines · .*to expand/);
  const failed = rendered(bash.renderResult(result("l1\nl2\nl3\nl4\nl5\nl6\n\nCommand exited with code 1"), { expanded: false }, theme, context({ isError: true })));
  assert.deepEqual(failed.slice(0, 2), ["    <error>l1", "    <error>l2"]);
  assert.match(failed[2], /^    <muted>… 2 more lines · .*to expand/);
  assert.equal(failed.at(-1), "    <error>Command exited with code 1");
});

test("folded rows render nothing and the last row carries the summary at the text column; opening the summary row opens its siblings", () => {
  const folds = createFolds();
  const rows = [["read", "a"], ["read", "b"], ["bash", "c"]].map(([tool, id]) => ({ tool, id, renderers: toolRenderers(tool, folds), invalidated: 0 }));
  const contextFor = (row, expanded = false) => context({ toolCallId: row.id, expanded, invalidate: () => row.invalidated++ });
  for (const row of rows) {
    row.renderers.renderCall({}, theme, contextFor(row)); // first render precedes registration
    addFold(folds, row.id, row.tool);
  }
  closeFolds(folds);
  assert.deepEqual(rows.map(row => row.invalidated), [1, 1, 1]);
  assert.deepEqual(rendered(rows[0].renderers.renderCall({}, theme, contextFor(rows[0]))), []);
  assert.deepEqual(rendered(rows[0].renderers.renderResult(result("x"), { expanded: false }, theme, contextFor(rows[0]))), []);
  assert.deepEqual(rendered(rows[2].renderers.renderCall({}, theme, contextFor(rows[2]))), ["    <muted>Read 2 files, ran 1 shell command"]);
  // The click lands on the summary row; its expanded flag opens the group.
  assert.deepEqual(rendered(rows[2].renderers.renderCall({ command: "c" }, theme, contextFor(rows[2], true))), ["  <success>• <toolTitle>Ran c"]);
  assert.deepEqual(rows.map(row => row.invalidated), [2, 2, 1]);
  assert.deepEqual(rendered(rows[0].renderers.renderCall({ path: "a" }, theme, contextFor(rows[0]))), ["  <success>• <toolTitle>Read a"]);
  assert.match(rendered(rows[0].renderers.renderResult(result("x"), { expanded: false }, theme, contextFor(rows[0])))[0], /^    <muted>↳ 1 line · /);
  rows[2].renderers.renderCall({}, theme, contextFor(rows[2], true));
  assert.deepEqual(rows.map(row => row.invalidated), [2, 2, 1]);
  rows[2].renderers.renderCall({}, theme, contextFor(rows[2]));
  assert.deepEqual(rows.map(row => row.invalidated), [3, 3, 1]);
  assert.deepEqual(rendered(rows[0].renderers.renderCall({}, theme, contextFor(rows[0]))), []);
  closeFolds(folds); // nothing open: no re-invalidation
  assert.deepEqual(rows.map(row => row.invalidated), [3, 3, 1]);
  addFold(folds, "d", "grep");
  assert.equal(folds.byId.get("d").collapsed, false);
  assert.equal(folds.byId.get("a").collapsed, true);
});

test("summary wording", () => {
  assert.equal(summarise({ read: 3, bash: 9, grep: 1, edit: 2, list: 1, mcp: 2 }), "Read 3 files, ran 9 shell commands, searched for 1 pattern, edited 2 files, listed 1 path, called 2 MCP tools");
  assert.equal(summarise({ write: 1 }), "Wrote 1 file");
  assert.equal(summarise({}), "");
});

test("folding closes on the first non-empty assistant text, streaming or not; MCP rows fold, subagent rows never", () => {
  const folds = createFolds();
  const handlers = {};
  installFolding({ on: (name, fn) => { handlers[name] = fn; } }, folds);
  handlers.tool_execution_start({ toolName: "workspace_read", toolCallId: "r1" });
  handlers.tool_execution_start({ toolName: "mcp__exa_web_search_exa", toolCallId: "m1" });
  handlers.tool_execution_start({ toolName: "subagent", toolCallId: "s1" });
  handlers.message_update({ message: { role: "assistant", content: [{ type: "thinking", thinking: "hm" }, { type: "text", text: " " }] } });
  handlers.message_update({ message: { role: "user", content: [{ type: "text", text: "hi" }] } });
  assert.equal(folds.byId.get("r1").collapsed, false);
  assert.deepEqual(folds.byId.get("m1").counts, { read: 1, mcp: 1 });
  assert.equal(folds.byId.has("s1"), false);
  handlers.message_update({ message: { role: "assistant", content: [{ type: "text", text: "Done" }] } });
  assert.equal(folds.byId.get("r1").collapsed, true);
  handlers.tool_execution_start({ toolName: "workspace_bash", toolCallId: "b1" });
  handlers.message_end({ message: { role: "assistant", content: [{ type: "text", text: "Ok" }] } });
  assert.equal(folds.byId.get("b1").collapsed, true);
});

test("plugin rows: MCP failures reported in details turn the row red after the render; a launch reads as launched", async () => {
  const mcp = pluginRenderers("mcp__exa_web_search_exa", { servers: ["exa"], folds: createFolds() });
  assert.equal(mcp.renderShell, "self");
  assert.deepEqual(rendered(mcp.renderCall({ query: "npm pi" }, theme, context())), ['  <success>• <toolTitle>exa › web_search_exa "npm pi"']);
  assert.match(rendered(mcp.renderResult(result("a\nb\nc"), { expanded: false }, theme, context()))[0], /^    <muted>↳ 3 lines · .*to expand/);
  let invalidated = 0;
  const shared = context({ invalidate: () => invalidated++ });
  assert.deepEqual(rendered(mcp.renderResult(result("boom", { error: "auth_required" }), { expanded: false }, theme, shared)), ["    <error>boom"]);
  // pi's invalidate rebuilds the row synchronously, so it must wait for this render to finish.
  assert.deepEqual([invalidated, shared.state.failed], [0, true]);
  await Promise.resolve();
  assert.equal(invalidated, 1);
  assert.deepEqual(rendered(mcp.renderCall({ query: "npm pi" }, theme, shared)), ['  <error>• <toolTitle>exa › web_search_exa "npm pi"']);
  mcp.renderResult(result("boom", { error: "auth_required" }), { expanded: false }, theme, shared);
  await Promise.resolve();
  assert.equal(invalidated, 1);
  const subagent = pluginRenderers("subagent", { folds: createFolds() });
  assert.deepEqual(rendered(subagent.renderCall({ agent: "explore-deep", task: "Audit the last commits" }, theme, context())), ["  <success>○ <toolTitle>explore-deep › Audit the last commits"]);
  assert.deepEqual(rendered(subagent.renderResult(result("Async run r1", { asyncId: "r1" }), { expanded: false }, theme, context())), ["    <muted>↳ launched"]);
  assert.match(rendered(subagent.renderResult(result("done\nall good"), { expanded: false }, theme, context()))[0], /^    <muted>↳ 2 lines · /);
});

test("assistant bullets keep block syntax intact and land on the rows' column", () => {
  assert.equal(bulletMarkdown("Done.", { messageType: "assistant" }), " • Done.");
  assert.equal(bulletMarkdown("# Title\nbody", { messageType: "assistant" }), " •\n\n# Title\nbody");
  assert.equal(bulletMarkdown("plain", { messageType: "user" }), "plain");
  assert.equal(bulletMarkdown("  ", { messageType: "assistant" }), "  ");
  // pi renders assistant text one column in and marked keeps the leading space.
  assert.ok(new Markdown(bulletMarkdown("Done.", { messageType: "assistant" }), 1, 0, getMarkdownTheme()).render(40)[0].startsWith("  • Done."));
});

test("answers, completion and turn lines format", () => {
  assert.deepEqual(answerLines([{ question: "Pad both sides?", answer: "yes" }], theme), [
    "<success>• <toolTitle>User answered pi's question",
    "  <muted>↳ Pad both sides? <muted>→ yes",
  ]);
  assert.equal(completionLine({ agent: "explore-deep", task: "Audit the\n last commits", status: "completed" }, theme), "<success>○ <toolTitle>explore-deep finished<muted> · Audit the last commits");
  assert.equal(completionLine({ agent: "ts-reviewer", task: "", status: "failed" }, theme), "<error>○ <toolTitle>ts-reviewer failed");
  assert.equal(completionLine({ agent: "ts-reviewer", task: "", status: "paused" }, theme), "<warning>○ <toolTitle>ts-reviewer paused");
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
  const failed = context({ toolCallId: "e1", isError: true });
  renderers.renderCall({ command: "false" }, theme, failed);
  addFold(folds, "e1", "bash");
  closeFolds(folds);
  assert.deepEqual(rendered(renderers.renderCall({ command: "false" }, theme, failed)), ["    <muted>Ran 1 shell command", "  <error>• <toolTitle>Ran false"]);
  assert.deepEqual(rendered(renderers.renderResult(result("boom"), { expanded: false }, theme, failed)), ["    <error>boom"]);
});
