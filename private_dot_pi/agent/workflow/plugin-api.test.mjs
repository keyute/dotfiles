import test from "node:test";
import assert from "node:assert/strict";
import { recordingExec, trimHistory, workflowPrompt } from "./index.mjs";
import { DRAWN_ENTRIES, NOTICE_RENDERERS, QUIET_MESSAGES, controlNotice, mcpConfig, pluginApi } from "./plugin-api.mjs";
import { addFold, appendVisible, closeFolds, createFolds } from "./rows.mjs";
import { runnerPath } from "./operations.mjs";
import { narrowSubagentSchema } from "./children.mjs";

test("the plugin API decorates every registration and forwards everything else untouched", () => {
  const tools = new Map();
  const events = { on() {} };
  const pi = { events, on: () => "on", registerTool(tool) { tools.set(tool.name, tool); } };
  const styled = pluginApi(pi, name => ({ renderShell: "self", renderCall: `ours:${name}`, renderResult: "ours" }));
  const { registerTool } = styled; // a plugin may extract the function
  const execute = () => {};
  registerTool({ name: "subagent", execute, parameters: { a: 1 }, renderCall: "theirs", renderResult: "theirs" });
  registerTool({ name: "mcp__docs_q", execute, renderCall: "theirs" });
  registerTool({ name: "bg_wait", execute });
  assert.deepEqual(tools.get("subagent"), { name: "subagent", execute, parameters: { a: 1 }, renderShell: "self", renderCall: "ours:subagent", renderResult: "ours" });
  assert.equal(tools.get("mcp__docs_q").renderCall, "ours:mcp__docs_q");
  assert.equal(tools.get("bg_wait").renderCall, "ours:bg_wait");
  assert.equal(styled.events, events);
  assert.equal(styled.on, pi.on);
});

test("the plugin API replaces only the subagent description without changing its executor or schema", () => {
  const tools = new Map();
  const execute = () => {};
  const parameters = { type: "object", properties: { agent: {} } };
  const managed = "Managed subagent description.";
  const styled = pluginApi({ on() {}, registerTool(tool) { tools.set(tool.name, tool); } }, () => ({}), {}, {}, undefined, undefined, managed);
  styled.registerTool({ name: "subagent", description: "upstream", parameters, execute });
  styled.registerTool({ name: "other", description: "other upstream", parameters, execute });
  assert.equal(tools.get("subagent").description, managed);
  assert.equal(tools.get("subagent").parameters, parameters);
  assert.equal(tools.get("subagent").execute, execute);
  assert.equal(tools.get("other").description, "other upstream");
});

test("the subagent schema exposes only the managed launch and control surface", () => {
  const supported = ["agent", "task", "async", "context", "agentScope", "action", "id", "runId", "index", "message", "mode", "view", "lines", "steeringRecovery", "capabilities"];
  const upstream = { type: "object", description: "upstream safety description", properties: Object.fromEntries([...supported, "model", "cwd", "workflowScript"].map(name => [name, { description: `${name} definition` }])) };
  const narrowed = narrowSubagentSchema(upstream);
  assert.deepEqual(Object.keys(narrowed.properties).sort(), [...supported, "title"].sort());
  assert.equal(narrowed.additionalProperties, false);
  assert.deepEqual(narrowed.properties.action.enum, ["list", "status", "interrupt", "stop", "steer"]);
  assert.deepEqual(narrowed.properties.context.enum, ["fresh", "fork"]);
  assert.deepEqual(narrowed.properties.agentScope.enum, ["user"]);
  assert.equal(narrowed.description, "upstream safety description");
  assert.equal(narrowed.properties.task.description, "task definition");
  assert.equal(narrowed.properties.title.type, "string");
});

test("the plugin API narrows only the subagent definition and preserves its executor", () => {
  const tools = new Map();
  const pi = { on() {}, registerTool(tool) { tools.set(tool.name, tool); } };
  const execute = () => {};
  const schema = { type: "object", properties: { agent: {}, task: {}, async: {}, model: {}, context: {}, agentScope: {}, action: {}, id: {}, runId: {}, index: {}, message: {}, mode: {}, view: {}, lines: {}, steeringRecovery: {}, capabilities: {}, cwd: {} } };
  const styled = pluginApi(pi, () => ({}), {}, {}, narrowSubagentSchema);
  styled.registerTool({ name: "subagent", parameters: schema, execute });
  styled.registerTool({ name: "other", parameters: schema, execute });
  assert.equal(tools.get("subagent").execute, execute);
  assert.equal(tools.get("other").parameters, schema);
  assert.equal(tools.get("subagent").parameters.additionalProperties, false);
  assert.equal("cwd" in tools.get("subagent").parameters.properties, false);
});

