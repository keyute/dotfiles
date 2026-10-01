#!/usr/bin/env node
// Subscription-usage metrics from both harnesses' session stores, which are
// sandbox-denied: user-run outside it (`! node scripts/agent-usage.mjs --days 30`).
// Prints tables and writes them all to a fresh /tmp/claude/agent-usage-*/usage.json:
// a fresh dir and exclusive create, because this unsandboxed run must not
// follow a symlink a sandboxed agent planted in /tmp/claude.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";

const i = process.argv.indexOf("--days");
const days = i > 0 ? Number(process.argv[i + 1]) : 30;
if (!Number.isFinite(days)) {
  console.error("usage: agent-usage.mjs [--days N]");
  process.exit(1);
}
const since = Date.now() - days * 864e5;

const walk = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
    .map((e) => path.join(e.parentPath, e.name));
};
const records = (file) => fs.readFileSync(file, "utf8").split("\n").flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
});
const inWindow = (r) => Date.parse(r.timestamp) > since;
const tally = (o, k) => { if (k) o[k] = (o[k] ?? 0) + 1; };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const pct = (x, total) => `${(100 * x / total).toFixed(1)}%`;
const byDesc = (o, k) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1][k] - a[1][k]));
// Sums metric k of "model|origin" rows per origin, with each origin's share of the total.
const byOrigin = (o, k) => {
  const t = {};
  for (const [key, v] of Object.entries(o)) {
    const origin = key.slice(key.lastIndexOf("|") + 1);
    t[origin] = { [k]: (t[origin]?.[k] ?? 0) + v[k] };
  }
  const total = sum(Object.values(t).map((v) => v[k]));
  return byDesc(Object.fromEntries(Object.entries(t).map(([origin, v]) => [origin, { ...v, share: pct(v[k], total) }])), k);
};

// Cost in USD at the pinned pi-ai catalog's per-M-token prices (a 1h cache write
// is 2x input, Anthropic's multiple). A model the catalog lacks falls back to M
// weighted units — Anthropic's multiples of base input (cache write 5m 1.25x,
// 1h 2x, cache read 0.1x, output 5x) — comparable only within that model.
const unitRates = { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 };
const cost = (u, model) => {
  const r = getBuiltinModel("anthropic", model)?.cost ?? unitRates;
  const cc = u.cache_creation;
  const w5m = cc ? cc.ephemeral_5m_input_tokens ?? 0 : u.cache_creation_input_tokens ?? 0;
  const w1h = cc?.ephemeral_1h_input_tokens ?? 0;
  return (r.input * ((u.input_tokens ?? 0) + 2 * w1h) + r.cacheWrite * w5m + r.cacheRead * (u.cache_read_input_tokens ?? 0) + r.output * (u.output_tokens ?? 0)) / 1e6;
};
const context = (u) => (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);

const home = os.homedir();

// Claude: Claude keeps child transcripts under /subagents/ (workflow agents under /subagents/workflows/wf_<id>/).
const claudeOrigin = (f) => /\/workflows\//.test(f) ? "workflow" : /\/subagents\//.test(f) ? "subagent" : "root";
const calls = new Map(); // message.id -> call; a streamed message is logged repeatedly with partial output_tokens
const toolRole = new Map(); // Agent tool_use id -> role
const agentRole = new Map(); // subagent agentId -> role
const span = new Map(); // child transcript -> [first, last] timestamp ms
const claudeDispatches = {}, claudeSkills = {};
for (const file of walk(path.join(home, ".claude/projects"))) {
  const root = claudeOrigin(file) === "root";
  for (const r of records(file)) {
    const m = r.message;
    const recent = inWindow(r);
    const t = Date.parse(r.timestamp);
    if (!root && t) span.set(file, [Math.min(span.get(file)?.[0] ?? t, t), Math.max(span.get(file)?.[1] ?? t, t)]);
    if (recent && r.type === "assistant" && m?.id && m.usage && m.model !== "<synthetic>") {
      const out = m.usage.output_tokens ?? 0;
      const prev = calls.get(m.id);
      if (!prev || out > prev.out) calls.set(m.id, { file, model: m.model, out, cost: cost(m.usage, m.model), ctx: context(m.usage) });
    }
    if (!root) continue;
    if (recent && typeof m?.content === "string") {
      for (const [, cmd] of m.content.matchAll(/<command-name>([^<]+)<\/command-name>/g)) tally(claudeSkills, cmd);
    }
    for (const c of Array.isArray(m?.content) ? m.content : []) {
      if (c.type === "tool_use" && c.name === "Agent") {
        const role = c.input?.subagent_type ?? "general-purpose";
        toolRole.set(c.id, role);
        if (recent) tally(claudeDispatches, role);
      } else if (recent && c.type === "tool_use" && c.name === "Skill") {
        tally(claudeSkills, c.input?.skill);
      } else if (c.type === "tool_result" && toolRole.has(c.tool_use_id)) {
        const id = JSON.stringify(c.content).match(/agentId: (\w+)/)?.[1];
        if (id) agentRole.set(id, toolRole.get(c.tool_use_id));
      }
    }
  }
}

