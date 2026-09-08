import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { buildSegments, formatReset, installFooter, parseGitChanges, parseRateLimits, windowLabel } from "./footer.mjs";
import { createTurnClock } from "./rows.mjs";

// A footer wired to fake pi/ctx objects; handlers are invoked by event name.
function harness({ active = 0, live = 0, tickMs = 5 } = {}) {
  const path = process.env.PATH;
  process.env.PATH = ""; // codex/git lookups fail fast instead of spawning
  const handlers = {};
  const entries = [];
  const messages = [];
  const pi = { on: (name, fn) => { handlers[name] = fn; }, registerEntryRenderer() {}, appendEntry: (kind, data) => entries.push({ kind, data }) };
  const widget = {};
  const visible = [];
  // The working row is a real Loader over a fake tui; every label it is given
  // is recorded, so the turn clock's ticks stay observable.
  const ui = {
    setFooter() {},
    setWorkingVisible: value => visible.push(value),
    setWidget(key, factory) {
      widget.key = key;
      widget.row = factory({ requestRender() {} }, { fg: (_color, text) => text });
      const setMessage = widget.row.setMessage.bind(widget.row);
      widget.row.setMessage = text => { messages.push(text); setMessage(text); };
    },
  };
  const ctx = { cwd: ".", model: { id: "gpt-5.6-sol" }, thinkingLevel: "high", getContextUsage: () => ({ percent: 27.2 }), ui };
  const fleet = { attach() {}, render: () => [], activeCount: () => active };
  const tasks = { live: () => live };
  installFooter(pi, ctx, { fleet, tasks, clock: createTurnClock([["Iterating", "Iterated"]], () => 0), tickMs });
  process.env.PATH = path;
  const fire = (name, event = {}) => handlers[name]?.(event, { cwd: "." });
  return { fire, entries, messages, fleet, tasks, widget, visible, done: () => fire("session_shutdown") };
}

test("rate limits key only on stable window fields", () => {
  const parsed = parseRateLimits({
    rateLimits: {
      primary: { usedPercent: 12, resetsAt: 1_800_000_000, windowDurationMins: 300 },
      secondary: { usedPercent: 40 },
      credits: { hasCredits: true, unlimited: false },
    },
    rateLimitUpsell: { anything: "ignored" },
  });
  assert.deepEqual(parsed, [
    { usedPercent: 12, resetsAt: 1_800_000_000, windowMins: 300 },
    { usedPercent: 40, resetsAt: null, windowMins: null },
  ]);
  assert.equal(parseRateLimits({ rateLimits: {} }), null);
  assert.equal(parseRateLimits(undefined), null);
  assert.equal(parseRateLimits({ rateLimits: { primary: { usedPercent: "50" } } }), null);
});

test("windows label by duration, not position", () => {
  assert.equal(windowLabel(300), "ses");
  assert.equal(windowLabel(10_080), "wk");
  assert.equal(windowLabel(720), "12h");
  assert.equal(windowLabel(null), "usage");
});

test("segments follow the ccstatusline order and omit missing data", () => {
  const texts = segments => segments.map(s => s.text);
  assert.deepEqual(
    texts(
      buildSegments({
        modelId: "gpt-5.6-sol",
        thinkingLevel: "high",
        contextPercent: 12.34,
        limits: [
          { usedPercent: 7, resetsAt: null, windowMins: 300 },
          { usedPercent: 41, resetsAt: null, windowMins: 10_080 },
        ],
        branch: "main",
        changes: "+3 -1",
      }),
    ),
    ["gpt-5.6-sol high", "12.3%", "ses 7%", "wk 41%", "main +3 -1"],
  );
  assert.deepEqual(texts(buildSegments({ modelId: "gpt-5.6-sol", contextPercent: null, limits: null, branch: null })), [
    "gpt-5.6-sol",
  ]);
});

test("reset timestamps format as time, weekly with weekday", () => {
  assert.match(formatReset(1_800_000_000), /^\d{2}:\d{2}$/);
  assert.match(formatReset(1_800_000_000, { weekday: true }), /^[A-Z][a-z]{2} \d{2}:\d{2}$/);
  assert.equal(formatReset(null), "");
});

test("git shortstat parses to compact change counts", () => {
  assert.equal(parseGitChanges(" 3 files changed, 14 insertions(+), 2 deletions(-)"), "+14 -2");
  assert.equal(parseGitChanges(" 1 file changed, 5 deletions(-)"), "-5");
  assert.equal(parseGitChanges(""), null);
});

