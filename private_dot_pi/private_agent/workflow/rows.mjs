import { Container, Markdown, Spacer, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { AssistantMessageComponent, InteractiveMode, formatReadLineRange, getMarkdownTheme, renderDiff } from "@earendil-works/pi-coding-agent";
import { commandMarkdown, commandMarkdownTheme } from "./command-display.mjs";
import { highlightProse } from "./keywords.mjs";
import { unsandboxed } from "./policy.mjs";

// Transcript glyphs (docs/pi-design.md): one bullet for every row, ↳ for the
// line under a row, π for anything the harness says in its own voice, the
// hollow circle only on fleet rows, a caret for a fold handle's state, filled
// and empty cells for a bar. A line that opens with a glyph starts at column 0;
// a line without one (↳) sits at the text column, and so the caret puts the
// handle's text there too.
export const BULLET = "•";
export const CHILD = "○";
export const TURN_GLYPH = "π";
const SUB = "↳";
const FOLD_OPEN = "▾";
const FOLD_CLOSED = "▸";
const FILLED = "▰";
const EMPTY = "▱";
export const PROMPT = "❯";
export const CURSOR = "❭";
export const PAD = "  ";
const TITLE_WIDTH = 36;
const PREVIEW_WIDTH = 48;
const SUMMARY_WIDTH = 60;

// [running, done] pairs for the turn line; pi/circle/maths flavoured. Edit freely.
export const TURN_VERBS = [
  ["Integrating", "Integrated"],
  ["Iterating", "Iterated"],
  ["Converging", "Converged"],
  ["Approximating", "Approximated"],
  ["Deriving", "Derived"],
  ["Interpolating", "Interpolated"],
  ["Factoring", "Factored"],
  ["Normalising", "Normalised"],
  ["Rounding off", "Rounded off"],
  ["Squaring away", "Squared away"],
  ["Circling back", "Circled back"],
  ["Transcending", "Transcended"],
];

// The SDK bash tool substitutes this text for empty output.
const NO_OUTPUT = "(no output)";
const EXIT_STATUS = /^Command exited with code \d+$/;
const ELIDED = /^… \d+ more lines$/;

export const firstLine = value => String(value ?? "").split("\n")[0];
const resultText = result => {
  const text = (result?.content ?? []).filter(c => c.type === "text").map(c => c.text ?? "").join("\n").trim();
  return text === NO_OUTPUT ? "" : text;
};
const nonEmpty = text => text.split("\n").filter(line => line.trim());
const plural = (n, noun, nouns = `${noun}s`) => `${n} ${n === 1 ? noun : nouns}`;
const liveWork = ({ agents, shells }) => [agents && plural(agents, "agent"), shells && plural(shells, "shell")].filter(Boolean).join(", ");
const indent = line => `${PAD}${line}`;
export const oneLine = text => (text ?? "").replace(/\s+/g, " ").trim();

// A full SGR reset inside the line (styled content) also drops the
// background and any foreground the caller painted; re-open both after every
// reset so the shade and the text colour span the line.
export function shade(theme, line, background = "userMessageBg", foreground) {
  const open = theme.bg(background, "").replace(/\x1b\[49m$/, "") + (foreground ? theme.fg(foreground, "").replace(/\x1b\[39m$/, "") : "");
  return theme.bg(background, line.replaceAll("\x1b[0m", `\x1b[0m${open}`));
}

// Pads a rendered line to a fixed visible width without truncating it; `padRow`
// pads and truncates to exactly the width — the two are not the same function.
export const pad = (text, width) => text + " ".repeat(Math.max(0, width - visibleWidth(text)));
export const padRow = (text, width) => truncateToWidth(text, width, "", true);

// `right` flush against `width`, at least `gap` columns clear of `left`; the
// left side yields, so the right never clips.
export function alignRight(left, right, width, gap = 2) {
  const rightWidth = visibleWidth(right);
  const head = truncateToWidth(left, Math.max(0, width - rightWidth - gap), "…");
  return head + " ".repeat(Math.max(gap, width - visibleWidth(head) - rightWidth)) + right;
}

// The TUI's one bar (docs/pi-design.md rule 1): `parts` are [colour, fraction]
// segments in order, edges rounded cumulatively so the cells always sum to
// `width`; the rest is dim empty cells.
export function meter(theme, width, parts) {
  let at = 0;
  let sum = 0;
  let out = "";
  for (const [colour, fraction] of parts) {
    sum += fraction;
    const edge = Math.max(at, Math.min(width, Math.round(sum * width)));
    if (edge > at) out += theme.fg(colour, FILLED.repeat(edge - at));
    at = edge;
  }
  return at < width ? out + theme.fg("dim", EMPTY.repeat(width - at)) : out;
}

// A run's state colour, shared by completion lines and the workflow row and view.
export function statusTone(status) {
  if (status === "completed") return "success";
  if (status === "running") return "accent";
  if (status === "launching") return "dim";
  if (status === "failed" || status === "stopped" || status === "unknown") return "error";
  return "warning";
}

// The user box's shaded block (docs/pi-design.md rule 5). `foreground` is the
// colour `shade` re-opens after a reset; `fit` is pad or truncate per surface.
export function shadedBlock(theme, lines, width, { prompt, promptColour = "accent", background = "userMessageBg", foreground, fit = pad } = {}) {
  const content = prompt ? lines.map((line, i) => `${i === 0 ? theme.fg(promptColour, `${prompt} `) : PAD}${line}`) : lines;
  return ["", ...content, ""].map(line => shade(theme, fit(line, width), background, foreground));
}

// The one rule every slot dialog frames itself with (docs/pi-design.md rule
// 11), and the peek's fixed height (rule 6): half the
// terminal's rows, whichever of the live dialog or the text-tail draws it.
export const frameRule = (theme, width) => theme.fg("borderAccent", "─".repeat(Math.max(0, width)));
export const slotHeight = rows => Math.max(12, Math.floor(rows / 2));

export function shortTitle(text, width = TITLE_WIDTH) {
  const title = oneLine(text);
  if (title.length <= width) return title;
  const cut = title.slice(0, width - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > width / 2 ? cut.slice(0, space) : cut}…`;
}

// The glyph carries the row's state, as Claude Code's does: plain while the
// call is running, then success or error.
export function glyph(theme, { isPartial, isError }, mark = BULLET) {
  if (isPartial) return mark;
  return theme.fg(isError ? "error" : "success", mark);
}

export function callTitle(name, args = {}) {
  const where = args.path ? ` in ${args.path}` : "";
  switch (name) {
    case "bash": return `${args.run_in_background ? `Started ${firstLine(args.command) || "…"} in background` : `Ran ${firstLine(args.command) || "…"}`}${args.dangerouslyDisableSandbox ? " · unsandboxed" : ""}`;
    case "read": return `Read ${args.path ?? ""}${formatReadLineRange(args.offset, args.limit)}`;
    case "edit": return `Edited ${args.path ?? ""}`;
    case "write": return `Wrote ${args.path ?? ""}`;
    case "grep": return `Search "${args.pattern ?? ""}"${where}`;
    case "find": return `Find ${args.pattern ?? ""}${where}`;
    case "ls": return `List ${args.path ?? "."}`;
    default: return name;
  }
}

// Plugin rows: pi's MCP tools are `mcp__<server>__<tool>`, and a configured
// server name (which may itself hold `__`) wins over the first separator;
// pi-subagents' launch carries `agent` and `task`, its other actions an
// `action`. Any other plugin tool (bg_wait, the supervisor channel) is its
// name and first string argument.
const mcpName = (raw, servers) => {
  const server = servers.filter(s => raw.startsWith(`${s}__`)).sort((a, b) => b.length - a.length)[0];
  return server ? `${server} › ${raw.slice(server.length + 2)}` : raw.replace("__", " › ");
};
const preview = args => {
  const value = Object.values(args ?? {}).find(v => typeof v === "string" && v.trim());
  return value ? ` "${shortTitle(value, PREVIEW_WIDTH)}"` : "";
};

export function pluginTitle(name, args = {}, servers = []) {
  if (name === "subagent") {
    if (args.action) return `subagent ${args.action}${args.id ? ` ${args.id}` : ""}`;
    const task = shortTitle(args.title || args.task, PREVIEW_WIDTH);
    return `${args.agent ?? "subagent"}${task ? ` › ${task}` : ""}`;
  }
  if (name.startsWith("mcp__")) return `${mcpName(name.slice("mcp__".length), servers)}${preview(args)}`;
  if (name === "web_search") return `Searched "${shortTitle(args.query ?? "", PREVIEW_WIDTH)}"`;
  if (name === "web_fetch") return `Fetched ${URL.parse(args.url ?? "")?.hostname ?? ""}`;
  return `${name.replaceAll("_", " ")}${preview(args)}`;
}

// The one line under a collapsed row: what the result was, never what it said.
// A plugin tool outside the known kinds answers in a sentence (bg_wait's
// "Waited 33.2s for run …; done."), which is the summary itself.
export function resultSummary(name, result) {
  if (!result) return "";
  if (result.details?.taskId) return `task ${result.details.taskId} · running`;
  if (name === "plugin") return shortTitle(firstLine(resultText(result)), SUMMARY_WIDTH);
  if (name === "edit" || name === "write") {
    const diff = result.details?.diff;
    if (typeof diff !== "string") return "";
    const added = diff.split("\n").filter(line => /^\+(?!\+\+)/.test(line)).length;
    const removed = diff.split("\n").filter(line => /^-(?!--)/.test(line)).length;
    return `+${added} −${removed}`;
  }
  // pi's read, ls, find, grep and bash append one "\n\n[...]" notice on truncation or offset.
  const text = resultText(result).replace(/\n\n\[(Showing |\d+ more lines in file|Some lines truncated|[^\n]* limit reached)[^\n]*\]$/, "");
  if (name === "grep") return plural(text.split("\n").filter(line => /^[^:\n]+:\d+: /.test(line)).length, "match", "matches");
  if (name === "find" || name === "ls") return !text || /^(No |\(empty directory\))/.test(text) ? "" : plural(nonEmpty(text).length, "entry", "entries");
  if (text) return plural(text.split("\n").length, "line");
  return name === "read" ? "" : "no output";
}

// Collapsed bodies stay hidden except errors, which show head and tail with
// the exit status last (a shell error), or in full (anything else).
export function bodyLines(name, result, { expanded = false, isError = false } = {}) {
  if (!result) return [];
  const text = resultText(result);
  if (isError) {
    const lines = nonEmpty(text);
    if (expanded || name !== "bash") return lines;
    const status = EXIT_STATUS.test(lines.at(-1) ?? "") ? [lines.pop()] : [];
    if (lines.length <= 5) return [...lines, ...status];
    return [...lines.slice(0, 2), `… ${lines.length - 4} more lines`, ...lines.slice(-2), ...status];
  }
  if (!expanded || (name === "subagent" && result.details?.asyncId)) return [];
  if (name === "edit") return typeof result.details?.diff === "string" ? renderDiff(result.details.diff).split("\n") : [];
  if (name === "write") return [];
  return text ? text.split("\n") : [];
}

// The diff counts are the one summary a colour can carry, so they take the
// theme's own success/error pair, here and on the status line. Each part is
// coloured on its own rather than nested inside one muted wrapper, whose reset
// would end the muted colour for the rest of the line (the hazard design
// rule 5 records for the user box). The sign carries the meaning as well as
// the colour, and the two surfaces spell the minus differently.
export const paintCounts = (counts, theme) =>
  counts.split(" ").map(part => theme.fg(part.startsWith("+") ? "success" : "error", part)).join(" ");

function summaryLine(name, summary, theme) {
  const counts = name === "edit" || name === "write" ? summary.split(" ") : null;
  if (counts?.length !== 2) return theme.fg("muted", `${SUB} ${summary}`);
  return `${theme.fg("muted", SUB)} ${paintCounts(summary, theme)}`;
}

// A duration only ever appears formatted this one way, in a completion's own
// tail, a group member's or a workflow's outcome.
const durationText = durationMs => (typeof durationMs === "number" ? formatDuration(durationMs) : null);

// The orchestrate row is a workflow's one outcome (docs/pi-design.md rule 4), failed or not:
// its agents, the outcome, the workflow's own duration and, on a completed run, the
// children that failed in warning — a script may catch a child's failure (parallel,
// pipeline) and still return, and its children draw no lines of their own. `stopped`
// is left out: a script that returns early has its still-running children stopped.
function workflowOutcome(result, isError, durationMs, theme) {
  const runs = result?.details?.runs ?? [];
  const workflow = result?.details?.workflow;
  const status = workflow?.status ?? (isError ? "failed" : "completed");
  const failed = status !== "completed" ? 0 : runs.filter(run => run?.status !== "completed" && run?.status !== "stopped").length;
  const head = `${SUB} ${plural(runs.length, "agent")} · ${status}`;
  const tail = durationText(workflow ? workflow.durationMs ?? (workflow.endedAt == null ? undefined : workflow.endedAt - workflow.startedAt) : durationMs);
  if (!failed) return theme.fg("muted", tail ? `${head} · ${tail}` : head);
  return `${theme.fg("muted", `${head} · `)}${theme.fg("warning", `${failed} failed`)}${tail ? theme.fg("muted", ` · ${tail}`) : ""}`;
}

// The lines a row's result draws: the summary line first when there is one,
// then the body, each indented to the text column.
export function rowLines(name, result, { expanded = false, isError = false, durationMs, action } = {}, theme) {
  if (name === "orchestrate" && action) {
    const workflow = result?.details?.workflow;
    const summary = workflow ? `${SUB} ${workflow.id} · ${workflow.status}` : `${SUB} ${resultSummary("plugin", result)}`;
    return [indent(theme.fg("muted", summary)), ...bodyLines("plugin", result, { expanded, isError }).map(line => indent(theme.fg(isError ? "error" : "toolOutput", line)))];
  }
  // A subagent launch answers with its run id and finishes later.
  if (name === "subagent" && !isError && result?.details?.asyncId) return [indent(theme.fg("muted", `${SUB} launched`))];
  const lines = [];
  const summary = isError || name === "orchestrate" ? "" : resultSummary(name, result);
  if (name === "orchestrate") lines.push(workflowOutcome(result, isError, durationMs, theme));
  else if (summary) lines.push(summaryLine(name, summary, theme));
  for (const line of bodyLines(name, result, { expanded, isError })) {
    if (isError && ELIDED.test(line)) lines.push(theme.fg("muted", line));
    else lines.push(name === "edit" && !isError ? line : theme.fg(isError ? "error" : "toolOutput", line));
  }
  return lines.map(indent);
}

// Grouping, as Claude Code does it: successful activity facts between two
// things that stay visible form one chronological group, which collapses to a
// count sentence ("Read 3 files, launched 2 agents"); clicking it restores the
// member ladder and ctrl+o restores full tool output. State is per process — a
// resumed session renders its old rows and completions unfolded.
//
// The extent is derived, never edited (docs/pi-design.md rule 2).
// The timeline holds ordered facts — one per tool row plus its outcome, one
// boundary per line that stays visible — and a run is read back out of them on
// demand. Three times the extent was maintained by hand and three times a
// producer of a visible line failed to close the group it interrupted; a fact
// that has to be appended for the line to be drawn at all cannot be forgotten
// the same way.
const WORDS = {
  read: ["read", "file"],
  bash: ["ran", "shell command"],
  grep: ["searched for", "pattern"],
  edit: ["edited", "file"],
  write: ["wrote", "file"],
  list: ["listed", "path"],
  toolSearch: ["ran", "tool search", "tool searches"],
  mcp: ["called", "MCP tool"],
  web: ["ran", "web search", "web searches"],
  fetch: ["fetched", "page"],
  discovery: ["ran", "agent discovery", "agent discoveries"],
  agent: ["launched", "agent"],
  steer: ["steered", "agent"],
  check: ["checked on", "agent"],
  stop: ["stopped", "agent"],
  interrupt: ["interrupted", "agent"],
  task: ["started", "background command"],
  taskCheck: ["checked on", "background task"],
  taskStop: ["stopped", "background task"],
  // Listing has no object to count, so the clause is the verb alone.
  taskList: ["listed background tasks"],
  agentDone: ["finished", "agent"],
  taskDone: ["finished", "background task"],
};
const countKey = tool => (tool === "find" || tool === "ls" ? "list" : tool);
export const isMcp = name => name.startsWith("mcp__");
// Subagent and background-task management calls are transcript housekeeping
// and group like any other activity fact: launch, list discovery, steer,
// status check, stop and interrupt; a task's output, stop and list. `bg_wait`
// stays out as a visible boundary row: it is a blocking wait on running work
// whose own sentence is the information.
const SUBAGENT_ACTIONS = { list: "discovery", steer: "steer", status: "check", stop: "stop", interrupt: "interrupt" };
const TASK_ACTIONS = { output: "taskCheck", stop: "taskStop", list: "taskList" };
// Every subagent fold but discovery carries no summary worth a member line.
const NO_SUMMARY = new Set(["agent", ...Object.values(SUBAGENT_ACTIONS).filter(key => key !== "discovery")]);
export const foldKey = (name, args = {}) => {
  if (name === "subagent") {
    if (args.agent && args.task) return "agent";
    return SUBAGENT_ACTIONS[args.action] ?? null;
  }
  if (name === "workspace_task") return TASK_ACTIONS[args.action] ?? null;
  if (name === "web_search") return "web";
  if (name === "web_fetch") return "fetch";
  if (name === "tool_search") return "toolSearch";
  return name.startsWith("workspace_") ? name.slice("workspace_".length) : isMcp(name) ? "mcp" : null;
};
// The name a member's summary is computed under, where its fold key differs
// from the name its plain row renders with (`pluginRenderers`, `taskRenderers`).
const SUMMARY_NAME = { web: "plugin", fetch: "plugin", toolSearch: "plugin", taskCheck: "plugin", taskStop: "plugin", taskList: "plugin" };

// One row behind one header line hides nothing and draws a caret over content
// that is not there, so a run needs two rows to be worth a handle.
const MIN_RUN = 2;

// `toolsExpanded` reads pi's global ctrl+o flag (ctx.ui.getToolsExpanded);
// a sealed group reopens when that flag changes. `nonce` marks this
// process's own completion seqs apart from another process sharing the same
// session file (rule 4); `repaint` is unset until `setRepaint` wires it to
// the TUI, since completion rows have no per-entry invalidate of their own.
// `quiet` skips the before/after diff a bulk replay has no components to
// invalidate for (the fleet peek, see `refold`). `streamBoundary` is the
// boundary standing for the reply pi is streaming (see `appendVisible`).
export function createFolds(toolsExpanded = () => undefined, { quiet = false } = {}) {
  return { timeline: [], facts: new Map(), invalidate: new Map(), titles: new Map(), views: new Map(), revision: 0, derived: null, boundaries: 0, toolsExpanded, repaint: () => {}, nonce: Math.random().toString(36).slice(2, 8), doneSeq: 0, quiet, streamBoundary: null };
}
export const defaultFolds = createFolds();
export function setRepaint(folds, repaint) {
  folds.repaint = repaint;
}
// `facts` indexes the timeline's activity facts by id; the first fact under an
// id keeps it, as a search of the timeline would find it.
function addFact(folds, fact, index = folds.timeline.length) {
  folds.timeline.splice(index, 0, fact);
  if (!folds.facts.has(fact.id)) folds.facts.set(fact.id, fact);
}
const nextSeq = folds => `${folds.nonce}-${++folds.doneSeq}`;

// `tool` is the fold key before `countKey` folds `find`/`ls` into `list` —
// `settleFold` needs it back to compute the fact's summary. `args` are kept
// for the escalation count and a backgrounded bash call's settled title.
export function addFold(folds, id, tool, args = {}) {
  refold(folds, () => {
    addFact(folds, { kind: "activity", source: "tool", id, key: countKey(tool), tool, args, unsandboxed: unsandboxed(tool, args), outcome: "pending" });
    folds.revision += 1;
  });
}

// A backgrounded bash call is keyed `bash` at `addFold`, before anyone knows
// whether it will finish inside its grace period; a result carrying
// `details.taskId` means it outlived that period and became a running task, so
// the fact re-keys to `task` here. Re-keying before the run can seal is safe: a
// pending fact already holds its whole run back (see `derive`). One answered
// inside the period, either way, was a foreground call after all and takes its
// title (`inline`); the title is rewritten here because the group's first row
// repaints from `folds.titles` before this row's own render can. A success
// also records its summary for the group's member line.
export function settleFold(folds, id, failed, result) {
  const fact = folds.facts.get(id);
  if (fact?.source !== "tool" || fact.outcome !== "pending") return;
  refold(folds, () => {
    fact.outcome = failed ? "failed" : "success";
    if (!failed && !folds.quiet) fact.result = result;
    if (fact.key === "bash" && result?.details?.taskId) fact.key = "task";
    else if (fact.key === "bash" && fact.args.run_in_background) {
      fact.inline = true;
      folds.titles.set(id, callTitle("bash", { ...fact.args, run_in_background: false }));
    }
    if (!failed) fact.summary = NO_SUMMARY.has(fact.key) ? "" : resultSummary(SUMMARY_NAME[fact.key] ?? fact.tool, result);
    folds.revision += 1;
  });
}

// Every line that stays visible ends the run above it. Two of them in a row
// need only one boundary — there is no run between them to seal.
export function closeFolds(folds, index = folds.timeline.length) {
  const last = folds.timeline[index - 1];
  if (!last || last.kind === "boundary") return;
  refold(folds, () => {
    folds.timeline.splice(index, 0, { kind: "boundary", id: `b${(folds.boundaries += 1)}` });
    folds.revision += 1;
  });
}

// An unsandboxed call is counted under its own clause's key, so a bash call
// re-keyed to `task` carries its escalation with it.
const tally = entries => {
  const counts = {};
  for (const entry of entries) {
    counts[entry.key] = (counts[entry.key] ?? 0) + 1;
    if (entry.unsandboxed) counts[`${entry.key}:unsandboxed`] = (counts[`${entry.key}:unsandboxed`] ?? 0) + 1;
  }
  return counts;
};

// A group is one maximal chronological stretch of successful activity facts:
// workspace/MCP/search/discovery calls, launches, and successful child/task
// completions. A failed fact or an explicit visible boundary seals the stretch
// on its left and is never a member. Every member has to be settled before a
// sealed group can exist, because a pending call may still split the stretch.
//
// The live group is the leading settled-success stretch at the end of the
// timeline. A pending fact blocks only what follows it, so already-settled work
// above a still-running row can remain the newest visible group. Both tool rows
// and completion entries read these same maps; there is no second completion
// grouping layer.
function derive(folds) {
  if (folds.derived?.revision === folds.revision) return folds.derived;
  const byId = new Map();
  const liveById = new Map();
  let run = [];
  let waiting = false;
  let live = [];
  let blocked = false;
  const seal = boundaryId => {
    if (!waiting && run.length >= MIN_RUN) {
      const group = { boundaryId, entries: run, counts: tally(run), sealed: true };
      for (const entry of run) byId.set(entry.id, group);
    }
    run = [];
    waiting = false;
    live = [];
    blocked = false;
  };
  for (const fact of folds.timeline) {
    if (fact.kind === "boundary") seal(fact.id);
    else if (fact.outcome === "success") {
      run.push(fact);
      if (!blocked) live.push(fact);
    }
    else if (fact.outcome === "failed") seal(`failed:${fact.id}`);
    // A pending row holds its whole sealed run back rather than only the rows
    // after it. It blocks the live block only from its own position onward.
    else { waiting = true; blocked = true; }
  }
  if (live.length >= MIN_RUN) {
    const group = { boundaryId: `live:${live[0].id}`, entries: live, counts: tally(live), sealed: false };
    for (const entry of live) liveById.set(entry.id, group);
  }
  folds.derived = { revision: folds.revision, byId, liveById, liveTail: live.at(-1) };
  return folds.derived;
}

// The read side of the model: sealed and live membership. `doneGroup` retains
// its public name for the entry-renderer callers, but reads the same activity
// group as a tool row.
export const foldGroup = (folds, id) => derive(folds).byId.get(id) ?? null;
export const liveGroup = (folds, id) => derive(folds).liveById.get(id) ?? null;
export const doneGroup = (folds, seq) => groupFor(derive(folds), seq);
const signature = group => (group ? `${group.boundaryId} ${group.sealed} ${group.entries.map(entry => entry.id).join(",")}` : "");
const groupFor = (derived, id) => derived.byId.get(id) ?? derived.liveById.get(id) ?? null;

// Membership is recomputed rather than edited. Tool rows have their own
// invalidators; completion entries do not, so a changed completion membership
// requests one whole-TUI repaint. Both paths read the same derived group before
// any renderer runs, preventing a stale separator inside a mixed group.
function refold(folds, mutate) {
  if (folds.quiet) {
    mutate();
    return;
  }
  const derivedBefore = derive(folds);
  const beforeIds = new Set([...derivedBefore.byId.keys(), ...derivedBefore.liveById.keys()]);
  const before = new Map([...beforeIds].map(id => [id, groupFor(derivedBefore, id)]));
  mutate();
  const derivedAfter = derive(folds);
  const liveViews = new Set([...derivedAfter.liveById.values()].map(group => group.boundaryId));
  for (const key of folds.views.keys()) if (key.startsWith("live:") && !liveViews.has(key)) folds.views.delete(key);
  const afterIds = new Set([...derivedAfter.byId.keys(), ...derivedAfter.liveById.keys()]);
  let repaint = false;
  for (const id of new Set([...beforeIds, ...afterIds])) {
    if (signature(before.get(id)) === signature(groupFor(derivedAfter, id))) continue;
    if (folds.facts.get(id)?.source === "completion") repaint = true;
    else folds.invalidate.get(id)?.();
  }
  if (repaint) folds.repaint();
}

// Appending an entry is what draws its line, so visible non-activity entries
// carry their own boundary. A successful child/task completion instead appends
// one activity fact and can extend the same chronological group as tool rows.
// A successful completion's fact at `index`, shared with the fleet peek's
// replay of a child's own entries, which keep the seq the child gave them.
export function addCompletion(folds, type, data, index = folds.timeline.length) {
  data.seq ??= nextSeq(folds);
  const done = DONE[type];
  refold(folds, () => {
    addFact(folds, { kind: "activity", source: "completion", outcome: "success", id: data.seq, key: done.key, data: done.line(data) }, index);
    folds.revision += 1;
  });
}

// While a reply streams, pi mounts an entry above the reply rather than below
// it, so the entry's fact or boundary goes in before the reply's boundary to
// keep fold order equal to screen order.
export function appendVisible(pi, type, data, folds = defaultFolds) {
  const done = data.status === "completed" && DONE[type];
  const streaming = () => (folds.streamBoundary ? folds.timeline.indexOf(folds.streamBoundary) : -1);
  const end = () => (streaming() < 0 ? folds.timeline.length : streaming());
  if (done) {
    addCompletion(folds, type, data, end());
  } else if (streaming() >= 0) {
    // The reply's boundary stays where it is and now closes the run above this
    // entry, so that group keeps its key (and its click/ctrl+o state); a new
    // one below the entry stands for the reply.
    const boundary = { kind: "boundary", id: `b${(folds.boundaries += 1)}` };
    folds.timeline.splice(streaming() + 1, 0, boundary);
    folds.streamBoundary = boundary;
    folds.revision += 1;
  } else closeFolds(folds);
  pi.appendEntry(type, data);
}

export function summarise(counts) {
  const clause = (key, [verb, noun, nouns]) => {
    const escalated = counts[`${key}:unsandboxed`];
    return `${noun ? `${verb} ${plural(counts[key], noun, nouns)}` : verb}${escalated ? ` (${escalated} unsandboxed)` : ""}`;
  };
  const text = Object.entries(WORDS).filter(([key]) => counts[key]).map(([key, words]) => clause(key, words)).join(", ");
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

const speaks = event => event.message?.role === "assistant" && (event.message.content ?? []).some(c => c.type === "text" && c.text?.trim());
// A visible custom message the agent loop delivers — pi-subagents' control
// notice, and anything else a plugin sends into a run — is a transcript line
// like any other, and its `message_end` is where it lands, so the boundary sits
// at its position rather than at the enqueue that can precede it. One the
// session appends outside the stream (`_appendCustomMessage`: idle without a
// turn, the deferred flush) emits no `message_end`; plugin-api closes for those.
const displays = event => Boolean(event.message?.customType) && Boolean(event.message.display);
// pi's red lines under an assistant message: its tail (assistant-message.js),
// or for an error or abort with tool calls the red rows pi draws for them —
// pi-agent-core ends that message with no tool results, so no tool event
// adds a fact for those rows.
const tails = event => event.message?.role === "assistant" && ["length", "error", "aborted"].includes(event.message.stopReason);

// A pending tool must stay outside the collapsed success group; a boundary
// after it would hold the whole group open until it settles. Shared by
// `installFolding`'s `input` handler and the fleet peek's replay, so the two
// close a group at the same point.
export function closeLive(folds) {
  const tail = derive(folds).liveTail;
  closeFolds(folds, tail ? folds.timeline.indexOf(tail) + 1 : undefined);
}

export function installFolding(pi, ctx, folds = defaultFolds) {
  folds.toolsExpanded = () => ctx.ui.getToolsExpanded();
  pi.on("tool_execution_start", event => {
    // The question row draws nothing (questionnaire.mjs); its answers entry, when there is one, is the boundary.
    if (event.toolName === "ask_user_question") return;
    const key = foldKey(event.toolName, event.args);
    if (key) addFold(folds, event.toolCallId, key, event.args);
    else closeFolds(folds);
  });
  // pi-web-search reports failures in `details.error` without `isError`.
  pi.on("tool_execution_end", event => settleFold(folds, event.toolCallId, Boolean(event.isError || event.result?.details?.error), event.result));
  // A run's start draws nothing, so it closes nothing: a run a quiet notice
  // starts continues the group above it.
  pi.on("input", event => {
    if (event.source !== "extension") closeLive(folds);
    return { action: "continue" };
  });
  // Input closes at submission; a user box closes again where it lands, which
  // for a queued steer or extension input is later, mid-run.
  pi.on("message_start", event => { if (event.message?.role === "user") closeLive(folds); });
  // Streaming replies announce their text in updates; non-streaming ones only
  // at the end. The first boundary a streaming reply adds stands for it until
  // pi drops its streaming component, at the assistant's message_end or at
  // agent_end after an abort; one that follows another visible line adds none,
  // and entries pushed after that line already sit above the reply.
  pi.on("message_update", event => {
    if (!speaks(event) || folds.streamBoundary) return;
    const tail = folds.timeline.at(-1);
    closeFolds(folds);
    if (folds.timeline.at(-1) !== tail) folds.streamBoundary = folds.timeline.at(-1);
  });
  pi.on("message_end", event => {
    if (speaks(event) || displays(event) || tails(event)) closeFolds(folds);
    if (event.message?.role === "assistant") folds.streamBoundary = null;
  });
  pi.on("agent_end", () => { folds.streamBoundary = null; });
  // pi rebuilds the chat from the kept entries after this event (compaction_end),
  // so facts for entries it no longer draws go, and the group's first kept
  // member draws the sentence for what remains. The summary pi appends below
  // them is visible, so it closes the group; this also covers a threshold
  // compaction mid-run, which no run start or turn line follows.
  pi.on("session_compact", (_event, eventCtx) => {
    const kept = new Set();
    for (const entry of eventCtx.sessionManager.buildContextEntries()) {
      if (entry.type === "custom" && entry.data?.seq != null) kept.add(entry.data.seq);
      if (entry.type === "message" && entry.message.role === "assistant") {
        for (const block of entry.message.content ?? []) if (block.type === "toolCall") kept.add(block.id);
      }
    }
    refold(folds, () => {
      folds.timeline = folds.timeline.filter(fact => fact.kind !== "activity" || kept.has(fact.id));
      for (const id of [...folds.facts.keys()]) {
        if (kept.has(id)) continue;
        folds.facts.delete(id);
        folds.titles.delete(id);
        folds.invalidate.delete(id);
      }
      folds.revision += 1;
    });
    closeFolds(folds);
  });
}

// Child-first native mouse routing lets the group consume label and body
// clicks without changing the host's unrelated native expanded flag.
class FoldHandle extends Text {
  constructor(text, toggle, layout) {
    super(text, 0, 0);
    this.toggle = toggle;
    this.layout = layout;
    this.targets = [];
    this.lineComponents = [];
  }
  invalidate() {
    super.invalidate();
    for (const component of this.lineComponents) component.invalidate();
  }
  render(width) {
    if (!this.layout) return super.render(width);
    const { lines, targets } = this.layout();
    this.targets = [];
    this.lineComponents.length = lines.length;
    return lines.flatMap((line, index) => {
      const component = this.lineComponents[index] ??= new Text("", 0, 0);
      component.setText(line);
      const wrapped = component.render(width);
      const rendered = wrapped.length ? wrapped : [""];
      this.targets.push(...rendered.map(() => targets.get(index)));
      return rendered;
    });
  }
  handleMouse(event) {
    if (event.type !== "click" || event.button !== "left") return undefined;
    if (this.targets.length && (event.y < 0 || event.y >= this.targets.length)) return undefined;
    const target = this.targets[event.y];
    if (target !== undefined) this.toggle(target);
    else if (event.y === 0 && !this.targets.length) this.toggle();
    return { handled: true };
  }
}

// Open/closed lives under the run's boundary id rather than on the run itself,
// so a re-derivation hands the same state back to the same group.
function view(folds, group, rendering) {
  let state = folds.views.get(group.boundaryId);
  if (!state) {
    // A group that seals while ctrl+o is on joins it: it records the flag as
    // already seen, so the render's transition guard would never fire for it.
    const expandedAt = folds.toolsExpanded();
    state = { open: expandedAt === true, expandedAt, members: new Set() };
    folds.views.set(group.boundaryId, state);
  }
  const expanded = folds.toolsExpanded();
  if (expanded !== state.expandedAt) {
    state.expandedAt = expanded;
    state.open = expanded === true;
    state.members.clear();
    if (rendering !== undefined) for (const entry of group.entries) if (entry.id !== rendering) folds.invalidate.get(entry.id)?.();
  }
  return state;
}

// The caret is the handle's state (docs/pi-design.md rule 2). It sits in the
// dot column so the handle lines up with the rows it owns, and the text undims
// when open so a stacked run of groups shows which one is expanded. Takes the
// sentence text rather than a group, so a completion's own wording (rule 4)
// draws through the same handle as a tool group's.
const handleLine = (text, state, theme) =>
  theme.fg(state.open ? "toolTitle" : "muted", `${state.open ? FOLD_OPEN : FOLD_CLOSED} ${text}`);

function toggleFold(folds, group, rendering) {
  const state = view(folds, group);
  state.open = !state.open;
  state.members.clear();
  for (const entry of group.entries) if (entry.id !== rendering) folds.invalidate.get(entry.id)?.();
}

// A group's member line, live or sealed. Completion members keep the status
// word that distinguishes them from launch members, plus their task and
// duration; tool members retain the row's own settled summary.
function completionMemberLine(entry, theme) {
  const { agent, task, durationMs } = entry.data;
  const title = `${agent} finished${task ? ` › ${shortTitle(task, SUMMARY_WIDTH)}` : ""}`;
  const duration = durationText(durationMs);
  const tail = duration ? theme.fg("muted", ` · ${duration}`) : "";
  return indent(`${theme.fg("muted", SUB)} ${theme.fg("toolTitle", title)}${tail}`);
}

function memberLine(folds, entry, theme) {
  if (entry.source === "completion") return completionMemberLine(entry, theme);
  const title = theme.fg("toolTitle", folds.titles.get(entry.id));
  const summary = entry.summary ?? "";
  if (!summary) return indent(`${theme.fg("muted", SUB)} ${title}`);
  const isDiff = (entry.tool === "edit" || entry.tool === "write") && summary.split(" ").length === 2;
  const tail = `${theme.fg("muted", " · ")}${isDiff ? paintCounts(summary, theme) : theme.fg("muted", summary)}`;
  return indent(`${theme.fg("muted", SUB)} ${title}${tail}`);
}

// One group row's lines at the three levels (see `rowRenderers`), shared by
// tool rows, completion entries and the peek replay; `own` is what the row
// shows under ctrl+o.
const liveLine = (group, theme) => `${theme.fg("success", BULLET)} ${theme.fg("toolTitle", summarise(group.counts))}`;
export function groupLines(folds, group, { first, expanded, state, own, targets = new Map() }, theme) {
  if (expanded) return group.sealed && first ? [handleLine(summarise(group.counts), state, theme), ...own] : own;
  if (!first) return [];
  const lines = [group.sealed ? handleLine(summarise(group.counts), state, theme) : liveLine(group, theme)];
  if (group.sealed) targets.set(0, "handle");
  if (group.sealed && !state.open) return lines;
  for (const entry of group.entries) {
    targets.set(lines.length, entry.id);
    lines.push(memberLine(folds, entry, theme));
    if (state?.members?.has(entry.id)) lines.push(...memberBody(entry, theme));
  }
  return lines;
}

function memberBody(entry, theme) {
  if (entry.source !== "tool") return [];
  const name = entry.bodyName ?? SUMMARY_NAME[entry.key] ?? (entry.tool === "agent" ? "subagent" : entry.tool);
  return bodyLines(name, entry.result, { expanded: true }).map(line => indent(name === "edit" ? line : theme.fg("toolOutput", line)));
}

function groupComponent(folds, group, own, theme, previous) {
  const toggle = (target = "handle") => {
    if (folds.toolsExpanded()) return;
    const state = view(folds, group);
    if (target === "handle") toggleFold(folds, group);
    else {
      const entry = group.entries.find(entry => entry.id === target);
      if (!entry || !memberBody(entry, theme).length) return;
      if (state.members.has(target)) state.members.delete(target);
      else state.members.add(target);
      folds.invalidate.get(group.entries[0].id)?.();
    }
    folds.repaint();
  };
  const component = previous ?? new FoldHandle("", toggle);
  component.toggle = toggle;
  component.layout = () => {
    const targets = new Map();
    const lines = groupLines(folds, group, { first: true, expanded: folds.toolsExpanded(), state: view(folds, group), own, targets }, theme);
    return { lines, targets };
  };
  return component;
}

// Below output level a member's own result slot draws nothing: the group's
// first row speaks for it from its call slot.
const hidden = (folds, id) => !folds.toolsExpanded() && Boolean(foldGroup(folds, id) ?? liveGroup(folds, id));

// A row is `glyph title` and one ↳ line; a group renders at one of three
// levels (docs/pi-design.md rule 2): members — the sentence and one `↳` line
// per row, with independently selected bodies — while live or clicked open;
// the sentence alone once sealed;
// every row in full under ctrl+o, which outranks both. Only a sealed group has
// a handle to click. A failed or pending row is never a member, so it needs no
// exception here to stay visible.
function rowRenderers({ name, title, folds = defaultFolds, failed = (_result, context) => context.isError }) {
  const status = context => (context.state?.failed ? { ...context, isError: true } : context);
  return {
    renderShell: "self",
    renderCall(args, theme, rawContext) {
      // The first render precedes tool_execution_start, so every render records the invalidator and title.
      const id = rawContext.toolCallId;
      folds.invalidate.set(id, rawContext.invalidate);
      const context = status(rawContext);
      const rowTitle = title(args, { workflow: rawContext.state?.workflow, inline: Boolean(rawContext.state?.inline || folds.facts.get(id)?.inline) });
      folds.titles.set(id, rowTitle);
      const line = `${glyph(theme, context)} ${theme.fg("toolTitle", rowTitle)}`;
      const group = foldGroup(folds, id) ?? liveGroup(folds, id);
      if (!group) return new Text(line, 0, 0);
      const first = group.entries[0].id === id;
      const toolsExpanded = folds.toolsExpanded();
      const state = view(folds, group, id);
      if (first) return groupComponent(folds, group, [line], theme, rawContext.lastComponent instanceof FoldHandle ? rawContext.lastComponent : undefined);
      return new FoldHandle(groupLines(folds, group, { first, expanded: toolsExpanded, state, own: [line] }, theme).join("\n"), () => {});
    },
    renderResult(result, options, theme, rawContext) {
      // The call slot only sees pi's isError; a failure known from the result
      // is shared through the row's state so the glyph turns too. pi's
      // invalidate rebuilds the row synchronously, so it runs after this render
      // or the result would be appended twice.
      if (rawContext.state && !rawContext.isError && !rawContext.state.failed && failed(result, rawContext)) {
        rawContext.state.failed = true;
        queueMicrotask(() => rawContext.invalidate?.());
      }
      // A backgrounded call answered inside its grace period reads as the
      // foreground call it was; a resumed row has no fact to say so.
      if (name === "bash" && rawContext.state && !rawContext.state.inline && rawContext.args?.run_in_background && !rawContext.isPartial && !result?.details?.taskId) {
        rawContext.state.inline = true;
        queueMicrotask(() => rawContext.invalidate?.());
      }
      if (name === "orchestrate" && rawContext.state && result?.details?.workflow && rawContext.state.workflow !== result.details.workflow) {
        rawContext.state.workflow = result.details.workflow;
        queueMicrotask(() => rawContext.invalidate?.());
      }
      const context = status(rawContext);
      const fact = folds.facts.get(context.toolCallId);
      if (fact) {
        if (fact.outcome === "pending") fact.result = result;
        fact.bodyName = name;
      }
      if (hidden(folds, context.toolCallId)) return new Text("", 0, 0);
      const text = rowLines(name, result, { expanded: options.expanded, isError: context.isError, durationMs: context.durationMs, action: rawContext.args?.action }, theme).join("\n");
      const grouped = foldGroup(folds, context.toolCallId) ?? liveGroup(folds, context.toolCallId);
      return grouped ? new FoldHandle(text, () => {}) : new Text(text, 0, 0);
    },
  };
}

export function toolRenderers(name, folds = defaultFolds) {
  return rowRenderers({ name, title: (args, { inline }) => callTitle(name, inline ? { ...args, run_in_background: false } : args), folds });
}

// pi-web-search reports failures in details.error without isError.
export function pluginRenderers(name, { servers = [], folds = defaultFolds } = {}) {
  return rowRenderers({
    name: name === "subagent" ? "subagent" : isMcp(name) ? "mcp" : "plugin",
    title: args => pluginTitle(name, args, servers),
    folds,
    failed: (result, context) => context.isError || Boolean(result?.details?.error),
  });
}

// The background-task tool: its result is a status line and the task's output.
export const taskTitle = args => (args.action === "list" ? "Listed background tasks" : args.action === "stop" ? `Stopped task ${args.id ?? ""}` : `Task ${args.id ?? ""} output`);
export const taskRenderers = rowRenderers({ name: "plugin", title: taskTitle });
export function orchestrateTitle(args, workflow) {
  if (args.action) return `${{ status: "Checked workflow", result: "Read workflow result", stop: "Stop workflow" }[args.action] ?? `Workflow ${args.action}`} ${workflow?.title || args.id || ""}`.trimEnd();
  const title = workflow?.title || args.title;
  if (!workflow || workflow.status === "running") return `Started workflow${title ? ` ${shortTitle(title)}` : ""}`;
  return `Orchestrated ${shortTitle(title || "workflow")}`;
}
export const orchestrateRenderers = rowRenderers({ name: "orchestrate", title: (args, { workflow }) => orchestrateTitle(args, workflow) });

export function orchestrateCompletionLines(data, theme) {
  const workflow = data.details.workflow;
  return [`${glyph(theme, { isError: data.isError || workflow.status !== "completed" })} ${theme.fg("toolTitle", `Orchestrated ${shortTitle(workflow.title)}`)}`,
    ...rowLines("orchestrate", data, { isError: data.isError || workflow.status !== "completed" }, theme)];
}

// Pending results carry the assembled draft; call arguments may contain only edits.
export const planRenderers = {
  renderShell: "self",
  renderCall(args, theme, context) {
    const container = new Container();
    container.addChild(new Text(`${glyph(theme, context)} ${theme.fg("toolTitle", args?.action === "read" ? "Read plan" : "Plan approval")}`, 0, 0));
    return container;
  },
  renderResult(result, options, theme, context) {
    if (context.isError) return new Text(rowLines("plugin", result, { isError: true }, theme).join("\n"), 0, 0);
    const plan = result.details?.plan ?? context.args?.plan;
    if (result.details?.action === "read") {
      const revision = result.details.revision;
      const container = new Container();
      container.addChild(new Text(indent(theme.fg("muted", `${SUB} ${revision == null ? "no plan" : `revision ${revision}`}`)), 0, 0));
      if (options.expanded && plan) container.addChild(new Markdown(plan, PAD.length, 0, getMarkdownTheme()));
      return container;
    }
    if (options.isPartial && result.details?.decision === "pending") return new Markdown(plan ?? "", PAD.length, 0, getMarkdownTheme());
    // Persisted results from before structured decisions have only result text.
    const status = {
      pending: ["warning", "draft"],
      approved: ["success", "approved"],
      revision_requested: ["warning", "revision requested"],
      cancelled: ["warning", "cancelled"],
    }[result.details?.decision] ?? (/approved;/.test(resultText(result)) ? ["success", "approved"] : ["warning", "not approved"]);
    const container = new Container();
    container.addChild(new Text(indent(`${theme.fg("muted", SUB)} ${theme.fg(status[0], status[1])}`), 0, 0));
    if (options.expanded && plan) container.addChild(new Markdown(plan, PAD.length, 0, getMarkdownTheme()));
    return container;
  },
};

// Assistant text gets the bullet as a plain prefix (pi-tui's list marker is a
// fixed dash, so a list item would not give this glyph). A leading heading
// rides the bullet line as bold, the way Claude Code shows headings; any other
// block-level start keeps its syntax by taking the bullet as the paragraph
// before it (lists, fences, quotes and tables all interrupt that paragraph, so
// no blank line is needed between them).
export function bulletMarkdown(markdown, { messageType }, palette) {
  // A sent message opens with the composer's glyph at the same column: pi's
  // user box renders its content at outputPad, which is 0. The glyph takes the
  // box's own colour rather than the accent — the box colours its content
  // through one function, so the skill command's and each keyword's inner
  // colour must explicitly restore the user foreground after it.
  if (messageType === "user") {
    if (!markdown.trim()) return markdown;
    const body = markdown.trimStart();
    const mark = text => highlightProse(palette, text, "userMessageText");
    const skill = palette && body.match(/^(\/skill:[^\s]+)(?=\s|$)/);
    if (skill) return `${PROMPT} ${palette.fg("accent", skill[1])}${palette.fg("userMessageText", mark(body.slice(skill[1].length)))}`;
    if (/^(```|~~~)/.test(body)) return `${PROMPT}\n${mark(body)}`;
    return `${PROMPT} ${mark(body)}`;
  }
  if (messageType !== "assistant") return markdown;
  const body = commandMarkdown(markdown.trimStart(), palette);
  if (!body) return markdown;
  const [first, ...rest] = body.split("\n");
  const heading = first.match(/^#{1,6}\s+(.*?)\s*$/);
  if (heading) return [`${BULLET} **${heading[1]}**`, ...(rest[0]?.trim() ? [""] : []), ...rest].join("\n");
  return /^(```|~~~|>|[-*+]\s|\d+[.)]\s|\|)/.test(markdown.trimStart()) ? `${BULLET}\n${body}` : `${BULLET} ${body}`;
}

// pi's assistant component draws reasoning as a clickable block (or its label)
// and spaces the message from it, so every draw — construction, streaming,
// history and invalidate all pass through updateContent — takes a copy without
// the thinking blocks. The message itself, and so model context and the
// session file, keep them. pi spaces two text blocks of one message apart only
// after a thinking run between them, so with the run gone each text block that
// follows another gets that blank line back (rule 8; docs/pi-coupling.md).
const REASONING_HIDDEN = Symbol.for("pi-workflow:reasoning-hidden");
export function installReasoningHide(AssistantMessage = AssistantMessageComponent, palette) {
  const prototype = AssistantMessage.prototype;
  if (prototype.updateContent[REASONING_HIDDEN]) {
    if (palette) prototype.updateContent.palette = palette;
    return;
  }
  const original = prototype.updateContent;
  // Pi retains positional Markdown slots and the theme captured at construction.
  const forwardingPalette = { fg: (color, text) => {
    const current = typeof hidden.palette === "function" ? hidden.palette() : hidden.palette;
    return current ? current.fg(color, text) : text;
  } };
  const hidden = function (message, ...rest) {
    const markdownTheme = this.markdownTheme;
    let drawn;
    try {
      this.markdownTheme = commandMarkdownTheme(markdownTheme, forwardingPalette);
      drawn = original.call(this, { ...message, content: message.content.filter(block => block.type !== "thinking") }, ...rest);
    } finally {
      this.markdownTheme = markdownTheme;
    }
    // By class name: pi-coding-agent may resolve its own pi-tui copy, so `instanceof` can miss.
    const text = child => child?.constructor.name === "Markdown";
    const children = this.contentContainer.children;
    for (let i = children.length - 1; i > 0; i--) if (text(children[i]) && text(children[i - 1])) children.splice(i, 0, new Spacer(1));
    return drawn;
  };
  hidden.palette = palette;
  hidden[REASONING_HIDDEN] = true;
  prototype.updateContent = hidden;
}

export function answerLines(answers, theme) {
  const head = `${theme.fg("success", BULLET)} ${theme.fg("toolTitle", `User answered pi's ${answers.length === 1 ? "question" : "questions"}`)}`;
  const line = (label, text) => indent(`${theme.fg("muted", SUB)} ${label} ${theme.fg("muted", "→")} ${text}`);
  return [head, ...answers.map(({ question, answer, notes }) => line(question, [answer, notes].filter(Boolean).join(" — ")))];
}

// One line when an async child ends; pi-subagents' own notice shows only for
// failures, so this is the transcript's record of a finished child and of how
// long it took.
export function completionLine({ agent, task, status, durationMs }, theme) {
  const ok = status === "completed";
  const title = `${agent} ${ok ? "finished" : status}`;
  const tail = [task && shortTitle(task, SUMMARY_WIDTH), durationText(durationMs)].filter(Boolean).map(part => ` · ${part}`).join("");
  return `${theme.fg(statusTone(status), BULLET)} ${theme.fg("toolTitle", title)}${tail ? theme.fg("muted", tail) : ""}`;
}

// Successful completion entries use distinct count keys from launches while
// carrying completionLine's shape for both their plain row and group member.
export const DONE = {
  "workflow-child": { key: "agentDone", line: data => data },
  "workflow-task": { key: "taskDone", line: data => ({ agent: `task ${data.id}`, task: data.command, status: data.status, durationMs: data.durationMs }) },
};

// Every completion retains a component: pending tools can later fail and
// expose it, or succeed and hand ownership to the group's first fact.
class ActivityEntryComponent extends Text {
  constructor(folds, seq, mapped, theme) {
    super("", 0, 0);
    this.folds = folds;
    this.seq = seq;
    this.mapped = mapped;
    this.theme = theme;
  }
  invalidate() {
    super.invalidate();
    this.groupComponent?.invalidate();
  }
  lines() {
    const group = doneGroup(this.folds, this.seq);
    if (!group) return [completionLine(this.mapped, this.theme)];
    const toolsExpanded = this.folds.toolsExpanded();
    const state = view(this.folds, group);
    const own = [completionLine(this.mapped, this.theme)];
    return groupLines(this.folds, group, { first: group.entries[0].id === this.seq, expanded: toolsExpanded, state, own }, this.theme);
  }
  render(width) {
    const group = doneGroup(this.folds, this.seq);
    if (group?.entries[0].id === this.seq) {
      this.groupComponent = groupComponent(this.folds, group, [completionLine(this.mapped, this.theme)], this.theme, this.groupComponent);
      return this.groupComponent.render(width);
    }
    this.groupComponent = null;
    this.setText(this.lines().join("\n"));
    return super.render(width);
  }
  handleMouse(event) {
    if (this.groupComponent) return this.groupComponent.handleMouse(event);
    if (doneGroup(this.folds, this.seq) && event.type === "click" && event.button === "left") return { handled: true };
    return undefined;
  }
}

// A resumed/foreign completion has no fact and draws as a plain line.
export function doneEntryRenderer(type, folds = defaultFolds) {
  const map = DONE[type].line;
  return (entry, _options, theme) => {
    const seq = entry.data.seq;
    if (seq == null || folds.facts.get(seq)?.source !== "completion") return new Text(completionLine(map(entry.data), theme), 0, 0);
    return new ActivityEntryComponent(folds, seq, map(entry.data), theme);
  };
}

// Native custom entries unconditionally prepend a spacer. Only owned activity
// hosts suppress spacer-only output after the native render, preserving its
// mouse layout and following expansion/invalidate rebuilds without a second render.
const ACTIVITY_ENTRIES = Symbol.for("pi-workflow:activity-entries");
export function installActivityEntries(Mode = InteractiveMode) {
  const prototype = Mode.prototype;
  if (prototype.addCustomEntryToChat[ACTIVITY_ENTRIES]) return;
  const original = prototype.addCustomEntryToChat;
  const wrapped = function (entry, ...args) {
    if (!Object.hasOwn(DONE, entry.customType)) return original.call(this, entry, ...args);
    const before = new Set(this.chatContainer.children);
    const result = original.call(this, entry, ...args);
    const host = this.chatContainer.children.find(child => !before.has(child));
    if (host) {
      const render = host.render;
      host.render = function (width) {
        const lines = render.call(this, width);
        return lines.length > 1 ? lines : [];
      };
    }
    return result;
  };
  wrapped[ACTIVITY_ENTRIES] = true;
  prototype.addCustomEntryToChat = wrapped;
}

const behind = (text, head) => (text.startsWith(head) ? text.slice(head.length).trimStart() : text);

// pi-subagents' control notice carries the run id and the four subagent({…})
// calls the model answers it with; the reader gets the completion line's shape
// instead, and the message's own content reaches the model untouched. Every
// notice is a "needs attention" (idle, supervisor request; there is no
// failure notice). The signal opens by naming the agent and, on the idle
// notice, its state too — both of which the title has said, and the default
// idle signal parenthesizes what is left of it.
export function noticeLine({ agent, message }, theme) {
  const state = "needs attention";
  const reason = behind(behind(oneLine(message), `${agent} `), state);
  const tail = shortTitle(reason.startsWith("(") && reason.endsWith(")") ? reason.slice(1, -1) : reason, SUMMARY_WIDTH);
  return `${theme.fg("warning", BULLET)} ${theme.fg("toolTitle", `${agent} ${state}`)}${tail ? theme.fg("muted", ` · ${tail}`) : ""}`;
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

// Anything the harness says in its own voice: the turn line, a workspace change.
export function noteLine(text, theme) {
  return `${theme.fg("accent", TURN_GLYPH)} ${theme.fg("muted", text)}`;
}

const runningCounts = running => [running.workflows && plural(running.workflows, "workflow"), liveWork(running)].filter(Boolean).join(", ");

// `running` marks a turn the user's typing or an interrupt closed while work
// was still live: its line names that work instead of claiming done. Entries
// from before it existed carry none.
export function formatTurn({ verb, ms, endedAt, aborted, running }, theme) {
  const still = running && `${runningCounts(running)} still running`;
  if (aborted) return noteLine(`Interrupted after ${formatDuration(ms)}${still ? ` · ${still}` : ""}`, theme);
  const tail = still || `done ${new Date(endedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase()}`;
  return noteLine(`${verb} for ${formatDuration(ms)} · ${tail}`, theme);
}

// One turn from agent_start until the footer decides it is over (see
// footer.mjs); start is idempotent so retries and follow-up runs merge. The
// running label sits next to pi's spinner, so it carries no glyph of its own.
export function createTurnClock(verbs = TURN_VERBS, pick = () => Math.floor(Math.random() * verbs.length)) {
  let startedAt = null;
  let verb = null;
  return {
    start(now = Date.now()) {
      if (startedAt != null) return;
      startedAt = now;
      verb = verbs[pick()];
    },
    running: () => startedAt != null,
    label(now = Date.now()) {
      return startedAt == null ? "" : `${verb[0]}… ${formatDuration(now - startedAt)}`;
    },
    // The root has settled with work live: it names that work, the turn's
    // clock still running. Counts can read zero while a wake is on its way.
    waitingLabel(running, now = Date.now()) {
      if (startedAt == null) return "";
      const work = runningCounts(running);
      return `${work ? `Waiting on ${work}` : verb[0]}… ${formatDuration(now - startedAt)}`;
    },
    stop(now = Date.now(), { aborted = false, running } = {}) {
      if (startedAt == null) return null;
      const turn = { verb: verb[1], ms: now - startedAt, endedAt: now, aborted, ...(running && { running }) };
      startedAt = null;
      return turn;
    },
  };
}