const perFile = new Map(); // file -> { model, calls, ctx, cost }
// Fallback units compare only within one model (see cost), so shares are of the model's own total.
const modelOrigin = {}, modelTotal = {};
for (const c of calls.values()) {
  const f = perFile.get(c.file) ?? { model: c.model, calls: 0, ctx: 0, cost: 0 };
  f.calls++; f.ctx = Math.max(f.ctx, c.ctx); f.cost += c.cost;
  perFile.set(c.file, f);
  const k = `${c.model}|${claudeOrigin(c.file)}`;
  modelOrigin[k] ??= { calls: 0, cost: 0 };
  modelOrigin[k].calls++; modelOrigin[k].cost += c.cost;
  modelTotal[c.model] = (modelTotal[c.model] ?? 0) + c.cost;
}

const roles = {}, runs = {};
for (const [file, f] of perFile) {
  const origin = claudeOrigin(file);
  if (origin === "subagent") {
    const id = path.basename(file).match(/^agent-(\w+)\.jsonl$/)?.[1];
    const k = `${agentRole.get(id) ?? "(unknown)"}|${f.model}`;
    (roles[k] ??= []).push({ ...f, seconds: (span.get(file)[1] - span.get(file)[0]) / 1e3 });
  } else if (origin === "workflow") {
    // Keyed per model like roles: a run's agents may mix USD and fallback units.
    const k = `${file.match(/\/workflows\/(wf_[^/]+)\//)[1]}|${f.model}`;
    runs[k] ??= { agents: 0, calls: 0, maxCtx: 0, cost: 0 };
    runs[k].agents++; runs[k].calls += f.calls; runs[k].maxCtx = Math.max(runs[k].maxCtx, f.ctx); runs[k].cost += f.cost;
  }
}

