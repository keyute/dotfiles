import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildSegments, formatReset, installFooter, paintMode, paintSegment, parseCodexHeaders, parseCodexRateLimits, parseGitChanges, parseRateLimits, readRateLimits, windowLabel } from "./footer.mjs";
import { createTurnClock, formatTurn } from "./rows.mjs";

// A footer wired to fake pi/ctx objects; handlers are invoked by event name.
function harness({ active = 0, live = 0, tickMs = 5, settleMs = 0, readLimits = async () => null, mountFooter = false } = {}) {
  const path = process.env.PATH;
  process.env.PATH = ""; // git lookups fail fast instead of spawning
  const handlers = {};
  const entries = [];
  const messages = [];
  const pi = { on: (name, fn) => { handlers[name] = fn; }, registerEntryRenderer() {}, appendEntry: (kind, data) => entries.push({ kind, data }) };
  const widget = {};
  const visible = [];
  let component;
  let renders = 0;
  // The working row is a real Loader over a fake tui; every label it is given
  // is recorded, so the turn clock's ticks stay observable.
  const ui = {
    setFooter(factory) {
      if (!mountFooter) return;
      component?.dispose();
      component = factory({ requestRender() { renders++; } }, { fg: (_color, text) => text }, {
        onBranchChange: () => () => {}, getGitBranch: () => null, getExtensionStatuses: () => new Map(),
      });
    },
    setWorkingVisible: value => visible.push(value),
    setWidget(key, factory) {
      widget.key = key;
      widget.row = factory({ requestRender() {} }, { fg: (_color, text) => text });
      const setMessage = widget.row.setMessage.bind(widget.row);
      widget.row.setMessage = text => { messages.push(text); setMessage(text); };
    },
  };
  const root = { idle: true };
  const ctx = { cwd: ".", model: { id: "gpt-5.6-sol", provider: "openai-codex" }, getContextUsage: () => ({ percent: 27.2 }), isIdle: () => root.idle, ui };
  const changes = [];
  const fleet = { attach() {}, render: () => [], activeCount: () => active, onChange: fn => changes.push(fn), changed: () => changes.forEach(fn => fn()) };
  const tasks = { live: () => live, onChange: fn => changes.push(fn), changed: () => changes.forEach(fn => fn()) };
  const footer = installFooter(pi, ctx, { fleet, tasks, clock: createTurnClock([["Iterating", "Iterated"]], () => 0), tickMs, settleMs, readLimits });
  process.env.PATH = path;
  const fire = (name, event = {}, eventCtx = ctx) => handlers[name]?.(event, eventCtx);
  return { fire, entries, messages, fleet, tasks, root, widget, visible, working: footer.working, refreshUsage: footer.refreshUsage, attach: () => footer.attach(ctx), render: () => component.render(100)[0], renders: () => renders, done: () => { fire("session_shutdown"); component?.dispose(); } };
}

const usageWindow = usedPercent => [{ usedPercent, resetsAt: null, windowMins: 300 }];

test("usage refreshes mid-run on assistant and tool results, not user messages", async t => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 0 });
  let calls = 0;
  const h = harness({ readLimits: async () => usageWindow(++calls), mountFooter: true });
  t.after(h.done);
  assert.equal(calls, 1, "attach makes exactly one initial read even at epoch zero");
  await h.refreshUsage();
  h.fire("agent_start");
  t.mock.timers.tick(60_000);
  h.fire("message_end", { message: { role: "user" } });
  await Promise.resolve();
  assert.equal(calls, 1);
  h.fire("message_end", { message: { role: "assistant" } });
  assert.equal(calls, 2);
  await h.refreshUsage();
  assert.match(h.render(), /ses 2%/);
  t.mock.timers.tick(60_000);
  h.fire("message_end", { message: { role: "toolResult" } });
  assert.equal(calls, 3);
  await h.refreshUsage();
  t.mock.timers.tick(60_000);
  h.fire("agent_end");
  assert.equal(calls, 4);
  await h.refreshUsage();
  h.attach();
  await Promise.resolve();
  assert.equal(calls, 4, "session attach respects the same throttle");
  t.mock.timers.tick(60_000);
  h.attach();
  assert.equal(calls, 5);
  await h.refreshUsage();
});

