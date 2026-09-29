import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { formatReset } from "./footer.mjs";
import { contextUsage, formatMoney, readUsage, sessionCost, usageLines } from "./usage.mjs";

const plain = { fg: (_color, text) => text };
const usage = (total, input = 0, output = 0, cacheRead = 0, cacheWrite = 0) => ({ input, output, cacheRead, cacheWrite, cost: { total } });
const assistant = (model, cost, content = []) => ({ type: "message", message: { role: "assistant", model, content, usage: usage(cost, 1000, 200, 9000, 0) } });
const launchCall = (id, agent) => ({ type: "message", message: { role: "assistant", model: "gpt-5.5", content: [{ type: "toolCall", name: "subagent", id, arguments: { agent, task: "t" } }], usage: usage(0) } });
const launched = (id, runId, asyncDir) => ({ type: "message", message: { role: "toolResult", toolName: "subagent", toolCallId: id, details: { mode: "single", runId, results: [], asyncId: runId, asyncDir } } });

// A session with one foreground run whose grandchild rides its totalCost, three
// async launches (one with a bg_wait receipt, one only on disk, one with no
// receipt anywhere) and a slash result.
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "usage-"));
  writeFileSync(join(dir, "status.json"), JSON.stringify({ totalCost: { inputTokens: 1, outputTokens: 1, costUsd: 0.25 } }));
  const completion = { runId: "a2", agent: "implementer", results: [{ agent: "implementer", usage: { cost: 0.1 } }] };
  return [
    assistant("gpt-5.5", 1.5),
    // pi-subagents folds the child's figure into the tool result's own usage;
    // counting it again would double count the run.
    { type: "message", message: { role: "toolResult", toolName: "subagent", usage: usage(0.8), details: { mode: "single", runId: "fg1", results: [{ agent: "researcher", usage: { cost: 0.5 }, children: [{ totalCost: { costUsd: 0.3 } }] }], totalCost: { costUsd: 0.8 } } } },
    launchCall("c1", "implementer"), launched("c1", "a1", dir),
    launchCall("c2", "implementer"), launched("c2", "a2", join(dir, "missing")),
    launchCall("c3", "explore"), launched("c3", "a3", join(dir, "missing")),
    // A status snapshot while a2 ran, then the final receipt twice (bg_wait and a later subagent result).
    { type: "custom_message", customType: "subagent-slash-result", details: { requestId: "r", result: { content: [], details: { mode: "single", runId: "a2", results: [{ agent: "implementer", usage: { cost: 0.05 } }] } } } },
    { type: "message", message: { role: "toolResult", toolName: "bg_wait", usage: usage(0.1), details: { mode: "management", results: [], completions: [completion] } } },
    { type: "message", message: { role: "toolResult", toolName: "bg_wait", details: { mode: "management", results: [], completions: [completion] } } },
    { type: "compaction", usage: usage(0.02) },
  ];
}

test("cost: parent usage without tool-result usage, nested totalCost once, async fallback and dedupe", () => {
  const cost = sessionCost(fixture());
  assert.equal(cost.main.cost.toFixed(2), "1.52");
  assert.equal(cost.subagents.cost.toFixed(2), "1.15"); // 0.8 + 0.25 + 0.1, a3 unavailable
  assert.equal(cost.total.toFixed(2), "2.67");
  assert.equal(cost.subagents.runs, 4);
  assert.equal(cost.subagents.unavailable, 1);
  assert.deepEqual(cost.subagents.agents, [["researcher", 1], ["implementer", 2], ["explore", 1]]);
  // gpt-5.5 plus the compaction's summaries bucket.
  assert.deepEqual(cost.models.map(m => m.model), ["gpt-5.5", "summaries"]);
  assert.deepEqual(sessionCost([assistant("gpt-5.5", 1)]).models, []);
});

test("an async run's cost is read from its status file and missing receipts count as unavailable", () => {
  const reads = [];
  const entries = [launchCall("c1", "worker"), launched("c1", "a1", "/runs/a1")];
  const cost = sessionCost(entries, { readStatus: dir => (reads.push(dir), { totalCost: { costUsd: 0.4 } }) });
  assert.deepEqual(reads, ["/runs/a1"]);
  assert.equal(cost.subagents.cost, 0.4);
  const missing = sessionCost(entries, { readStatus: () => { throw new Error("ENOENT"); } });
  assert.equal(missing.subagents.unavailable, 1);
  assert.equal(missing.subagents.cost, 0);
});