const mcpFixture = () => ({
  mcp: {
    context7: { policy: { denied_tools: [] } },
    exa: { policy: { denied_tools: ["agent_run"] } },
    playwright: { policy: { denied_tools: ["browser_run_code_unsafe"] } },
  },
  agents: {
    researcher: { tools: ["workspace_read", "mcp__exa__web_fetch_exa", "mcp__context7__query_docs"] },
    reviewer: { tools: ["workspace_read"] },
  },
});

test("the root's MCP config defers every server and hides denied tools", () => {
  const { servers, errors } = mcpConfig(mcpFixture(), "root");
  assert.deepEqual(errors, []);
  assert.deepEqual(servers.map(server => server.name), ["context7", "exa", "playwright"]);
  const [context7, exa, playwright] = servers;
  assert.deepEqual(context7, { name: "context7", source: runnerPath, scope: "extension", config: {
    command: process.execPath, args: [runnerPath, "server", "context7"], env: { PI_WORKFLOW_ROLE: "root" }, exposure: "deferred", toolExposure: {},
  } });
  assert.deepEqual(servers.map(server => server.config.exposure), ["deferred", "deferred", "deferred"]);
  assert.deepEqual(exa.config.toolExposure, { agent_run: "hidden" });
  assert.deepEqual(playwright.config.toolExposure, { browser_run_code_unsafe: "hidden" });
});

test("a child's MCP config holds only the servers its roster names a tool of, direct, with denied tools hidden", () => {
  const { servers } = mcpConfig(mcpFixture(), "researcher");
  assert.deepEqual(servers.map(server => server.name), ["context7", "exa"]);
  assert.deepEqual(servers.map(server => server.config.exposure), ["direct", "direct"]);
  assert.deepEqual(servers[1].config.toolExposure, { agent_run: "hidden" });
  assert.deepEqual(servers[1].config.env, { PI_WORKFLOW_ROLE: "researcher" });
  assert.deepEqual(mcpConfig(mcpFixture(), "reviewer").servers, []);
});

test("the plugin API records each MCP tool's identity from its label", () => {
  const tools = new Map();
  const identities = new Map();
  const styled = pluginApi({ on() {}, registerTool(tool) { tools.set(tool.name, tool); } }, () => ({}), {}, {}, undefined, undefined, undefined, identities);
  const execute = () => {};
  styled.registerTool({ name: "mcp__context7__query_docs", label: "context7/query-docs", exposure: "deferred", execute });
  // A hash-shortened name keeps its identity in the label only.
  styled.registerTool({ name: "mcp__exa__a_very_long_name_1a2b3c4d", label: "exa/a.very/long/name", exposure: "direct", execute });
  styled.registerTool({ name: "mcp__nolabel__x", label: "mcp__nolabel__x", execute });
  styled.registerTool({ name: "bg_wait", label: "bg/wait", execute });
  assert.deepEqual([...identities], [
    ["mcp__context7__query_docs", { server: "context7", tool: "query-docs" }],
    ["mcp__exa__a_very_long_name_1a2b3c4d", { server: "exa", tool: "a.very/long/name" }],
  ]);
  assert.equal(tools.get("mcp__context7__query_docs").exposure, "deferred");
  assert.equal(tools.get("mcp__context7__query_docs").execute, execute);
});

test("a message renderer we own is composed over the plugin's, which stays as the fallback", () => {
  const registered = new Map();
  const pi = { on() {}, registerMessageRenderer(type, renderer) { registered.set(type, renderer); } };
  const styled = pluginApi(pi, () => ({}), { ours: message => (message.details ? "row" : undefined) });
  const { registerMessageRenderer } = styled;
  registerMessageRenderer("ours", () => "box");
  registerMessageRenderer("theirs", () => "box");
  assert.equal(registered.get("ours")({ details: { event: {} } }), "row");
  // A payload the row does not recognise is the plugin's to draw.
  assert.equal(registered.get("ours")({}), "box");
  // A type we do not own is registered as the plugin wrote it.
  assert.equal(registered.get("theirs")({ details: {} }), "box");
});

