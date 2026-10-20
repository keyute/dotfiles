import test from "node:test";
import assert from "node:assert/strict";
import { recordingExec, trimHistory, workflowPrompt } from "./index.mjs";
import { DRAWN_ENTRIES, NOTICE_RENDERERS, QUIET_MESSAGES, controlNotice, mcpConfig, pluginApi } from "./plugin-api.mjs";
import { addFold, appendVisible, closeFolds, createFolds } from "./rows.mjs";
import { runnerPath } from "./operations.mjs";
import { SUBAGENT_SCHEMA } from "./children.mjs";

test("the plugin API records every registered tool name and forwards everything else untouched", () => {
  const tools = new Map();
  const names = new Set();
  const events = { on() {} };
  const pi = { events, on: () => "on", registerTool(tool) { tools.set(tool.name, tool); } };
  const styled = pluginApi(pi, {}, {}, undefined, undefined, undefined, undefined, names);
  const { registerTool } = styled; // a plugin may extract the function
  const execute = () => {};
  registerTool({ name: "subagent", execute, parameters: { a: 1 }, renderCall: "theirs", renderResult: "theirs" });
  registerTool({ name: "mcp__docs_q", execute, renderCall: "theirs" });
  registerTool({ name: "bg_wait", execute });
  // Rows ride the registerToolRenderer resolver; the registration is the plugin's own.
  assert.deepEqual(tools.get("subagent"), { name: "subagent", execute, parameters: { a: 1 }, renderCall: "theirs", renderResult: "theirs" });
  assert.equal(tools.get("mcp__docs_q").renderCall, "theirs");
  assert.deepEqual([...names], ["subagent", "mcp__docs_q", "bg_wait"]);
  assert.equal(styled.events, events);
  assert.equal(styled.on, pi.on);
});

test("the plugin API replaces only the subagent description without changing its executor or schema", () => {
  const tools = new Map();
  const execute = () => {};
  const parameters = { type: "object", properties: { agent: {} } };
  const managed = "Managed subagent description.";
  const styled = pluginApi({ on() {}, registerTool(tool) { tools.set(tool.name, tool); } }, {}, {}, undefined, undefined, managed);
  styled.registerTool({ name: "subagent", description: "upstream", parameters, execute });
  styled.registerTool({ name: "other", description: "other upstream", parameters, execute });
  assert.equal(tools.get("subagent").description, managed);
  assert.equal(tools.get("subagent").parameters, parameters);
  assert.equal(tools.get("subagent").execute, execute);
  assert.equal(tools.get("other").description, "other upstream");
});

test("the subagent schema exposes only the managed launch and control surface", () => {
  assert.deepEqual(Object.keys(SUBAGENT_SCHEMA.properties).sort(), ["action", "agent", "context", "id", "message", "options", "task", "title"]);
  assert.equal(SUBAGENT_SCHEMA.additionalProperties, false);
  assert.deepEqual(SUBAGENT_SCHEMA.properties.action.enum, ["list", "status", "interrupt", "stop", "steer"]);
  assert.deepEqual(SUBAGENT_SCHEMA.properties.context.enum, ["fresh", "fork"]);
  const { options } = SUBAGENT_SCHEMA.properties;
  assert.deepEqual(Object.keys(options.properties).sort(), ["capabilities", "index", "lines", "mode", "view"]);
  assert.equal(options.additionalProperties, false);
  assert.deepEqual(options.properties.mode.enum, ["steer", "follow_up"]);
  assert.deepEqual([options.properties.lines.minimum, options.properties.lines.maximum], [1, 500]);
});

