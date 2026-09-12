import test from "node:test";
import assert from "node:assert/strict";
import { controlNotice, pluginApi, recordingExec, trimHistory, workflowPrompt } from "./index.mjs";

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

test("the control notice row is built from the event pi-subagents puts in details", () => {
  const theme = { fg: (color, text) => `<${color}>${text}` };
  const notice = event => controlNotice({ content: "Subagent needs attention: researcher\nRun: …", details: { event } }, {}, theme)?.render(200)[0].trimEnd();
  assert.equal(notice({ agent: "researcher", message: "researcher is waiting for a supervisor reply", reason: "supervisor_request" }),
    "<warning>• <toolTitle>researcher needs attention<muted> · is waiting for a supervisor reply");
  assert.equal(notice({ agent: "ts-reviewer", message: "ts-reviewer failed", reason: "completion_guard" }), "<error>• <toolTitle>ts-reviewer failed");
  // A payload the row cannot read is the plugin's to draw.
  assert.equal(controlNotice({ details: { event: { agent: "researcher" } } }, {}, theme), undefined);
  assert.equal(controlNotice({}, {}, theme), undefined);
  // A goal mission reaches the renderer too, but its body is several lines that do
  // not open with the agent and state, so the box keeps it whole.
  assert.equal(controlNotice({ details: { source: "goal", event: { agent: "goal mission", reason: "idle", message: "Goal mission needs attention: ship it\nMission: goal-abc\nRemaining budget: 500 tokens" } } }, {}, theme), undefined);
});

test("the plan-mode research addendum is the root's alone, and execute mode carries neither", () => {
  const base = { systemPrompt: "S", mode: "plan", readonly: true };
  const root = workflowPrompt({ ...base, isRoot: true });
  assert.match(root, /Workflow mode: plan\. Investigate only/);
  assert.match(root, /Research the request to the point of a plan without being asked/);
  assert.match(root, /Approval switches the mode and revokes running child sessions/);
  // A child in plan mode is read-only too, but has neither submit_plan nor ask_user_question.
  assert.doesNotMatch(workflowPrompt({ ...base, isRoot: false }), /Research the request/);
  // Execute mode replaces the investigate clause outright, so the addendum cannot ride it.
  const executing = workflowPrompt({ systemPrompt: "S", mode: "execute", readonly: false, isRoot: true });
  assert.equal(executing, "S\n\nWorkflow mode: execute. Execute only the user-approved task.");
  // An added directory's instructions sit between the base prompt and the mode line.
  assert.match(workflowPrompt({ ...base, isRoot: true, added: "\n\n# Instructions for /w\n\nX" }), /^S\n\n# Instructions for \/w\n\nX\n\nWorkflow mode: plan\./);
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
