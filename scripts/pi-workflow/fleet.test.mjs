import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { buildRow, createFleetState, formatTokens, installFleet, navigate, renderFleet, setEntries } from "./fleet.mjs";

test("rows follow the Claude Code subagent statusline shape and trim the goal only", () => {
  const entry = { agent: "diff-reviewer", goal: "Review 2051082^..7ebb0ad\n for correctness", tokens: { input: 1, output: 2, total: 22079 }, model: "gpt-5.6-terra", effort: "high" };
  assert.equal(buildRow(entry, 0), "diff-reviewer › Review 2051082^..7ebb0ad for correctness · 22.1k tokens · gpt-5.6-terra high");
  assert.equal(buildRow(entry, 60), "diff-reviewer › Review … · 22.1k tokens · gpt-5.6-terra high");
  assert.equal(buildRow({ agent: "explore-deep", tokens: { total: 0 } }, 80), "explore-deep");
  assert.equal(buildRow({ agent: "x", goal: "g", tokens: { total: 1000 }, model: "gpt-5.6-luna" }, 80), "x › g · 1k tokens · gpt-5.6-luna");
  assert.equal(formatTokens(1234567), "1.2m tokens");
  assert.equal(formatTokens(undefined), null);
});

const theme = { fg: (_color, text) => text };

