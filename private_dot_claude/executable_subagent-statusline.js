#!/usr/bin/env node
// subagentStatusLine: rebuild the subagent panel row in Claude Code's own
// workflow/agent-panel style and append the model as a suffix. Complements the
// main ccstatusline status line (which only ever sees the parent session's
// model). Contract (Claude Code >= 2.1.212): stdin is JSON { columns, tasks:
// [{ id, name, description, tokenCount, model, ... }] }; stdout is one JSON line
// per task, schema { id, content }, which REPLACES that task's row — there is no
// append mode, so the row is composed here from its components:
//   "name › description · <compact> tokens · model"
// mirroring the stock workflow row (name › description · <compact> tokens · N
// tools) but with the model in place of the tool count, which the stock row
// never surfaces. Tasks we omit keep their default rendering.

const FAMILIES = ["opus", "sonnet", "haiku", "fable", "instant"];
const SEP = " · "; // segment separator
const NAME_SEP = " › "; // name↔description divider, matching the workflow row

// Humanize a token count the way Claude Code does (its Na()): compact notation,
// lowercased, with a trailing ".0" stripped (1000 -> "1k", 22079 -> "22.1k",
// 1234567 -> "1.2m"). Returns null for absent/zero counts so the segment is
// omitted entirely, as the stock row does (it renders tokens only when > 0).
const TOK_FMT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});
function formatTokens(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  return `${TOK_FMT.format(v).toLowerCase().replace(".0", "")} tokens`;
}

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
  const columns = Number(payload && payload.columns);
  const out = [];
  for (const t of tasks) {
    const model = prettyModel(t && t.model);
    if (!model) continue; // no model (e.g. bash tasks): leave true stock row
    const desc = t.description ? String(t.description) : "";
    // Workflow row order (name › description · tokens) with model appended. The
    // › divider only joins name↔description; with no description the head is
    // just the name and the · separators carry the rest.
    const build = (d) => {
      const head = d ? `${t.name}${NAME_SEP}${d}` : String(t.name);
      return [head, formatTokens(t.tokenCount), model]
        .filter((p) => p != null && p !== "")
        .join(SEP);
    };
    let row = build(desc);
    if (columns > 0 && row.length > columns && desc) {
      // Trim the description, not the tail — the model suffix is the point.
      // build("") drops the divider, so add it back into the width budget.
      const room = columns - (build("").length + NAME_SEP.length);
      row = build(room > 1 ? desc.slice(0, room - 1) + "…" : "");
    }
    out.push(JSON.stringify({ id: t.id, content: row }));
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
