import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { buildRow, createFleetState, formatTokens, installFleet, modelLabel, navigate, renderFleet, runIdFor, setEntries, shortTitle } from "./fleet.mjs";

test("rows are a word-boundary title, compact tokens and the model; the agent name stands in for a missing title", () => {
  const entry = { agent: "diff-reviewer", goal: "Review 2051082^..7ebb0ad\n for correctness", tokens: { input: 1, output: 2, total: 22079 }, model: "openai-codex/gpt-5.6-terra:high", effort: "high" };
  assert.equal(buildRow(entry), "Review 2051082^..7ebb0ad for… · 22.1k tokens · gpt-5.6-terra high");
  assert.equal(buildRow({ agent: "explore-deep", tokens: { total: 0 } }), "explore-deep");
  assert.equal(shortTitle("Audit latest 8 commits 2051082..3d1ce3e in /Users/keyute/.local/share/chezmoi for architecture"), "Audit latest 8 commits…");
  assert.equal(shortTitle("x".repeat(40)), `${"x".repeat(35)}…`);
  assert.equal(shortTitle("  short\n title "), "short title");
  // pi-subagents reports the launch string as model and the level again as effort.
  assert.equal(modelLabel("openai-codex/gpt-5.6-terra:medium", "medium"), "gpt-5.6-terra medium");
  assert.equal(modelLabel("openai-codex/gpt-5.6-terra:medium"), "gpt-5.6-terra");
  assert.equal(modelLabel(undefined, "high"), null);
  assert.equal(formatTokens(1234567), "1.2m");
  assert.equal(formatTokens(undefined), null);
});

// dim → ~text~, accent → *text*, so the assertions show which parts are styled.
const theme = { fg: (color, text) => (color === "dim" ? `~${text}~` : color === "accent" ? `*${text}*` : text) };

test("panel: child marker, dim queued rows, cursor row, and overflow markers", () => {
  const state = createFleetState();
  const entries = Array.from({ length: 7 }, (_, i) => ({ agent: `a${i}`, goal: `task ${i}`, tokens: { total: 1000 * (i + 1) }, model: "gpt-5.6-terra", effort: "high" }));
  setEntries(state, { entries: [entries[0], { ...entries[1], agent: "long-name", status: "pending" }], totalActive: 2 });
  assert.deepEqual(renderFleet(state, 80, theme), [
    "  ○ task 0 · 1k tokens · gpt-5.6-terra high",
    "  ○ ~task 1 · 2k tokens · gpt-5.6-terra high~",
  ]);
  setEntries(state, { entries, totalActive: 9 });
  assert.equal(navigate(state, "enter"), true);
  state.cursor = 1;
  const rows = renderFleet(state, 80, theme);
  assert.equal(rows.length, 6);
  assert.equal(rows[0], "  ○ task 0 · 1k tokens · gpt-5.6-terra high");
  assert.equal(rows[1], "  *›* task 1 · 2k tokens · gpt-5.6-terra high");
  assert.equal(rows.at(-1), "~  ↓ 4 more~");
  state.cursor = 6;
  const tail = renderFleet(state, 80, theme);
  assert.deepEqual([tail[0], tail.at(-1)], ["~  ↑ 2 more~", "~  ↓ 2 more~"]);
  assert.equal(tail[5], "  *›* task 6 · 7k tokens · gpt-5.6-terra high");
  assert.deepEqual(renderFleet(createFleetState(), 80, theme), []);
});

test("navigation is an editor-owned mode: enter on a stuck cursor, move, open, leave", () => {
  const state = createFleetState();
  const opens = [];
  const open = entry => opens.push(entry.agent);
  assert.equal(navigate(state, "enter", open), false);
  setEntries(state, { entries: [{ agent: "a" }, { agent: "b" }], totalActive: 2 });
  assert.equal(navigate(state, "down", open), false);
  assert.equal(navigate(state, "enter", open), true);
  assert.deepEqual([state.focused, state.cursor], [true, 0]);
  navigate(state, "down", open); navigate(state, "down", open);
  assert.equal(state.cursor, 1);
  navigate(state, "up", open);
  assert.equal(state.cursor, 0);
  assert.equal(navigate(state, "up", open), true);
  assert.equal(state.focused, false);
  navigate(state, "enter", open);
  assert.equal(navigate(state, "confirm", open), true);
  assert.deepEqual([opens, state.focused], [["a"], false]);
  navigate(state, "enter", open);
  assert.equal(navigate(state, "cancel", open), true);
  navigate(state, "enter", open);
  assert.equal(navigate(state, "other", open), false);
  assert.equal(state.focused, false);
  navigate(state, "enter", open);
  state.cursor = 1;
  setEntries(state, { entries: [{ agent: "a" }], totalActive: 1 });
  assert.equal(state.cursor, 0);
  setEntries(state, { entries: [], totalActive: 0 });
  assert.equal(state.focused, false);
});