test("panel has a root row, glyph and cursor per child, and overflow markers like Claude Code's", () => {
  const state = createFleetState();
  const entries = Array.from({ length: 7 }, (_, i) => ({ agent: `a${i}`, goal: `task ${i}`, tokens: { total: 1000 * (i + 1) }, model: "gpt-5.6-terra", effort: "high" }));
  setEntries(state, { entries: entries.slice(0, 2), totalActive: 2 });
  assert.deepEqual(renderFleet(state, 80, theme, { model: "gpt-5.6-sol", effort: "high" }), [
    "  ⏺ main · gpt-5.6-sol high",
    "  ◯ a0 › task 0 · 1k tokens · gpt-5.6-terra high",
    "  ◯ a1 › task 1 · 2k tokens · gpt-5.6-terra high",
  ]);
  assert.equal(renderFleet(state, 80, theme, { hint: "⌃⌥F fleet" })[0], "  ⏺ main" + " ".repeat(63) + "⌃⌥F fleet");
  setEntries(state, { entries, totalActive: 9 });
  assert.equal(navigate(state, "enter"), true);
  state.cursor = 1;
  const rows = renderFleet(state, 80, theme);
  assert.equal(rows.length, 7);
  assert.equal(rows[2], "❯ ◯ a1 › task 1 · 2k tokens · gpt-5.6-terra high");
  assert.equal(rows.at(-1), "  ↓ 4 more");
  state.cursor = 6;
  const tail = renderFleet(state, 80, theme);
  assert.deepEqual([tail[1], tail.at(-1)], ["  ↑ 2 more", "  ↓ 2 more"]);
  assert.equal(tail[6], "❯ ◯ a6 › task 6 · 7k tokens · gpt-5.6-terra high");
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
      if (channel === "subagent:async-started") return handlers.get(channel)?.(message);
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

test("widget polls while children run, survives dropped replies, and stops on shutdown", async () => {
  const bus = fakeBus();
  const events = {};
  let factory;
  const pi = { events: bus, on: (name, handler) => { events[name] = handler; } };
  const overlays = [];
  const ctx = { hasUI: true, ui: { setWidget: (key, content, options) => { assert.equal(options.placement, "belowEditor"); factory = content; }, custom: async (make, options) => { assert.equal(options.overlay, true); const component = make({}, theme, {}, () => overlays.push("closed")); overlays.push(component.render(80).join("\n")); component.handleInput("\x1b"); } }, model: { id: "gpt-5.6-sol" }, thinkingLevel: "high" };
  bus.entries = [{ agent: "restored", tokens: { total: 0 } }];
  const fleet = installFleet(pi, ctx, { pollMs: 5, quietMs: 30, timeoutMs: 10 });
  const widget = factory({ requestRender() {} }, theme);
  await sleep(20);
  assert.deepEqual(bus.requests.slice(0, 2), ["ping", "status"]);
  assert.deepEqual(widget.render(80), ["  ⏺ main · gpt-5.6-sol high" + " ".repeat(44) + "⌃⌥F fleet", "  ◯ restored"]);

  bus.entries = [{ agent: "a", goal: "one", tokens: { total: 2000 }, model: "m", startedAt: 1000 }, { agent: "b", goal: "two", tokens: { total: 0 }, startedAt: 5000 }];
  bus.runs = [{ id: "run-a-old", label: "a", startedAt: 900_000 }, { id: "run-a", label: "a", startedAt: 1200 }, { id: "run-b", label: "b", startedAt: 5000 }];
  events.tool_execution_end({ toolName: "subagent" });
  await sleep(20);
  assert.deepEqual(widget.render(60), ["  ⏺ main · gpt-5.6-sol high" + " ".repeat(24) + "⌃⌥F fleet", "  ◯ a › one · 2k tokens · m", "  ◯ b › two"]);
  const shortcuts = [];
  const editor = { onExtensionShortcut: data => shortcuts.push(data) };
  assert.equal(fleet.handleKey("enter", editor), true);
  assert.equal(widget.render(60)[1], "❯ ◯ a › one · 2k tokens · m");
  assert.equal(fleet.handleKey("down", editor), true);
  assert.equal(widget.render(60)[2], "❯ ◯ b › two");
  // Enter peeks at the highlighted child's transcript, not the first child's.
  assert.equal(fleet.handleKey("confirm", editor), true);
  await sleep(10);
  assert.deepEqual(shortcuts, []);
  assert.match(overlays[0], /b › two/);
  assert.match(overlays[0], /transcript of run-b \(transcript, 40\)/);
  assert.equal(overlays[1], "closed");
  assert.equal(fleet.focused(), false);
  // Ambiguous (same-agent siblings) or missing run ids open the inspector instead.
  bus.runs = [{ id: "run-b", label: "b", startedAt: 5000 }, { id: "run-b2", label: "b", startedAt: 5100 }];
  events.tool_execution_end({ toolName: "subagent" });
  await sleep(20);
  fleet.handleKey("enter", editor);
  fleet.handleKey("down", editor);
  fleet.handleKey("confirm", editor);
  await sleep(10);
  assert.deepEqual(shortcuts, ["\x1b\x06"]);
  bus.runs = [];
  events.tool_execution_end({ toolName: "subagent" });
  await sleep(20);
  fleet.handleKey("enter", editor);
  fleet.handleKey("confirm", editor);
  await sleep(10);
  assert.deepEqual(shortcuts, ["\x1b\x06", "\x1b\x06"]);
  assert.equal(overlays.length, 2);

  bus.silent = true;
  await sleep(20);
  assert.equal(widget.render(60).length, 3);
  bus.silent = false;

  bus.entries = [];
  await sleep(60);
  assert.deepEqual(widget.render(60), []);
  const settled = bus.requests.length;
  await sleep(30);
  assert.equal(bus.requests.length, settled);
  assert.equal(bus.pending(), 0);

  bus.entries = [{ agent: "late", tokens: { total: 0 } }];
  bus.emit("subagent:async-started", {});
  await sleep(20);
  assert.equal(widget.render(60).length, 2);
  bus.delayMs = 5;
  await sleep(6);
  events.session_shutdown();
  assert.deepEqual(widget.render(60), []);
  const afterShutdown = bus.requests.length;
  await sleep(30);
  assert.deepEqual(widget.render(60), []);
  assert.equal(bus.requests.length, afterShutdown);
  events.tool_execution_end({ toolName: "subagent" });
  await sleep(20);
  assert.equal(bus.requests.length, afterShutdown);
});
