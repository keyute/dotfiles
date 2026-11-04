import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordingExec, trimHistory, workflowPrompt } from "./index.mjs";
import { DRAWN_ENTRIES, NOTICE_RENDERERS, QUIET_MESSAGES, controlNotice, mcpConfig, pluginApi } from "./plugin-api.mjs";
import { addFold, appendVisible, closeFolds, createFolds } from "./rows.mjs";
import { runnerPath } from "./operations.mjs";
import { SUBAGENT_SCHEMA } from "./children.mjs";
import { SessionManager } from "@earendil-works/pi-coding-agent";

test("the plugin API records every registered tool name and forwards everything else untouched", () => {
  const tools = new Map();
  const names = new Set();
  const events = { on() {} };
  const receivers = [];
  const pi = { events, on() { receivers.push(this); return "on"; }, registerTool(tool) { tools.set(tool.name, tool); } };
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
  assert.equal(styled.on("other", () => {}), "on");
  assert.equal(receivers.at(-1), styled);
  assert.equal(styled.on("session_start", () => {}), "on");
  assert.equal(receivers.at(-1), styled, "context wrapping preserves the registration receiver");
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

test("classifier usage metadata persists without a row boundary or model message", () => {
  const manager = SessionManager.inMemory("/work");
  manager.appendMessage({ role: "user", content: "Inspect the workspace", timestamp: 1 });
  const messages = manager.buildSessionContext().messages;
  const folds = createFolds();
  addFold(folds, "read", "read");
  const timeline = [...folds.timeline];
  const pi = { on() {}, appendEntry: (type, data) => manager.appendCustomEntry(type, data) };
  const styled = pluginApi(pi, {}, {}, undefined, undefined, undefined, undefined, undefined, undefined, folds);
  const data = { version: 1, requestId: "review-1", stages: [] };
  styled.appendEntry("workflow-classifier-usage", data);
  assert.deepEqual(folds.timeline, timeline);
  assert.deepEqual(manager.buildSessionContext().messages, messages);
  const entry = manager.getBranch().at(-1);
  assert.equal(entry.customType, "workflow-classifier-usage");
  assert.deepEqual(entry.data, data);
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

const { createParentWake } = await import(new URL("../../../node_modules/pi-subagents/src/shared/parent-wake.js", import.meta.url));
const { default: registerSubagentNotify, createCompletionSendRegistry } = await import(new URL("../../../node_modules/pi-subagents/src/runs/background/notify.js", import.meta.url));
const reservationsSymbol = Symbol.for("pi.idle-wake.v1");
const queuedWakesSymbol = Symbol.for("pi-subagents.queued-completion-wakes.v2");
const nativeNotifications = ({ idle = true, held = false, prior, batch = false } = {}) => {
  const sent = [];
  const users = [];
  const persisted = [];
  const owned = new Set(["owned", "owned-2"]);
  const manager = { getSessionId: () => "session" };
  let current = manager;
  const handlers = new Map();
  const on = (event, handler) => {
    const entries = handlers.get(event) ?? new Set();
    handlers.set(event, entries);
    entries.add(handler);
    return () => entries.delete(handler);
  };
  const pi = { on, appendEntry: (...args) => persisted.push(args), events: { on: () => () => {} }, sendMessage: (message, options) => sent.push([message, options]), sendUserMessage: (...args) => users.push(args) };
  const api = pluginApi(pi, {}, QUIET_MESSAGES, undefined, undefined, undefined, undefined, undefined, () => idle, undefined,
    ids => { const all = ids.every(id => owned.has(id)); ids.forEach(id => owned.delete(id)); return all; }, () => current);
  const wake = createParentWake(api, () => 20_000);
  api.on("session_start", (_event, ctx) => wake.bindSession(ctx));
  for (const handler of handlers.get("session_start")) handler({}, { sessionManager: manager, isIdle: () => idle });
  // Bind creates the lazy reservation through isPending, just as native liveness can.
  wake.isPending();
  if (prior !== undefined) globalThis[reservationsSymbol].get(manager).sentAt = prior;
  if (held) wake.userAborted();
  const notifier = registerSubagentNotify({ events: pi.events, on, sendMessage: wake.sendMessage, isHeld: wake.isHeld },
    { currentSessionId: "session", completionOwnerId: "owner" },
    { batchConfig: { enabled: batch }, sendRegistry: createCompletionSendRegistry() });
  notifier.bindSession(manager);
  const deliver = (id, extra = {}) => notifier.deliver({ id, runId: id, sessionId: "session", completionOwnerId: "owner", agent: id, success: true, summary: id, ...extra });
  const state = globalThis[queuedWakesSymbol].get(manager);
  return { api, wake, notifier, deliver, sent, users, manager, state, handlers, owned, persisted, replace: value => { current = value; } };
};

for (const idle of [true, false]) for (const held of [true, false]) for (const quiet of [true, false]) {
  test(`native owned completion is consumed idle=${idle} held=${held} quiet=${quiet}`, async () => {
    const f = nativeNotifications({ idle, held });
    try {
      assert.equal(await f.deliver("owned", { triggerTurn: !quiet }), true);
      assert.deepEqual(f.sent, []);
      assert.deepEqual(f.users, []);
      assert.deepEqual(f.state.wakes, []);
      assert.equal(f.state.unansweredCompletions.size, 0);
      assert.equal(f.state.notices.size, 0);
      assert.equal(f.notifier.hasPendingDelivery(), false);
      for (const handler of f.handlers.get("agent_before_settle") ?? []) {
        assert.equal(handler({ outcome: "completed", context: { pendingMessages: [], contextMessages: [] }, entries: [] }), undefined);
      }
      f.notifier.sessionShutdown("quit");
      assert.deepEqual(f.persisted, []);
    } finally { f.notifier.dispose(); }
  });
}

for (const prior of [undefined, 19_999, 1]) test(`owned idle reservation restores prior ${prior}`, async () => {
  const f = nativeNotifications({ prior });
  try {
    await f.deliver("owned");
    assert.equal(globalThis[reservationsSymbol].get(f.manager).sentAt, prior);
    assert.deepEqual(f.sent, []);
    await f.deliver("unowned");
    assert.equal(f.sent[0][0].customType, "subagent-notify");
    assert.equal(f.sent[0][0].display, false);
    assert.equal(f.sent[0][1].triggerTurn, prior !== 19_999);
  } finally { f.notifier.dispose(); }
});

test("owned then unowned delivery in one stack retains only unowned native bookkeeping", async () => {
  const f = nativeNotifications();
  try {
    const owned = f.deliver("owned");
    const unowned = f.deliver("unowned");
    await Promise.all([owned, unowned]);
    assert.deepEqual(f.sent.map(([m]) => m.customType), ["subagent-notify"]);
    assert.equal(f.state.unansweredCompletions.size, 1);
    assert.match([...f.state.unansweredCompletions.keys()][0], /unowned/);
    assert.deepEqual(f.state.wakes, [...f.state.unansweredCompletions.keys()]);
    assert.equal(f.sent[0][1].triggerTurn, true);
  } finally { f.notifier.dispose(); }
});

test("a mixed grouped native notice forwards whole and releases its owned claims", async () => {
  const f = nativeNotifications({ batch: true });
  try {
    const first = f.deliver("owned");
    const second = f.deliver("unowned");
    f.notifier.flush();
    await Promise.all([first, second]);
    assert.deepEqual(f.sent[0][0].details.runs.map(run => run.runId), ["owned", "unowned"]);
    assert.equal(f.sent[0][0].display, false);
    assert.equal(f.state.unansweredCompletions.size, 1);
  } finally { f.notifier.dispose(); }
});

test("missing native shape forwards owned notices rather than partially consuming them", () => {
  const sent = [];
  const api = pluginApi({ on() {}, sendMessage: message => sent.push(message) }, {}, QUIET_MESSAGES,
    undefined, undefined, undefined, undefined, undefined, () => false, undefined, () => true);
  api.sendMessage({ customType: "subagent-notify", content: "result", details: { runs: [{ runId: "owned" }] } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].display, false);
});

for (const replacement of ["manager", "session", "state", "entry", "notice", "wakes", "unanswered", "notices"]) test(`cleanup leaves replacement ${replacement} untouched`, async () => {
  const f = nativeNotifications({ idle: false });
  try {
    const delivery = f.deliver("owned");
    const content = [...f.state.unansweredCompletions.keys()][0];
    if (replacement === "manager") f.replace({ getSessionId: () => "session" });
    if (replacement === "session") f.manager.getSessionId = () => "next";
    if (replacement === "state") globalThis[queuedWakesSymbol].set(f.manager, { ...f.state });
    if (replacement === "entry") f.state.unansweredCompletions.set(content, { reminded: true });
    if (replacement === "notice") f.state.notices.set(content, { content: "replacement" });
    if (replacement === "wakes") f.state.wakes = [...f.state.wakes];
    if (replacement === "unanswered") f.state.unansweredCompletions = new Map(f.state.unansweredCompletions);
    if (replacement === "notices") f.state.notices = new Map(f.state.notices);
    await delivery;
    assert.equal(f.state.unansweredCompletions.size, 1);
    assert.equal(f.state.wakes.length, 1);
    assert.equal(f.state.notices.size, 1);
  } finally { f.notifier.dispose(); }
});

test("consumed appended wakes are cleaned only after native splice and preserve unrelated wakes", async () => {
  const f = nativeNotifications({ prior: 19_999 });
  try {
    f.state.wakes.push("unrelated");
    const unrelated = { content: "unrelated" };
    f.state.notices.set("unrelated", unrelated);
    const delivery = f.deliver("owned");
    assert.deepEqual(f.state.wakes, ["unrelated"], "native removed only its appended wake");
    assert.equal(f.state.unansweredCompletions.size, 1, "cleanup waits for native bookkeeping");
    await delivery;
    assert.deepEqual(f.state.wakes, ["unrelated"]);
    assert.deepEqual([...f.state.notices], [["unrelated", unrelated]]);
    assert.equal(f.state.unansweredCompletions.size, 0);
  } finally { f.notifier.dispose(); }
});

for (const mismatch of ["wakes", "notices", "unanswered", "session", "message", "snapshot", "reservation", "state"]) {
  test(`invalid native ${mismatch} forwards without claiming ownership`, async () => {
    const f = nativeNotifications({ idle: false });
    try {
      const content = "uncorrelated";
      const message = { customType: "subagent-notify", content, details: { runs: [{ runId: "owned" }] } };
      f.state.wakes.push(content);
      f.state.notices.set(content, message);
      f.state.unansweredCompletions.set(content, { reminded: false });
      const ctx = { sessionManager: f.manager, isIdle: () => false };
      let bound;
      f.api.on("session_start", (_event, context) => { bound = context; });
      [...f.handlers.get("session_start")].at(-1)({}, ctx);
      if (mismatch !== "snapshot") bound.isIdle();
      if (mismatch === "wakes") f.state.wakes = {};
      if (mismatch === "notices") f.state.notices = {};
      if (mismatch === "unanswered") f.state.unansweredCompletions = {};
      if (mismatch === "session") f.manager.getSessionId = () => "replacement";
      if (mismatch === "message") f.state.notices.set(content, { ...message });
      if (mismatch === "reservation") globalThis[reservationsSymbol].set(f.manager, { sessionId: "session" });
      if (mismatch === "state") globalThis[queuedWakesSymbol].set(f.manager, { ...f.state });
      f.api.sendMessage(message, { triggerTurn: true });
      assert.equal(f.sent.length, 1);
      assert.equal(f.sent[0][0].display, false);
      assert.equal(f.owned.has("owned"), true);
      await Promise.resolve();
    } finally { f.notifier.dispose(); }
  });
}

test("native owned notifications are isolated between session managers", async () => {
  const first = nativeNotifications({ idle: false });
  const second = nativeNotifications();
  try {
    await Promise.all([first.deliver("owned"), second.deliver("unowned")]);
    assert.equal(first.state.unansweredCompletions.size, 0);
    assert.equal(second.state.unansweredCompletions.size, 1);
    assert.deepEqual(first.sent, []);
    assert.equal(second.sent.length, 1);
  } finally { first.notifier.dispose(); second.notifier.dispose(); }
});

test("user messages, including former wake text, pass through untouched", () => {
  const users = [];
  const pi = { on() {}, sendUserMessage: (...args) => users.push(args) };
  const api = pluginApi(pi);
  assert.equal(api.sendUserMessage, pi.sendUserMessage);
  api.sendUserMessage("Inspect subagent updates above.", { deliverAs: "steer" });
  assert.deepEqual(users, [["Inspect subagent updates above.", { deliverAs: "steer" }]]);
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

test("the root planning contract requires proposals for changes and actionable investigations, with direct-answer exemptions", () => {
  const base = { mode: "plan", readonly: true };
  const root = workflowPrompt({ ...base, isRoot: true });
  assert.match(root, /Workflow mode: plan\. Investigate only/);
  assert.match(root, /For requested changes, and investigations and reviews that identify concrete changes you recommend within the requested scope/);
  assert.match(root, /Submit the plan with submit_plan for explicit approval before ending the task; do not wait for a separate request to implement/);
  assert.match(root, /Read-only research restricts execution, not proposal preparation/);
  assert.match(root, /Answer informational questions, command-only requests, clean reviews with no recommended changes, and explicit report-only\/no-plan requests directly without a plan/);
  assert.match(root, /Approval switches the mode and revokes running child sessions/);
  // A child in plan mode is read-only too, but has neither submit_plan nor ask_user_question.
  assert.doesNotMatch(workflowPrompt({ ...base, isRoot: false }), /submit_plan|research through|Answer informational/i);
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


test("exported pi-subagents bundle consumes owned completions without wake, reminders or persistence", t => {
  const root = mkdtempSync(join(tmpdir(), "pi-bundle-notify-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { EventEmitter } from "node:events";
    import { pluginApi, QUIET_MESSAGES } from ${JSON.stringify(new URL("./plugin-api.mjs", import.meta.url).href)};
    const { default: register } = await import("pi-subagents");
    const events = new EventEmitter();
    const handlers = new Map();
    const sent = [], entries = [];
    const manager = { getSessionId: () => "bundle-session", getSessionFile: () => undefined,
      getBranch: () => [], getEntries: () => [], getLeafId: () => null };
    const raw = new Proxy({
      events: { on(name, fn) { events.on(name, fn); return () => events.off(name, fn); }, emit: (...args) => events.emit(...args) },
      on(name, fn) { const list = handlers.get(name) ?? new Set(); list.add(fn); handlers.set(name, list); return () => list.delete(fn); },
      sendMessage: (message, options) => sent.push([message, options]),
      appendEntry: (...args) => entries.push(args),
      getFlag: () => undefined, getActiveTools: () => [], getAllTools: () => [], getThinkingLevel: () => "off",
    }, { get(target, key) { return target[key] ?? (() => {}); } });
    const api = pluginApi(raw, {}, QUIET_MESSAGES, undefined, undefined, undefined, undefined, undefined,
      () => true, undefined, ids => ids.every(id => id.startsWith("owned")), () => manager);
    register(api);
    const ctx = { cwd: process.env.PI_CODING_AGENT_DIR, hasUI: false, sessionManager: manager,
      isIdle: () => true, isProjectTrusted: () => true, getContextUsage: () => undefined,
      modelRegistry: { getAvailable: () => [], find: () => undefined }, ui: { notify() {}, setStatus() {}, setWidget() {} } };
    for (const handler of handlers.get("session_start") ?? []) await handler({ reason: "startup" }, ctx);
    const send = runId => events.emit("subagent:foreground-complete", { id: runId, runId,
      source: "foreground", sessionId: "bundle-session", agent: runId, success: true, summary: "done" });
    send("owned-bundle");
    send("unowned-bundle");
    assert.equal(sent.length, 1);
    assert.equal(sent[0][1].triggerTurn, true);
    await Promise.resolve();
    const state = globalThis[Symbol.for("pi-subagents.queued-completion-wakes.v2")].get(manager);
    assert.equal(state.wakes.length, 1);
    assert.equal(state.notices.size, 1);
    assert.equal(state.unansweredCompletions.size, 1);
    assert.match(state.wakes[0], /unowned-bundle/);
    for (const handler of handlers.get("session_shutdown") ?? []) await handler({ reason: "quit" }, ctx);
    assert.equal(entries.filter(([type, data]) => type === "subagent-notify-pending" && data.message.details.runs.some(run => run.runId === "owned-bundle")).length, 0);
  `], { cwd: new URL("../../../", import.meta.url), env: { ...process.env, PI_CODING_AGENT_DIR: root, PI_SUBAGENT_CHILD: "", HERDR_PI_MODE: "" }, encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error));
});