test("same-agent siblings pair with their runs by rank; other agents and far runs never match", () => {
  const state = createFleetState();
  const entries = [{ agent: "b", startedAt: 5000 }, { agent: "b", startedAt: 5100 }, { agent: "c", startedAt: 5200 }, { agent: "d" }];
  setEntries(state, { entries, totalActive: 4 }, { runs: [
    { id: "run-b-old", label: "b", startedAt: 900_000 }, { id: "run-b2", label: "b", startedAt: 5100 }, { id: "run-b", label: "b", startedAt: 5000 }, { id: "run-c", label: "c", startedAt: 5050 },
  ] });
  assert.deepEqual(entries.map(entry => runIdFor(state, entry)), ["run-b", "run-b2", "run-c", null]);
  setEntries(state, { entries, totalActive: 4 }, { runs: [{ id: "run-b", label: "b", startedAt: 5000 }] });
  assert.deepEqual(entries.slice(0, 2).map(entry => runIdFor(state, entry)), ["run-b", null]);
});

function fakeBus() {
  const handlers = new Map();
  return {
    requests: [],
    entries: [],
    runs: [],
    silent: false,
    delayMs: 0,
    on(channel, handler) { handlers.set(channel, handler); return () => handlers.delete(channel); },
    emit(channel, message) {
      if (channel.startsWith("subagent:async-")) return handlers.get(channel)?.(message);
      if (channel !== "subagents:rpc:v1:request") return;
      this.requests.push(message.method);
      if (this.silent) return;
      const data = message.method === "ping" ? { capabilities: { fleetStatus: { version: 1 } } }
        : message.params.id ? { text: `transcript of ${message.params.id} (${message.params.view}, ${message.params.lines})` }
        : { fleet: { version: 1, entries: this.entries, totalActive: this.entries.length }, asyncSnapshot: { runs: this.runs ?? [] } };
      const reply = () => handlers.get(`subagents:rpc:v1:reply:${message.requestId}`)?.({ version: 1, requestId: message.requestId, success: true, data });
      this.delayMs ? setTimeout(reply, this.delayMs) : reply();
    },
    pending: () => [...handlers.keys()].filter(key => key.startsWith("subagents:rpc:v1:reply:")).length,
  };
}

