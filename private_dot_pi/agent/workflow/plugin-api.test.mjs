import test from "node:test";
import assert from "node:assert/strict";
import { controlNotice, mcpGateway, pluginApi, recordingExec, trimHistory, workflowPrompt } from "./index.mjs";
import { narrowSubagentSchema } from "./children.mjs";

test("the plugin API decorates every registration and forwards everything else untouched", () => {
  const tools = new Map();
  const events = { on() {} };
  const pi = { events, on: () => "on", registerTool(tool) { tools.set(tool.name, tool); } };
  const styled = pluginApi(pi, name => ({ renderShell: "self", renderCall: `ours:${name}`, renderResult: "ours" }));
  const { registerTool } = styled; // the adapter extracts the function
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
  const styled = pluginApi({ registerTool(tool) { tools.set(tool.name, tool); } }, () => ({}), {}, [], undefined, undefined, managed);
  styled.registerTool({ name: "subagent", description: "upstream", parameters, execute });
  styled.registerTool({ name: "other", description: "other upstream", parameters, execute });
  assert.equal(tools.get("subagent").description, managed);
  assert.equal(tools.get("subagent").parameters, parameters);
  assert.equal(tools.get("subagent").execute, execute);
  assert.equal(tools.get("other").description, "other upstream");
});

test("the subagent schema exposes only the managed launch and control surface", () => {
  const supported = ["agent", "task", "async", "model", "context", "agentScope", "action", "id", "runId", "index", "message", "mode", "view", "lines", "steeringRecovery", "capabilities"];
  const upstream = { type: "object", description: "upstream safety description", properties: Object.fromEntries([...supported, "cwd", "workflowScript"].map(name => [name, { description: `${name} definition` }])) };
  const narrowed = narrowSubagentSchema(upstream);
  assert.deepEqual(Object.keys(narrowed.properties).sort(), supported.slice().sort());
  assert.equal(narrowed.additionalProperties, false);
  assert.deepEqual(narrowed.properties.action.enum, ["list", "status", "interrupt", "stop", "steer"]);
  assert.deepEqual(narrowed.properties.context.enum, ["fresh", "fork"]);
  assert.deepEqual(narrowed.properties.agentScope.enum, ["user"]);
  assert.equal(narrowed.description, "upstream safety description");
  assert.equal(narrowed.properties.task.description, "task definition");
});

test("the plugin API narrows only the subagent definition and preserves its executor", () => {
  const tools = new Map();
  const pi = { registerTool(tool) { tools.set(tool.name, tool); } };
  const execute = () => {};
  const schema = { type: "object", properties: { agent: {}, task: {}, async: {}, model: {}, context: {}, agentScope: {}, action: {}, id: {}, runId: {}, index: {}, message: {}, mode: {}, view: {}, lines: {}, steeringRecovery: {}, capabilities: {}, cwd: {} } };
  const styled = pluginApi(pi, () => ({}), {}, [], narrowSubagentSchema);
  styled.registerTool({ name: "subagent", parameters: schema, execute });
  styled.registerTool({ name: "other", parameters: schema, execute });
  assert.equal(tools.get("subagent").execute, execute);
  assert.equal(tools.get("other").parameters, schema);
  assert.equal(tools.get("subagent").parameters.additionalProperties, false);
  assert.equal("cwd" in tools.get("subagent").parameters.properties, false);
});

test("the plugin API gives the mcp gateway the managed surface and keeps its executor", () => {
  const tools = new Map();
  const execute = () => {};
  const parameters = { type: "object", properties: Object.fromEntries(["tool", "args", "search", "server", "action", "url", "target", "searchMode"].map(name => [name, {}])) };
  const gateway = mcpGateway(["context7", "exa"]);
  const styled = pluginApi({ registerTool(tool) { tools.set(tool.name, tool); } }, () => ({}), {}, [], undefined, undefined, undefined, gateway);
  styled.registerTool({ name: "mcp", description: "install by URL", promptSnippet: "install, auth", parameters, execute });
  styled.registerTool({ name: "other", description: "other upstream", parameters, execute });
  const mcp = tools.get("mcp");
  assert.deepEqual(Object.keys(mcp.parameters.properties), ["tool", "args", "search", "server"]);
  assert.equal(mcp.execute, execute);
  assert.equal(mcp.promptSnippet, gateway.promptSnippet);
  assert.match(mcp.description, /^Servers: context7, exa$/m);
  assert.doesNotMatch(mcp.description + mcp.promptSnippet + mcp.parameters.properties.server.description, /install|auth|mcpScript|ui-messages/);
  // Byte-stable per config, so re-registration never rewrites the prompt prefix.
  assert.equal(mcpGateway(["context7", "exa"]).description, mcp.description);
  assert.equal(tools.get("other").parameters, parameters);
});