// pi: child transcripts live under /run-N/ and are mirrored in subagent-artifacts/, so calls are deduplicated by responseId.
// The pi bridge (scripts/pi-bridge.mjs SESSION_DIR) keeps its own sessions outside ~/.pi; they are origin "bridge".
const bridgeSessions = path.resolve(process.env.XDG_CACHE_HOME || path.resolve(home, ".cache"), "pi-bridge", "sessions");
const piFiles = [
  ...walk(path.join(home, ".pi/agent/sessions")).map((f) => [f, /\/(run-\d+|subagent-artifacts)\//.test(f) ? "child" : "root"]),
  ...walk(bridgeSessions).map((f) => [f, "bridge"]),
];
const piCalls = new Map();
const piDispatches = {}, piSkills = {};
for (const [file, origin] of piFiles) {
  let model;
  records(file).forEach((r, n) => {
    if (r.type === "model_change") model = r.modelId;
    if (!inWindow(r)) return;
    const m = r.message;
    const usage = r.usage ?? m?.usage;
    // Compaction and branch summaries, and usage entries (e.g. cache warming), are model calls outside the message stream.
    const sideCall = ["compaction", "branch_summary", "usage"].includes(r.type);
    if (((r.role ?? m?.role) === "assistant" || sideCall) && usage) {
      piCalls.set(m?.responseId ?? (sideCall && r.id ? `${r.type}:${r.id}` : `${file}:${n}`), { key: `${r.model ?? m?.model ?? model}|${origin}`, usage });
    }
    if (origin !== "root") return;
    for (const c of Array.isArray(m?.content) ? m.content : []) {
      if (c.type === "toolCall" && c.name === "subagent" && !c.arguments?.action) tally(piDispatches, c.arguments?.agent);
      if (m.role === "user" && c.type === "text") tally(piSkills, c.text?.match(/^<skill name="([^"]+)"/)?.[1]);
    }
  });
}
const pi = {};
for (const { key, usage } of piCalls.values()) {
  pi[key] ??= { calls: 0, cacheRead: 0, output: 0, cost: 0 };
  pi[key].calls++; pi[key].cacheRead += usage.cacheRead ?? 0; pi[key].output += usage.output ?? 0;
  pi[key].cost += typeof usage.cost === "number" ? usage.cost : usage.cost?.total ?? 0;
}

const out = {
  days,
  claude: {
    modelOrigin: byDesc(Object.fromEntries(Object.entries(modelOrigin).map(([k, v]) => [k, { ...v, share: pct(v.cost, modelTotal[k.slice(0, k.lastIndexOf("|"))]) }])), "cost"),
    roles: byDesc(Object.fromEntries(Object.entries(roles).map(([k, files]) => [k, {
      dispatches: files.length, unit: getBuiltinModel("anthropic", k.slice(k.lastIndexOf("|") + 1))?.cost ? "USD" : "M units", medianCalls: median(files.map((f) => f.calls)), medianMaxCtx: median(files.map((f) => f.ctx)),
      costPerDispatch: sum(files.map((f) => f.cost)) / files.length, medianSeconds: Math.round(median(files.map((f) => f.seconds))),
    }])), "dispatches"),
    workflowRuns: byDesc(runs, "cost"),
    dispatches: claudeDispatches,
    skills: claudeSkills,
  },
  pi: {
    modelOrigin: byDesc(pi, "cost"),
    origins: byOrigin(pi, "cost"),
    dispatches: piDispatches,
    skills: piSkills,
  },
};
fs.mkdirSync("/tmp/claude", { recursive: true });
const outFile = path.join(fs.mkdtempSync("/tmp/claude/agent-usage-"), "usage.json");
fs.writeFileSync(outFile, JSON.stringify(out, null, 2), { flag: "wx" });

const counts = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, { n }]));
const show = (title, rows) => { console.log(`\n${title}, last ${days} days`); console.table(rows); };
const round2 = (o, keys) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { ...v, ...Object.fromEntries(keys.map((x) => [x, Number(v[x].toFixed(2))])) }]));
show("claude — cost (USD; M units if unpriced) by model|origin, share of that model", round2(out.claude.modelOrigin, ["cost"]));
show("claude — subagent cost by role|model (USD or M units per dispatch)", round2(out.claude.roles, ["costPerDispatch"]));
show("claude — workflow runs by run|model (USD or M units)", round2(out.claude.workflowRuns, ["cost"]));
show("claude — dispatches", counts(claudeDispatches));
show("claude — skills and slash commands", counts(claudeSkills));
show("pi — by model|origin (cost USD)", Object.fromEntries(Object.entries(out.pi.modelOrigin).map(([k, v]) => [k, { ...v, cost: Number(v.cost.toFixed(2)) }])));
show("pi — cost USD by origin", Object.fromEntries(Object.entries(out.pi.origins).map(([k, v]) => [k, { ...v, cost: Number(v.cost.toFixed(2)) }])));
show("pi — dispatches", counts(piDispatches));
show("pi — skills", counts(piSkills));
console.log(`\nJSON: ${outFile}`);