test("a /subagent --bg launch is costed from its status file, or counted unavailable", () => {
  const slashLaunch = (runId, asyncDir) => ({ type: "custom_message", customType: "subagent-slash-result", details: { requestId: "r", result: { content: [], details: { mode: "single", runId, results: [], asyncId: runId, asyncDir } } } });
  const readStatus = dir => { if (dir !== "/runs/s1") throw new Error("ENOENT"); return { totalCost: { costUsd: 0.3 } }; };
  const cost = sessionCost([slashLaunch("s1", "/runs/s1"), slashLaunch("s2", "/runs/s2")], { readStatus });
  assert.equal(cost.subagents.cost, 0.3);
  assert.equal(cost.subagents.runs, 2);
  assert.equal(cost.subagents.unavailable, 1);
  assert.deepEqual(cost.subagents.agents, [["unknown", 2]]);
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
  assert.match(usageLines({ at: 0, limits: null, context: estimated, cost: sessionCost([]) }, plain, 70)[2], /^π Context · gpt-5\.5 · ~\d/);
});

const limits = [
  { usedPercent: 37, resetsAt: 1_800_000_000, windowMins: 300 },
  { usedPercent: 58, resetsAt: 1_800_300_000, windowMins: 10_080 },
];

test("the entry renders three π blocks at width 70", async () => {
  const data = await readUsage(ctx(84_200, fixture()), { readLimits: async () => limits, now: 1_800_000_000_000 - 7_980_000 });
  // truncateToWidth wraps its ellipsis in resets; the plain theme adds no other codes.
  const lines = usageLines(data, plain, 70).map(line => line.replaceAll("\x1b[0m", ""));
  assert.deepEqual(lines, [
    "π Plan · ChatGPT",
    `  Session   ${"━".repeat(9)}${"─".repeat(15)}   37%   resets ${formatReset(1_800_000_000)} (in 2h 13m)`,
    `  Weekly    ${"━".repeat(14)}${"─".repeat(10)}   58%   resets ${formatReset(1_800_300_000, { weekday: true })}`,
    "",
    "π Context · gpt-5.5 · 84.2k / 272k tokens (31%)",
    `  ${"━".repeat(19)}${"─".repeat(43)}`,
    "  System prompt      1.1k    0%",
    "  Tools              2.5k    1%   subagent 2k · workspace_bash 511",
    "  Project context    1.5k    1%   AGENTS.md ×2",
    "  Skills              200    0%",
    "  Messages          78.8k   29%   tool results 49.3k · assistant 19.7…",
    "  Free             187.8k   69%",
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
  const render = windows => usageLines({ at: 0, limits: windows, context: contextUsage(ctx(1000)), cost: sessionCost([]) }, colours, 70);
  // prolite reports only a weekly window, as primary.
  const weekly = render([{ usedPercent: 12, resetsAt: null, windowMins: 10_080 }]);
  assert.match(weekly[1], /^ {2}Weekly {4}<accent>━+<dim>─+<muted> {3}12%$/);
  assert.equal(weekly[2], "");
  assert.deepEqual(render(null).slice(0, 2), ["<dim>π Plan · unavailable", ""]);
  assert.match(render([{ usedPercent: 91, resetsAt: null, windowMins: 300 }])[1], /<warning>━+<dim>─/);
  assert.match(render([{ usedPercent: 89, resetsAt: null, windowMins: 300 }])[1], /<accent>━+<dim>─/);
});

test("every line fits a narrow terminal, and the % column is the first to go", async () => {
  const data = await readUsage(ctx(84_200, fixture()), { readLimits: async () => limits });
  for (const line of usageLines(data, plain, 30)) assert.ok(visibleWidth(line) <= 30, line);
  assert.equal(usageLines(data, plain, 40).find(line => line.includes("Free")), "  Free             187.8k");
});