test("a message renderer we own is composed over the plugin's, which stays as the fallback", () => {
  const registered = new Map();
  const pi = { registerMessageRenderer(type, renderer) { registered.set(type, renderer); } };
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
  const pi = { sendMessage(message, options) { sent.push([message, options]); } };
  const styled = pluginApi(pi, () => ({}), {}, ["subagent-notify"]);
  const { sendMessage } = styled; // the adapter extracts the function
  sendMessage({ customType: "subagent-notify", content: "Background task failed: **x**", display: true }, { triggerTurn: true });
  sendMessage({ customType: "other", content: "c", display: true });
  assert.deepEqual(sent[0], [{ customType: "subagent-notify", content: "Background task failed: **x**", display: false }, { triggerTurn: true }]);
  assert.deepEqual(sent[1], [{ customType: "other", content: "c", display: true }, undefined]);
});

test("shutdown retains child results without requesting a new model turn", () => {
  const sent = [];
  let shuttingDown = false;
  const styled = pluginApi({ sendMessage: (message, options) => sent.push([message, options]) }, () => ({}), {}, ["subagent-notify"], undefined, () => shuttingDown);
  const message = { customType: "subagent-notify", content: "Child stopped", display: true };
  styled.sendMessage(message, { triggerTurn: true });
  shuttingDown = true;
  styled.sendMessage(message, { triggerTurn: true });
  assert.equal(sent[0][1].triggerTurn, true);
  assert.equal(sent[1][1].triggerTurn, false);
  assert.equal(sent[1][0].content, message.content);
  assert.equal(sent[1][0].display, false);
});

test("the control notice row is built from the event pi-subagents puts in details", () => {
  const theme = { fg: (color, text) => `<${color}>${text}` };
  const notice = event => controlNotice({ content: "Subagent needs attention: researcher\nRun: …", details: { event } }, {}, theme)?.render(200)[0].trimEnd();
  assert.equal(notice({ agent: "researcher", message: "researcher is waiting for a supervisor reply", reason: "supervisor_request" }),
    "<warning>• <toolTitle>researcher needs attention<muted> · is waiting for a supervisor reply");
  assert.equal(notice({ agent: "ts-reviewer", message: "ts-reviewer needs attention (no observed activity for 300s)", reason: "idle" }), "<warning>• <toolTitle>ts-reviewer needs attention<muted> · no observed activity for 300s");
  // A payload the row cannot read is the plugin's to draw.
  assert.equal(controlNotice({ details: { event: { agent: "researcher" } } }, {}, theme), undefined);
  assert.equal(controlNotice({}, {}, theme), undefined);
  // A goal mission reaches the renderer too, but its body is several lines that do
  // not open with the agent and state, so the box keeps it whole.
  assert.equal(controlNotice({ details: { source: "goal", event: { agent: "goal mission", reason: "idle", message: "Goal mission needs attention: ship it\nMission: goal-abc\nRemaining budget: 500 tokens" } } }, {}, theme), undefined);
});

test("the plan-mode research addendum is the root's alone, and execute mode carries neither", () => {
  const base = { mode: "plan", readonly: true };
  const root = workflowPrompt({ ...base, isRoot: true });
  assert.match(root, /Workflow mode: plan\. Investigate only/);
  assert.match(root, /Research the request to the point of a plan without being asked/);
  assert.match(root, /Approval switches the mode and revokes running child sessions/);
  // A child in plan mode is read-only too, but has neither submit_plan nor ask_user_question.
  assert.doesNotMatch(workflowPrompt({ ...base, isRoot: false }), /Research the request/);
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