test("automatic usage throttle skips without queuing; idle ticks only repaint", async t => {
  t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: 0 });
  let calls = 0;
  const h = harness({ readLimits: async () => usageWindow(++calls), mountFooter: true });
  t.after(h.done);
  await h.refreshUsage();
  t.mock.timers.tick(59_999);
  h.fire("message_end", { message: { role: "assistant" } });
  assert.equal(await h.refreshUsage(), null);
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  await Promise.resolve();
  assert.equal(calls, 1, "the skipped event did not schedule a boundary read");
  h.fire("message_end", { message: { role: "toolResult" } });
  assert.equal(calls, 2, "the exact boundary permits the next event");
  await h.refreshUsage();
  const renders = h.renders();
  t.mock.timers.tick(10 * 60_000);
  await Promise.resolve();
  assert.equal(calls, 2, "idle time never fetches");
  assert.ok(h.renders() > renders, "the countdown still repaints");
});

test("forced usage bypasses throttle but shares each in-flight automatic or manual read", async t => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 0 });
  let calls = 0;
  let resolve;
  const h = harness({ readLimits: () => { calls++; return new Promise(done => { resolve = done; }); }, mountFooter: true });
  t.after(h.done);
  const automatic = h.refreshUsage();
  const forced = h.refreshUsage({ force: true });
  assert.equal(forced, automatic);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve(usageWindow(12));
  assert.deepEqual(await forced, usageWindow(12));
  assert.match(h.render(), /ses 12%/);
  assert.equal(await h.refreshUsage(), null);
  const manual = h.refreshUsage({ force: true });
  assert.equal(h.refreshUsage({ force: true }), manual);
  assert.equal(h.refreshUsage(), manual);
  h.fire("message_end", { message: { role: "assistant" } });
  await Promise.resolve();
  assert.equal(calls, 2);
  resolve(usageWindow(25));
  assert.deepEqual(await manual, usageWindow(25));
  assert.match(h.render(), /ses 25%/, "a fresh manual read updates the footer");
});

test("failed fresh reads return null while retaining the footer's last good limits", async t => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 0 });
  let result = usageWindow(15);
  let calls = 0;
  const h = harness({ readLimits: async () => { calls++; return result; }, mountFooter: true });
  t.after(h.done);
  await h.refreshUsage();
  const renders = h.renders();
  result = null;
  assert.equal(await h.refreshUsage({ force: true }), null);
  assert.match(h.render(), /ses 15%/);
  assert.equal(h.renders(), renders);
  t.mock.timers.tick(59_999);
  h.fire("agent_end");
  assert.equal(await h.refreshUsage(), null);
  assert.equal(calls, 2, "failed attempts are throttled too");
  t.mock.timers.tick(1);
  h.fire("message_end", { message: { role: "assistant" } });
  assert.equal(await h.refreshUsage(), null);
  assert.equal(calls, 3);
  assert.match(h.render(), /ses 15%/);
  result = usageWindow(30);
  await h.refreshUsage({ force: true });
  assert.match(h.render(), /ses 30%/, "failure releases the shared request for the next read");
});

test("Codex historical headers retain stable default windows and suppress phantom zero", () => {
  const headers = {
    "x-codex-primary-used-percent": "12.5",
    "x-codex-primary-window-minutes": "300",
    "x-codex-primary-reset-at": "1800000000",
    "x-codex-secondary-used-percent": "40",
    "x-codex-secondary-window-minutes": "10080",
    "x-codex-limit-name": "Pro display label",
    "x-codex-other-primary-used-percent": "99",
  };
  assert.deepEqual(parseCodexHeaders(headers), [
    { usedPercent: 12.5, windowMins: 300, resetsAt: 1800000000 },
    { usedPercent: 40, windowMins: 10080, resetsAt: null },
  ]);
  assert.equal(parseCodexHeaders({ "x-other-primary-used-percent": "1" }), null);
  for (const value of ["", " ", "NaN", "Infinity", undefined]) {
    assert.equal(parseCodexHeaders({ "x-codex-primary-used-percent": value }), null);
  }
  for (const minutes of [undefined, "0", "bad"]) {
    assert.equal(parseCodexHeaders({ "x-codex-primary-used-percent": "0", "x-codex-primary-window-minutes": minutes }), null);
  }
  assert.deepEqual(parseCodexHeaders({ "x-codex-primary-used-percent": "120", "x-codex-primary-window-minutes": "-1", "x-codex-primary-reset-at": "0" }), [{ usedPercent: 120, windowMins: -1, resetsAt: 0 }]);
  assert.deepEqual(parseCodexHeaders({ "x-codex-primary-used-percent": "2", "x-codex-primary-window-minutes": "1.5", "x-codex-primary-reset-at": "bad" }), [{ usedPercent: 2, windowMins: null, resetsAt: null }]);
});

