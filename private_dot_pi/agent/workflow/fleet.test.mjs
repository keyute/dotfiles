import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { buildRow, createFleetState, formatTokens, installFleet, modelLabel, navigate, renderFleet, runIdFor, setEntries, shortTitle } from "./fleet.mjs";

test("rows are the agent, a word-boundary title, compact tokens and the model; the agent alone when the title is missing", () => {
  const entry = { agent: "diff-reviewer", goal: "Review 2051082^..7ebb0ad\n for correctness", tokens: { input: 1, output: 2, total: 22079 }, model: "openai-codex/gpt-5.6-terra:high", effort: "high" };
  assert.equal(buildRow(entry), "diff-reviewer › Review 2051082^..7ebb0ad for… · 22.1k tokens · gpt-5.6-terra high");
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
    "  ○ a0 › task 0 · 1k tokens · gpt-5.6-terra high",
    "  ○ ~long-name › task 1 · 2k tokens · gpt-5.6-terra high~",
  ]);
  setEntries(state, { entries, totalActive: 9 });
  assert.equal(navigate(state, "enter"), true);
  state.cursor = 1;
  const rows = renderFleet(state, 80, theme);
  assert.equal(rows.length, 6);
  assert.equal(rows[0], "  ○ a0 › task 0 · 1k tokens · gpt-5.6-terra high");
  assert.equal(rows[1], "  *❭* a1 › task 1 · 2k tokens · gpt-5.6-terra high");
  assert.equal(rows.at(-1), "~  ↓ 4 more~");
  state.cursor = 6;
  const tail = renderFleet(state, 80, theme);
  assert.deepEqual([tail[0], tail.at(-1)], ["~  ↑ 2 more~", "~  ↓ 2 more~"]);
  assert.equal(tail[5], "  *❭* a6 › task 6 · 7k tokens · gpt-5.6-terra high");
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

test("completed same-role siblings never shift active rows, even when rows and runs reorder", () => {
  const state = createFleetState();
  const b = { key: "fleet-2", agent: "worker", startedAt: 2000 };
  const c = { key: "fleet-3", agent: "worker", startedAt: 3000 };
  const runs = [
    { id: "A", label: "worker", startedAt: 1000, state: "complete" },
    { id: "B", label: "worker", startedAt: 2000, state: "running" },
    { id: "C", label: "worker", startedAt: 3000, state: "running" },
  ];
  setEntries(state, { entries: [b, c] }, { runs });
  assert.deepEqual([runIdFor(state, b), runIdFor(state, c)], ["B", "C"]);
  setEntries(state, { entries: [c, b] }, { runs: [...runs].reverse() });
  assert.deepEqual([runIdFor(state, c), runIdFor(state, b)], ["C", "B"]);
  setEntries(state, { entries: [b, c] }, { runs: [runs[0], runs[2], { id: "replacement", label: "worker", startedAt: 2000, state: "running" }] });
  assert.deepEqual([runIdFor(state, b), runIdFor(state, c)], [null, "C"], "an established key cannot rebind even to an exact replacement");
  setEntries(state, { entries: [b, c] }, { runs: [runs[0], runs[1], runs[2]] });
  assert.equal(runIdFor(state, b), "B");
});