test("rows poll while children run, name the task from the launch, peek each sibling, and stop on shutdown", async () => {
  const bus = fakeBus();
  const events = {};
  const entries = [];
  const pi = { events: bus, on: (name, handler) => { events[name] = handler; }, appendEntry: (kind, data) => entries.push({ kind, data }), registerEntryRenderer() {} };
  const overlays = [];
  const notices = [];
  const ctx = { hasUI: true, ui: {
    custom: async (make, options) => { assert.equal(options.overlay, true); const component = make({}, theme, {}, () => overlays.push("closed")); overlays.push(component.render(80).join("\n")); component.handleInput("\x1b"); },
    notify: (message, level) => notices.push(`${level}: ${message}`),
  } };
  bus.entries = [{ agent: "restored", tokens: { total: 0 } }];
  const fleet = installFleet(pi, ctx, { pollMs: 5, quietMs: 30, timeoutMs: 10 });
  const renders = [];
  fleet.attach({ requestRender: () => renders.push(1) });
  await sleep(20);
  assert.deepEqual(bus.requests.slice(0, 2), ["ping", "status"]);
  assert.deepEqual(fleet.render(80, theme), ["  ○ restored"]);
  assert.ok(renders.length);

  // The DTO never carries the task; the launch's start/end events do, keyed by the run id.
  events.tool_execution_start({ toolName: "subagent", toolCallId: "c1", args: { agent: "b", task: "Review the diff\n  for correctness", cwd: "/x" } });
  events.tool_execution_start({ toolName: "workspace_bash", toolCallId: "c2", args: { command: "ls" } });
  events.tool_execution_end({ toolName: "workspace_bash", toolCallId: "c2", result: {} });
  bus.entries = [{ agent: "a", goal: "one", tokens: { total: 2000 }, model: "openai-codex/m:high", effort: "high", startedAt: 1000 }, { agent: "b", tokens: { total: 0 }, startedAt: 5000 }];
  bus.runs = [{ id: "run-a-old", label: "a", startedAt: 900_000 }, { id: "run-a", label: "a", startedAt: 1200 }, { id: "run-b", label: "b", startedAt: 5000 }];
  events.tool_execution_end({ toolName: "subagent", toolCallId: "c1", result: { details: { mode: "async", runId: "run-b" } } });
  await sleep(20);
  assert.deepEqual(fleet.render(60, theme), ["  ○ one · 2k tokens · m high", "  ○ Review the diff for correctness"]);
  assert.equal(fleet.handleKey("enter"), true);
  assert.equal(fleet.render(60, theme)[0], "  *›* one · 2k tokens · m high");
  assert.equal(fleet.handleKey("down"), true);
  assert.equal(fleet.render(60, theme)[1], "  *›* Review the diff for correctness");
  // Enter peeks at the highlighted child's transcript, not the first child's.
  assert.equal(fleet.handleKey("confirm"), true);
  await sleep(10);
  assert.match(overlays[0], /\*b › Review the diff for correctness\*/);
  assert.match(overlays[0], /transcript of run-b \(transcript, 40\)/);
  assert.equal(overlays[1], "closed");
  assert.equal(fleet.focused(), false);
  // Same-agent siblings: the second row peeks the second run.
  bus.entries = [{ agent: "b", tokens: { total: 0 }, startedAt: 5000 }, { agent: "b", tokens: { total: 0 }, startedAt: 5100 }];
  bus.runs = [{ id: "run-b", label: "b", startedAt: 5000 }, { id: "run-b2", label: "b", startedAt: 5100 }];
  events.tool_execution_end({ toolName: "subagent", toolCallId: "c9", result: {} });
  await sleep(20);
  fleet.handleKey("enter");
  fleet.handleKey("down");
  fleet.handleKey("confirm");
  await sleep(10);
  assert.match(overlays[2], /transcript of run-b2 /);
  // No run at all: Enter says so instead of staying silent.
  bus.runs = [];
  events.tool_execution_end({ toolName: "subagent", toolCallId: "c9", result: {} });
  await sleep(20);
  fleet.handleKey("enter");
  fleet.handleKey("confirm");
  await sleep(10);
  assert.deepEqual(notices, ["info: No transcript yet for b"]);
  assert.equal(overlays.length, 4);

  bus.silent = true;
  await sleep(20);
  assert.equal(fleet.render(60, theme).length, 2);
  bus.silent = false;

  bus.entries = [];
  await sleep(60);
  assert.deepEqual(fleet.render(60, theme), []);
  const settled = bus.requests.length;
  await sleep(30);
  assert.equal(bus.requests.length, settled);
  assert.equal(bus.pending(), 0);

  bus.entries = [{ agent: "late", tokens: { total: 0 } }];
  bus.emit("subagent:async-started", { id: "late-1" });
  await sleep(20);
  assert.equal(fleet.render(60, theme).length, 1);
  // Live children: the launch/complete events lead, the poll (which also
  // covers runs restored with the session) catches up within an interval.
  assert.equal(fleet.activeCount(), 1);
  // Completions print a transcript line: the launch names the child and task,
  // an unknown run falls back to the payload.
  bus.emit("subagent:async-complete", { id: "unknown", agent: "stray", success: true });
  assert.equal(fleet.activeCount(), 1);
  bus.emit("subagent:async-complete", { runId: "run-b", success: false, state: "stopped" });
  // An interrupted but resumable child is paused, not failed: the resolved
  // per-result status leads, the file's own fields are the fallback.
  bus.emit("subagent:async-complete", { runId: "run-b", success: false, interrupted: true, state: "partial", results: [{ agent: "b", status: "paused" }] });
  bus.emit("subagent:async-complete", { runId: "run-b", success: false, state: "failed", results: [{ status: "completed" }, { status: "failed" }] });
  bus.emit("subagent:async-complete", { runId: "late-1", success: true, durationMs: 134_000 });
  assert.deepEqual(entries.map(entry => [entry.kind, entry.data.agent, entry.data.status]), [
    ["workflow-child", "stray", "completed"],
    ["workflow-child", "b", "stopped"],
    ["workflow-child", "b", "paused"],
    ["workflow-child", "b", "failed"],
    ["workflow-child", "subagent", "completed"],
  ]);
  assert.equal(entries[1].data.task, "Review the diff\n  for correctness");
  // The result file's run-level duration rides along; a payload without one leaves it out.
  assert.equal(entries[4].data.durationMs, 134_000);
  assert.equal(entries[0].data.durationMs, undefined);
  bus.entries = [];
  await sleep(20);
  assert.equal(fleet.activeCount(), 0);
  bus.entries = [{ agent: "late", tokens: { total: 0 } }];
  await sleep(20);
  assert.equal(fleet.activeCount(), 1);
  bus.delayMs = 5;
  await sleep(6);
  events.session_shutdown();
  assert.deepEqual(fleet.render(60, theme), []);
  const afterShutdown = bus.requests.length;
  await sleep(30);
  assert.deepEqual(fleet.render(60, theme), []);
  assert.equal(bus.requests.length, afterShutdown);
  events.tool_execution_end({ toolName: "subagent", toolCallId: "c9", result: {} });
  await sleep(20);
  assert.equal(bus.requests.length, afterShutdown);
});