const codexEvent = (rate_limits, metadata = {}) => ({ type: "codex.rate_limits", rate_limits, ...metadata });

test("Codex WS fixtures accept only the default bucket and reject malformed snapshots", () => {
  const primary = { used_percent: 0, window_minutes: 300, reset_at: 1800000000 };
  const secondary = { used_percent: 40, window_minutes: 10080 };
  assert.deepEqual(parseCodexRateLimits(codexEvent({ primary, secondary }, { credits: { ignored: true } })), [
    { usedPercent: 0, windowMins: 300, resetsAt: 1800000000 },
    { usedPercent: 40, windowMins: 10080, resetsAt: null },
  ]);
  assert.deepEqual(parseCodexRateLimits(codexEvent({ primary: { used_percent: 0 }, secondary: null }, { limit_name: " CODEX " })), [{ usedPercent: 0, windowMins: null, resetsAt: null }]);
  for (const name of ["", "gpt-5", "codex-other", 42, {}, []]) {
    assert.equal(parseCodexRateLimits(codexEvent({ primary }, { metered_limit_name: name, limit_name: "codex" })), null);
  }
  assert.equal(parseCodexRateLimits(codexEvent({ primary }, { limit_name: "other" })), null);
  assert.ok(parseCodexRateLimits(codexEvent({ primary }, { metered_limit_name: "codex", limit_name: "other" })));
  for (const malformed of [{ used_percent: "2" }, { used_percent: Infinity }, { used_percent: 1, window_minutes: "300" }, { used_percent: 1, reset_at: 1.5 }, false]) {
    assert.equal(parseCodexRateLimits(codexEvent({ primary, secondary: malformed })), null);
  }
  assert.equal(parseCodexRateLimits(codexEvent({ primary: null })), null);
  assert.equal(parseCodexRateLimits({ type: "unknown", rate_limits: { primary } }), null);
  assert.equal(parseCodexRateLimits(undefined), null);
  assert.deepEqual(parseCodexRateLimits(codexEvent({ secondary: { used_percent: 120, window_minutes: -1, reset_at: 0 } })), [{ usedPercent: 120, windowMins: -1, resetsAt: 0 }]);
});

for (const transport of ["headers", "stream"]) {
  test(`native ${transport} updates inside throttle and fallback waits for a stale event`, async t => {
    t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 0 });
    let calls = 0;
    const h = harness({ mountFooter: true, readLimits: async () => usageWindow(++calls) });
    t.after(h.done);
    await h.refreshUsage();
    const send = (percent, eventCtx) => transport === "headers"
      ? h.fire("after_provider_response", { headers: { "x-codex-primary-used-percent": String(percent), "x-codex-primary-window-minutes": "10080" } }, eventCtx)
      : h.fire("provider_stream_event", { provider: eventCtx?.model?.provider ?? "openai-codex", data: codexEvent({ primary: { used_percent: percent, window_minutes: 10080 } }) });
    send(22, { model: { provider: "other" } });
    assert.match(h.render(), /ses 1%/);
    t.mock.timers.tick(30_000);
    const renders = h.renders();
    send(22);
    assert.ok(h.renders() > renders);
    assert.match(h.render(), /wk 22%/);
    assert.doesNotMatch(h.render(), /ses/, "full snapshot replaces the missing short window");
    send(23);
    assert.match(h.render(), /wk 23%/);
    h.fire("message_end", { message: { role: "assistant" } });
    assert.equal(await h.refreshUsage(), null);
    assert.equal(calls, 1);
    h.fire("provider_stream_event", { provider: "openai-codex", data: codexEvent({ primary: { used_percent: "bad" } }) });
    h.fire("after_provider_response", { headers: {} });
    t.mock.timers.tick(60_000);
    await Promise.resolve();
    assert.equal(calls, 1, "staleness and missing data schedule no reads");
    h.fire("agent_end");
    await h.refreshUsage();
    assert.equal(calls, 2);
    assert.match(h.render(), /ses 2%/);
  });
}

