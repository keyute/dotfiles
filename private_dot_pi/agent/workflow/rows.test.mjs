import test from "node:test";
import assert from "node:assert/strict";
import { Markdown } from "@earendil-works/pi-tui";
import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { addFold, answerLines, appendVisible, blankReasoning, bodyLines, bulletMarkdown, callTitle, closeFolds, completionLine, createFolds, createTurnClock, doneEntryRenderer, doneGroup, foldGroup, formatDuration, formatTurn, glyph, hideStreamingReasoning, installFolding, liveGroup, noticeLine, paintCounts, planRenderers, pluginRenderers, pluginTitle, resultSummary, settleFold, summarise, toolRenderers } from "./rows.mjs";

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
  const rows = [["read", "a", { path: "a" }], ["read", "b", { path: "b" }], ["bash", "c", { command: "c" }]].map(([tool, id, args]) => ({ tool, id, args, renderers: toolRenderers(tool, folds), invalidated: 0 }));
  const contextFor = (row, expanded = false) => context({ toolCallId: row.id, expanded, invalidate: () => row.invalidated++ });
  const click = y => ({ type: "click", button: "left", x: 0, y });
  for (const row of rows) {
    row.renderers.renderCall(row.args, theme, contextFor(row)); // first render precedes registration
    addFold(folds, row.id, row.tool);
  }
  // A run seals only once every member has an outcome: until then any of them
  // could turn out to be a separator rather than a member. Settling the second
  // row forms the live block early, though — no boundary needed — and it grows
  // again with the third, so both wake once more when the boundary seals it.
  for (const row of rows) settleFold(folds, row.id, false);
  closeFolds(folds);
  assert.deepEqual(rows.map(row => row.invalidated), [3, 3, 2]);
  const handle = rows[0].renderers.renderCall({ path: "a" }, theme, contextFor(rows[0]));
  assert.deepEqual(rendered(handle), ["<muted>▸ Read 2 files, ran 1 shell command"]);
  assert.deepEqual(rendered(rows[0].renderers.renderResult(result("x"), { expanded: false }, theme, contextFor(rows[0]))), []);
  assert.deepEqual(rendered(rows[2].renderers.renderCall({ command: "c" }, theme, contextFor(rows[2]))), []);
  // Only the summary line answers clicks; anything else is pi's own toggle.
  assert.equal(handle.handleMouse(click(1)), undefined);
  assert.equal(handle.handleMouse({ ...click(0), type: "down" }), undefined);
  assert.deepEqual(handle.handleMouse(click(0)), { handled: true });
  assert.deepEqual(rows.map(row => row.invalidated), [4, 4, 3]);
  // Clicked open with ctrl+o off, the group renders at the `members` level: the
  // handle stays (now `▾`), and every row is one `↳` member line, no body —
  // never today's full open rows.
  const open = rows[0].renderers.renderCall({ path: "a" }, theme, contextFor(rows[0]));
  assert.deepEqual(rendered(open), ["<toolTitle>▾ Read 2 files, ran 1 shell command", "  <muted>↳ <toolTitle>Read a", "  <muted>↳ <toolTitle>Read b", "  <muted>↳ <toolTitle>Ran c"]);
  assert.deepEqual(rendered(rows[2].renderers.renderCall({ command: "c" }, theme, contextFor(rows[2]))), []);
  assert.deepEqual(rendered(rows[2].renderers.renderResult(result("x"), { expanded: false }, theme, contextFor(rows[2]))), []);
  // A row's own `expanded` flag is a body toggle; the members level has no body to toggle.
  assert.deepEqual(rendered(rows[0].renderers.renderCall({ path: "a" }, theme, contextFor(rows[0], true))), ["<toolTitle>▾ Read 2 files, ran 1 shell command", "  <muted>↳ <toolTitle>Read a", "  <muted>↳ <toolTitle>Read b", "  <muted>↳ <toolTitle>Ran c"]);
  assert.deepEqual(rows.map(row => row.invalidated), [4, 4, 3]);
  open.handleMouse(click(0));
  assert.deepEqual(rows.map(row => row.invalidated), [5, 5, 4]);
  assert.deepEqual(rendered(rows[2].renderers.renderCall({ command: "c" }, theme, contextFor(rows[2]))), []);
  // A row's own flag (left true by the click above) says nothing about the
  // group; ctrl+o is pi's global flag, and its change opens the closed group
  // from whichever row renders first (siblings woken, that row not re-entered).
  assert.deepEqual(rendered(rows[0].renderers.renderCall({ path: "a" }, theme, contextFor(rows[0], true))), ["<muted>▸ Read 2 files, ran 1 shell command"]);
  toolsExpanded = true;
  assert.deepEqual(rendered(rows[2].renderers.renderCall({ command: "c" }, theme, contextFor(rows[2], true))), ["<success>• <toolTitle>Ran c"]);
  assert.deepEqual(rows.map(row => row.invalidated), [6, 6, 4]);
  // ctrl+o off drives every group back to collapsed, as the handle does.
  toolsExpanded = false;
  assert.deepEqual(rendered(rows[0].renderers.renderCall({ path: "a" }, theme, contextFor(rows[0]))), ["<muted>▸ Read 2 files, ran 1 shell command"]);
  assert.deepEqual(rows.map(row => row.invalidated), [6, 7, 5]);
  closeFolds(folds); // the run already ends in a boundary: no second one, no re-invalidation
  assert.deepEqual(rows.map(row => row.invalidated), [6, 7, 5]);
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
  const approved = result("Plan approved; scoped execution enabled.", { decision: "approved" });
  assert.deepEqual(rendered(planRenderers.renderResult(approved, { expanded: false }, theme, settled)), ["  <muted>↳ <success>approved"]);
  assert.deepEqual(rendered(planRenderers.renderResult(approved, { expanded: true }, theme, settled)), ["  <muted>↳ <success>approved", ...body]);
  const revision = result("Plan revision requested.", { decision: "revision_requested" });
  assert.deepEqual(rendered(planRenderers.renderResult(revision, { expanded: false }, theme, settled)), ["  <muted>↳ <warning>revision requested"]);
  const cancelled = result("Plan approval cancelled.", { decision: "cancelled" });
  assert.deepEqual(rendered(planRenderers.renderResult(cancelled, { expanded: false }, theme, settled)), ["  <muted>↳ <warning>cancelled"]);
  const legacyApproved = result("Plan approved; scoped execution enabled.");
  assert.deepEqual(rendered(planRenderers.renderResult(legacyApproved, { expanded: false }, theme, settled)), ["  <muted>↳ <success>approved"]);
  const legacyRejected = result("Plan not approved. Remain in planning mode.");
  assert.deepEqual(rendered(planRenderers.renderResult(legacyRejected, { expanded: false }, theme, settled)), ["  <muted>↳ <warning>not approved"]);
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

