import test from "node:test";
import assert from "node:assert/strict";
import { Markdown } from "@earendil-works/pi-tui";
import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { addFold, answerLines, blankReasoning, bodyLines, bulletMarkdown, callTitle, closeFolds, completionLine, createFolds, createTurnClock, formatDuration, formatTurn, glyph, installFolding, noticeLine, pluginRenderers, pluginTitle, resultSummary, summarise, toolRenderers } from "./rows.mjs";

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
  closeFolds(folds); // nothing open: no re-invalidation
  assert.deepEqual(rows.map(row => row.invalidated), [4, 5, 4]);
  addFold(folds, "d", "grep");
  assert.equal(folds.byId.get("d").collapsed, false);
  assert.equal(folds.byId.get("a").collapsed, true);
});

test("a group that forms while ctrl+o is on opens with it", () => {
  const folds = createFolds(() => true);
  const renderers = toolRenderers("read", folds);
  const ctx = () => context({ toolCallId: "g1" });
  renderers.renderCall({ path: "a" }, theme, ctx());
  addFold(folds, "g1", "read");
  closeFolds(folds);
  // The flag was already true at close, so no transition is left to react to.
  assert.deepEqual(rendered(renderers.renderCall({ path: "a" }, theme, ctx())), ["<toolTitle>▾ Read 1 file", "<success>• <toolTitle>Read a"]);
});

test("summary wording", () => {
  assert.equal(summarise({ read: 3, bash: 9, grep: 1, edit: 2, list: 1, mcp: 2 }), "Read 3 files, ran 9 shell commands, searched for 1 pattern, edited 2 files, listed 1 path, called 2 MCP tools");
  assert.equal(summarise({ write: 1 }), "Wrote 1 file");
  assert.equal(summarise({}), "");
});

test("folding closes on assistant text, streaming or not, and on anything that stays visible; MCP rows fold, subagent rows never", () => {
  const folds = createFolds();
  const handlers = {};
  installFolding({ on: (name, fn) => { handlers[name] = fn; } }, { ui: { getToolsExpanded: () => false } }, folds);
  handlers.tool_execution_start({ toolName: "workspace_read", toolCallId: "r1" });
  handlers.tool_execution_start({ toolName: "mcp__exa_web_search_exa", toolCallId: "m1" });
  handlers.message_update({ message: { role: "assistant", content: [{ type: "thinking", thinking: "hm" }, { type: "text", text: " " }] } });
  handlers.message_update({ message: { role: "user", content: [{ type: "text", text: "hi" }] } });
  assert.equal(folds.byId.get("r1").collapsed, false);
  assert.deepEqual(folds.byId.get("m1").counts, { read: 1, mcp: 1 });
  // A subagent row stays visible: it closes the group, and the next foldable row opens a new one.
  handlers.tool_execution_start({ toolName: "subagent", toolCallId: "s1" });
  assert.equal(folds.byId.has("s1"), false);
  assert.equal(folds.byId.get("r1").collapsed, true);
  handlers.tool_execution_start({ toolName: "workspace_bash", toolCallId: "b1" });
  assert.notEqual(folds.byId.get("b1"), folds.byId.get("r1"));
  assert.deepEqual(folds.byId.get("b1").counts, { bash: 1 });
  handlers.message_update({ message: { role: "assistant", content: [{ type: "text", text: "Done" }] } });
  assert.equal(folds.byId.get("b1").collapsed, true);
  // A failure (pi's isError or the adapter's details.error) closes its group as the last row.
  handlers.tool_execution_start({ toolName: "workspace_bash", toolCallId: "b2" });
  handlers.tool_execution_end({ toolName: "workspace_bash", toolCallId: "b2", isError: true, result: {} });
  assert.equal(folds.byId.get("b2").collapsed, true);
  handlers.tool_execution_start({ toolName: "mcp__exa_web_search_exa", toolCallId: "m2" });
  handlers.tool_execution_end({ toolName: "mcp__exa_web_search_exa", toolCallId: "m2", isError: false, result: { details: { error: "auth_required" } } });
  assert.equal(folds.byId.get("m2").collapsed, true);
  handlers.tool_execution_start({ toolName: "workspace_read", toolCallId: "r2" });
  handlers.tool_execution_end({ toolName: "workspace_read", toolCallId: "r2", isError: false, result: { details: {} } });
  assert.equal(folds.byId.get("r2").collapsed, false);
  // Parallel tools end in completion order: a failure from an earlier, already
  // closed group (or a non-foldable tool) leaves the group still forming alone.
  handlers.tool_execution_end({ toolName: "workspace_bash", toolCallId: "b1", isError: true, result: {} });
  handlers.tool_execution_end({ toolName: "subagent", toolCallId: "s1", isError: true, result: {} });
  assert.equal(folds.byId.get("r2").collapsed, false);
  // A new run closes whatever is open; a non-streaming reply closes at its end.
  handlers.agent_start({});
  assert.equal(folds.byId.get("r2").collapsed, true);
  handlers.tool_execution_start({ toolName: "workspace_read", toolCallId: "r3" });
  handlers.message_end({ message: { role: "assistant", content: [{ type: "text", text: "Ok" }] } });
  assert.equal(folds.byId.get("r3").collapsed, true);
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

test("a failed row stays visible inside a fold, under the summary when it is the first row", () => {
  const folds = createFolds();
  const renderers = toolRenderers("bash", folds);
  const failed = context({ toolCallId: "e1", isError: true });
  renderers.renderCall({ command: "false" }, theme, failed);
  addFold(folds, "e1", "bash");
  closeFolds(folds);
  assert.deepEqual(rendered(renderers.renderCall({ command: "false" }, theme, failed)), ["<muted>▸ Ran 1 shell command", "<error>• <toolTitle>Ran false"]);
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