for (const force of [false, true]) {
  for (const result of [usageWindow(5), null]) {
    test(`late ${force ? "forced" : "automatic"} GET ${result ? "success" : "failure"} returns the newer native snapshot`, async t => {
      let resolve;
      const h = harness({ mountFooter: true, readLimits: () => new Promise(done => { resolve = done; }) });
      t.after(h.done);
      resolve(usageWindow(1));
      await h.refreshUsage();
      // A forced call starts inside freshness; an automatic call starts stale.
      t.mock.timers.enable({ apis: ["Date", "setInterval"], now: Date.now() + (force ? 0 : 60_000) });
      const pending = h.refreshUsage({ force });
      assert.equal(h.refreshUsage({ force: true }), pending, "/usage shares the in-flight read");
      h.fire("provider_stream_event", { provider: "openai-codex", data: codexEvent({ primary: { used_percent: 35, window_minutes: 300 } }) });
      resolve(result);
      assert.deepEqual(await pending, usageWindow(35));
      assert.match(h.render(), /ses 35%/);
      assert.equal(await h.refreshUsage(), null);
    });
  }
}

test("rate limits key only on stable window fields", () => {
  const parsed = parseRateLimits({
    plan_type: "pro",
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: { used_percent: 12, limit_window_seconds: 18_000, reset_after_seconds: 60, reset_at: 1_800_000_000 },
      secondary_window: { used_percent: 40 },
    },
    credits: { has_credits: true, unlimited: false },
    rate_limit_upsell: { anything: "ignored" },
  });
  assert.deepEqual(parsed, [
    { usedPercent: 12, resetsAt: 1_800_000_000, windowMins: 300 },
    { usedPercent: 40, resetsAt: null, windowMins: null },
  ]);
  assert.equal(parseRateLimits({ rate_limit: {} }), null);
  assert.equal(parseRateLimits(undefined), null);
  assert.equal(parseRateLimits({ rate_limit: { primary_window: { used_percent: "50" } } }), null);
});

test("the usage read scopes pi's stored token in and never refreshes it", async () => {
  const credential = { type: "oauth", access: "at", refresh: "rt", expires: Date.now() + 60_000, accountId: "acc-1" };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, headers: options.headers });
    return { ok: true, json: async () => ({ rate_limit: { primary_window: { used_percent: 7, limit_window_seconds: 300 * 60 } } }) };
  };
  assert.deepEqual(await readRateLimits({ credential, fetchImpl }), [{ usedPercent: 7, resetsAt: null, windowMins: 300 }]);
  assert.deepEqual(calls, [{ url: "https://chatgpt.com/backend-api/wham/usage", headers: { authorization: "Bearer at", "chatgpt-account-id": "acc-1" } }]);
  // An expired or missing credential skips the read entirely: refreshing here
  // would race pi's own rotating refresh, and pi restores the token itself.
  assert.equal(await readRateLimits({ credential: { ...credential, expires: Date.now() - 1 }, fetchImpl }), null);
  // null, not undefined: undefined would trigger the parameter default and
  // read the developer's real auth.json.
  assert.equal(await readRateLimits({ credential: null, fetchImpl }), null);
  assert.equal(calls.length, 1);
  assert.equal(await readRateLimits({ credential, fetchImpl: async () => ({ ok: false, status: 401 }) }), null);
  assert.equal(await readRateLimits({ credential, fetchImpl: async () => { throw new Error("offline"); } }), null);
});

test("windows label by duration, not position", () => {
  assert.equal(windowLabel(300), "ses");
  assert.equal(windowLabel(10_080), "wk");
  assert.equal(windowLabel(720), "12h");
  assert.equal(windowLabel(null), "usage");
});

test("segments follow the ccstatusline order and omit missing data", () => {
  const texts = segments => segments.map(s => s.text);
  const segments = buildSegments({
    modelId: "gpt-5.6-sol",
    contextPercent: 12.34,
    limits: [
      { usedPercent: 7, resetsAt: null, windowMins: 300 },
      { usedPercent: 41, resetsAt: null, windowMins: 10_080 },
    ],
    branch: "main",
    changes: "+3 -1",
  });
  assert.deepEqual(texts(segments), ["gpt-5.6-sol", "12.3%", "ses 7%", "wk 41%", "main"]);
  // The counts stay a field of their own, so the render can colour them apart
  // from the branch (rows.mjs paintCounts).
  assert.deepEqual(segments.at(-1), { text: "main", color: "accent", changes: "+3 -1" });
  assert.deepEqual(texts(buildSegments({ modelId: "gpt-5.6-sol", contextPercent: null, limits: null, branch: null })), [
    "gpt-5.6-sol",
  ]);
});