test("grouping closes on assistant text and visible rows; MCP, discovery, and launches group, other management and background-task rows do not", () => {
  const folds = createFolds();
  const handlers = {};
  installFolding({ on: (name, fn) => { handlers[name] = fn; } }, { ui: { getToolsExpanded: () => false } }, folds);
  const start = (toolName, toolCallId, args) => handlers.tool_execution_start({ toolName, toolCallId, args });
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
  // A subagent launch joins the run above it like any other foldable fact.
  start("workspace_read", "r4");
  start("workspace_read", "r5");
  ok("r4");
  ok("r5");
  start("subagent", "s1", { agent: "researcher", task: "x" });
  ok("s1");
  start("subagent", "s2", { action: "status", id: "r1" }); // management: a boundary, seals the run above and joins none
  assert.equal(foldGroup(folds, "s2"), null);
  assert.deepEqual(foldGroup(folds, "s1").counts, { read: 2, agent: 1 });
  assert.equal(foldGroup(folds, "r4"), foldGroup(folds, "s1"));
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

test("two subagent launches alone seal into a run, a failed launch is never a member, and a background bash keys as task only once it outlives its grace period", () => {
  const folds = createFolds();
  const handlers = {};
  installFolding({ on: (name, fn) => { handlers[name] = fn; } }, { ui: { getToolsExpanded: () => false } }, folds);
  const start = (toolName, toolCallId, args) => handlers.tool_execution_start({ toolName, toolCallId, args });
  const end = (toolCallId, opts = {}) => handlers.tool_execution_end({ toolCallId, isError: false, result: { details: {} }, ...opts });
  start("subagent", "a1", { agent: "researcher", task: "x" });
  start("subagent", "a2", { agent: "reviewer", task: "y" });
  end("a1");
  end("a2");
  handlers.message_end({ message: { role: "assistant", content: [{ type: "text", text: "done" }] } });
  assert.deepEqual(foldGroup(folds, "a1").counts, { agent: 2 });
  assert.equal(summarise(foldGroup(folds, "a1").counts), "Launched 2 agents");

  const failedFolds = createFolds();
  const failedHandlers = {};
  installFolding({ on: (name, fn) => { failedHandlers[name] = fn; } }, { ui: { getToolsExpanded: () => false } }, failedFolds);
  const fstart = (toolName, toolCallId, args) => failedHandlers.tool_execution_start({ toolName, toolCallId, args });
  fstart("subagent", "g1", { agent: "researcher", task: "x" });
  fstart("subagent", "g2", { agent: "reviewer", task: "y" });
  fstart("subagent", "g3", { agent: "planner", task: "z" });
  failedHandlers.tool_execution_end({ toolCallId: "g1", isError: false, result: { details: {} } });
  // isError and the adapter's own details.error both mark a launch as failed.
  failedHandlers.tool_execution_end({ toolCallId: "g2", isError: false, result: { details: { error: "timeout" } } });
  failedHandlers.tool_execution_end({ toolCallId: "g3", isError: false, result: { details: {} } });
  failedHandlers.message_end({ message: { role: "assistant", content: [{ type: "text", text: "done" }] } });
  assert.equal(foldGroup(failedFolds, "g2"), null);
  assert.equal(foldGroup(failedFolds, "g1"), null, "a lone launch ahead of the failure has no run to join");
  assert.deepEqual(foldGroup(failedFolds, "g3"), null, "a lone launch behind the failure has no run to join either");

  const bashFolds = createFolds();
  const bashHandlers = {};
  installFolding({ on: (name, fn) => { bashHandlers[name] = fn; } }, { ui: { getToolsExpanded: () => false } }, bashFolds);
  for (const id of ["t1", "t2", "b1", "b2"]) bashHandlers.tool_execution_start({ toolName: "workspace_bash", toolCallId: id });
  bashHandlers.tool_execution_end({ toolCallId: "t1", isError: false, result: { details: { taskId: "task-1" } } });
  bashHandlers.tool_execution_end({ toolCallId: "t2", isError: false, result: { details: { taskId: "task-2" } } });
  bashHandlers.tool_execution_end({ toolCallId: "b1", isError: false, result: { details: {} } });
  bashHandlers.tool_execution_end({ toolCallId: "b2", isError: false, result: { details: {} } });
  bashHandlers.message_end({ message: { role: "assistant", content: [{ type: "text", text: "done" }] } });
  assert.deepEqual(foldGroup(bashFolds, "t1").counts, { task: 2, bash: 2 });
});

test("summarise names launches and background commands", () => {
  assert.equal(summarise({ read: 2, agent: 3, task: 1 }), "Read 2 files, launched 3 agents, started 1 background command");
});

test("successful calls, discovery, launches, and completions share one chronological activity group", () => {
  const folds = createFolds(() => false);
  const handlers = {};
  installFolding({ on: (name, fn) => { handlers[name] = fn; } }, { ui: { getToolsExpanded: () => false } }, folds);
  const calls = [
    ["r1", "workspace_read", { path: "a.mjs" }],
    ["w1", "web_search", { query: "pi tui" }],
    ["m1", "mcp", { search: "mouse region" }],
    ["d1", "subagent", { action: "list" }],
    ["a1", "subagent", { agent: "researcher", task: "Audit rows" }],
  ];
  for (const [toolCallId, toolName, args] of calls) handlers.tool_execution_start({ toolName, toolCallId, args });
  for (const [toolCallId] of calls) handlers.tool_execution_end({ toolCallId, isError: false, result: { content: [], details: {} } });

  const child = { agent: "researcher", task: "Audit rows", status: "completed", durationMs: 45_000 };
  const task = { id: "t1", command: "npm test", status: "completed", durationMs: 12_000 };
  appendVisible(fakePi(), "workflow-child", child, folds);
  appendVisible(fakePi(), "workflow-task", task, folds);
  handlers.message_update({ message: { role: "assistant", content: [{ type: "text", text: "Done" }] } });

  const group = foldGroup(folds, "r1");
  assert.equal(doneGroup(folds, child.seq), group);
  assert.equal(doneGroup(folds, task.seq), group);
  assert.deepEqual(group.entries.map(entry => entry.id), ["r1", "w1", "m1", "d1", "a1", child.seq, task.seq]);
  assert.deepEqual(group.counts, { read: 1, web: 1, mcp: 1, discovery: 1, agent: 1, agentDone: 1, taskDone: 1 });
  assert.equal(summarise(group.counts), "Read 1 file, called 1 MCP tool, ran 1 web search, ran 1 agent discovery, launched 1 agent, finished 1 agent, finished 1 background task");
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
  // and the other is not disturbed by that click. Clicked open with the flag
  // off, the group renders at the `members` level, not today's full rows.
  const handle = renderers.e1.renderCall({ path: "e1" }, theme, ctx("e1"));
  handle.handleMouse({ type: "click", button: "left", x: 0, y: 0 });
  assert.deepEqual(draw("e1"), ["<toolTitle>▾ Edited 2 files", "  <muted>↳ <toolTitle>Edited e1", "  <muted>↳ <toolTitle>Edited e2"]);
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

test("a live group forms at the second settled success, not the first, and is never a sealed one", () => {
  const folds = createFolds();
  const handlers = {};
  installFolding({ on: (name, fn) => { handlers[name] = fn; } }, { ui: { getToolsExpanded: () => false } }, folds);
  handlers.tool_execution_start({ toolName: "workspace_read", toolCallId: "a" });
  handlers.tool_execution_start({ toolName: "workspace_read", toolCallId: "b" });
  handlers.tool_execution_end({ toolCallId: "a", isError: false, result: { details: {} } });
  assert.equal(liveGroup(folds, "a"), null);
  handlers.tool_execution_end({ toolCallId: "b", isError: false, result: { details: {} } });
  assert.deepEqual(liveGroup(folds, "a").counts, { read: 2 });
  assert.equal(liveGroup(folds, "a"), liveGroup(folds, "b"));
  assert.equal(foldGroup(folds, "a"), null, "a live group is never a sealed one");
});

test("a pending fact earlier in the run holds the live block back; one later in the run does not, and that row stays a plain one", () => {
  const folds = createFolds();
  const handlers = {};
  installFolding({ on: (name, fn) => { handlers[name] = fn; } }, { ui: { getToolsExpanded: () => false } }, folds);
  for (const id of ["p", "a", "b"]) handlers.tool_execution_start({ toolName: "workspace_read", toolCallId: id });
  handlers.tool_execution_end({ toolCallId: "a", isError: false, result: { details: {} } });
  handlers.tool_execution_end({ toolCallId: "b", isError: false, result: { details: {} } });
  // `p` (still pending) precedes both in the timeline, so neither joins a block yet.
  assert.equal(liveGroup(folds, "a"), null);
  assert.equal(liveGroup(folds, "b"), null);
  handlers.tool_execution_end({ toolCallId: "p", isError: false, result: { details: {} } });
  assert.deepEqual(liveGroup(folds, "p").counts, { read: 3 });

  const later = createFolds();
  const laterHandlers = {};
  installFolding({ on: (name, fn) => { laterHandlers[name] = fn; } }, { ui: { getToolsExpanded: () => false } }, later);
  for (const id of ["a", "b", "p", "c"]) laterHandlers.tool_execution_start({ toolName: "workspace_read", toolCallId: id });
  laterHandlers.tool_execution_end({ toolCallId: "a", isError: false, result: { details: {} } });
  laterHandlers.tool_execution_end({ toolCallId: "b", isError: false, result: { details: {} } });
  laterHandlers.tool_execution_end({ toolCallId: "c", isError: false, result: { details: {} } });
  // `p`'s pending outcome blocks only what follows it in the timeline: `a`/`b`
  // already stand as the block, and `c` — settled but behind the still-pending
  // `p` — renders as a plain row, not held back with it.
  assert.deepEqual(liveGroup(later, "a").counts, { read: 2 });
  assert.equal(liveGroup(later, "a"), liveGroup(later, "b"));
  assert.equal(liveGroup(later, "c"), null);
  assert.equal(liveGroup(later, "p"), null);
});

test("a failed fact stands alone and seals the live stretch above it into a sealed group, sentence level", () => {
  const folds = createFolds(() => false);
  const handlers = {};
  installFolding({ on: (name, fn) => { handlers[name] = fn; } }, { ui: { getToolsExpanded: () => false } }, folds);
  for (const id of ["a", "b"]) handlers.tool_execution_start({ toolName: "workspace_read", toolCallId: id });
  handlers.tool_execution_end({ toolCallId: "a", isError: false, result: { details: {} } });
  handlers.tool_execution_end({ toolCallId: "b", isError: false, result: { details: {} } });
  assert.deepEqual(liveGroup(folds, "a").counts, { read: 2 });
  handlers.tool_execution_start({ toolName: "workspace_bash", toolCallId: "f" });
  handlers.tool_execution_end({ toolCallId: "f", isError: true, result: {} });
  assert.equal(liveGroup(folds, "a"), null, "the failure sealed it: no live group left");
  assert.equal(liveGroup(folds, "f"), null);
  assert.deepEqual(foldGroup(folds, "a").counts, { read: 2 });
  assert.equal(foldGroup(folds, "f"), null, "the failure itself is never a member");
  const renderers = toolRenderers("read", folds);
  assert.deepEqual(rendered(renderers.renderCall({ path: "a" }, theme, context({ toolCallId: "a" }))), ["<muted>▸ Read 2 files"]);
});

test("a live block's member lines carry each row's own settled summary; the group behaves the same once sealed, clicked open, or under ctrl+o", () => {
  let toolsExpanded = false;
  const folds = createFolds(() => toolsExpanded);
  const renderers = {
    read: toolRenderers("read", folds),
    edit: toolRenderers("edit", folds),
    bash: toolRenderers("bash", folds),
    subagent: pluginRenderers("subagent", { folds }),
  };
  // The sentence wraps at 80 columns; render wide so its assembly is one string.
  const wide = component => component.render(200).map(line => line.trimEnd());
  const ctx = id => context({ toolCallId: id });
  const mount = (kind, id, args, tool = kind) => { renderers[kind].renderCall(args, theme, ctx(id)); addFold(folds, id, tool); };
  mount("read", "r1", { path: "a.mjs" });
  mount("edit", "e1", { path: "b.mjs" });
  mount("bash", "b1", { command: "npm test" });
  mount("subagent", "s1", { agent: "researcher", task: "x" }, "agent");
  mount("bash", "t1", { command: "npm run watch", run_in_background: true });
  settleFold(folds, "r1", false, result(""));
  settleFold(folds, "e1", false, result("ok", { diff: "-  1 old\n+  1 new\n+  2 more\n   3 same" }));
  settleFold(folds, "b1", false, result("one\ntwo"));
  settleFold(folds, "s1", false, result("Async run r1", { asyncId: "r1" }));
  settleFold(folds, "t1", false, result("Started", { taskId: "task-1" }));

  const memberLines = [
    "  <muted>↳ <toolTitle>Read a.mjs",
    "  <muted>↳ <toolTitle>Edited b.mjs<muted> · <success>+2 <error>−1",
    "  <muted>↳ <toolTitle>Ran npm test<muted> · <muted>2 lines",
    "  <muted>↳ <toolTitle>researcher › x",
    "  <muted>↳ <toolTitle>Started npm run watch in background<muted> · <muted>task task-1 · running",
  ];
  const sentence = "Read 1 file, ran 1 shell command, edited 1 file, launched 1 agent, started 1 background command";
  assert.deepEqual(wide(renderers.read.renderCall({ path: "a.mjs" }, theme, ctx("r1"))), [`<success>• <toolTitle>${sentence}`, ...memberLines]);
  // Every other member's call slot, and every member's own result slot — the
  // first included — draws nothing: the sentence and every summary already
  // live in the block's one component.
  const members = [["edit", "e1", { path: "b.mjs" }], ["bash", "b1", { command: "npm test" }], ["subagent", "s1", { agent: "researcher", task: "x" }], ["bash", "t1", { command: "npm run watch", run_in_background: true }]];
  for (const [kind, id, args] of members) {
    assert.deepEqual(rendered(renderers[kind].renderCall(args, theme, ctx(id))), []);
    assert.deepEqual(rendered(renderers[kind].renderResult(result(""), { expanded: false }, theme, ctx(id))), []);
  }
  assert.deepEqual(rendered(renderers.read.renderResult(result(""), { expanded: false }, theme, ctx("r1"))), []);

  // Sealed: the sentence alone, dim, behind the handle.
  closeFolds(folds);
  assert.deepEqual(wide(renderers.read.renderCall({ path: "a.mjs" }, theme, ctx("r1"))), [`<muted>▸ ${sentence}`]);
  // Clicked open with ctrl+o off: the handle plus the same member lines.
  const handle = renderers.read.renderCall({ path: "a.mjs" }, theme, ctx("r1"));
  handle.handleMouse({ type: "click", button: "left", x: 0, y: 0 });
  assert.deepEqual(wide(renderers.read.renderCall({ path: "a.mjs" }, theme, ctx("r1"))), [`<toolTitle>▾ ${sentence}`, ...memberLines]);

  // ctrl+o outranks the click: the sealed group renders in full as before, its
  // handle's own toggle now a no-op, and a still-live block renders as plain,
  // ungrouped rows — it has nothing sealed to expand into.
  toolsExpanded = true;
  assert.deepEqual(wide(renderers.read.renderCall({ path: "a.mjs" }, theme, ctx("r1"))), [`<toolTitle>▾ ${sentence}`, "<success>• <toolTitle>Read a.mjs"]);
  assert.deepEqual(rendered(renderers.edit.renderCall({ path: "b.mjs" }, theme, ctx("e1"))), ["<success>• <toolTitle>Edited b.mjs"]);
  const noOp = renderers.read.renderCall({ path: "a.mjs" }, theme, ctx("r1"));
  noOp.toggle();
  assert.deepEqual(wide(renderers.read.renderCall({ path: "a.mjs" }, theme, ctx("r1"))), [`<toolTitle>▾ ${sentence}`, "<success>• <toolTitle>Read a.mjs"]);

  mount("read", "u1", { path: "u1.mjs" });
  mount("read", "u2", { path: "u2.mjs" });
  settleFold(folds, "u1", false, result(""));
  settleFold(folds, "u2", false, result(""));
  assert.ok(liveGroup(folds, "u1"), "a live group still forms under ctrl+o");
  assert.deepEqual(rendered(renderers.read.renderCall({ path: "u1.mjs" }, theme, ctx("u1"))), ["<success>• <toolTitle>Read u1.mjs"]);
  assert.deepEqual(rendered(renderers.read.renderCall({ path: "u2.mjs" }, theme, ctx("u2"))), ["<success>• <toolTitle>Read u2.mjs"]);
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
});

test("a subagent launch inside a sealed closed group renders nothing, launch line included", () => {
  const folds = createFolds(() => false);
  const subagent = pluginRenderers("subagent", { folds });
  const args = { agent: "explore-deep", task: "x" };
  const ctx = id => context({ toolCallId: id });
  subagent.renderCall(args, theme, ctx("l1")); // first render precedes registration
  subagent.renderCall(args, theme, ctx("l2"));
  addFold(folds, "l1", "agent");
  addFold(folds, "l2", "agent");
  settleFold(folds, "l1", false);
  settleFold(folds, "l2", false);
  closeFolds(folds);
  const launched = result("Async run r2", { asyncId: "r2" });
  assert.deepEqual(subagent.renderCall(args, theme, ctx("l2")).render(80), []);
  assert.deepEqual(subagent.renderResult(launched, { expanded: false }, theme, ctx("l2")).render(80), []);
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

test("hideStreamingReasoning blanks a copy of the thinking block without touching the original or unrelated messages", () => {
  const thinkingBlock = { type: "thinking", thinking: "weighing it up" };
  const textBlock = { type: "text", text: "hi" };
  const message = { role: "assistant", api: "openai-responses", content: [thinkingBlock, textBlock] };
  hideStreamingReasoning(message);
  assert.equal(message.content[0].thinking, "");
  assert.equal(thinkingBlock.thinking, "weighing it up");
  assert.equal(message.content[1], textBlock);
  const anthropic = { role: "assistant", api: "anthropic-messages", content: [{ type: "thinking", thinking: "weighing it up" }] };
  hideStreamingReasoning(anthropic);
  assert.equal(anthropic.content[0].thinking, "weighing it up");
  const user = { role: "user", content: [] };
  const userContent = user.content;
  hideStreamingReasoning(user);
  assert.equal(user.content, userContent);
});

test("answers, completion and turn lines format", () => {
  assert.deepEqual(answerLines([{ question: "Pad both sides?", answer: "yes" }], theme), [
    "<success>• <toolTitle>User answered pi's question",
    "  <muted>↳ Pad both sides? <muted>→ yes",
  ]);
  // Custom text is the whole answer when the user writes instead of picking.
  assert.deepEqual(answerLines([{ question: "Which marker?", answer: "", notes: "or use the background" }, { question: "Pad?", answer: "yes", notes: "both sides" }], theme), [
    "<success>• <toolTitle>User answered pi's questions",
    "  <muted>↳ Which marker? <muted>→ or use the background",
    "  <muted>↳ Pad? <muted>→ yes — both sides",
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

// Successful completions are activity facts on the same ladder as successful
// tool rows; `appendVisible` gives each one a `seq`, and `doneEntryRenderer`
// decides whether its entry owns the shared group or renders plain.
const childMapper = "workflow-child";
const taskMapper = "workflow-task";
const fakePi = () => ({ appendEntry() {} });

test("one completed completion has no group and renders as today's plain line", () => {
  const folds = createFolds(() => false);
  const data = { agent: "researcher", task: "x", status: "completed", durationMs: 45_000 };
  appendVisible(fakePi(), "workflow-child", data, folds);
  assert.equal(doneGroup(folds, data.seq), null);
  const component = doneEntryRenderer(childMapper, folds)({ data }, {}, theme);
  assert.deepEqual(rendered(component), [completionLine(data, theme)]);
});

test("two adjacent completed completions form one activity group; the second member's renderer answers with no component at all", () => {
  const folds = createFolds(() => false);
  const a = { agent: "researcher", task: "Delegation claims", status: "completed", durationMs: 45_000 };
  const b = { id: "t1", command: "npm test", status: "completed", durationMs: 12_000 };
  appendVisible(fakePi(), "workflow-child", a, folds);
  appendVisible(fakePi(), "workflow-task", b, folds);
  const group = doneGroup(folds, a.seq);
  assert.deepEqual(group.entries.map(entry => entry.id), [a.seq, b.seq]);
  assert.equal(doneGroup(folds, b.seq), group);
  const render = doneEntryRenderer(childMapper, folds);
  assert.ok(render({ data: a }, {}, theme));
  assert.equal(doneEntryRenderer(taskMapper, folds)({ data: b }, {}, theme), undefined);
});

test("a completion at any other status stands alone and separates the completed ones around it", () => {
  const folds = createFolds(() => false);
  const a = { agent: "researcher", task: "x", status: "completed" };
  const mid = { agent: "reviewer", task: "y", status: "failed" };
  const b = { agent: "planner", task: "z", status: "completed" };
  appendVisible(fakePi(), "workflow-child", a, folds);
  appendVisible(fakePi(), "workflow-child", mid, folds);
  appendVisible(fakePi(), "workflow-child", b, folds);
  assert.equal(mid.seq, undefined);
  assert.equal(doneGroup(folds, a.seq), null);
  assert.equal(doneGroup(folds, b.seq), null);
});

test("a successful tool between completions joins their one group; a visible boundary still separates them", () => {
  const toolFolds = createFolds(() => false);
  const c = { agent: "researcher", task: "x", status: "completed" };
  const d = { agent: "reviewer", task: "y", status: "completed" };
  appendVisible(fakePi(), "workflow-child", c, toolFolds);
  addFold(toolFolds, "r1", "read");
  settleFold(toolFolds, "r1", false);
  appendVisible(fakePi(), "workflow-child", d, toolFolds);
  const mixed = doneGroup(toolFolds, c.seq);
  assert.equal(doneGroup(toolFolds, d.seq), mixed);
  assert.equal(liveGroup(toolFolds, "r1"), mixed);
  assert.deepEqual(mixed.entries.map(entry => entry.id), [c.seq, "r1", d.seq]);

  const boundaryFolds = createFolds(() => false);
  const e = { agent: "researcher", task: "x", status: "completed" };
  const f = { agent: "reviewer", task: "y", status: "completed" };
  appendVisible(fakePi(), "workflow-child", e, boundaryFolds);
  closeFolds(boundaryFolds);
  appendVisible(fakePi(), "workflow-child", f, boundaryFolds);
  assert.equal(doneGroup(boundaryFolds, e.seq), null);
  assert.equal(doneGroup(boundaryFolds, f.seq), null);
});

test("a successful completion extends the live tool group and the next visible boundary seals them together", () => {
  const folds = createFolds(() => false);
  addFold(folds, "r1", "read");
  addFold(folds, "r2", "read");
  settleFold(folds, "r1", false);
  settleFold(folds, "r2", false);
  assert.equal(foldGroup(folds, "r1"), null, "still live, not sealed, before the completion lands");
  const data = { agent: "researcher", task: "x", status: "completed" };
  appendVisible(fakePi(), "workflow-child", data, folds);
  const live = liveGroup(folds, "r1");
  assert.equal(doneGroup(folds, data.seq), live);
  assert.deepEqual(live.counts, { read: 2, agentDone: 1 });
  closeFolds(folds);
  const sealed = foldGroup(folds, "r1");
  assert.equal(doneGroup(folds, data.seq), sealed);
  assert.deepEqual(sealed.entries.map(entry => entry.id), ["r1", "r2", data.seq]);
});

test("a completion behind a pending call stays rendered whichever way that call settles", () => {
  for (const failed of [false, true]) {
    const folds = createFolds(() => false);
    addFold(folds, "pending", "read");
    const data = { agent: "researcher", task: "x", status: "completed", durationMs: 1_000 };
    appendVisible(fakePi(), "workflow-child", data, folds);
    const component = doneEntryRenderer("workflow-child", folds)({ data }, {}, theme);
    assert.deepEqual(rendered(component), [completionLine(data, theme)]);
    settleFold(folds, "pending", failed);
    assert.deepEqual(rendered(component), [completionLine(data, theme)]);
    assert.equal(doneGroup(folds, data.seq), null);
  }
});

test("a tool-led mixed group owns one handle and one chronological member ladder", () => {
  const folds = createFolds(() => false);
  const reads = toolRenderers("read", folds);
  const ctx = id => context({ toolCallId: id });
  reads.renderCall({ path: "a" }, theme, ctx("r1"));
  reads.renderCall({ path: "b" }, theme, ctx("r2"));
  addFold(folds, "r1", "read");
  addFold(folds, "r2", "read");
  settleFold(folds, "r1", false);
  settleFold(folds, "r2", false);
  const a = { agent: "researcher", task: "x", status: "completed", durationMs: 1_000 };
  const b = { agent: "reviewer", task: "y", status: "completed", durationMs: 2_000 };
  appendVisible(fakePi(), "workflow-child", a, folds);
  appendVisible(fakePi(), "workflow-child", b, folds);
  closeFolds(folds);

  assert.equal(doneEntryRenderer("workflow-child", folds)({ data: a }, {}, theme), undefined);
  const handle = reads.renderCall({ path: "a" }, theme, ctx("r1"));
  assert.deepEqual(rendered(handle), ["<muted>▸ Read 2 files, finished 2 agents"]);
  handle.handleMouse({ type: "click", button: "left", x: 0, y: 0 });
  assert.deepEqual(rendered(reads.renderCall({ path: "a" }, theme, ctx("r1"))), [
    "<toolTitle>▾ Read 2 files, finished 2 agents",
    "  <muted>↳ <toolTitle>Read a",
    "  <muted>↳ <toolTitle>Read b",
    "  <muted>↳ <toolTitle>researcher finished › x<muted> · 1s",
    "  <muted>↳ <toolTitle>reviewer finished › y<muted> · 2s",
  ]);
});

test("a completion-led agent+task group shares one sentence; sealed, clicked, and under ctrl+o", () => {
  let toolsExpanded = false;
  const folds = createFolds(() => toolsExpanded);
  const a = { agent: "researcher", task: "Delegation claims", status: "completed", durationMs: 45_000 };
  const b = { id: "t1", command: "npm test", status: "completed", durationMs: 12_000 };
  appendVisible(fakePi(), "workflow-child", a, folds);
  appendVisible(fakePi(), "workflow-task", b, folds);
  const component = doneEntryRenderer(childMapper, folds)({ data: a }, {}, theme);
  const memberLines = [
    "  <muted>↳ <toolTitle>researcher finished › Delegation claims<muted> · 45s",
    "  <muted>↳ <toolTitle>task t1 finished › npm test<muted> · 12s",
  ];
  // Live: nothing has closed the group yet.
  assert.deepEqual(rendered(component), ["<success>• <toolTitle>Finished 1 agent, finished 1 background task", ...memberLines]);

  // Sealed: the dim handle alone.
  closeFolds(folds);
  assert.deepEqual(rendered(component), ["<muted>▸ Finished 1 agent, finished 1 background task"]);

  // Clicked open with ctrl+o off: the undimmed handle plus the same member lines.
  assert.deepEqual(component.handleMouse({ type: "click", button: "left", x: 0, y: 0 }), { handled: true });
  assert.deepEqual(rendered(component), ["<toolTitle>▾ Finished 1 agent, finished 1 background task", ...memberLines]);

  // A click anywhere but the first line, or with the wrong button, changes nothing.
  assert.equal(component.handleMouse({ type: "click", button: "left", x: 0, y: 1 }), undefined);
  assert.equal(component.handleMouse({ type: "click", button: "right", x: 0, y: 0 }), undefined);
});

test("ctrl+o shows a sealed completion-led group's members and its own toggle is a no-op", () => {
  let toolsExpanded = false;
  const folds = createFolds(() => toolsExpanded);
  const a = { agent: "researcher", task: "x", status: "completed", durationMs: 1_000 };
  const b = { agent: "reviewer", task: "y", status: "completed", durationMs: 2_000 };
  appendVisible(fakePi(), "workflow-child", a, folds);
  appendVisible(fakePi(), "workflow-child", b, folds);
  closeFolds(folds);
  const component = doneEntryRenderer(childMapper, folds)({ data: a }, {}, theme);
  toolsExpanded = true;
  const memberLines = [
    "  <muted>↳ <toolTitle>researcher finished › x<muted> · 1s",
    "  <muted>↳ <toolTitle>reviewer finished › y<muted> · 2s",
  ];
  assert.deepEqual(rendered(component), ["<toolTitle>▾ Finished 2 agents", ...memberLines]);
  assert.equal(component.handleMouse({ type: "click", button: "left", x: 0, y: 0 }), undefined);
  assert.deepEqual(rendered(component), ["<toolTitle>▾ Finished 2 agents", ...memberLines]);
});

test("resumed completions whose seqs this process does not know all render as plain lines", () => {
  const folds = createFolds(() => false);
  const foreign = [
    { agent: "ghost", task: "z", status: "completed", seq: "other-process-1", durationMs: 500 },
    { agent: "reviewer", task: "y", status: "completed", seq: "other-process-2", durationMs: 1_000 },
  ];
  const render = doneEntryRenderer(childMapper, folds);
  for (const data of foreign) {
    const component = render({ data }, {}, theme);
    assert.ok(component);
    assert.deepEqual(rendered(component), [completionLine(data, theme)]);
  }
});

test("a completion's seq carries this process's own nonce; two folds in one process may share it", () => {
  const a = createFolds();
  const b = createFolds();
  assert.match(a.nonce, /^[a-z0-9]+$/);
  const data = { agent: "x", task: "", status: "completed" };
  appendVisible(fakePi(), "workflow-child", data, a);
  assert.equal(data.seq, `${a.nonce}-1`);
  const data2 = { agent: "y", task: "", status: "completed" };
  appendVisible(fakePi(), "workflow-child", data2, b);
  assert.equal(data2.seq, `${b.nonce}-1`);
});
