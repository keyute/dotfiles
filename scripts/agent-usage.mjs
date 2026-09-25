#!/usr/bin/env node
// Per-role subagent dispatch counts from both harnesses' session stores, which
// are sandbox-denied: user-run outside it (`! node scripts/agent-usage.mjs --days 30`).
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

// Root session files only: Claude keeps child transcripts under /subagents/, pi under /run-N/ and subagent-artifacts/ (child transcripts share the root record shape).
const count = (dir, skip, roleOf) => {
  const counts = {};
  for (const file of walk(dir).filter((f) => !skip.test(f))) {
    for (const r of records(file)) {
      if (!(Date.parse(r.timestamp) > since)) continue;
      for (const c of r.message?.content ?? []) {
        const role = typeof c === "object" ? roleOf(c) : undefined;
        if (role) counts[role] = (counts[role] ?? 0) + 1;
      }
    }
  }
  return counts;
};

const home = os.homedir();
const out = {
  claude: count(path.join(home, ".claude/projects"), /\/subagents\//,
    (c) => c.type === "tool_use" && c.name === "Agent" && (c.input?.subagent_type ?? "(unset)")),
  pi: count(path.join(home, ".pi/agent/sessions"), /\/(run-\d+|subagent-artifacts)\//,
    (c) => c.type === "toolCall" && c.name === "subagent" && !c.arguments?.action && c.arguments?.agent),
};
for (const h of ["claude", "pi"]) {
  console.log(`\n${h} — dispatches, last ${days} days`);
  console.table(Object.fromEntries(Object.entries(out[h]).sort((a, b) => b[1] - a[1]).map(([role, n]) => [role, { n }])));
}