test("only unique exact active step or root matches are controllable", () => {
  const state = createFleetState();
  const step = { key: "fleet-step", agent: "worker", startedAt: 2200 };
  const fallback = { key: "fleet-fallback", agent: "queued", startedAt: 4100 };
  setEntries(state, { entries: [step, fallback] }, { runs: [
    { id: "step-run", label: "worker", startedAt: 2000, state: "running", children: [{ kind: "step", label: "worker", startedAt: 2200, state: "running" }] },
    { id: "root-run", label: "queued", startedAt: 4100, state: "queued" },
  ] });
  assert.deepEqual([runIdFor(state, step), runIdFor(state, fallback)], ["step-run", "root-run"]);
  setEntries(state, { entries: [{ key: "new", agent: "worker", startedAt: 2200 }] }, { runs: [
    { id: "one", label: "worker", startedAt: 2000, state: "running", children: [{ kind: "step", label: "worker", startedAt: 2200, state: "running" }] },
    { id: "two", label: "worker", startedAt: 2100, state: "running", children: [{ kind: "step", label: "worker", startedAt: 2200, state: "queued" }] },
  ] });
  assert.equal(runIdFor(state, state.entries[0]), null);
  setEntries(state, { entries: [{ key: "new", agent: "worker", startedAt: 2200 }, { key: "other", agent: "worker", startedAt: 2200 }] }, { runs: [
    { id: "one", label: "worker", startedAt: 2000, state: "running", children: [{ kind: "step", label: "worker", startedAt: 2200, state: "running" }] },
  ] });
  assert.deepEqual(state.entries.map(entry => runIdFor(state, entry)), [null, null]);
  setEntries(state, { entries: [{ agent: "worker", startedAt: 2000 }] }, { runs: [
    { id: "omitted-step-time", label: "worker", startedAt: 2000, state: "running", children: [{ kind: "step", label: "worker", state: "running" }] },
  ] });
  assert.equal(runIdFor(state, state.entries[0]), "omitted-step-time");
  assert.equal(state.bindings.size, 0, "unkeyed synthetic rows have no retained identity");
  setEntries(state, { entries: [{ agent: "worker", startedAt: 2000 }] }, { runs: [
    { id: "inactive-step", label: "worker", startedAt: 2000, state: "running", children: [{ kind: "step", label: "worker", startedAt: 2000, state: "complete" }] },
  ] });
  assert.equal(runIdFor(state, state.entries[0]), null, "a root with step nodes cannot fall back to its own label/time");
  setEntries(state, { entries: [{ agent: "worker", startedAt: 2000 }] }, { runs: [
    { id: "multi-run", label: "worker, reviewer", startedAt: 2000, state: "running", children: [{ kind: "step", label: "worker", startedAt: 2000, state: "running" }] },
  ] });
  assert.equal(runIdFor(state, state.entries[0]), null, "a step cannot authorize control of a multi-agent parent");
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
      if (channel.startsWith("subagent:")) return handlers.get(channel)?.(message);
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

function cleanupBus({ runs = [], omitted = 0, hiddenActive = 0, failStop = new Set(), settle = true, initialProof = false, completeOnly = false, onStop } = {}) {
  const handlers = new Map();
  const bus = {
    requests: [],
    proofs: new Map(),
    on(channel, handler) {
      const list = handlers.get(channel) ?? new Set();
      list.add(handler);
      handlers.set(channel, list);
      return () => list.delete(handler);
    },
    emit(channel, message) {
      if (channel !== "subagents:rpc:v1:request") {
        for (const handler of handlers.get(channel) ?? []) handler(message);
        return;
      }
      this.requests.push({ method: message.method, params: message.params });
      if (message.method === "stop") onStop?.(this, message.params.id);
      let success = true;
      let data;
      if (message.method === "ping") data = { capabilities: { fleetStatus: { version: 1 }, stop: true, processTerminalProof: { version: 1 } } };
      else if (message.method === "status" && !message.params.id) data = {
        fleet: { version: 1, entries: [], totalActive: runs.filter(run => ["queued", "running"].includes(run.state)).length + hiddenActive },
        asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, omitted: { runs: omitted, children: 0, byteLimitExceeded: false }, runs },
      };
      else if (message.method === "status") {
        const run = runs.find(item => item.id === message.params.id);
        data = {
          details: this.proofs.has(message.params.id) || initialProof ? { lifecycleStatus: { processTerminal: this.proofs.get(message.params.id) ?? { version: 1, runId: message.params.id, state: "pending" } } } : { mode: "single", results: [] },
          asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, omitted: { runs: omitted, children: 0, byteLimitExceeded: false }, runs: run ? [run] : [] },
        };
      } else if (message.method === "stop" && failStop.has(message.params.id)) {
        success = false;
      } else if (message.method === "stop") {
        data = { runId: message.params.id, state: "stopping" };
        if (settle) setImmediate(() => {
          const run = runs.find(item => item.id === message.params.id);
          if (run) run.state = "stopped";
          if (completeOnly) return this.emit("subagent:async-complete", { runId: message.params.id, state: "stopped" });
          const proof = { version: 1, runId: message.params.id, state: "observed" };
          this.proofs.set(message.params.id, proof);
          this.emit("subagent:process-terminal", proof);
        });
      }
      const reply = { version: 1, requestId: message.requestId, success, ...(success ? { data } : { error: { code: "failed", message: "stop failed" } }) };
      for (const handler of handlers.get(`subagents:rpc:v1:reply:${message.requestId}`) ?? []) handler(reply);
    },
  };
  return bus;
}

