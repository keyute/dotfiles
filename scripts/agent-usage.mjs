#!/usr/bin/env node
// Subscription-usage metrics from both harnesses' session stores, which are
// sandbox-denied: user-run outside it (`! node scripts/agent-usage.mjs --days 30`).
// Prints tables and writes them all to a fresh /tmp/claude/agent-usage-*/usage.json:
// a fresh dir and exclusive create, because this unsandboxed run must not
// follow a symlink a sandboxed agent planted in /tmp/claude.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
const mu = (x) => Number((x / 1e6).toFixed(2));
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

// Weighted units: Anthropic's per-token price multiples relative to base input
// within one model (cache write 5m 1.25x, 1h 2x, cache read 0.1x, output 5x) —
// comparable across origins and roles of a model, not a cross-model price.
const units = (u) => {
  const cc = u.cache_creation;
  const w5m = cc ? cc.ephemeral_5m_input_tokens ?? 0 : u.cache_creation_input_tokens ?? 0;
  const w1h = cc?.ephemeral_1h_input_tokens ?? 0;
  return (u.input_tokens ?? 0) + 1.25 * w5m + 2 * w1h + 0.1 * (u.cache_read_input_tokens ?? 0) + 5 * (u.output_tokens ?? 0);
};
const context = (u) => (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);

const home = os.homedir();

// Claude: Claude keeps child transcripts under /subagents/ (workflow agents under /subagents/workflows/wf_<id>/).
const claudeOrigin = (f) => /\/workflows\//.test(f) ? "workflow" : /\/subagents\//.test(f) ? "subagent" : "root";
const calls = new Map(); // message.id -> call; a streamed message is logged repeatedly with partial output_tokens
const toolRole = new Map(); // Agent tool_use id -> role
const agentRole = new Map(); // subagent agentId -> role
const claudeDispatches = {}, claudeSkills = {};
for (const file of walk(path.join(home, ".claude/projects"))) {
  const root = claudeOrigin(file) === "root";
  for (const r of records(file)) {
    const m = r.message;
    const recent = inWindow(r);
    if (recent && r.type === "assistant" && m?.id && m.usage && m.model !== "<synthetic>") {
      const out = m.usage.output_tokens ?? 0;
      const prev = calls.get(m.id);
      if (!prev || out > prev.out) calls.set(m.id, { file, model: m.model, out, units: units(m.usage), ctx: context(m.usage) });
    }
    if (!root) continue;
    if (recent && typeof m?.content === "string") {
      for (const [, cmd] of m.content.matchAll(/<command-name>([^<]+)<\/command-name>/g)) tally(claudeSkills, cmd);
    }
    for (const c of Array.isArray(m?.content) ? m.content : []) {
      if (c.type === "tool_use" && c.name === "Agent") {
        const role = c.input?.subagent_type ?? "fork";
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

const perFile = new Map(); // file -> { model, calls, ctx, units }
const modelOrigin = {};
for (const c of calls.values()) {
  const f = perFile.get(c.file) ?? { model: c.model, calls: 0, ctx: 0, units: 0 };
  f.calls++; f.ctx = Math.max(f.ctx, c.ctx); f.units += c.units;
  perFile.set(c.file, f);
  const k = `${c.model}|${claudeOrigin(c.file)}`;
  modelOrigin[k] ??= { calls: 0, units: 0 };
  modelOrigin[k].calls++; modelOrigin[k].units += c.units;
}
const claudeTotal = sum(Object.values(modelOrigin).map((v) => v.units));

const roles = {}, runs = {};
for (const [file, f] of perFile) {
  const origin = claudeOrigin(file);
  if (origin === "subagent") {
    const id = path.basename(file).match(/^agent-(\w+)\.jsonl$/)?.[1];
    const k = `${agentRole.get(id) ?? "(unknown)"}|${f.model}`;
    (roles[k] ??= []).push(f);
  } else if (origin === "workflow") {
    const wf = file.match(/\/workflows\/(wf_[^/]+)\//)[1];
    runs[wf] ??= { agents: 0, calls: 0, maxCtx: 0, units: 0 };
    runs[wf].agents++; runs[wf].calls += f.calls; runs[wf].maxCtx = Math.max(runs[wf].maxCtx, f.ctx); runs[wf].units += f.units;
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
    if ((r.role ?? m?.role) === "assistant" && usage) {
      piCalls.set(m?.responseId ?? `${file}:${n}`, { key: `${r.model ?? m?.model ?? model}|${origin}`, usage });
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
    modelOrigin: byDesc(Object.fromEntries(Object.entries(modelOrigin).map(([k, v]) => [k, { ...v, share: pct(v.units, claudeTotal) }])), "units"),
    origins: byOrigin(modelOrigin, "units"),
    roles: byDesc(Object.fromEntries(Object.entries(roles).map(([k, files]) => [k, {
      dispatches: files.length, medianCalls: median(files.map((f) => f.calls)), medianMaxCtx: median(files.map((f) => f.ctx)),
      unitsPerDispatch: Math.round(sum(files.map((f) => f.units)) / files.length),
    }])), "dispatches"),
    workflowRuns: byDesc(Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, { ...v, share: pct(v.units, claudeTotal) }])), "units"),
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
const inMu = (o, keys) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { ...v, ...Object.fromEntries(keys.map((x) => [x, mu(v[x])])) }]));
show("claude — weighted units (M) by model|origin", inMu(out.claude.modelOrigin, ["units"]));
show("claude — weighted units (M) by origin", inMu(out.claude.origins, ["units"]));
show("claude — subagent cost by role|model (units M per dispatch)", inMu(out.claude.roles, ["unitsPerDispatch"]));
show("claude — workflow runs (units M)", inMu(out.claude.workflowRuns, ["units"]));
show("claude — dispatches", counts(claudeDispatches));
show("claude — skills and slash commands", counts(claudeSkills));
show("pi — by model|origin (cost USD)", Object.fromEntries(Object.entries(out.pi.modelOrigin).map(([k, v]) => [k, { ...v, cost: Number(v.cost.toFixed(2)) }])));
show("pi — cost USD by origin", Object.fromEntries(Object.entries(out.pi.origins).map(([k, v]) => [k, { ...v, cost: Number(v.cost.toFixed(2)) }])));
show("pi — dispatches", counts(piDispatches));
show("pi — skills", counts(piSkills));
console.log(`\nJSON: ${outFile}`);
