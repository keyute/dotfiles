import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { visibleWidth } from "@earendil-works/pi-tui";
import { formatReset } from "./footer.mjs";
import { contextUsage, formatMoney, readUsage, sessionCost, usageLines } from "./usage.mjs";

const plain = { fg: (_color, text) => text };
const usage = (total, input = 0, output = 0, cacheRead = 0, cacheWrite = 0) => ({ input, output, cacheRead, cacheWrite, cost: { total } });
const assistant = (model, cost, content = []) => ({ type: "message", message: { role: "assistant", model, content, usage: usage(cost, 1000, 200, 9000, 0) } });
// Answers rpcCall the way pi-subagents does; a method without a reply is
// refused, which rpcCall reads as no reply, as it does a timeout.
const bus = replies => {
  const handlers = new Map();
  return {
    on: (name, handler) => (handlers.set(name, handler), () => handlers.delete(name)),
    emit: (_name, { requestId, method }) => handlers.get(`subagents:rpc:v1:reply:${requestId}`)?.(method in replies ? { success: true, data: replies[method] } : { success: false }),
  };
};
const ping = (version = 1) => ({ capabilities: { cost: { version } } });
const child = (agent, cost) => ({ label: `Child (${agent ?? "unknown"})`, ...(agent ? { agent } : {}), usage: { cost } });
const report = (children, unresolvedAsyncChildren = 0) => {
  const childTotal = { cost: children.reduce((sum, c) => sum + c.usage.cost, 0) };
  return { version: 1, parent: { cost: 0 }, children, childTotal, total: childTotal, unresolvedAsyncChildren };
};
const costReport = report([child("researcher", 0.8), child("implementer", 0.25), child("implementer", 0.1)], 1);

// The parent's own spend and a compaction; the child spend is the report's.
const fixture = () => [
  assistant("gpt-5.5", 1.5),
  // pi-subagents folds the child's figure into the tool result's own usage;
  // counting it again would double count the run.
  { type: "message", message: { role: "toolResult", toolName: "subagent", usage: usage(0.8), details: { mode: "single", runId: "fg1", results: [] } } },
  { type: "compaction", usage: usage(0.02) },
];

