import test from "node:test";
import assert from "node:assert/strict";
import { Markdown } from "@earendil-works/pi-tui";
import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { addFold, answerLines, appendVisible, blankReasoning, bodyLines, bulletMarkdown, callTitle, closeFolds, completionLine, createFolds, createTurnClock, foldGroup, formatDuration, formatTurn, glyph, installFolding, noticeLine, paintCounts, planRenderers, pluginRenderers, pluginTitle, resultSummary, settleFold, summarise, toolRenderers } from "./rows.mjs";

// The markdown theme reads pi's theme; the default one is enough.
initTheme();

const theme = { fg: (color, text) => `<${color}>${text}`, bold: text => text };
const result =(text, details) => ({ content: [{ type: "text", text }], details });
const context = (overrides = {}) => ({ toolCallId: "c1", isPartial: false, isError: false, expanded: false, state: {}, invalidate() {}, ...overrides });
const rendered = component => component.render(80).map(line => line.trimEnd());

test("row titles name the action and the target", () => {
  assert.equal(callTitle("bash", { command: "git status\n# trailing" }), "Ran git status");
  assert.equal(callTitle("bash", { command: "npm test", run_in_background: true }), "Started npm test in background");
  assert.equal(callTitle("bash", { command: "brew install x", dangerouslyDisableSandbox: true }), "Ran brew install x · unsandboxed");
  assert.equal(callTitle("bash", { command: "npm test", run_in_background: true, dangerouslyDisableSandbox: true }), "Started npm test in background · unsandboxed");
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
  assert.equal(pluginTitle("bg_wait", { id: "eeeb8e9f", timeoutMs: 30000 }), 'bg wait "eeeb8e9f"');
  assert.equal(pluginTitle("contact_supervisor", {}), "contact supervisor");
  assert.equal(pluginTitle("web_search", { query: "pi tui MouseRegion" }), 'Searched "pi tui MouseRegion"');
});