test("the branch's counts paint green and red, the rest of the segment does not", () => {
  const theme = { fg: (color, text) => `<${color}>${text}` };
  assert.equal(paintSegment({ text: "main", color: "accent", changes: "+14 -2" }, theme), "<accent>main <success>+14 <error>-2");
  assert.equal(paintSegment({ text: "main", color: "accent", changes: null }, theme), "<accent>main");
  assert.equal(paintSegment({ text: "12.3%" }, theme), "12.3%");
  // The status line pads to the terminal width from this string: the three
  // colour runs and their resets must still measure as the plain text.
  const ansi = { fg: (_color, text) => `\x1b[32m${text}\x1b[39m` };
  assert.equal(visibleWidth(paintSegment({ text: "main", color: "accent", changes: "+14 -2" }, ansi)), "main +14 -2".length);
});

test("the mode takes the plan row's approved/not-approved pair and carries its approval setting", () => {
  const theme = { fg: (color, text) => `<${color}>${text}` };
  assert.equal(paintMode("execute auto", theme), "<success>execute<dim> · auto");
  assert.equal(paintMode("plan ask", theme), "<warning>plan<dim> · ask");
  assert.equal(paintMode("plan", theme), "<warning>plan");
  assert.equal(paintMode("", theme), "");
  // The status line pads from this string too.
  const ansi = { fg: (_color, text) => `\x1b[32m${text}\x1b[39m` };
  assert.equal(visibleWidth(paintMode("execute auto", ansi)), "execute · auto".length);
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
  process.env.PATH = ""; // git lookups fail fast instead of spawning
  try {
    let factory;
    const attached = [];
    const fleet = { attach: tui => attached.push(tui), render: (width, theme) => [theme.fg("dim", `rows@${width}`)], onChange() {} };
    let live = 2;
    const tasks = { live: () => live, onChange() {} };
    const ctx = { cwd: ".", model: { id: "gpt-5.6-sol" }, getContextUsage: () => ({ percent: 27.2 }), ui: { setFooter: make => { factory = make; }, setWorkingVisible() {}, setWidget() {} } };
    installFooter({ on() {}, registerEntryRenderer() {}, appendEntry() {} }, ctx, { fleet, tasks, readLimits: async () => null });
    const tui = { requestRender() {} };
    let status = "execute auto";
    const footerData = { onBranchChange: () => () => {}, getGitBranch: () => "main", getExtensionStatuses: () => new Map([["workflow", status]]) };
    const render = width => factory(tui, { fg: (_color, text) => text }, footerData).render(width);
    const lines = render(70);
    assert.deepEqual(attached, [tui]);
    assert.equal(lines[0], "  gpt-5.6-sol · 27.2% · main" + " ".repeat(70 - 4 - 26 - 25) + "2 shells · execute · auto  ");
    assert.deepEqual(lines.slice(1), ["rows@70"]);
    // Too narrow for both: the left gives way, so the mode and its approval
    // survive whole. Truncating the composed line clipped the right first, and
    // `· auto` and `· ask` clip to the same string — two states, one reading.
    const auto = render(30)[0];
    status = "plan ask";
    const ask = render(30)[0];
    assert.ok(auto.endsWith("execute · auto  "), auto);
    assert.ok(ask.endsWith("plan · ask  "), ask);
    assert.doesNotMatch(auto, /shell/, "shell count yields before the mode at narrow widths");
    assert.doesNotMatch(ask, /shell/, "shell count yields before the mode at narrow widths");
    assert.equal(visibleWidth(auto), 30);
    assert.equal(visibleWidth(ask), 30);
    live = 0;
    status = "execute auto";
    const zero = render(60)[0];
    assert.ok(zero.endsWith("execute · auto  "), zero);
    assert.doesNotMatch(zero, /shell/);
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

test("a settled root waits on active work with a fixed completion snapshot, not an animated clock", async () => {
  const h = harness({ active: 1 });
  h.fire("agent_start");
  await sleep(12);
  h.fire("agent_settled");
  const snapshot = h.widget.row.message;
  assert.match(snapshot, /^Iterated for \d+s$/);
  assert.equal(h.widget.row.intervalId, null);
  await sleep(12);
  assert.equal(h.widget.row.message, snapshot);
  assert.equal(h.entries.length, 0);
  h.done();
});

test("a waiting snapshot survives prompts and compaction without restarting animation", () => {
  const h = harness({ active: 1 });
  h.fire("agent_start");
  h.fire("agent_settled");
  const snapshot = h.widget.row.render(80);
  assert.match(snapshot[0], /π Iterated for/);
  h.fire("ui_prompt_start");
  assert.match(h.widget.row.render(80)[0], /Waiting for you…/, "a confirm outranks the frozen snapshot");
  h.fire("ui_prompt_end");
  assert.deepEqual(h.widget.row.render(80), snapshot);
  h.fire("session_before_compact");
  h.fire("session_compact");
  assert.deepEqual(h.widget.row.render(80), snapshot);
  assert.equal(h.widget.row.intervalId, null);
  h.done();
});

test("staggered child and shell wakes keep one turn open until the final settle", () => {
  let active = 1;
  let live = 0;
  const h = harness();
  h.fleet.activeCount = () => active;
  h.tasks.live = () => live;
  h.fire("agent_start");
  h.fire("agent_settled");
  const childSnapshot = h.widget.row.message;
  active = 0;
  live = 1;
  h.fire("agent_start");
  assert.notEqual(h.widget.row.intervalId, null);
  h.fire("agent_settled");
  assert.match(h.widget.row.message, /^Iterated for \d+s$/);
  assert.equal(h.widget.row.intervalId, null);
  assert.equal(h.entries.length, 0);
  active = 0;
  live = 0;
  h.fire("agent_start");
  h.fire("agent_settled");
  assert.equal(h.entries.length, 1);
  assert.match(childSnapshot, /^Iterated for \d+s$/);
  h.done();
});

test("a typed prompt while work still runs closes the turn at the settle, naming that work, and the prompt's turn takes the wake", t => {
  t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: 1_000 });
  const h = harness({ active: 2, live: 1 });
  h.fire("agent_start");
  t.mock.timers.tick(82_000);
  h.fire("agent_settled");
  t.mock.timers.tick(30_000);
  h.fire("input", { source: "interactive" });
  assert.deepEqual(h.entries.map(entry => entry.data), [{ verb: "Iterated", ms: 82_000, endedAt: 83_000, aborted: false, running: { agents: 2, shells: 1 } }]);
  assert.equal(formatTurn(h.entries[0].data, { fg: (_color, text) => text }), "π Iterated for 1m 22s · 2 agents, 1 shell still running");
  assert.equal(h.widget.row.message, "");
  h.fleet.activeCount = () => 0;
  h.tasks.live = () => 0;
  h.fire("agent_start");
  h.fire("agent_settled");
  assert.equal(h.entries.length, 2);
  assert.equal(h.entries[1].data.running, undefined);
  h.done();
});

test("the last child ending with the root idle closes the frozen row once, at that moment", t => {
  t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: 0 });
  let active = 2;
  const h = harness({ settleMs: 250 });
  h.fleet.activeCount = () => active;
  h.fire("agent_start");
  t.mock.timers.tick(3_000);
  h.fire("agent_settled");
  active = 1;
  h.fleet.changed();
  t.mock.timers.tick(1_000);
  assert.equal(h.entries.length, 0, "a child still runs");
  active = 0;
  h.fleet.changed();
  t.mock.timers.tick(249);
  assert.equal(h.entries.length, 0, "the grace lets a wake start first");
  t.mock.timers.tick(1);
  assert.deepEqual(h.entries.map(entry => entry.data), [{ verb: "Iterated", ms: 4_000, endedAt: 4_000, aborted: false }]);
  assert.equal(h.widget.row.message, "");
  h.fleet.changed();
  t.mock.timers.tick(1_000);
  assert.equal(h.entries.length, 1);
  h.done();
});