test("cleanup stops event-owned and restored top-level run ids and verifies process-terminal proof", async () => {
  const runs = [{ id: "restored", label: "worker", state: "running", updatedAt: 2 }, { id: "done", label: "reviewer", state: "complete", updatedAt: 3 }];
  const bus = cleanupBus({ runs });
  const events = {};
  const pi = { events: bus, on: (name, handler) => { events[name] = handler; }, appendEntry() {}, registerEntryRenderer() {} };
  const fleet = installFleet(pi, null, { pollMs: 50, quietMs: 50, timeoutMs: 20, cleanupTimeoutMs: 50 });
  bus.emit("subagent:async-started", { id: "launched" });
  runs.push({ id: "launched", label: "scout", state: "running", updatedAt: 1 });
  await fleet.stopAll();
  assert.deepEqual(bus.requests.filter(request => request.method === "stop").map(request => request.params), [{ id: "launched" }, { id: "restored" }]);
  assert.equal(runs.find(run => run.id === "done").state, "complete");
});

test("cleanup fails visibly for a failed stop, missing terminal proof, or an omitted snapshot", async () => {
  const failed = cleanupBus({ runs: [{ id: "bad", state: "running" }], failStop: new Set(["bad"]) });
  const failedFleet = installFleet({ events: failed, on() {}, appendEntry() {}, registerEntryRenderer() {} }, null, { pollMs: 5, quietMs: 5, timeoutMs: 20, cleanupTimeoutMs: 20 });
  await assert.rejects(failedFleet.stopAll(), /bad.*stop request failed/);

  const unproven = cleanupBus({ runs: [{ id: "slow", state: "running" }], settle: false, initialProof: true });
  const unprovenFleet = installFleet({ events: unproven, on() {}, appendEntry() {}, registerEntryRenderer() {} }, null, { pollMs: 5, quietMs: 5, timeoutMs: 20, cleanupTimeoutMs: 5 });
  await assert.rejects(unprovenFleet.stopAll(), /slow.*terminal state was not established/);

  const omitted = cleanupBus({ runs: [{ id: "known", state: "running" }], omitted: 1, hiddenActive: 1 });
  const omittedFleet = installFleet({ events: omitted, on() {}, appendEntry() {}, registerEntryRenderer() {} }, null, { pollMs: 5, quietMs: 5, timeoutMs: 20, cleanupTimeoutMs: 20 });
  await assert.rejects(omittedFleet.stopAll(), /snapshot omitted 1 run.*restored work/i);
  assert.deepEqual(omitted.requests.filter(request => request.method === "stop").map(request => request.params), [{ id: "known" }]);
});

test("cleanup permits more than twenty terminal historical runs", async () => {
  const bus = cleanupBus({ runs: Array.from({ length: 20 }, (_, i) => ({ id: `done-${i}`, state: "complete" })), omitted: 1 });
  const fleet = installFleet({ events: bus, on() {}, appendEntry() {}, registerEntryRenderer() {} }, null, { timeoutMs: 20, cleanupTimeoutMs: 5 });
  await fleet.stopAll();
  assert.equal(bus.requests.some(request => request.method === "stop"), false);
});