test("a quiet customType is sent with display off, everything else untouched", () => {
  const sent = [];
  const pi = { on() {}, sendMessage(message, options) { sent.push([message, options]); } };
  const styled = pluginApi(pi, () => ({}), {}, QUIET_MESSAGES);
  const { sendMessage } = styled; // a plugin may extract the function
  // An idle parent's notice arrives without a turn; the wake that follows carries it.
  sendMessage({ customType: "subagent-notify", content: "Background task failed: **x**", display: true }, { triggerTurn: false });
  sendMessage({ customType: "other", content: "c", display: true });
  assert.deepEqual(sent[0], [{ customType: "subagent-notify", content: "Background task failed: **x**", display: false }, { triggerTurn: false }]);
  assert.deepEqual(sent[1], [{ customType: "other", content: "c", display: true }, undefined]);
  // A customType that names an Object prototype member is not a quiet check.
  sendMessage({ customType: "constructor", content: "c", display: true });
  assert.equal(sent[2][0].display, true);
});

test("a displayed message pi appends outside the agent stream ends the group where it draws", () => {
  const handlers = new Map();
  const folds = createFolds();
  let idle = true;
  const pi = { on: (name, fn) => handlers.set(name, fn), sendMessage() {} };
  const styled = pluginApi(pi, () => ({}), {}, QUIET_MESSAGES, undefined, undefined, undefined, undefined, () => idle, folds);
  const closedAfter = (message, options) => {
    addFold(folds, `t${folds.timeline.length}`, "read");
    styled.sendMessage(message, options);
    return folds.timeline.at(-1).kind === "boundary";
  };
  const shown = { customType: "subagents-admin", content: "c", display: true };
  // Idle without a turn: appended at once, so the group closes before it.
  assert.equal(closedAfter(shown), true);
  // Drawn later through the agent stream, which closes it itself.
  assert.equal(closedAfter(shown, { triggerTurn: true }), false);
  assert.equal(closedAfter(shown, { deliverAs: "nextTurn" }), false);
  // Never drawn.
  assert.equal(closedAfter({ ...shown, display: false }), false);
  assert.equal(closedAfter({ customType: "subagent-notify", content: "c", display: true }), false);
  idle = false;
  // A steer or follow-up reaches message_end.
  assert.equal(closedAfter(shown, { deliverAs: "steer" }), false);
  // Deferred to the turn_end flush: the group closes at the first event after it, once.
  assert.equal(closedAfter(shown, { triggerTurn: false }), false);
  handlers.get("turn_start")();
  assert.equal(folds.timeline.at(-1).kind, "boundary");
  addFold(folds, "later", "read");
  handlers.get("agent_settled")();
  assert.equal(folds.timeline.at(-1).kind, "activity", "a drained count does not close again");
  assert.deepEqual([...handlers.keys()].sort(), ["agent_end", "agent_settled", "turn_start"]);
});

test("a plugin entry ends the group only when its renderer would draw it", () => {
  const appended = [];
  const folds = createFolds();
  const pi = { on() {}, appendEntry(type, data) { appended.push([this, type, data]); } };
  const styled = pluginApi(pi, () => ({}), {}, {}, undefined, undefined, undefined, undefined, undefined, folds);
  const { appendEntry } = styled; // pi-subagents extracts it and calls it with its own receiver
  const closedAfter = (type, data) => {
    addFold(folds, `t${folds.timeline.length}`, "read");
    appendEntry.call({}, type, data);
    return folds.timeline.at(-1).kind === "boundary";
  };
  const warning = { summary: "s", evidence: "e", recommendedAction: "a" };
  const reply = { requestId: "q", runId: "r", agent: "worker", message: "m", childIndex: 0, createdAt: 1 };
  assert.equal(closedAfter("subagent_watchdog_warning", warning), true);
  assert.equal(closedAfter("subagent_watchdog_warning", { summary: "s" }), false);
  assert.equal(closedAfter("subagent_supervisor_reply", reply), true);
  assert.equal(closedAfter("subagent_supervisor_reply", { ...reply, childIndex: undefined }), false);
  assert.equal(closedAfter("other", warning), false);
  assert.equal(closedAfter("constructor", warning), false);
  assert.ok(appended.every(([receiver]) => receiver === pi), "the raw function is called on the raw API");
  assert.equal(appended.length, 6);
  assert.deepEqual(Object.keys(DRAWN_ENTRIES), ["subagent_watchdog_warning", "subagent_supervisor_reply"]);
});