test("/usage wiring forces the footer reader in TUI and keeps the default reader without it", async () => {
  const source = readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
  const registration = source.match(/^    pi\.registerCommand\("usage",.*$/m)?.[0];
  assert.ok(registration, "usage command registration exists");
  const commands = new Map();
  const entries = [];
  const pi = { registerCommand: (name, command) => commands.set(name, command) };
  const commandContext = ctx(1000);
  let surfaces;
  let forced = 0;
  let optionsSeen;
  let result = limits;
  const read = async (api, context, options) => {
    assert.equal(api, pi);
    assert.equal(context, commandContext);
    optionsSeen = options;
    // Explicit null for the non-TUI test avoids reading real stored credentials.
    return readUsage({ events: bus({}) }, context, options ?? { readLimits: async () => null });
  };
  const register = new Function("pi", "surfaces", "readUsage", "appendVisible", registration);
  const append = (_pi, type, data) => entries.push({ type, data });
  register(pi, surfaces, read, append);
  await commands.get("usage").handler("", commandContext);
  assert.equal(optionsSeen, undefined, "non-TUI uses readUsage's default reader");
  assert.equal(entries.at(-1).data.limits, null);
  surfaces = { footer: { refreshUsage(options) { assert.deepEqual(options, { force: true }); forced++; return Promise.resolve(result); } } };
  register(pi, surfaces, read, append);
  await commands.get("usage").handler("", commandContext);
  assert.equal(forced, 1);
  assert.equal(entries.at(-1).type, "workflow-usage");
  assert.deepEqual(entries.at(-1).data.limits, limits);
  result = null;
  await commands.get("usage").handler("", commandContext);
  assert.equal(forced, 2);
  assert.equal(entries.at(-1).data.limits, null);
  assert.equal(usageLines(entries.at(-1).data, plain, 70)[0], "π Plan · unavailable");
});

test("cost: parent usage without tool-result usage, subagents from the cost report", () => {
  const cost = sessionCost(fixture(), costReport);
  assert.equal(cost.main.cost.toFixed(2), "1.52");
  assert.equal(cost.subagents.cost.toFixed(2), "1.15");
  assert.equal(cost.total.toFixed(2), "2.67");
  assert.equal(cost.subagents.runs, 4);
  assert.equal(cost.subagents.unavailable, 1);
  assert.deepEqual(cost.subagents.agents, [["researcher", 1], ["implementer", 2]]);
  // gpt-5.5 plus the compaction's summaries bucket.
  assert.deepEqual(cost.models.map(m => m.model), ["gpt-5.5", "summaries"]);
  assert.deepEqual(sessionCost([assistant("gpt-5.5", 1)], report([])).models, []);
});

test("a child without an agent counts as unknown, and unresolved children only as unavailable", () => {
  const cost = sessionCost([], report([child(undefined, 0.3)], 2));
  assert.equal(cost.subagents.cost, 0.3);
  assert.equal(cost.subagents.runs, 3);
  assert.equal(cost.subagents.unavailable, 2);
  assert.deepEqual(cost.subagents.agents, [["unknown", 1]]);
});

test("the Subagents row reads unavailable without a cost reply or on another report version", async () => {
  const read = events => readUsage({ events }, ctx(1000, fixture()), { readLimits: async () => null });
  assert.equal((await read(bus({ ping: ping(), cost: costReport }))).cost.subagents.cost.toFixed(2), "1.15");
  for (const events of [bus({ ping: ping() }), bus({ ping: ping(2), cost: costReport }), bus({})]) {
    const data = await read(events);
    assert.equal(data.cost.subagents, null);
    assert.equal(data.cost.total.toFixed(2), "1.52");
    assert.equal(usageLines(data, plain, 70).at(-1), "  Subagents   unavailable");
  }
});

test("money shows two decimals, four below ten cents", () => {
  assert.equal(formatMoney(4.18), "$4.18");
  assert.equal(formatMoney(0.0421), "$0.0421");
  assert.equal(formatMoney(0), "$0.0000");
});

const system = {
  role: "system",
  content: "",
  sections: {
    preamble: "p".repeat(4000),
    workflow: "w".repeat(400),
    project_context: `Project:\n<project_instructions path="/a/AGENTS.md">${"a".repeat(3000)}</project_instructions>\n<project_instructions path="/b/AGENTS.md">${"b".repeat(3000)}</project_instructions>`,
    skills: "s".repeat(800),
  },
  toolsAdded: [{ name: "subagent", description: "d".repeat(8000) }, { name: "workspace_bash", description: "d".repeat(2000) }],
  timestamp: 0,
};
const messages = [
  system,
  { role: "user", content: "u".repeat(4000), timestamp: 1 },
  { role: "assistant", content: [{ type: "text", text: "x".repeat(8000) }], timestamp: 2 },
  { role: "toolResult", content: [{ type: "text", text: "r".repeat(20000) }], timestamp: 3 },
];
const ctx = (tokens, entries = []) => ({
  model: { id: "gpt-5.5", contextWindow: 272_000 },
  getContextUsage: () => ({ tokens, contextWindow: 272_000, percent: tokens == null ? null : tokens / 2720 }),
  sessionManager: { getEntries: () => entries, getBranch: () => entries, buildSessionProjection: () => ({ messages }) },
});

test("context rows sum to pi's real count; with none the estimates stand in behind ~", () => {
  const real = contextUsage(ctx(20_000));
  assert.equal(real.used, 20_000);
  assert.equal(real.estimated, false);
  assert.equal(real.parts.reduce((sum, part) => sum + part.tokens, 0), 20_000);
  assert.equal(real.parts[1].tail, "subagent 2k · workspace_bash 511");
  assert.equal(real.parts[2].tail, "AGENTS.md ×2");
  // Below the system-side estimate the system rows shrink to the real count.
  const low = contextUsage(ctx(3000));
  assert.ok(Math.abs(low.parts.reduce((sum, part) => sum + part.tokens, 0) - 3000) <= low.parts.length);
  assert.equal(low.parts.at(-1).tokens, 0);
  const estimated = contextUsage(ctx(null));
  assert.equal(estimated.estimated, true);
  assert.equal(estimated.parts.at(-1).tokens, 8000); // 32k chars of messages ÷ 4
  assert.match(usageLines({ at: 0, limits: null, context: estimated, cost: sessionCost([], report([])) }, plain, 70)[2], /^π Context · gpt-5\.5 · ~\d/);
});

const limits = [
  { usedPercent: 37, resetsAt: 1_800_000_000, windowMins: 300 },
  { usedPercent: 58, resetsAt: 1_800_300_000, windowMins: 10_080 },
];

test("the entry renders three π blocks at width 70", async () => {
  const data = await readUsage({ events: bus({ ping: ping(), cost: costReport }) }, ctx(84_200, fixture()), { readLimits: async () => limits, now: 1_800_000_000_000 - 7_980_000 });
  // truncateToWidth wraps its ellipsis in resets; the plain theme adds no other codes.
  const lines = usageLines(data, plain, 70).map(line => line.replaceAll("\x1b[0m", ""));
  assert.deepEqual(lines, [
    "π Plan · ChatGPT",
    `  Session   ${"━".repeat(9)}${"─".repeat(15)}   37%   resets ${formatReset(1_800_000_000)} (in 2h 13m)`,
    `  Weekly    ${"━".repeat(14)}${"─".repeat(10)}   58%   resets ${formatReset(1_800_300_000, { weekday: true })}`,
    "",
    "π Context · gpt-5.5 · 84.2k / 272k tokens (31.0%)",
    `  ${"━".repeat(19)}${"─".repeat(43)}`,
    "  System prompt      1.1k    0.4%",
    "  Tools              2.5k    0.9%   subagent 2k · workspace_bash 511",
    "  Project context    1.5k    0.6%   AGENTS.md ×2",
    "  Skills              200    0.1%",
    "  Messages          78.8k   29.0%   tool results 49.3k · assistant 19…",
    "  Free             187.8k   69.0%",
    "",
    "π Cost · $2.67",
    "  Main           $1.52   10k in · 200 out · 90% cached",
    "    gpt-5.5      $1.50   10k in · 200 out · 90% cached",
    "    summaries  $0.0200   0 in · 0 out",
    "  Subagents      $1.15   4 runs (1 unavailable) · implementer 2 · res…",
  ]);
});

test("the plan block: one window, unavailable, and warning from 90%", () => {
  const colours = { fg: (color, text) => (color === "plain" ? text : `<${color}>${text}`) };
  const render = windows => usageLines({ at: 0, limits: windows, context: contextUsage(ctx(1000)), cost: sessionCost([], report([])) }, colours, 70);
  // prolite reports only a weekly window, as primary.
  const weekly = render([{ usedPercent: 12, resetsAt: null, windowMins: 10_080 }]);
  assert.match(weekly[1], /^ {2}Weekly {4}<accent>━+<dim>─+<muted> {3}12%$/);
  assert.equal(weekly[2], "");
  assert.deepEqual(render(null).slice(0, 2), ["<dim>π Plan · unavailable", ""]);
  assert.match(render([{ usedPercent: 91, resetsAt: null, windowMins: 300 }])[1], /<warning>━+<dim>─/);
  assert.match(render([{ usedPercent: 89, resetsAt: null, windowMins: 300 }])[1], /<accent>━+<dim>─/);
});

test("every line fits a narrow terminal, and the % column is the first to go", async () => {
  const data = await readUsage({ events: bus({ ping: ping(), cost: costReport }) }, ctx(84_200, fixture()), { readLimits: async () => limits });
  for (const line of usageLines(data, plain, 30)) assert.ok(visibleWidth(line) <= 30, line);
  assert.equal(usageLines(data, plain, 40).find(line => line.includes("Free")), "  Free             187.8k");
  // The widest share still leaves a gap after the token count.
  const full = { model: "gpt-5.5", window: 272_000, used: 272_000, estimated: false, parts: [{ label: "Messages", tokens: 272_000 }] };
  const lines = usageLines({ at: 0, limits: null, context: full, cost: sessionCost([], report([])) }, plain, 70);
  assert.match(lines.find(line => line.includes("Messages")), /272k {2}100\.0%$/);
  assert.match(lines[2], /\(100\.0%\)$/);
});