test("completion without process metadata is not exit proof", async () => {
  const bus = cleanupBus({ runs: [{ id: "unproven", state: "running" }], completeOnly: true });
  const fleet = installFleet({ events: bus, on() {}, appendEntry() {}, registerEntryRenderer() {} }, null, { timeoutMs: 20, cleanupTimeoutMs: 5 });
  await assert.rejects(fleet.stopAll(), /unproven.*terminal state was not established/);
});

test("observed natural exit racing a stop is successful and repeated cleanup is harmless", async () => {
  const runs = [{ id: "racing", state: "running" }];
  const bus = cleanupBus({ runs, failStop: new Set(["racing"]), onStop(bus, id) {
    runs[0].state = "complete";
    const proof = { version: 1, runId: id, state: "observed" };
    bus.proofs.set(id, proof);
    bus.emit("subagent:process-terminal", proof);
  } });
  const fleet = installFleet({ events: bus, on() {}, appendEntry() {}, registerEntryRenderer() {} }, null, { timeoutMs: 20, cleanupTimeoutMs: 5 });
  await fleet.stopAll();
  await fleet.stopAll();
  assert.equal(bus.requests.filter(request => request.method === "stop").length, 1);
});

test("completed event-owned runs stay tracked until their process exits", async () => {
  const bus = cleanupBus();
  const fleet = installFleet({ events: bus, on() {}, appendEntry() {}, registerEntryRenderer() {} }, null, { timeoutMs: 20, cleanupTimeoutMs: 5 });
  bus.emit("subagent:async-started", { id: "closing" });
  bus.emit("subagent:async-complete", { runId: "closing", success: true });
  assert.equal(fleet.activeCount(), 1);
  await fleet.stopAll();
  assert.deepEqual(bus.requests.filter(request => request.method === "stop").map(request => request.params.id), ["closing"]);
  assert.equal(fleet.activeCount(), 0);
});

test("peek opens the intended active sibling after a completed sibling drops", async () => {
  const bus = fakeBus();
  const hooks = {};
  const opened = [];
  const pi = { events: bus, on: (name, handler) => { hooks[name] = handler; }, appendEntry() {}, registerEntryRenderer() {} };
  const ctx = { mode: "tui", hasUI: true, ui: { notify() {} } };
  const fleet = installFleet(pi, ctx, { pollMs: 5, quietMs: 20, timeoutMs: 10, openPeek: async (_ctx, options) => { opened.push(options); } });
  for (const [id, time] of [["A", 1000], ["B", 2000], ["C", 3000]]) {
    hooks.tool_execution_start({ toolName: "subagent", toolCallId: id, args: { agent: "worker", task: id } });
    hooks.tool_execution_end({ toolName: "subagent", toolCallId: id, result: { details: { runId: id, asyncDir: `/tmp/${id}` } } });
    bus.runs.push({ id, kind: "subagent", label: "worker", state: "running", startedAt: time });
    bus.entries.push({ key: `fleet-${id}`, agent: "worker", startedAt: time });
  }
  await sleep(20);
  bus.runs[0].state = "complete";
  bus.entries.shift();
  await sleep(20);
  fleet.handleKey("enter");
  fleet.handleKey("confirm");
  await sleep(10);
  assert.deepEqual(opened.map(({ id, asyncDir }) => [id, asyncDir]), [["B", "/tmp/B"]]);
  bus.entries = [{ key: "fleet-new", agent: "worker", startedAt: 2000 }];
  bus.runs.push({ id: "D", label: "worker", state: "running", startedAt: 2000 });
  await sleep(20);
  fleet.handleKey("confirm");
  await sleep(10);
  assert.equal(opened.length, 1, "an ambiguous row cannot open a controllable peek");
  assert.ok(!bus.requests.some(method => method === "steer" || method === "stop"));
  hooks.session_shutdown();
});