test("a plugin entry that lands while a reply streams ends the group above the reply, where pi mounts it", () => {
  const folds = createFolds();
  const styled = pluginApi({ on() {}, appendEntry() {} }, () => ({}), {}, {}, undefined, undefined, undefined, undefined, undefined, folds);
  addFold(folds, "a", "read");
  addFold(folds, "b", "read");
  closeFolds(folds);
  folds.streamBoundary = folds.timeline.at(-1);
  styled.appendEntry("subagent_watchdog_warning", { summary: "s", evidence: "e", recommendedAction: "a" });
  const done = { agent: "x", status: "completed", durationMs: 1000 };
  appendVisible({ appendEntry() {} }, "workflow-child", done, folds);
  const kinds = folds.timeline.map(fact => fact.kind === "boundary" ? (fact === folds.streamBoundary ? "reply" : "|") : fact.id);
  assert.deepEqual(kinds, ["a", "b", "|", done.seq, "reply"], "the completion folds below the warning, not into the reads");
});

test("pi-subagents' default-box notices draw as unshaded rows, and an unknown payload stays the plugin's", () => {
  const theme = { fg: (color, text) => `<${color}>${text}` };
  const render = (type, message) => NOTICE_RENDERERS[type](message, {}, theme)?.render(200).map(line => line.trimEnd());
  assert.deepEqual(render("subagent-incremental-child-notify", { content: "Workflow child paused (needs attention): **review**\nWorkflow run: w1\nStatus: workflow still running" }),
    ["<warning>• <toolTitle>review paused", "  <muted>Workflow run: w1", "  <muted>Status: workflow still running"]);
  assert.deepEqual(render("subagent-incremental-child-notify", { content: [{ type: "text", text: "Workflow child failed: **build**" }] }), ["<error>• <toolTitle>build failed"]);
  assert.equal(render("subagent-incremental-child-notify", { content: "Something else" }), undefined);
  assert.deepEqual(render("subagent-workflow-result-write-failed", { content: "Failed to write async workflow result /r.json: EACCES" }),
    ["<error>• <toolTitle>workflow result write failed", "  <muted>Failed to write async workflow result /r.json: EACCES"]);
  assert.equal(render("subagent-workflow-result-write-failed", { content: "" }), undefined);
  assert.deepEqual(render("subagent_watchdog_clarification", { content: "Main watchdog clarification:\nWhich branch?\nEvidence: two remotes" }),
    ["<accent>π <muted>Main watchdog clarification:", "  <muted>Which branch?", "  <muted>Evidence: two remotes"]);
  assert.equal(render("subagent_watchdog_clarification", { content: [] }), undefined);
});

test("shutdown retains child results without requesting a new model turn", () => {
  const sent = [];
  let shuttingDown = false;
  const styled = pluginApi({ on() {}, sendMessage: (message, options) => sent.push([message, options]) }, () => ({}), {}, QUIET_MESSAGES, undefined, () => shuttingDown);
  const message = { customType: "subagent-notify", content: "Child stopped", display: true };
  styled.sendMessage(message, { triggerTurn: true });
  shuttingDown = true;
  styled.sendMessage(message, { triggerTurn: true });
  assert.equal(sent[0][1].triggerTurn, true);
  assert.equal(sent[1][1].triggerTurn, false);
  assert.equal(sent[1][0].content, message.content);
  assert.equal(sent[1][0].display, false);
});

test("pi-subagents' parent wake is sent as a quiet custom message and dropped at shutdown, every other user message untouched", () => {
  const sent = [];
  const users = [];
  let shuttingDown = false;
  const pi = { on() {}, sendMessage: (message, options) => sent.push([message, options]), sendUserMessage: (content, options) => users.push([content, options]) };
  const { sendUserMessage } = pluginApi(pi, () => ({}), {}, QUIET_MESSAGES, undefined, () => shuttingDown);
  sendUserMessage("Subagent updates above.", { deliverAs: "steer" });
  sendUserMessage("Subagent updates above.");
  sendUserMessage("relayed", { deliverAs: "steer" });
  shuttingDown = true;
  sendUserMessage("Subagent updates above.", { deliverAs: "steer" });
  assert.deepEqual(sent, [
    [{ customType: "subagent-wake", content: "Subagent updates above.", display: false }, { deliverAs: "steer", triggerTurn: true }],
  ]);
  assert.deepEqual(users, [["Subagent updates above.", undefined], ["relayed", { deliverAs: "steer" }]]);
});

