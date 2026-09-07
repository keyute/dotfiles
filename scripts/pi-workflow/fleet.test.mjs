import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { buildRow, formatTokens, installFleet } from "./fleet.mjs";

test("rows follow the Claude Code subagent statusline shape and trim the goal only", () => {
  const entry = { agent: "diff-reviewer", goal: "Review 2051082^..7ebb0ad\n for correctness", tokens: { input: 1, output: 2, total: 22079 }, model: "gpt-5.6-terra", effort: "high" };
  assert.equal(buildRow(entry, 0), "diff-reviewer › Review 2051082^..7ebb0ad for correctness · 22.1k tokens · gpt-5.6-terra high");
  assert.equal(buildRow(entry, 60), "diff-reviewer › Review … · 22.1k tokens · gpt-5.6-terra high");
  assert.equal(buildRow({ agent: "explore-deep", tokens: { total: 0 } }, 80), "explore-deep");
  assert.equal(buildRow({ agent: "x", goal: "g", tokens: { total: 1000 }, model: "gpt-5.6-luna" }, 80), "x › g · 1k tokens · gpt-5.6-luna");
  assert.equal(formatTokens(1234567), "1.2m tokens");
  assert.equal(formatTokens(undefined), null);
});

function fakeBus() {
  const handlers = new Map();
  return {
    requests: [],
    entries: [],
    silent: false,
    delayMs: 0,
    on(channel, handler) { handlers.set(channel, handler); return () => handlers.delete(channel); },
    emit(channel, message) {
      if (channel === "subagent:async-started") return handlers.get(channel)?.(message);
      if (channel !== "subagents:rpc:v1:request") return;
      this.requests.push(message.method);
      if (this.silent) return;
      const data = message.method === "ping" ? { capabilities: { fleetStatus: { version: 1 } } } : { fleet: { version: 1, entries: this.entries } };
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
  const ctx = { ui: { setWidget: (key, content, options) => { assert.equal(options.placement, "belowEditor"); factory = content; } } };
  bus.entries = [{ agent: "restored", tokens: { total: 0 } }];
  installFleet(pi, ctx, { pollMs: 5, quietMs: 30, timeoutMs: 10 });
  const widget = factory({ requestRender() {} }, { fg: (_color, text) => text });
  await sleep(20);
  assert.deepEqual(bus.requests.slice(0, 2), ["ping", "status"]);
  assert.deepEqual(widget.render(80), ["restored" + " ".repeat(63) + "⌃⌥F fleet"]);

  bus.entries = [{ agent: "a", goal: "one", tokens: { total: 2000 }, model: "m" }, { agent: "b", goal: "two", tokens: { total: 0 } }];
  events.tool_execution_end({ toolName: "subagent" });
  await sleep(20);
  assert.deepEqual(widget.render(60), ["a › one · 2k tokens · m" + " ".repeat(28) + "⌃⌥F fleet", "b › two"]);

  bus.silent = true;
  await sleep(20);
  assert.equal(widget.render(60).length, 2);
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
  assert.equal(widget.render(60).length, 1);
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