test("a wake already running holds the turn open, and its settle closes it once", t => {
  t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: 0 });
  let active = 1;
  const h = harness({ settleMs: 250 });
  h.fleet.activeCount = () => active;
  h.fire("agent_start");
  h.fire("agent_settled");
  active = 0;
  h.root.idle = false;
  h.fleet.changed();
  t.mock.timers.tick(1_000);
  assert.equal(h.entries.length, 0);
  h.fire("agent_start");
  t.mock.timers.tick(2_000);
  h.root.idle = true;
  h.fire("agent_settled");
  assert.deepEqual(h.entries.map(entry => entry.data.ms), [3_000]);
  h.done();
});

test("a wake still in pi's input handlers outlasts the grace and takes the turn; an unstarted wake releases at its bound", t => {
  t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: 0 });
  let active = 1;
  const h = harness({ settleMs: 250 });
  h.fleet.activeCount = () => active;
  h.fire("agent_start");
  t.mock.timers.tick(1_000);
  h.fire("agent_settled");
  active = 0;
  h.fleet.changed();
  h.fire("input", { source: "extension" });
  t.mock.timers.tick(1_000);
  assert.equal(h.entries.length, 0, "the wake's run is not active yet");
  h.fire("agent_start");
  t.mock.timers.tick(2_000);
  h.fire("agent_settled");
  assert.deepEqual(h.entries.map(entry => entry.data.ms), [4_000]);

  active = 1;
  h.fire("agent_start");
  t.mock.timers.tick(1_000);
  h.fire("agent_settled");
  active = 0;
  h.fleet.changed();
  h.fire("input", { source: "extension" });
  t.mock.timers.tick(9_999);
  assert.equal(h.entries.length, 1, "held until the wake's bound");
  t.mock.timers.tick(1);
  assert.deepEqual(h.entries.slice(1).map(entry => [entry.data.ms, entry.data.endedAt]), [[1_000, 5_000]]);
  h.done();
});

