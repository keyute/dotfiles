#!/usr/bin/env node
// subagentStatusLine: annotate each active subagent's panel row with its model.
// Complements the main ccstatusline status line (which only ever sees the parent
// session's model). Contract (Claude Code >= 2.1.212): stdin is JSON
// { columns, tasks: [{ id, model, name, type, ... }] }; stdout is one JSON line
// per task, schema { id: string, content: string }. Tasks we omit keep their
// default rendering, so this only adds the model, never replaces anything.

const FAMILIES = ["opus", "sonnet", "haiku", "fable", "instant"];

// Derive a friendly label from a model id generically, so it doesn't rot as
// models change (e.g. claude-opus-4-8 -> "Opus 4.8", claude-opus-4-8[1m] ->
// "Opus 4.8 1M", claude-haiku-4-5-20251001 -> "Haiku 4.5"). Falls back to raw.
function prettyModel(id) {
  if (!id) return null;
  const oneM = /\[1m\]/i.test(id);
  let s = String(id)
    .replace(/\[1m\]/gi, "")
    .replace(/^claude-/i, "")
    .replace(/-\d{6,8}$/, ""); // strip date suffix
  const tokens = s.split("-").filter(Boolean);
  const fam = tokens.find((t) => FAMILIES.includes(t.toLowerCase()));
  const nums = tokens.filter((t) => /^\d+$/.test(t));
  let label;
  if (fam) {
    const name = fam[0].toUpperCase() + fam.slice(1);
    label = nums.length ? `${name} ${nums.join(".")}` : name;
  } else {
    label = String(id); // unrecognized shape: show it raw rather than guess
  }
  return oneM ? `${label} 1M` : label;
}

function main(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return; // malformed input: emit nothing, let default rendering stand
  }
  const tasks = Array.isArray(payload && payload.tasks) ? payload.tasks : [];
  const out = [];
  for (const t of tasks) {
    const model = prettyModel(t && t.model);
    if (!model) continue; // no model (e.g. bash tasks): leave default row
    out.push(JSON.stringify({ id: t.id, content: model }));
  }
  if (out.length) process.stdout.write(out.join("\n") + "\n");
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (buf += c));
process.stdin.on("end", () => {
  try {
    main(buf);
  } catch {
    // never let a statusline error surface in the UI
  }
});