test("the plugin API replaces only the subagent schema and preserves its executor", () => {
  const tools = new Map();
  const pi = { on() {}, registerTool(tool) { tools.set(tool.name, tool); } };
  const execute = () => {};
  const schema = { type: "object", properties: { agent: {}, model: {}, cwd: {}, options: {} } };
  const styled = pluginApi(pi, {}, {}, SUBAGENT_SCHEMA);
  styled.registerTool({ name: "subagent", parameters: schema, execute });
  styled.registerTool({ name: "other", parameters: schema, execute });
  assert.equal(tools.get("subagent").execute, execute);
  assert.equal(tools.get("subagent").parameters, SUBAGENT_SCHEMA);
  assert.equal(tools.get("other").parameters, schema);
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
  const styled = pluginApi({ on() {}, registerTool(tool) { tools.set(tool.name, tool); } }, {}, {}, undefined, undefined, undefined, identities);
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
  const styled = pluginApi(pi, { ours: message => (message.details ? "row" : undefined) });
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
  const styled = pluginApi(pi, {}, QUIET_MESSAGES);
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
  const styled = pluginApi(pi, {}, QUIET_MESSAGES, undefined, undefined, undefined, undefined, undefined, () => idle, folds);
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

test("a plugin entry type pi-subagents draws ends the group above it", () => {
  const appended = [];
  const folds = createFolds();
  const pi = { on() {}, appendEntry(type, data) { appended.push([this, type, data]); } };
  const styled = pluginApi(pi, {}, {}, undefined, undefined, undefined, undefined, undefined, undefined, folds);
  const { appendEntry } = styled; // pi-subagents extracts it and calls it with its own receiver
  const closedAfter = (type, data) => {
    addFold(folds, `t${folds.timeline.length}`, "read");
    appendEntry.call({}, type, data);
    return folds.timeline.at(-1).kind === "boundary";
  };
  const warning = { summary: "s", evidence: "e", recommendedAction: "a" };
  const reply = { requestId: "q", runId: "r", agent: "worker", message: "m", childIndex: 0, createdAt: 1 };
  assert.equal(closedAfter("subagent_watchdog_warning", warning), true);
  // A payload it does not recognise still draws, under a fallback headline.
  assert.equal(closedAfter("subagent_watchdog_warning", { summary: "s" }), true);
  assert.equal(closedAfter("subagent_supervisor_reply", reply), true);
  assert.equal(closedAfter("subagent_supervisor_reply", { ...reply, childIndex: undefined }), true);
  assert.equal(closedAfter("other", warning), false);
  assert.equal(closedAfter("constructor", warning), false);
  assert.ok(appended.every(([receiver]) => receiver === pi), "the raw function is called on the raw API");
  assert.equal(appended.length, 6);
  assert.deepEqual([...DRAWN_ENTRIES], ["subagent_watchdog_warning", "subagent_supervisor_reply"]);
});

test("a plugin entry that lands while a reply streams ends the group above the reply, where pi mounts it", () => {
  const folds = createFolds();
  const styled = pluginApi({ on() {}, appendEntry() {} }, {}, {}, undefined, undefined, undefined, undefined, undefined, undefined, folds);
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

test("pi-subagents' shaded notices draw as unshaded rows, and an unknown payload stays the plugin's", () => {
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
  const steering = state => render("subagent_steering_notice", { content: "Steering partially delivered for run r1.", details: { runId: "r1", requestId: "q1", state } });
  assert.deepEqual(steering("failed"), ["<error>• <toolTitle>steering for r1 failed", "  <muted>Steering partially delivered for run r1."]);
  assert.deepEqual(steering("recovered"), ["<warning>• <toolTitle>steering for r1 recovered", "  <muted>Steering partially delivered for run r1."]);
  assert.equal(steering("delivered"), undefined);
  assert.equal(render("subagent_steering_notice", { content: "x" }), undefined);
  assert.deepEqual(render("subagent-completion-unanswered", { content: "Completion wake ended silently." }),
    ["<accent>π <muted>Completion results unanswered", "  <muted>Completion wake ended silently."]);
  assert.deepEqual(render("subagent-completion-unhandled", { content: "UNHANDLED: no response." }),
    ["<accent>π <muted>Completion results unhandled", "  <muted>UNHANDLED: no response."]);
  assert.equal(render("subagent-completion-unhandled", { content: "" }), undefined);
  // Composed over the plugin's block, which an unknown payload falls back to.
  const registered = new Map();
  const styled = pluginApi({ on() {}, registerMessageRenderer(type, renderer) { registered.set(type, renderer); } }, NOTICE_RENDERERS);
  styled.registerMessageRenderer("subagent_steering_notice", () => "block");
  assert.equal(registered.get("subagent_steering_notice")({ content: "x" }, {}, theme), "block");
  assert.notEqual(registered.get("subagent_steering_notice")({ content: "x", details: { runId: "r1", state: "failed" } }, {}, theme), "block");
});

test("shutdown retains child results without requesting a new model turn", () => {
  const sent = [];
  let shuttingDown = false;
  const styled = pluginApi({ on() {}, sendMessage: (message, options) => sent.push([message, options]) }, {}, QUIET_MESSAGES, undefined, () => shuttingDown);
  const message = { customType: "subagent-notify", content: "Child stopped", display: true };
  styled.sendMessage(message, { triggerTurn: true });
  shuttingDown = true;
  styled.sendMessage(message, { triggerTurn: true });
  assert.equal(sent[0][1].triggerTurn, true);
  assert.equal(sent[1][1].triggerTurn, false);
  assert.equal(sent[1][0].content, message.content);
  assert.equal(sent[1][0].display, false);
});

test("a completion notice is dropped only when an orchestration owns every run in it and the root is busy; seeing it releases the runs", () => {
  const sent = [];
  const owned = new Set(["run-a", "run-b", "run-c", "run-d"]);
  let idle = false;
  const claimRuns = ids => { const all = ids.every(id => owned.has(id)); for (const id of ids) owned.delete(id); return all; };
  const styled = pluginApi({ on() {}, sendMessage: (message, options) => sent.push([message, options]) }, {}, QUIET_MESSAGES,
    undefined, undefined, undefined, undefined, undefined, () => idle, undefined, claimRuns);
  const notify = runs => ({ customType: "subagent-notify", content: "Background task completed", display: true, ...(runs ? { details: { runs } } : {}) });
  const forwarded = () => sent.map(([message]) => message.details?.runs?.map(run => run.runId));
  assert.equal(styled.sendMessage(notify([{ runId: "run-a", status: "completed" }, { runId: "run-b", status: "failed" }]), { deliverAs: "steer" }), undefined);
  assert.equal(sent.length, 0);
  // A claimed run is released: a second notice for it is forwarded.
  styled.sendMessage(notify([{ runId: "run-a" }]), { deliverAs: "steer" });
  assert.deepEqual(forwarded(), [["run-a"]]);
  assert.equal(sent[0][0].display, false);
  sent.length = 0;
  // An idle root's notice is followed by a wake, so a late owned one is forwarded hidden, and released.
  idle = true;
  styled.sendMessage(notify([{ runId: "run-c" }]), { triggerTurn: false });
  idle = false;
  styled.sendMessage(notify([{ runId: "run-c" }]), { deliverAs: "steer" });
  assert.deepEqual(forwarded(), [["run-c"], ["run-c"]]);
  assert.equal(sent[0][0].display, false);
  sent.length = 0;
  // Any unowned run forwards the whole batch, releasing its owned runs, as does a notice naming no runs.
  styled.sendMessage(notify([{ runId: "run-d" }, { runId: "run-x" }]), { deliverAs: "steer" });
  styled.sendMessage(notify([{ runId: "run-d" }]), { deliverAs: "steer" });
  styled.sendMessage(notify([]));
  styled.sendMessage(notify());
  assert.deepEqual(forwarded(), [["run-d", "run-x"], ["run-d"], [], undefined]);
  assert.equal(sent[0][0].display, false);
  // Only the completion notice is matched; another customType with owned runs is untouched.
  owned.add("run-a");
  styled.sendMessage({ customType: "other", content: "c", details: { runs: [{ runId: "run-a" }] } });
  assert.deepEqual(sent[4], [{ customType: "other", content: "c", details: { runs: [{ runId: "run-a" }] } }, undefined]);
  assert.equal(owned.has("run-a"), true);
  // Without a claimRuns every notice is forwarded.
  const plain = [];
  pluginApi({ on() {}, sendMessage: message => plain.push(message) }, {}, QUIET_MESSAGES).sendMessage(notify([{ runId: "run-a" }]));
  assert.equal(plain.length, 1);
});

test("pi-subagents' parent wake is sent as a quiet custom message and dropped at shutdown, every other user message untouched", () => {
  const sent = [];
  const users = [];
  let shuttingDown = false;
  const pi = { on() {}, sendMessage: (message, options) => sent.push([message, options]), sendUserMessage: (content, options) => users.push([content, options]) };
  const { sendUserMessage } = pluginApi(pi, {}, QUIET_MESSAGES, undefined, () => shuttingDown);
  const wake = "Inspect subagent updates above. Answer pending supervisor requests within your authority. For completed work, read saved results and resume the already-authorized parent task, or report completion. If approval is required, explicitly ask the user. Do not silently yield, rerun completed work, or infer new authorization.";
  sendUserMessage(wake, { deliverAs: "steer" });
  sendUserMessage(wake);
  sendUserMessage("relayed", { deliverAs: "steer" });
  shuttingDown = true;
  sendUserMessage(wake, { deliverAs: "steer" });
  // The whole wake reaches the model; only its box is hidden.
  assert.deepEqual(sent, [
    [{ customType: "subagent-wake", content: wake, display: false }, { deliverAs: "steer", triggerTurn: true }],
  ]);
  assert.deepEqual(users, [[wake, undefined], ["relayed", { deliverAs: "steer" }]]);
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
  // Ultracode rides the end of the section while on.
  assert.equal(workflowPrompt({ mode: "execute", readonly: false, isRoot: true, ultracode: true }), "Workflow mode: execute. Execute only the user-approved task. Ultracode is on.");
  assert.match(workflowPrompt({ ...base, isRoot: true, ultracode: true }), /launch them after\. Ultracode is on\.$/);
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