test("a background shell ending with the root idle closes the turn the same way, and a run start cancels the grace", t => {
  t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: 0 });
  let live = 1;
  const h = harness({ settleMs: 250 });
  h.tasks.live = () => live;
  h.fire("agent_start");
  h.fire("agent_settled");
  live = 0;
  h.tasks.changed();
  h.fire("agent_start");
  t.mock.timers.tick(1_000);
  assert.equal(h.entries.length, 0);
  live = 1;
  h.fire("agent_settled");
  t.mock.timers.tick(1_000);
  live = 0;
  h.tasks.changed();
  t.mock.timers.tick(250);
  assert.deepEqual(h.entries.map(entry => [entry.data.ms, entry.data.endedAt]), [[2_000, 2_000]]);
  h.done();
});

test("after session shutdown a change arms no settle, so the invalidated ctx is never asked", t => {
  t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: 0 });
  let active = 1;
  const h = harness({ settleMs: 250 });
  h.fleet.activeCount = () => active;
  h.fire("agent_start");
  h.fire("agent_settled");
  h.done();
  Object.defineProperty(h.root, "idle", { get() { throw new Error("stale ctx"); } });
  active = 0;
  h.fleet.changed();
  t.mock.timers.tick(1_000);
  assert.equal(h.entries.length, 0);
});

test("work ending during a compaction closes the frozen row once the compaction ends", t => {
  t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: 0 });
  let active = 1;
  const h = harness({ settleMs: 250 });
  h.fleet.activeCount = () => active;
  h.fire("agent_start");
  h.fire("agent_settled");
  h.fire("session_before_compact");
  h.root.idle = false;
  active = 0;
  h.fleet.changed();
  t.mock.timers.tick(1_000);
  assert.equal(h.entries.length, 0, "pi counts a compaction as not idle");
  h.root.idle = true;
  h.fire("session_compact");
  t.mock.timers.tick(250);
  assert.equal(h.entries.filter(entry => entry.kind === "workflow-turn").length, 1);
  t.mock.timers.tick(1_000);
  assert.equal(h.entries.length, 1);
  h.done();
});

test("a turn left open at session shutdown never lands in the next session", t => {
  t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: 0 });
  let active = 1;
  const h = harness({ settleMs: 250 });
  h.fleet.activeCount = () => active;
  h.fire("agent_start");
  h.fire("agent_settled");
  h.fire("session_shutdown");
  h.attach();
  active = 0;
  h.fleet.changed();
  t.mock.timers.tick(1_000);
  assert.equal(h.entries.filter(entry => entry.kind === "workflow-turn").length, 0);
  h.done();
});

