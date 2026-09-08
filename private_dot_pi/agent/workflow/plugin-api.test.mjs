import test from "node:test";
import assert from "node:assert/strict";
import { pluginApi, recordingExec, trimHistory } from "./index.mjs";

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