test("rows poll while children run, name the task from the launch, peek each sibling, and stop on shutdown", async () => {
  const bus = fakeBus();
  const events = {};
  const entries = [];
  const pi = { events: bus, on: (name, handler) => { events[name] = handler; }, appendEntry: (kind, data) => entries.push({ kind, data }), registerEntryRenderer() {} };
  const overlays = [];
  const notices = [];
  const opened = [];
  let shift = null;
  let hold = null;
  const openPeek = async (_ctx, opts) => { opened.push(opts); await shift?.(); await hold; };
  const ctx = { hasUI: true, mode: "tui", ui: {
    custom: async (make, options) => { assert.equal(options.overlay, true); const component = make({}, theme, {}, () => overlays.push("closed")); overlays.push(component.render(80).join("\n")); component.handleInput("\x1b"); },
    notify: (message, level) => notices.push(`${level}: ${message}`),
  } };
  bus.entries = [{ agent: "restored", tokens: { total: 0 } }];
  const fleet = installFleet(pi, ctx, { pollMs: 5, quietMs: 30, timeoutMs: 10, openPeek });
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
  bus.runs = [{ id: "run-a-old", label: "a", startedAt: 900_000, state: "complete" }, { id: "run-a", label: "a", startedAt: 1000, state: "running" }, { id: "run-b", label: "b", startedAt: 5000, state: "running" }];
  events.tool_execution_end({ toolName: "subagent", toolCallId: "c1", result: { details: { mode: "async", runId: "run-b" } } });
  await sleep(20);
  assert.deepEqual(fleet.render(60, theme), ["  ○ a › one · 2k tokens · m high", "  ○ b › Review the diff for correctness"]);
  assert.equal(fleet.handleKey("enter"), true);
  assert.equal(fleet.render(60, theme)[0], "  *❭* a › one · 2k tokens · m high");
  assert.equal(fleet.handleKey("down"), true);
  assert.equal(fleet.render(60, theme)[1], "  *❭* b › Review the diff for correctness");
  // Enter peeks at the highlighted child's transcript, not the first child's.
  assert.equal(fleet.handleKey("confirm"), true);
  await sleep(10);
  assert.match(overlays[0], /\*b › Review the diff for correctness\*/);
  assert.match(overlays[0], /transcript of run-b \(transcript, 40\)/);
  assert.equal(overlays[1], "closed");
  // The text-tail path restores focus and the cursor to the peeked row too,
  // so Down keeps moving without pressing Enter again.
  assert.equal(fleet.focused(), true);
  assert.equal(fleet.render(60, theme)[1], "  *❭* b › Review the diff for correctness");

  // A launch whose result carries an asyncDir opens the injected dialog
  // instead, with a live describe() sourced from the current poll.
  events.tool_execution_start({ toolName: "subagent", toolCallId: "c5", args: { agent: "d", task: "Patch the config" } });
  bus.entries = [{ agent: "d", tokens: { total: 2000 }, model: "openai-codex/m:medium", effort: "medium", startedAt: 7000 }];
  bus.runs = [{ id: "run-d", label: "d", startedAt: 7000, state: "running", activity: { currentTool: "workspace_bash" } }];
  events.tool_execution_end({ toolName: "subagent", toolCallId: "c5", result: { details: { mode: "async", runId: "run-d", asyncDir: "/tmp/x/run-d" } } });
  await sleep(20);
  assert.equal(fleet.handleKey("confirm"), true);
  await sleep(10);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].id, "run-d");
  assert.equal(opened[0].asyncDir, "/tmp/x/run-d");
  assert.deepEqual(opened[0].describe(), {
    agent: "d", task: "Patch the config", model: "openai-codex/m:medium", effort: "medium",
    tokens: { total: 2000 }, startedAt: 7000, state: "running", currentTool: "workspace_bash", terminal: false,
  });
  assert.equal(fleet.focused(), true);
  assert.equal(fleet.render(60, theme)[0], "  *❭* d › Patch the config · 2k tokens · m medium");
  // Once the run leaves the async snapshot, describe() reports it terminal.
  bus.runs = [];
  await sleep(20);
  assert.equal(opened[0].describe().terminal, true);
  // A sibling that lands above the peeked row while the peek is open does not
  // move the cursor off it: the row is found again by its key.
  bus.entries = [{ key: "k-d", agent: "d", tokens: { total: 0 }, startedAt: 7000 }];
  bus.runs = [{ id: "run-d", label: "d", startedAt: 7000, state: "running" }];
  await sleep(20);
  shift = async () => { bus.entries = [{ key: "k-c", agent: "c", tokens: { total: 0 }, startedAt: 6000 }, ...bus.entries]; await sleep(20); };
  fleet.handleKey("confirm");
  await sleep(50);
  shift = null;
  assert.deepEqual(fleet.render(60, theme), ["  ○ c", "  *❭* d › Patch the config"]);

  // Same-agent siblings: focus already sits on the first row, so Down alone
  // reaches the second run.
  bus.entries = [{ key: "k-b1", agent: "b", tokens: { total: 0 }, startedAt: 5000 }, { key: "k-b2", agent: "b", tokens: { total: 0 }, startedAt: 5100 }];
  bus.runs = [{ id: "run-b", label: "b", startedAt: 5000, state: "running" }, { id: "run-b2", label: "b", startedAt: 5100, state: "running" }];
  events.tool_execution_end({ toolName: "subagent", toolCallId: "c9", result: {} });
  await sleep(20);
  fleet.handleKey("down");
  fleet.handleKey("confirm");
  await sleep(10);
  assert.match(overlays[2], /transcript of run-b2 /);
  // No run at all: Enter says so instead of staying silent.
  bus.runs = [];
  events.tool_execution_end({ toolName: "subagent", toolCallId: "c9", result: {} });
  await sleep(20);
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
  // A `completed` completion carries a seq of its own (rule 4); the failed
  // one between them, like every other status, carries none.
  assert.ok(entries[0].data.seq);
  assert.ok(entries[4].data.seq);
  assert.notEqual(entries[0].data.seq, entries[4].data.seq);
  assert.equal(entries[3].data.seq, undefined);
  bus.entries = [];
  await sleep(20);
  assert.equal(fleet.activeCount(), 1, "logical completion does not prove runner exit");
  bus.emit("subagent:process-terminal", { version: 1, runId: "late-1", state: "observed" });
  assert.equal(fleet.activeCount(), 0);
  bus.entries = [{ agent: "late", tokens: { total: 0 } }];
  await sleep(20);
  assert.equal(fleet.activeCount(), 1);
  bus.delayMs = 5;
  await sleep(6);
  // A peek left open when the session shuts down gets its signal aborted.
  bus.entries = [{ agent: "d", tokens: { total: 0 }, startedAt: 7000 }];
  bus.runs = [{ id: "run-d", label: "d", startedAt: 7000, state: "running" }];
  await sleep(20);
  hold = new Promise(() => {});
  fleet.handleKey("enter");
  fleet.handleKey("confirm");
  await sleep(10);
  const pending = opened.at(-1);
  assert.ok(pending.signal instanceof AbortSignal);
  assert.equal(pending.signal.aborted, false);
  events.session_shutdown();
  assert.deepEqual(fleet.render(60, theme), []);
  assert.equal(pending.signal.aborted, true);
  const afterShutdown = bus.requests.length;
  await sleep(30);
  assert.deepEqual(fleet.render(60, theme), []);
  assert.equal(bus.requests.length, afterShutdown);
  events.tool_execution_end({ toolName: "subagent", toolCallId: "c9", result: {} });
  await sleep(20);
  assert.equal(bus.requests.length, afterShutdown);
});