test("an interrupted run closes immediately, even with children running", () => {
  const h = harness({ active: 1 });
  h.fire("agent_start");
  h.fire("agent_end");
  h.fire("agent_settled", { aborted: true });
  assert.deepEqual([h.entries.length, h.entries[0].data.aborted], [1, true]);
  h.fire("agent_settled", { aborted: true });
  assert.equal(h.entries.length, 1);
  h.done();
});

test("the working row sits above the composer at column 0 with a blank line under it, and no row between turns", () => {
  const h = harness();
  assert.deepEqual(h.visible, [false], "pi's own working row is switched off");
  assert.equal(h.widget.key, "workflow-working");
  assert.deepEqual(h.widget.row.render(40), [], "no turn, no row");
  h.fire("agent_start");
  const lines = h.widget.row.render(40);
  assert.equal(lines.length, 2, "the row and its trailing blank, none of pi's leading one");
  assert.match(lines[0], /^\S/, "the spinner glyph sits at column 0");
  assert.match(lines[0], /Iterating…/);
  assert.equal(lines[1], "", "a blank line stands the row off the composer");
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

test("a running shell command outranks the turn label and clears back to it", async () => {
  const h = harness();
  const working = h.working;
  h.fire("agent_start");
  await sleep(15);
  working({ command: "npm test", startedAt: Date.now() });
  assert.match(h.messages.at(-1), /^Running npm test… \d+s$/);
  working(null);
  assert.match(h.messages.at(-1), /^Iterating…/, "cleared back to the turn label while the clock still runs");
  h.fire("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
  h.fire("agent_settled");
});

test("a shell command outside any turn ticks and clears the spinner on its own", async () => {
  const h = harness();
  h.working({ command: "sleep 5", startedAt: Date.now() });
  assert.match(h.messages.at(-1), /^Running sleep 5… \d+s$/);
  const ticks = h.messages.length;
  await sleep(15);
  assert.ok(h.messages.length > ticks, "its own tick keeps the elapsed time live with no turn running");
  h.working(null);
  assert.equal(h.messages.at(-1), "", "the spinner stands down with no turn to return to");
});

test("a shell command that outlives its turn keeps its row and tick after the turn closes", async () => {
  const h = harness();
  h.fire("agent_start");
  h.working({ command: "npm test", startedAt: Date.now() });
  h.fire("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
  h.fire("agent_settled");
  assert.match(h.messages.at(-1), /^Running npm test… \d+s$/, "the turn closing did not drop the still-running shell's row");
  const ticks = h.messages.length;
  await sleep(15);
  assert.ok(h.messages.length > ticks, "its tick survived the turn closing");
  h.done();
});

test("compaction hides a running shell command's row and restores it after, with no turn running", () => {
  const h = harness();
  h.working({ command: "npm test", startedAt: Date.now() });
  assert.match(h.messages.at(-1), /^Running npm test…/);
  h.fire("session_before_compact");
  assert.equal(h.messages.at(-1), "", "pi's own compaction indicator is the only one, even with a shell running");
  h.fire("session_compact");
  assert.match(h.messages.at(-1), /^Running npm test… \d+s$/);
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

test("a custom view keeps the clock label", () => {
  const h = harness();
  h.fire("agent_start");
  h.fire("ui_prompt_start", { kind: "custom" });
  assert.match(h.messages.at(-1), /^Iterating…/);
  h.fire("ui_prompt_end", { kind: "custom" });
  assert.match(h.messages.at(-1), /^Iterating…/);
  h.done();
});

test("a frozen snapshot keeps its glyph through an invalidate and stays still", () => {
  const h = harness({ active: 1 });
  h.fire("agent_start");
  h.fire("agent_settled");
  const snapshot = h.widget.row.render(80);
  assert.match(snapshot[0], /^π Iterated for/);
  h.widget.row.invalidate();
  assert.deepEqual(h.widget.row.render(80), snapshot, "a theme switch redraws the snapshot, not a spinner frame");
  assert.equal(h.widget.row.intervalId, null);
  h.fire("agent_start");
  assert.match(h.widget.row.render(80)[0], /^\S Iterating…/, "a wake drops the snapshot for the spinner");
  h.done();
});