test("the control notice row is built from the event pi-subagents puts in details", () => {
  const theme = { fg: (color, text) => `<${color}>${text}` };
  const notice = event => controlNotice({ content: "Subagent needs attention: researcher\nRun: …", details: { event } }, {}, theme)?.render(200)[0].trimEnd();
  assert.equal(notice({ agent: "researcher", message: "researcher is waiting for a supervisor reply", reason: "supervisor_request" }),
    "<warning>• <toolTitle>researcher needs attention<muted> · is waiting for a supervisor reply");
  assert.equal(notice({ agent: "diff-reviewer", message: "diff-reviewer needs attention (no observed activity for 300s)", reason: "idle" }), "<warning>• <toolTitle>diff-reviewer needs attention<muted> · no observed activity for 300s");
  // A payload the row cannot read is the plugin's to draw.
  assert.equal(controlNotice({ details: { event: { agent: "researcher" } } }, {}, theme), undefined);
  assert.equal(controlNotice({}, {}, theme), undefined);
});

test("the plan-mode research addendum is the root's alone, and execute mode carries neither", () => {
  const base = { mode: "plan", readonly: true };
  const root = workflowPrompt({ ...base, isRoot: true });
  assert.match(root, /Workflow mode: plan\. Investigate only/);
  assert.match(root, /Answer read-only questions and command requests directly/);
  assert.match(root, /For requested source edits or external mutations, research the request to the point of a plan without being asked/);
  assert.match(root, /Approval switches the mode and revokes running child sessions/);
  // A child in plan mode is read-only too, but has neither submit_plan nor ask_user_question.
  assert.doesNotMatch(workflowPrompt({ ...base, isRoot: false }), /research the request|Answer read-only/i);
  // Execute mode replaces the investigate clause outright, so the addendum cannot ride it.
  const executing = workflowPrompt({ mode: "execute", readonly: false, isRoot: true });
  assert.equal(executing, "Workflow mode: execute. Execute only the user-approved task.");
  // The section body is standalone: no base prompt riding in front of it.
  assert.match(root, /^Workflow mode:/);
});

test("the exec recorder passes the call through and records command, sandbox flag and exit code, twenty deep", async () => {
  const history = [];
  const seen = [];
  const wrapped = recordingExec(history, { command: "gh pr list" }, async (...params) => { seen.push(params); return { exitCode: 1 }; });
  assert.deepEqual(await wrapped("gh pr list", "/work", { timeout: 5 }), { exitCode: 1 });
  assert.deepEqual(seen, [["gh pr list", "/work", { timeout: 5 }]]);
  assert.deepEqual(history, [{ command: "gh pr list", sandboxed: true, exitCode: 1 }]);
  await assert.rejects(recordingExec(history, { command: "boom", dangerouslyDisableSandbox: true }, async () => { throw new Error("lost"); })("boom", "/work", {}), /lost/);
  assert.deepEqual(history.at(-1), { command: "boom", sandboxed: false, exitCode: null });
  for (let i = 0; i < 25; i++) await recordingExec(history, { command: `c${i}` }, async () => ({ exitCode: 0 }))(`c${i}`, "/work", {});
  assert.equal(history.length, 20);
  assert.equal(history[0].command, "c5");
  await recordingExec(history, { command: "x".repeat(5000) }, async () => ({ exitCode: 0 }))("ignored", "/work", {});
  assert.equal(history.at(-1).command.length, 2000);
});

test("an authorization carries the newest history that fits the serialized budget", () => {
  const entry = command => ({ command, sandboxed: true, exitCode: 0 });
  const history = [entry("old"), entry("\u0001".repeat(2000)), entry("new")];
  assert.deepEqual(trimHistory(history, 200), [entry("new")]);
  assert.deepEqual(trimHistory(history), history);
  assert.deepEqual(trimHistory([entry("x".repeat(500))], 100), []);
});