test("background-task summaries", () => {
  assert.equal(resultSummary("bash", result("Started background task t1", { taskId: "t1" })), "task t1 · running");
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
  // A plugin tool outside the known kinds answers in a sentence; that sentence is the summary.
  assert.equal(resultSummary("plugin", result('Waited 33.2s for run "eeeb8e9f-4c89-44b6-8106-82a3e70e0ea4"; done. Outcome: 1 complete.\nmore')), 'Waited 33.2s for run "eeeb8e9f-4c89-44b6-8106-82a3e70e0ea4"…');
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

test("a row is a title at column 0 and one ↳ line at the text column; the hint appears only over a body", () => {
  const renderers = toolRenderers("edit", createFolds());
  assert.deepEqual(rendered(renderers.renderCall({ path: "f" }, theme, context())), ["<success>• <toolTitle>Edited f"]);
  assert.deepEqual(rendered(renderers.renderResult(result("ok", { diff: "+  1 a" }), { expanded: false }, theme, context())), ["  <muted>↳ <success>+1 <error>−0"]);
  const bash = toolRenderers("bash", createFolds());
  assert.deepEqual(rendered(bash.renderResult(result("(no output)"), { expanded: false }, theme, context())), ["  <muted>↳ no output"]);
  assert.deepEqual(rendered(bash.renderResult(result("a\nb"), { expanded: false }, theme, context())), ["  <muted>↳ 2 lines"]);
  const failed = rendered(bash.renderResult(result("l1\nl2\nl3\nl4\nl5\nl6\n\nCommand exited with code 1"), { expanded: false }, theme, context({ isError: true })));
  assert.deepEqual(failed.slice(0, 2), ["  <error>l1", "  <error>l2"]);
  assert.equal(failed[2], "  <muted>… 2 more lines");
  assert.equal(failed.at(-1), "  <error>Command exited with code 1");
});

test("folded rows render nothing; the first row carries the caret handle in both states, and ctrl+o drives it both ways", () => {
  let toolsExpanded = false;
  const folds = createFolds(() => toolsExpanded);
  const rows = [["read", "a"], ["read", "b"], ["bash", "c"]].map(([tool, id]) => ({ tool, id, renderers: toolRenderers(tool, folds), invalidated: 0 }));
  const contextFor = (row, expanded = false) => context({ toolCallId: row.id, expanded, invalidate: () => row.invalidated++ });
  const click = y => ({ type: "click", button: "left", x: 0, y });
  for (const row of rows) {
    row.renderers.renderCall({}, theme, contextFor(row)); // first render precedes registration
    addFold(folds, row.id, row.tool);
  }
  // A run seals only once every member has an outcome: until then any of them
  // could turn out to be a separator rather than a member.
  for (const row of rows) settleFold(folds, row.id, false);
  closeFolds(folds);
  assert.deepEqual(rows.map(row => row.invalidated), [1, 1, 1]);
  const handle = rows[0].renderers.renderCall({ path: "a" }, theme, contextFor(rows[0]));
  assert.deepEqual(rendered(handle), ["<muted>▸ Read 2 files, ran 1 shell command"]);
  assert.deepEqual(rendered(rows[0].renderers.renderResult(result("x"), { expanded: false }, theme, contextFor(rows[0]))), []);
  assert.deepEqual(rendered(rows[2].renderers.renderCall({ command: "c" }, theme, contextFor(rows[2]))), []);
  // Only the summary line answers clicks; anything else is pi's own toggle.
  assert.equal(handle.handleMouse(click(1)), undefined);
  assert.equal(handle.handleMouse({ ...click(0), type: "down" }), undefined);
  assert.deepEqual(handle.handleMouse(click(0)), { handled: true });
  assert.deepEqual(rows.map(row => row.invalidated), [2, 2, 2]);
  const open = rows[0].renderers.renderCall({ path: "a" }, theme, contextFor(rows[0]));
  assert.deepEqual(rendered(open), ["<toolTitle>▾ Read 2 files, ran 1 shell command", "<success>• <toolTitle>Read a"]);
  assert.deepEqual(rendered(rows[2].renderers.renderCall({ command: "c" }, theme, contextFor(rows[2]))), ["<success>• <toolTitle>Ran c"]);
  assert.equal(rendered(rows[2].renderers.renderResult(result("x"), { expanded: false }, theme, contextFor(rows[2])))[0], "  <muted>↳ 1 line");
  // Expanding a row inside an open group is pi's toggle for its body; the group stays open.
  assert.deepEqual(rendered(rows[0].renderers.renderCall({ path: "a" }, theme, contextFor(rows[0], true))), ["<toolTitle>▾ Read 2 files, ran 1 shell command", "<success>• <toolTitle>Read a"]);
  assert.deepEqual(rows.map(row => row.invalidated), [2, 2, 2]);
  open.handleMouse(click(0));
  assert.deepEqual(rows.map(row => row.invalidated), [3, 3, 3]);
  assert.deepEqual(rendered(rows[2].renderers.renderCall({ command: "c" }, theme, contextFor(rows[2]))), []);
  // A row's own flag (left true by the click above) says nothing about the
  // group; ctrl+o is pi's global flag, and its change opens the closed group
  // from whichever row renders first (siblings woken, that row not re-entered).
  assert.deepEqual(rendered(rows[0].renderers.renderCall({ path: "a" }, theme, contextFor(rows[0], true))), ["<muted>▸ Read 2 files, ran 1 shell command"]);
  toolsExpanded = true;
  assert.deepEqual(rendered(rows[2].renderers.renderCall({ command: "c" }, theme, contextFor(rows[2], true))), ["<success>• <toolTitle>Ran c"]);
  assert.deepEqual(rows.map(row => row.invalidated), [4, 4, 3]);
  // ctrl+o off drives every group back to collapsed, as the handle does.
  toolsExpanded = false;
  assert.deepEqual(rendered(rows[0].renderers.renderCall({ path: "a" }, theme, contextFor(rows[0]))), ["<muted>▸ Read 2 files, ran 1 shell command"]);
  assert.deepEqual(rows.map(row => row.invalidated), [4, 5, 4]);
  closeFolds(folds); // the run already ends in a boundary: no second one, no re-invalidation
  assert.deepEqual(rows.map(row => row.invalidated), [4, 5, 4]);
  // A row still forming belongs to no run; the sealed one above it is untouched.
  addFold(folds, "d", "grep");
  assert.equal(foldGroup(folds, "d"), null);
  assert.equal(foldGroup(folds, "a"), foldGroup(folds, "c"));
});

test("a group that seals while ctrl+o is on opens with it", () => {
  const folds = createFolds(() => true);
  const renderers = toolRenderers("read", folds);
  const ctx = id => context({ toolCallId: id });
  for (const id of ["g1", "g2"]) {
    renderers.renderCall({ path: "a" }, theme, ctx(id));
    addFold(folds, id, "read");
    settleFold(folds, id, false);
  }
  closeFolds(folds);
  // The flag was already true when it sealed, so no transition is left to react to.
  assert.deepEqual(rendered(renderers.renderCall({ path: "a" }, theme, ctx("g1"))), ["<toolTitle>▾ Read 2 files", "<success>• <toolTitle>Read a"]);
});

test("one row is never a group: a handle that hides a single line saves nothing", () => {
  const folds = createFolds(() => false);
  const renderers = toolRenderers("read", folds);
  const ctx = () => context({ toolCallId: "s1" });
  renderers.renderCall({ path: "a" }, theme, ctx());
  addFold(folds, "s1", "read");
  settleFold(folds, "s1", false);
  closeFolds(folds);
  assert.equal(foldGroup(folds, "s1"), null);
  assert.deepEqual(rendered(renderers.renderCall({ path: "a" }, theme, ctx())), ["<success>• <toolTitle>Read a"]);
});

test("the plan row carries the tool's approval label", () => {
  assert.deepEqual(rendered(planRenderers.renderCall({}, theme, context())), ["<success>• <toolTitle>Plan approval"]);
});

test("the plan renders as markdown while the decision is open, then hands its body to ctrl+o", () => {
  const plan = "# Context\n\nMove the plan out of the dialog.";
  const body = rendered(new Markdown(plan, 2, 0, getMarkdownTheme()));
  assert.ok(body.length > 1, "the body must render, or the assertions below hold vacuously");
  const title = "• <toolTitle>Plan approval";
  // Streaming args, and a call still queued behind another in the same batch,
  // both stay a bare title: the body belongs to the call whose dialog is open.
  assert.deepEqual(rendered(planRenderers.renderCall({ plan }, theme, context({ isPartial: true }))), [title]);
  assert.deepEqual(rendered(planRenderers.renderCall({ plan }, theme, context({ argsComplete: true, isPartial: true }))), [title]);
  const pending = context({ executionStarted: true, isPartial: true });
  assert.deepEqual(rendered(planRenderers.renderCall({ plan }, theme, pending)), [title, ...body]);

  // A result is what retires the body; pi re-runs the call slot when it lands,
  // and from there only `expanded` shows the plan.
  const settled = context({ executionStarted: true, args: { plan } });
  assert.deepEqual(rendered(planRenderers.renderCall({ plan }, theme, settled)), [`<success>${title}`]);
  const approved = result("Plan approved; scoped execution enabled.");
  assert.deepEqual(rendered(planRenderers.renderResult(approved, { expanded: false }, theme, settled)), ["  <muted>↳ <success>approved"]);
  assert.deepEqual(rendered(planRenderers.renderResult(approved, { expanded: true }, theme, settled)), ["  <muted>↳ <success>approved", ...body]);
});

test("diff counts take the theme's success/error pair, whichever minus the surface spells", () => {
  assert.equal(paintCounts("+3 -1", theme), "<success>+3 <error>-1");
  assert.equal(paintCounts("+2 −1", theme), "<success>+2 <error>−1");
  assert.equal(paintCounts("-5", theme), "<error>-5");
});

test("summary wording", () => {
  assert.equal(summarise({ read: 3, bash: 9, grep: 1, edit: 2, list: 1, mcp: 2 }), "Read 3 files, ran 9 shell commands, searched for 1 pattern, edited 2 files, listed 1 path, called 2 MCP tools");
  assert.equal(summarise({ write: 1 }), "Wrote 1 file");
  assert.equal(summarise({}), "");
});

test("folding closes on assistant text, streaming or not, and on anything that stays visible; MCP rows fold, subagent and background-task rows never", () => {
  const folds = createFolds();
  const handlers = {};
  installFolding({ on: (name, fn) => { handlers[name] = fn; } }, { ui: { getToolsExpanded: () => false } }, folds);
  const start = (toolName, toolCallId) => handlers.tool_execution_start({ toolName, toolCallId });
  const ok = toolCallId => handlers.tool_execution_end({ toolCallId, isError: false, result: { details: {} } });
  const says = text => ({ message: { role: "assistant", content: [{ type: "text", text }] } });
  start("workspace_read", "r1");
  start("mcp__exa_web_search_exa", "m1");
  ok("r1");
  ok("m1");
  // Neither thinking, whitespace, nor the user's own message is a boundary.
  handlers.message_update({ message: { role: "assistant", content: [{ type: "thinking", thinking: "hm" }, { type: "text", text: " " }] } });
  handlers.message_update({ message: { role: "user", content: [{ type: "text", text: "hi" }] } });
  assert.equal(foldGroup(folds, "r1"), null);
  handlers.message_update(says("Done"));
  assert.deepEqual(foldGroup(folds, "m1").counts, { read: 1, mcp: 1 });
  assert.equal(foldGroup(folds, "r1"), foldGroup(folds, "m1"));
  // A subagent row stays visible: it seals the run above and joins none.
  start("workspace_read", "r4");
  start("workspace_read", "r5");
  ok("r4");
  ok("r5");
  start("subagent", "s1");
  assert.equal(foldGroup(folds, "s1"), null);
  assert.deepEqual(foldGroup(folds, "r4").counts, { read: 2 });
  // A background task is running work, not housekeeping: its row stays visible too.
  start("workspace_read", "r6");
  start("workspace_read", "r7");
  ok("r6");
  ok("r7");
  start("workspace_task", "t1");
  assert.equal(foldGroup(folds, "t1"), null);
  assert.deepEqual(foldGroup(folds, "r6").counts, { read: 2 });
  assert.notEqual(foldGroup(folds, "r6"), foldGroup(folds, "r4"));
  // A visible custom message — pi-subagents' control notice — is a line like
  // any other, and pi appends it at message_end.
  start("workspace_bash", "b1");
  start("workspace_bash", "b2");
  ok("b1");
  ok("b2");
  handlers.message_end({ message: { customType: "subagent_control_notice", display: true, content: "researcher needs attention" } });
  assert.deepEqual(foldGroup(folds, "b1").counts, { bash: 2 });
  // A new run closes whatever is open; a non-streaming reply closes at its end.
  start("workspace_read", "r2");
  start("workspace_read", "r3");
  ok("r2");
  ok("r3");
  handlers.agent_start({});
  assert.deepEqual(foldGroup(folds, "r2").counts, { read: 2 });
  start("workspace_edit", "d1");
  start("workspace_edit", "d2");
  ok("d1");
  ok("d2");
  handlers.message_end(says("Ok"));
  assert.deepEqual(foldGroup(folds, "d1").counts, { edit: 2 });
});

test("a failed row separates the runs on either side of it, whatever order the batch settles in", () => {
  const folds = createFolds();
  const handlers = {};
  installFolding({ on: (name, fn) => { handlers[name] = fn; } }, { ui: { getToolsExpanded: () => false } }, folds);
  // pi emits every start in tool-call order before the batch executes, so the
  // timeline is transcript order however the ends interleave.
  for (const [id, tool] of [["r1", "workspace_read"], ["r2", "workspace_read"], ["f", "workspace_bash"], ["e1", "workspace_edit"], ["e2", "workspace_edit"]]) {
    handlers.tool_execution_start({ toolName: tool, toolCallId: id });
  }
  handlers.tool_execution_end({ toolCallId: "f", isError: true, result: {} });
  // Nothing seals while a member is still pending: its outcome decides whether
  // it is a member or another separator.
  assert.equal(foldGroup(folds, "r1"), null);
  for (const id of ["e1", "r2", "e2", "r1"]) handlers.tool_execution_end({ toolCallId: id, isError: false, result: { details: {} } });
  handlers.message_end({ message: { role: "assistant", content: [{ type: "text", text: "done" }] } });
  const above = foldGroup(folds, "r1");
  const below = foldGroup(folds, "e1");
  assert.equal(above, foldGroup(folds, "r2"));
  assert.equal(below, foldGroup(folds, "e2"));
  assert.notEqual(above, below);
  // The failure is in neither, and neither summary counts it.
  assert.equal(foldGroup(folds, "f"), null);
  assert.equal(summarise(above.counts), "Read 2 files");
  assert.equal(summarise(below.counts), "Edited 2 files");
});

test("ctrl+o drives every group both ways, including the two a failed row split apart", () => {
  let toolsExpanded = false;
  const folds = createFolds(() => toolsExpanded);
  const handlers = {};
  installFolding({ on: (name, fn) => { handlers[name] = fn; } }, { ui: { getToolsExpanded: () => toolsExpanded } }, folds);
  const rows = [["r1", "workspace_read"], ["r2", "workspace_read"], ["f", "workspace_bash"], ["e1", "workspace_edit"], ["e2", "workspace_edit"]];
  const renderers = Object.fromEntries(rows.map(([id, tool]) => [id, toolRenderers(tool.slice("workspace_".length), folds)]));
  const invalidated = {};
  const ctx = id => context({ toolCallId: id, isError: id === "f", invalidate: () => { invalidated[id] = (invalidated[id] ?? 0) + 1; } });
  const draw = id => rendered(renderers[id].renderCall({ path: id, command: id }, theme, ctx(id)));
  for (const [id, tool] of rows) {
    renderers[id].renderCall({ path: id, command: id }, theme, ctx(id)); // first render precedes the start event
    handlers.tool_execution_start({ toolName: tool, toolCallId: id });
  }
  handlers.tool_execution_end({ toolCallId: "f", isError: true, result: {} });
  for (const id of ["r1", "r2", "e1", "e2"]) handlers.tool_execution_end({ toolCallId: id, isError: false, result: { details: {} } });
  handlers.message_end({ message: { role: "assistant", content: [{ type: "text", text: "done" }] } });
  // Two groups, each with its own handle; the failure between them has neither.
  assert.deepEqual(draw("r1"), ["<muted>▸ Read 2 files"]);
  assert.deepEqual(draw("r2"), []);
  assert.deepEqual(draw("e1"), ["<muted>▸ Edited 2 files"]);
  assert.deepEqual(draw("f"), ["<error>• <toolTitle>Ran f"]);
  // ctrl+o on opens both, each from whichever of its own rows renders first.
  toolsExpanded = true;
  assert.deepEqual(draw("r1"), ["<toolTitle>▾ Read 2 files", "<success>• <toolTitle>Read r1"]);
  assert.deepEqual(draw("r2"), ["<success>• <toolTitle>Read r2"]);
  assert.deepEqual(draw("e1"), ["<toolTitle>▾ Edited 2 files", "<success>• <toolTitle>Edited e1"]);
  assert.deepEqual(draw("e2"), ["<success>• <toolTitle>Edited e2"]);
  // ctrl+o off collapses both back.
  toolsExpanded = false;
  assert.deepEqual(draw("r1"), ["<muted>▸ Read 2 files"]);
  assert.deepEqual(draw("r2"), []);
  assert.deepEqual(draw("e1"), ["<muted>▸ Edited 2 files"]);
  assert.deepEqual(draw("e2"), []);
  // One group clicked open against the flag follows it again at the next press,
  // and the other is not disturbed by that click.
  const handle = renderers.e1.renderCall({ path: "e1" }, theme, ctx("e1"));
  handle.handleMouse({ type: "click", button: "left", x: 0, y: 0 });
  assert.deepEqual(draw("e1"), ["<toolTitle>▾ Edited 2 files", "<success>• <toolTitle>Edited e1"]);
  assert.deepEqual(draw("r1"), ["<muted>▸ Read 2 files"]);
  toolsExpanded = true;
  assert.deepEqual(draw("r1"), ["<toolTitle>▾ Read 2 files", "<success>• <toolTitle>Read r1"]);
  assert.deepEqual(draw("e1"), ["<toolTitle>▾ Edited 2 files", "<success>• <toolTitle>Edited e1"]);
  toolsExpanded = false;
  assert.deepEqual(draw("e1"), ["<muted>▸ Edited 2 files"]);
  assert.deepEqual(draw("r1"), ["<muted>▸ Read 2 files"]);
});

test("the adapter's details.error is a failure too, and a lone failure leaves no handle behind", () => {
  const folds = createFolds();
  const handlers = {};
  installFolding({ on: (name, fn) => { handlers[name] = fn; } }, { ui: { getToolsExpanded: () => false } }, folds);
  handlers.tool_execution_start({ toolName: "mcp__exa_web_search_exa", toolCallId: "m2" });
  handlers.tool_execution_end({ toolCallId: "m2", isError: false, result: { details: { error: "auth_required" } } });
  handlers.message_end({ message: { role: "assistant", content: [{ type: "text", text: "done" }] } });
  assert.equal(foldGroup(folds, "m2"), null);
});

test("a failure at either end of a batch leaves one run, not two", () => {
  const drive = order => {
    const folds = createFolds();
    const handlers = {};
    installFolding({ on: (name, fn) => { handlers[name] = fn; } }, { ui: { getToolsExpanded: () => false } }, folds);
    for (const [id, tool] of order) handlers.tool_execution_start({ toolName: tool, toolCallId: id });
    for (const [id] of order) handlers.tool_execution_end({ toolCallId: id, isError: id === "f", result: { details: {} } });
    handlers.message_end({ message: { role: "assistant", content: [{ type: "text", text: "done" }] } });
    return folds;
  };
  // First: nothing above it to seal, one run below.
  const first = drive([["f", "workspace_bash"], ["e1", "workspace_edit"], ["e2", "workspace_edit"]]);
  assert.equal(foldGroup(first, "f"), null);
  assert.equal(summarise(foldGroup(first, "e1").counts), "Edited 2 files");
  assert.equal(foldGroup(first, "e1"), foldGroup(first, "e2"));
  // Last: one run above it, and it needs no boundary of its own after it.
  const last = drive([["r1", "workspace_read"], ["r2", "workspace_read"], ["f", "workspace_bash"]]);
  assert.equal(foldGroup(last, "f"), null);
  assert.equal(summarise(foldGroup(last, "r1").counts), "Read 2 files");
  assert.equal(foldGroup(last, "r1"), foldGroup(last, "r2"));
});

test("a pending row holds its whole run back, so no handle appears and then moves", () => {
  const folds = createFolds();
  const handlers = {};
  installFolding({ on: (name, fn) => { handlers[name] = fn; } }, { ui: { getToolsExpanded: () => false } }, folds);
  for (const id of ["a", "b", "c"]) handlers.tool_execution_start({ toolName: "workspace_read", toolCallId: id });
  for (const id of ["b", "c"]) handlers.tool_execution_end({ toolCallId: id, isError: false, result: { details: {} } });
  // A child's completion line can land mid-batch, while `a` is still running.
  closeFolds(folds);
  assert.equal(foldGroup(folds, "b"), null);
  handlers.tool_execution_end({ toolCallId: "a", isError: false, result: { details: {} } });
  // The run seals once, whole, with its handle on the row that actually leads it.
  const group = foldGroup(folds, "a");
  assert.equal(summarise(group.counts), "Read 3 files");
  assert.equal(group.entries[0].id, "a");
});

test("appendVisible is the boundary: appending the entry is what draws the line", () => {
  const folds = createFolds(() => false);
  const appended = [];
  const pi = { appendEntry: (type, data) => appended.push([type, data]) };
  addFold(folds, "v1", "read");
  addFold(folds, "v2", "read");
  settleFold(folds, "v1", false);
  settleFold(folds, "v2", false);
  assert.equal(foldGroup(folds, "v1"), null);
  appendVisible(pi, "workflow-task", { id: "t1", status: "failed" }, folds);
  assert.deepEqual(appended, [["workflow-task", { id: "t1", status: "failed" }]]);
  assert.deepEqual(foldGroup(folds, "v1").counts, { read: 2 });
});

test("plugin rows: MCP failures reported in details turn the row red after the render; a launch reads as launched", async () => {
  const mcp = pluginRenderers("mcp__exa_web_search_exa", { servers: ["exa"], folds: createFolds() });
  assert.equal(mcp.renderShell, "self");
  assert.deepEqual(rendered(mcp.renderCall({ query: "npm pi" }, theme, context())), ['<success>• <toolTitle>exa › web_search_exa "npm pi"']);
  assert.deepEqual(rendered(mcp.renderResult(result("a\nb\nc"), { expanded: false }, theme, context())), ["  <muted>↳ 3 lines"]);
  let invalidated = 0;
  const shared = context({ invalidate: () => invalidated++ });
  assert.deepEqual(rendered(mcp.renderResult(result("boom", { error: "auth_required" }), { expanded: false }, theme, shared)), ["  <error>boom"]);
  // pi's invalidate rebuilds the row synchronously, so it must wait for this render to finish.
  assert.deepEqual([invalidated, shared.state.failed], [0, true]);
  await Promise.resolve();
  assert.equal(invalidated, 1);
  assert.deepEqual(rendered(mcp.renderCall({ query: "npm pi" }, theme, shared)), ['<error>• <toolTitle>exa › web_search_exa "npm pi"']);
  mcp.renderResult(result("boom", { error: "auth_required" }), { expanded: false }, theme, shared);
  await Promise.resolve();
  assert.equal(invalidated, 1);
  const subagent = pluginRenderers("subagent", { folds: createFolds() });
  assert.deepEqual(rendered(subagent.renderCall({ agent: "explore-deep", task: "Audit the last commits" }, theme, context())), ["<success>• <toolTitle>explore-deep › Audit the last commits"]);
  assert.deepEqual(rendered(subagent.renderResult(result("Async run r1", { asyncId: "r1" }), { expanded: false }, theme, context())), ["  <muted>↳ launched"]);
  assert.equal(rendered(subagent.renderResult(result("done\nall good"), { expanded: false }, theme, context()))[0], "  <muted>↳ 2 lines");
  // Any other plugin tool is a row too: its title is its name and its summary its answer.
  const wait = pluginRenderers("bg_wait", { folds: createFolds() });
  assert.equal(wait.renderShell, "self");
  assert.deepEqual(rendered(wait.renderCall({ id: "r1" }, theme, context())), ['<success>• <toolTitle>bg wait "r1"']);
  assert.deepEqual(rendered(wait.renderResult(result('Waited 33.2s for run "r1"; done.'), { expanded: false }, theme, context())), ['  <muted>↳ Waited 33.2s for run "r1"; done.']);
  // The questionnaire has an overlay and an answers entry; its row says nothing.
  const ask = pluginRenderers("ask_user_question", { folds: createFolds() });
  assert.deepEqual(rendered(ask.renderCall({ questions: [] }, theme, context())), []);
  assert.deepEqual(rendered(ask.renderResult(result("answered"), { expanded: false }, theme, context())), []);
});

test("assistant bullets sit at column 0, a leading heading rides the bullet line, other block starts follow it, reasoning renders nothing", () => {
  assert.equal(bulletMarkdown("Done.", { messageType: "assistant" }), "• Done.");
  assert.equal(bulletMarkdown("# Title\nbody", { messageType: "assistant" }), "• **Title**\n\nbody");
  assert.equal(bulletMarkdown("- one\n- two", { messageType: "assistant" }), "•\n- one\n- two");
  assert.equal(bulletMarkdown("plain", { messageType: "user" }), "❯ plain");
  assert.equal(bulletMarkdown("  ", { messageType: "user" }), "  ");
  assert.equal(bulletMarkdown("  ", { messageType: "assistant" }), "  ");
  assert.equal(bulletMarkdown("Let me think.", { messageType: "assistant-thinking" }), "");
  const lines = md => new Markdown(bulletMarkdown(md, { messageType: "assistant" }), 0, 0, getMarkdownTheme()).render(40).map(line => line.replace(/\x1b\[[0-9;]*m/g, "").trimEnd());
  assert.equal(lines("Done.")[0], "• Done.");
  // A list interrupts the bullet paragraph without a blank line; a heading is bold on the bullet line.
  assert.deepEqual(lines("- one\n- two"), ["•", "- one", "- two"]);
  assert.deepEqual(lines("## Title"), ["• Title"]);
  assert.deepEqual(lines("## Title\n\nbody"), ["• Title", "", "body"]);
  assert.deepEqual(new Markdown(bulletMarkdown("hm", { messageType: "assistant-thinking" }), 0, 0, getMarkdownTheme()).render(40), []);
});

test("reasoning is blanked only where the provider replays it from the opaque item", () => {
  const message = (api, blocks) => ({ role: "assistant", api, content: blocks });
  const thinking = extra => ({ type: "thinking", thinking: "weighing it up", ...extra });
  const opaque = message("openai-responses", [thinking({ thinkingSignature: '{"type":"reasoning"}' }), { type: "toolCall", id: "t1" }]);
  assert.equal(blankReasoning(opaque), opaque);
  assert.equal(opaque.content[0].thinking, "");
  // The signature keeps the provider's own summary, so nothing leaves the session.
  assert.equal(opaque.content[0].thinkingSignature, '{"type":"reasoning"}');
  assert.equal(blankReasoning(opaque), undefined, "a blanked message is not replaced twice");
  const anthropic = message("anthropic-messages", [thinking({ thinkingSignature: "sig" })]);
  assert.equal(blankReasoning(anthropic), undefined);
  assert.equal(anthropic.content[0].thinking, "weighing it up");
  // Without a signature the text is all there is; an aborted stream leaves that.
  const unsigned = message("openai-responses", [thinking({})]);
  assert.equal(blankReasoning(unsigned), undefined);
  assert.equal(unsigned.content[0].thinking, "weighing it up");
  assert.equal(blankReasoning({ role: "user", content: [] }), undefined);
});

test("answers, completion and turn lines format", () => {
  assert.deepEqual(answerLines([{ question: "Pad both sides?", answer: "yes" }], theme), [
    "<success>• <toolTitle>User answered pi's question",
    "  <muted>↳ Pad both sides? <muted>→ yes",
  ]);
  // A note is the whole answer when the user writes instead of picking, and
  // the submit-tab note rides the end.
  assert.deepEqual(answerLines([{ question: "Which marker?", answer: "", notes: "or use the background" }, { question: "Pad?", answer: "yes", notes: "both sides" }], theme, "research this first"), [
    "<success>• <toolTitle>User answered pi's questions",
    "  <muted>↳ Which marker? <muted>→ or use the background",
    "  <muted>↳ Pad? <muted>→ yes — both sides",
    "  <muted>↳ Note <muted>→ research this first",
  ]);
  assert.equal(completionLine({ agent: "explore-deep", task: "Audit the\n last commits", status: "completed", durationMs: 134_000 }, theme), "<success>• <toolTitle>explore-deep finished<muted> · Audit the last commits · 2m 14s");
  assert.equal(completionLine({ agent: "explore-deep", task: "Audit", status: "completed" }, theme), "<success>• <toolTitle>explore-deep finished<muted> · Audit");
  assert.equal(completionLine({ agent: "ts-reviewer", task: "", status: "failed", durationMs: 4_000 }, theme), "<error>• <toolTitle>ts-reviewer failed<muted> · 4s");
  assert.equal(completionLine({ agent: "ts-reviewer", task: "", status: "paused" }, theme), "<warning>• <toolTitle>ts-reviewer paused");
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

test("a failed row is never folded: no handle above it, and its body renders in full", () => {
  const folds = createFolds(() => false);
  const renderers = toolRenderers("bash", folds);
  const failed = context({ toolCallId: "e1", isError: true });
  renderers.renderCall({ command: "false" }, theme, failed);
  addFold(folds, "e1", "bash");
  settleFold(folds, "e1", true);
  closeFolds(folds);
  assert.equal(foldGroup(folds, "e1"), null);
  assert.deepEqual(rendered(renderers.renderCall({ command: "false" }, theme, failed)), ["<error>• <toolTitle>Ran false"]);
  assert.deepEqual(rendered(renderers.renderResult(result("boom"), { expanded: false }, theme, failed)), ["  <error>boom"]);
});

test("a control notice is one row: the state, and the signal without what the title already carries", () => {
  assert.equal(noticeLine({ agent: "researcher", message: "researcher is waiting for a supervisor reply" }, theme),
    "<warning>• <toolTitle>researcher needs attention<muted> · is waiting for a supervisor reply");
  // buildControlEvent's default idle signal repeats the state and parenthesizes the reason.
  assert.equal(noticeLine({ agent: "researcher", message: "researcher needs attention (no observed activity for 300s)" }, theme),
    "<warning>• <toolTitle>researcher needs attention<muted> · no observed activity for 300s");
  assert.equal(noticeLine({ agent: "researcher", message: "researcher needs attention after repeated mutating tool failures" }, theme),
    "<warning>• <toolTitle>researcher needs attention<muted> · after repeated mutating tool failures");
  // The completion guard's own signal names neither state, so it survives whole.
  assert.equal(noticeLine({ agent: "ts-reviewer", failed: true, message: "ts-reviewer completed without making edits for an implementation task" }, theme),
    "<error>• <toolTitle>ts-reviewer failed<muted> · completed without making edits for an implementation task");
  // A trailing bracket that does not wrap the whole reason stays put.
  assert.equal(noticeLine({ agent: "ts-reviewer", failed: true, message: "ts-reviewer failed timing out (soft)" }, theme),
    "<error>• <toolTitle>ts-reviewer failed<muted> · timing out (soft)");
  assert.equal(noticeLine({ agent: "researcher", message: "" }, theme), "<warning>• <toolTitle>researcher needs attention");
});