test("footer renders the status line first and the fleet rows under it", () => {
  const path = process.env.PATH;
  process.env.PATH = ""; // codex/git lookups fail fast instead of spawning
  try {
    let factory;
    const attached = [];
    const fleet = { attach: tui => attached.push(tui), render: (width, theme) => [theme.fg("dim", `rows@${width}`)] };
    const ctx = { cwd: ".", model: { id: "gpt-5.6-sol" }, thinkingLevel: "high", getContextUsage: () => ({ percent: 27.2 }), ui: { setFooter: make => { factory = make; }, setWorkingVisible() {}, setWidget() {} } };
    installFooter({ on() {}, registerEntryRenderer() {}, appendEntry() {} }, ctx, { fleet });
    const tui = { requestRender() {} };
    const footerData = { onBranchChange: () => () => {}, getGitBranch: () => "main", getExtensionStatuses: () => new Map([["workflow", "plan"]]) };
    const lines = factory(tui, { fg: (_color, text) => text }, footerData).render(60);
    assert.deepEqual(attached, [tui]);
    assert.equal(lines[0], "  gpt-5.6-sol high · 27.2% · main" + " ".repeat(60 - 4 - 31 - 4) + "plan  ");
    assert.deepEqual(lines.slice(1), ["rows@60"]);
  } finally {
    process.env.PATH = path;
  }
});

test("the running label lives in the working row and clears at settle", async () => {
  const h = harness();
  h.fire("agent_start");
  await sleep(15);
  assert.match(h.messages[0], /^Iterating… \d+s$/);
  assert.ok(h.messages.length >= 2);
  h.fire("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
  h.fire("agent_settled");
  assert.equal(h.messages.at(-1), "");
  assert.equal(h.entries.length, 1);
  assert.equal(h.entries[0].data.verb, "Iterated");
  const ticks = h.messages.length;
  await sleep(15);
  assert.equal(h.messages.length, ticks);
  h.fire("agent_settled");
  assert.equal(h.entries.length, 1);
});

test("the turn line waits for background children and closes once with the total elapsed", async () => {
  let active = 1;
  const h = harness();
  h.fleet.activeCount = () => active;
  h.fire("agent_start");
  await sleep(12);
  h.fire("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
  h.fire("agent_settled");
  assert.equal(h.entries.length, 0);
  h.fire("input", { source: "extension" });
  assert.equal(h.entries.length, 0);
  active = 0;
  h.fire("agent_start");
  await sleep(12);
  h.fire("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
  h.fire("agent_settled");
  assert.equal(h.entries.length, 1);
  assert.ok(h.entries[0].data.ms >= 20, String(h.entries[0].data.ms));
  h.done();
});

test("the turn line waits for background tasks as it waits for children", () => {
  let live = 1;
  const h = harness();
  h.tasks.live = () => live;
  h.fire("agent_start");
  h.fire("agent_settled");
  assert.equal(h.entries.length, 0);
  live = 0;
  h.fire("agent_start");
  h.fire("agent_settled");
  assert.equal(h.entries.length, 1);
  h.done();
});

test("a typed prompt while waiting on children closes the turn", () => {
  const h = harness({ active: 1 });
  h.fire("agent_start");
  h.fire("agent_settled");
  assert.equal(h.entries.length, 0);
  h.fire("input", { source: "interactive" });
  assert.equal(h.entries.length, 1);
  h.done();
});

test("an interrupted run closes immediately", () => {
  const h = harness();
  h.fire("agent_start");
  h.fire("agent_end", { messages: [{ role: "assistant", stopReason: "aborted" }] });
  assert.deepEqual([h.entries.length, h.entries[0].data.aborted], [1, true]);
  h.fire("agent_settled");
  assert.equal(h.entries.length, 1);
  h.done();
});

test("the working row sits above the composer at column 0, with no row between turns", () => {
  const h = harness();
  assert.deepEqual(h.visible, [false], "pi's own working row is switched off");
  assert.equal(h.widget.key, "workflow-working");
  assert.deepEqual(h.widget.row.render(40), [], "no turn, no row");
  h.fire("agent_start");
  const lines = h.widget.row.render(40);
  assert.equal(lines.length, 1, "one line, and none of pi's leading blank");
  assert.match(lines[0], /^\S/, "the spinner glyph sits at column 0");
  assert.match(lines[0], /Iterating…/);
  h.fire("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
  h.fire("agent_settled");
  assert.deepEqual(h.widget.row.render(40), []);
  h.done();
});

test("the working row stands down while pi compacts, and comes back with the turn", async () => {
  const h = harness();
  h.fire("agent_start");
  assert.match(h.widget.row.render(40)[0], /Iterating…/);
  h.fire("session_before_compact");
  assert.deepEqual(h.widget.row.render(40), [], "pi's own compaction indicator is the only one");
  await sleep(15);
  assert.deepEqual(h.widget.row.render(40), [], "the turn clock's tick does not bring it back");
  h.fire("session_compact");
  assert.match(h.widget.row.render(40)[0], /Iterating…/);
  h.fire("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
  h.fire("agent_settled");
  // The turn is over; a late compaction has nothing to come back to.
  h.fire("session_compact");
  assert.deepEqual(h.widget.row.render(40), []);
  h.done();
});

test("ui prompts relabel the spinner", () => {
  const h = harness();
  h.fire("agent_start");
  h.fire("ui_prompt_start");
  assert.equal(h.messages.at(-1), "Waiting for you…");
  h.fire("ui_prompt_end");
  assert.match(h.messages.at(-1), /^Iterating…/);
  h.done();
});
