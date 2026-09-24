import { Container, Markdown, Text, visibleWidth } from "@earendil-works/pi-tui";
import { getMarkdownTheme, renderDiff } from "@earendil-works/pi-coding-agent";

// Transcript glyphs (docs/pi-design.md): one bullet for every row, ↳ for the
// line under a row, π for anything the harness says in its own voice, the
// hollow circle only on fleet rows, a caret for a fold handle's state. A line
// that opens with a glyph starts at column 0; a line without one (↳) sits at
// the text column, and so the caret puts the handle's text there too.
export const BULLET = "•";
export const CHILD = "○";
export const TURN_GLYPH = "π";
export const SUB = "↳";
export const FOLD_OPEN = "▾";
export const FOLD_CLOSED = "▸";
export const PROMPT = "❯";
export const PAD = "  ";
export const TITLE_WIDTH = 36;
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
const indent = line => `${PAD}${line}`;
export const oneLine = text => (text ?? "").replace(/\s+/g, " ").trim();

// The editor's fake cursor ends in a full SGR reset, which also drops the
// background and any foreground the caller painted; re-open both after every
// reset so the shade and the text colour span the line.
export function shade(theme, line, background = "userMessageBg", foreground) {
  const open = theme.bg(background, "").replace(/\x1b\[49m$/, "") + (foreground ? theme.fg(foreground, "").replace(/\x1b\[39m$/, "") : "");
  return theme.bg(background, line.replaceAll("\x1b[0m", `\x1b[0m${open}`));
}

// Pads a rendered line to a fixed visible width; shared by the blocks that
// shade whole rows without truncating them (the user-message replay, the `!`
// row). The composer pads its own rows with `padRow` (index.mjs), which
// truncates instead — the two are not the same function.
export const pad = (text, width) => text + " ".repeat(Math.max(0, width - visibleWidth(text)));

// The one rule every slot dialog frames itself with (docs/pi-design.md rule
// 11), and the peek's fixed height (rule 6, 2026-09-23, slot): half the
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
    case "read": return `Read ${args.path ?? ""}${args.offset ? `:${args.offset}` : ""}`;
    case "edit": return `Edited ${args.path ?? ""}`;
    case "write": return `Wrote ${args.path ?? ""}`;
    case "grep": return `Search "${args.pattern ?? ""}"${where}`;
    case "find": return `Find ${args.pattern ?? ""}${where}`;
    case "ls": return `List ${args.path ?? "."}`;
    default: return name;
  }
}

// Plugin rows: pi-mcp-adapter's direct tools are `mcp__<server>_<tool>` and its
// proxy takes the same server-prefixed name in `tool`; pi-subagents' launch
// carries `agent` and `task`, its other actions an `action`. Any other plugin
// tool (bg_wait, the supervisor channel) is its name and first string argument.
const mcpName = (raw, servers) => {
  const server = servers.filter(s => raw.startsWith(`${s}_`)).sort((a, b) => b.length - a.length)[0];
  return server ? `${server} › ${raw.slice(server.length + 1)}` : raw.replace("_", " › ");
};
const preview = args => {
  const value = Object.values(args ?? {}).find(v => typeof v === "string" && v.trim());
  return value ? ` "${shortTitle(value, PREVIEW_WIDTH)}"` : "";
};

export function pluginTitle(name, args = {}, servers = []) {
  if (name === "subagent") {
    if (args.action) return `subagent ${args.action}${args.id ? ` ${args.id}` : ""}`;
    const task = shortTitle(args.task, PREVIEW_WIDTH);
    return `${args.agent ?? "subagent"}${task ? ` › ${task}` : ""}`;
  }
  if (name === "mcp") {
    if (args.tool) return `${mcpName(args.tool, servers)}${preview(args.args)}`;
    if (args.search) return `mcp search "${shortTitle(args.search, PREVIEW_WIDTH)}"`;
    if (args.describe) return `mcp describe ${args.describe}`;
    return "mcp";
  }
  if (name.startsWith("mcp__")) return `${mcpName(name.slice("mcp__".length), servers)}${preview(args)}`;
  if (name === "web_search") return `Searched "${shortTitle(args.query ?? "", PREVIEW_WIDTH)}"`;
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
  const text = resultText(result);
  if (name === "grep") return plural(text.split("\n").filter(line => /^[^:\n]+:\d+: /.test(line)).length, "match", "matches");
  if (name === "find" || name === "ls") return !text || /^No /.test(text) ? "" : plural(nonEmpty(text).length, "entry", "entries");
  if (text) return plural(text.split("\n").length, "line");
  return name === "read" ? "" : "no output";
}

// Everything waits for ctrl+o except errors, which show head and tail with
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
  if (!expanded) return [];
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

// The lines a row's result draws: the summary line first when there is one,
// then the body, each indented to the text column.
export function rowLines(name, result, { expanded = false, isError = false } = {}, theme) {
  const lines = [];
  const summary = isError ? "" : resultSummary(name, result);
  if (summary) lines.push(summaryLine(name, summary, theme));
  for (const line of bodyLines(name, result, { expanded, isError })) {
    if (isError && ELIDED.test(line)) lines.push(theme.fg("muted", line));
    else lines.push(name === "edit" && !isError ? line : theme.fg(isError ? "error" : "toolOutput", line));
  }
  return lines.map(indent);
}

function renderBody(name, result, options, theme, context) {
  return new Text(rowLines(name, result, { expanded: options.expanded, isError: context.isError }, theme).join("\n"), 0, 0);
}

// Grouping, as Claude Code does it: successful activity facts between two
// things that stay visible form one chronological group, which collapses to a
// count sentence ("Read 3 files, launched 2 agents"); clicking it restores the
// member ladder and ctrl+o restores full tool output. State is per process — a
// resumed session renders its old rows and completions unfolded.
//
// The extent is derived, never edited (docs/pi-design.md rule 2, 2026-09-10).
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
  mcp: ["called", "MCP tool"],
  web: ["ran", "web search", "web searches"],
  discovery: ["ran", "agent discovery", "agent discoveries"],
  agent: ["launched", "agent"],
  steer: ["steered", "agent"],
  check: ["checked on", "agent"],
  stop: ["stopped", "agent"],
  interrupt: ["interrupted", "agent"],
  task: ["started", "background command"],
  agentDone: ["finished", "agent"],
  taskDone: ["finished", "background task"],
};
const countKey = tool => (tool === "find" || tool === "ls" ? "list" : tool);
const isMcp = name => name === "mcp" || name.startsWith("mcp__");
// Subagent management calls are transcript housekeeping and group like any
// other activity fact: launch, list discovery, steer, status check, stop and
// interrupt. `workspace_task` and `bg_wait` stay out as visible boundary
// rows: each is a blocking wait on running work whose own sentence is the
// information.
const SUBAGENT_ACTIONS = { list: "discovery", steer: "steer", status: "check", stop: "stop", interrupt: "interrupt" };
// Every subagent fold but discovery carries no summary worth a member line.
const NO_SUMMARY = new Set(["agent", ...Object.values(SUBAGENT_ACTIONS).filter(key => key !== "discovery")]);
export const foldKey = (name, args = {}) => {
  if (name === "subagent") {
    if (args.agent && args.task) return "agent";
    return SUBAGENT_ACTIONS[args.action] ?? null;
  }
  if (name === "web_search" || name === "url_context") return "web";
  return name.startsWith("workspace_") && name !== "workspace_task" ? name.slice("workspace_".length) : isMcp(name) ? "mcp" : null;
};

// One row behind one header line hides nothing and draws a caret over content
// that is not there, so a run needs two rows to be worth a handle.
const MIN_RUN = 2;

// `toolsExpanded` reads pi's global ctrl+o flag (ctx.ui.getToolsExpanded);
// a sealed group reopens when that flag changes. `nonce` marks this
// process's own completion seqs apart from another process sharing the same
// session file (rule 4); `repaint` is unset until `setRepaint` wires it to
// the TUI, since completion rows have no per-entry invalidate of their own.
// `quiet` skips the before/after diff a bulk replay has no components to
// invalidate for (the fleet peek, see `refold`).
export function createFolds(toolsExpanded = () => undefined, { quiet = false } = {}) {
  return { timeline: [], invalidate: new Map(), titles: new Map(), views: new Map(), revision: 0, derived: null, boundaries: 0, toolsExpanded, repaint: () => {}, nonce: Math.random().toString(36).slice(2, 8), doneSeq: 0, quiet };
}
export const defaultFolds = createFolds();
export function setRepaint(folds, repaint) {
  folds.repaint = repaint;
}
const nextSeq = folds => `${folds.nonce}-${++folds.doneSeq}`;

// `tool` is the fact's own name before `countKey` folds `find`/`ls` into
// `list` — `settleFold` needs that name back to compute the fact's summary.
export function addFold(folds, id, tool) {
  refold(folds, () => {
    folds.timeline.push({ kind: "activity", source: "tool", id, key: countKey(tool), tool, outcome: "pending" });
    folds.revision += 1;
  });
}

// A backgrounded bash call is keyed `bash` at `addFold`, before anyone knows
// whether it will finish inside its grace period; a result carrying
// `details.taskId` means it outlived that period and became a running task, so
// the fact re-keys to `task` here. Re-keying before the run can seal is safe: a
// pending fact already holds its whole run back (see `derive`). A success also
// records its summary for the group's member line.
export function settleFold(folds, id, failed, result) {
  const fact = folds.timeline.find(entry => entry.kind === "activity" && entry.source === "tool" && entry.id === id);
  if (!fact || fact.outcome !== "pending") return;
  refold(folds, () => {
    fact.outcome = failed ? "failed" : "success";
    if (fact.key === "bash" && result?.details?.taskId) fact.key = "task";
    if (!failed) fact.summary = NO_SUMMARY.has(fact.key) ? "" : resultSummary(fact.tool, result);
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

const tally = entries => {
  const counts = {};
  for (const entry of entries) counts[entry.key] = (counts[entry.key] ?? 0) + 1;
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
  const afterIds = new Set([...derivedAfter.byId.keys(), ...derivedAfter.liveById.keys()]);
  let repaint = false;
  for (const id of new Set([...beforeIds, ...afterIds])) {
    if (signature(before.get(id)) === signature(groupFor(derivedAfter, id))) continue;
    const fact = folds.timeline.find(entry => entry.kind === "activity" && entry.id === id);
    if (fact?.source === "completion") repaint = true;
    else folds.invalidate.get(id)?.();
  }
  if (repaint) folds.repaint();
}

// Appending an entry is what draws its line, so visible non-activity entries
// carry their own boundary. A successful child/task completion instead appends
// one activity fact and can extend the same chronological group as tool rows.
//
// Custom-entry renderers must decide once whether an entry has a component. If
// a completion lands behind a pending tool, that tool's later failure could
// otherwise turn a hidden completion into a standalone row. Preserve the old
// boundary at that unresolved event-order edge; once the pending call settles,
// later successes can form the next group without ever dropping the completion.
const tailHasPending = folds => {
  for (let i = folds.timeline.length - 1; i >= 0; i--) {
    const fact = folds.timeline[i];
    if (fact.kind === "boundary" || fact.outcome === "failed") return false;
    if (fact.outcome === "pending") return true;
  }
  return false;
};

export function appendVisible(pi, type, data, folds = defaultFolds) {
  const done = data.status === "completed" && DONE[type];
  if (done) {
    if (tailHasPending(folds)) closeFolds(folds);
    data.seq = nextSeq(folds);
    refold(folds, () => {
      folds.timeline.push({ kind: "activity", source: "completion", outcome: "success", id: data.seq, key: done.key, data: done.line(data) });
      folds.revision += 1;
    });
  } else closeFolds(folds);
  pi.appendEntry(type, data);
}

export function summarise(counts) {
  const text = Object.entries(WORDS).filter(([key]) => counts[key]).map(([key, [verb, noun, nouns]]) => `${verb} ${plural(counts[key], noun, nouns)}`).join(", ");
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

const speaks = event => event.message?.role === "assistant" && (event.message.content ?? []).some(c => c.type === "text" && c.text?.trim());
// A visible custom message — pi-subagents' control notice, and anything else a
// plugin displays — is a transcript line like any other. `message_end` is where
// the session appends it (`_appendCustomMessage`, which the deferred flush also
// goes through), so the boundary lands at its position rather than at the
// enqueue that can precede it.
const displays = event => Boolean(event.message?.customType) && Boolean(event.message.display);

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
    const key = foldKey(event.toolName, event.args);
    if (key) addFold(folds, event.toolCallId, key);
    else closeFolds(folds);
  });
  // The adapter reports some failures in `details.error` without `isError`.
  pi.on("tool_execution_end", event => settleFold(folds, event.toolCallId, Boolean(event.isError || event.result?.details?.error), event.result));
  pi.on("agent_start", () => closeFolds(folds));
  pi.on("input", event => {
    if (event.source !== "extension") closeLive(folds);
    return { action: "continue" };
  });
  // Streaming replies announce their text in updates; non-streaming ones only at the end.
  pi.on("message_update", event => { if (speaks(event)) closeFolds(folds); });
  pi.on("message_end", event => { if (speaks(event) || displays(event)) closeFolds(folds); });
}

// The group's first row draws the summary line whether the group is open or
// closed, so the handle never moves. The handle answers its own clicks (pi's
// MouseRegion asks the child before its own toggle), so a row's `expanded`
// flag only ever expands its body. The handle toggles its own group between
// the sentence and its members; ctrl+o outranks it — a group renders in full
// while the flag is on, and a click then has nothing to change, so a group
// clicked open against the flag still follows the flag once it drops.
class FoldHandle extends Text {
  constructor(text, toggle) {
    super(text, 0, 0);
    this.toggle = toggle;
  }
  handleMouse(event) {
    if (event.type !== "click" || event.button !== "left" || event.y !== 0) return undefined;
    this.toggle();
    return { handled: true };
  }
}

// Open/closed lives under the run's boundary id rather than on the run itself,
// so a re-derivation hands the same state back to the same group.
function view(folds, group) {
  let state = folds.views.get(group.boundaryId);
  if (!state) {
    // A group that seals while ctrl+o is on joins it: it records the flag as
    // already seen, so the render's transition guard would never fire for it.
    const expandedAt = folds.toolsExpanded();
    state = { open: expandedAt === true, expandedAt };
    folds.views.set(group.boundaryId, state);
  }
  return state;
}

// The caret is the handle's state (docs/pi-design.md rule 2). It sits in the
// dot column so the handle lines up with the rows it owns, and the text undims
// when open so a stacked run of groups shows which one is expanded. Takes the
// sentence text rather than a group, so a completion's own wording (rule 4)
// draws through the same handle as a tool group's.
export const handleLine = (text, state, theme) =>
  theme.fg(state.open ? "toolTitle" : "muted", `${state.open ? FOLD_OPEN : FOLD_CLOSED} ${text}`);

function toggleFold(folds, group, rendering) {
  const state = view(folds, group);
  state.open = !state.open;
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

export function memberLine(folds, entry, theme) {
  if (entry.source === "completion") return completionMemberLine(entry, theme);
  const title = theme.fg("toolTitle", folds.titles.get(entry.id));
  const summary = entry.summary ?? "";
  if (!summary) return indent(`${theme.fg("muted", SUB)} ${title}`);
  const isDiff = (entry.tool === "edit" || entry.tool === "write") && summary.split(" ").length === 2;
  const tail = `${theme.fg("muted", " · ")}${isDiff ? paintCounts(summary, theme) : theme.fg("muted", summary)}`;
  return indent(`${theme.fg("muted", SUB)} ${title}${tail}`);
}

// Under ctrl+o, each tool result carries only the completions immediately
// after it; a completion-led group carries only its leading completions.
// Hidden custom entries cannot reappear, so these existing slots preserve order.
function completionMemberLines(group, theme, after) {
  const lines = [];
  const start = after === undefined ? 0 : group.entries.findIndex(entry => entry.id === after) + 1;
  for (const entry of group.entries.slice(start)) {
    if (entry.source !== "completion") break;
    lines.push(completionMemberLine(entry, theme));
  }
  return lines;
}

function withFollowingCompletions(body, folds, id, theme) {
  const group = folds.toolsExpanded() && (foldGroup(folds, id) ?? liveGroup(folds, id));
  const lines = group ? completionMemberLines(group, theme, id) : [];
  if (!lines.length) return body;
  const block = new Container();
  block.addChild(body);
  block.addChild(new Text(lines.join("\n"), 0, 0));
  return block;
}

// Below output level a member's own result slot draws nothing: the group's
// first row speaks for it from its call slot.
const hidden = (folds, id) => !folds.toolsExpanded() && Boolean(foldGroup(folds, id) ?? liveGroup(folds, id));

// A row is `glyph title` and one ↳ line; a group renders at one of three
// levels (docs/pi-design.md rule 2): members — the sentence and one `↳` line
// per row — while it is live or clicked open; the sentence alone once sealed;
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
      const rowTitle = title(args);
      folds.titles.set(id, rowTitle);
      const line = `${glyph(theme, context)} ${theme.fg("toolTitle", rowTitle)}`;
      const group = foldGroup(folds, id);
      if (group) {
        const state = view(folds, group);
        const first = group.entries[0].id === id;
        const toolsExpanded = folds.toolsExpanded();
        if (toolsExpanded !== state.expandedAt) {
          state.expandedAt = toolsExpanded;
          if (state.open !== toolsExpanded) toggleFold(folds, group, id);
        }
        const toggle = () => { if (!folds.toolsExpanded()) toggleFold(folds, group); };
        if (toolsExpanded) {
          const lines = [];
          if (first) lines.push(handleLine(summarise(group.counts), state, theme));
          lines.push(line);
          return first ? new FoldHandle(lines.join("\n"), toggle) : new Text(lines.join("\n"), 0, 0);
        }
        if (!first) return new Text("", 0, 0);
        const lines = [handleLine(summarise(group.counts), state, theme)];
        if (state.open) for (const entry of group.entries) lines.push(memberLine(folds, entry, theme));
        return new FoldHandle(lines.join("\n"), toggle);
      }
      const live = liveGroup(folds, id);
      if (live) {
        const first = live.entries[0].id === id;
        if (folds.toolsExpanded()) {
          if (!first) return new Text(line, 0, 0);
          return new Text(line, 0, 0);
        }
        if (!first) return new Text("", 0, 0);
        const lines = [`${theme.fg("success", BULLET)} ${theme.fg("toolTitle", summarise(live.counts))}`, ...live.entries.map(entry => memberLine(folds, entry, theme))];
        return new Text(lines.join("\n"), 0, 0);
      }
      return new Text(line, 0, 0);
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
      const context = status(rawContext);
      if (hidden(folds, context.toolCallId)) return new Text("", 0, 0);
      return withFollowingCompletions(renderBody(name, result, options, theme, context), folds, context.toolCallId, theme);
    },
  };
}

export function toolRenderers(name, folds = defaultFolds) {
  return rowRenderers({ name, title: args => callTitle(name, args), folds });
}

// pi-mcp-adapter reports init, auth and server failures in details.error
// without isError; a subagent launch answers with its run id and finishes
// later.
export function pluginRenderers(name, { servers = [], folds = defaultFolds } = {}) {
  const subagent = name === "subagent";
  const renderers = rowRenderers({
    name: subagent ? "subagent" : isMcp(name) ? "mcp" : "plugin",
    title: args => pluginTitle(name, args, servers),
    folds,
    failed: (result, context) => context.isError || Boolean(result?.details?.error),
  });
  if (!subagent) return renderers;
  return {
    ...renderers,
    renderResult(result, options, theme, context) {
      if (hidden(folds, context.toolCallId)) return new Text("", 0, 0);
      if (result?.details?.asyncId && !context.isError) return withFollowingCompletions(new Text(indent(theme.fg("muted", `${SUB} launched`)), 0, 0), folds, context.toolCallId, theme);
      return renderers.renderResult(result, options, theme, context);
    },
  };
}

// The background-task tool: its result is a status line and the task's output.
export const taskTitle = args => (args.action === "stop" ? `Stopped task ${args.id ?? ""}` : `Task ${args.id ?? ""} output`);
export const taskRenderers = rowRenderers({ name: "plugin", title: taskTitle });

// The plan reads as chat, not as a dialog: pi's `confirm` folds its second
// argument into the selector's title, which renders bold accent with no
// markdown and no scroll, so the plan lands in the transcript instead and the
// dialog asks only the question. It is visible while the decision is open —
// nobody can approve what they cannot see — and `isPartial` retires it the
// moment a result lands, after which `expanded` governs it as it governs every
// other body: pi holds that flag until `updateResult`, which re-runs this slot,
// and the glyph above already reads it as the row's settled state. The window
// opens at `executionStarted`, which is the call's own turn rather than the
// batch's: `argsComplete` fires at `message_end` for every call queued behind
// this one, so gating on it would draw a plan before its dialog and strand the
// body of a plan whose batch aborted before reaching it. It is also never set on
// a non-streaming reply, where pi builds the row at `tool_execution_start` from
// arguments that are already whole.
export const planRenderers = {
  renderShell: "self",
  renderCall(args, theme, context) {
    const container = new Container();
    container.addChild(new Text(`${glyph(theme, context)} ${theme.fg("toolTitle", "Plan approval")}`, 0, 0));
    if (context.executionStarted && context.isPartial && args?.plan) container.addChild(new Markdown(args.plan, PAD.length, 0, getMarkdownTheme()));
    return container;
  },
  renderResult(result, options, theme, context) {
    // Persisted results from before structured decisions have only result text.
    const status = {
      approved: ["success", "approved"],
      revision_requested: ["warning", "revision requested"],
      cancelled: ["warning", "cancelled"],
    }[result.details?.decision] ?? (/approved;/.test(resultText(result)) ? ["success", "approved"] : ["warning", "not approved"]);
    const container = new Container();
    container.addChild(new Text(indent(`${theme.fg("muted", SUB)} ${theme.fg(status[0], status[1])}`), 0, 0));
    if (options.expanded && context.args?.plan) container.addChild(new Markdown(context.args.plan, PAD.length, 0, getMarkdownTheme()));
    return container;
  },
};

// Assistant text gets the bullet as a plain prefix (pi-tui's list marker is a
// fixed dash, so a list item would not give this glyph). A leading heading
// rides the bullet line as bold, the way Claude Code shows headings; any other
// block-level start keeps its syntax by taking the bullet as the paragraph
// before it (lists, fences, quotes and tables all interrupt that paragraph, so
// no blank line is needed between them). Reasoning renders as nothing at all:
// pi's own hidden-thinking label is wrapped in colour codes, so even an empty
// label leaves an invisible, clickable line.
export function bulletMarkdown(markdown, { messageType }, palette) {
  if (messageType === "assistant-thinking") return "";
  // A sent message opens with the composer's glyph at the same column: pi's
  // user box renders its content at outputPad, which is 0. The glyph takes the
  // box's own colour rather than the accent — the box colours its content
  // through one function, so the skill command's inner colour must explicitly
  // restore the user foreground for its arguments.
  if (messageType === "user") {
    if (!markdown.trim()) return markdown;
    const body = markdown.trimStart();
    const skill = palette && body.match(/^(\/skill:[^\s]+)(?=\s|$)/);
    if (skill) return `${PROMPT} ${palette.fg("accent", skill[1])}${palette.fg("userMessageText", body.slice(skill[1].length))}`;
    return `${PROMPT} ${body}`;
  }
  if (messageType !== "assistant") return markdown;
  const body = markdown.trimStart();
  if (!body) return markdown;
  const [first, ...rest] = body.split("\n");
  const heading = first.match(/^#{1,6}\s+(.*?)\s*$/);
  if (heading) return [`${BULLET} **${heading[1]}**`, ...(rest[0]?.trim() ? [""] : []), ...rest].join("\n");
  return /^(```|~~~|>|[-*+]\s|\d+[.)]\s|\|)/.test(body) ? `${BULLET}\n${body}` : `${BULLET} ${body}`;
}

// pi's assistant component adds a blank line for any message whose raw content
// carries reasoning, before any display hook runs (earendil-works/pi#8154), so
// a folded run stacks one blank per hidden reasoning block. These APIs replay
// reasoning from the opaque item alone (`JSON.parse(block.thinkingSignature)`
// in pi-ai's openai-responses-shared) and never send the text, so the same
// model loses nothing. The one cost is a change of model identity — pi's
// `transformMessages` keeps a signed block only when provider, api and model id
// all match, forwards the reasoning as plain text otherwise, and drops the block
// once that text is empty, so those summaries stop reaching the new model. Only
// the model id can change under the managed roster, which fixes the provider and
// validates the id in `before_agent_start`. Anthropic replays the text with its
// signature and rejects a modified block, hence the gate.
const OPAQUE_REASONING_APIS = new Set(["openai-responses", "azure-openai-responses", "openai-codex-responses"]);
export function blankReasoning(message) {
  if (message?.role !== "assistant" || !OPAQUE_REASONING_APIS.has(message.api)) return undefined;
  let blanked = false;
  for (const block of message.content ?? []) {
    if (block.type !== "thinking" || !block.thinkingSignature || !block.thinking) continue;
    // Mutated in place: pi's replacement copies onto this same object, and the
    // stream's signature backfill still holds the block by reference.
    block.thinking = "";
    blanked = true;
  }
  return blanked ? message : undefined;
}

// The streaming component spaces from raw reasoning too. The update event's
// message is a per-event shallow copy that pi hands to extensions before the
// UI, so swapping its content array changes only what is drawn — the provider
// is still appending to the original blocks, hence copies, not mutation. No
// signature check: a block is unsigned until it ends. Same API gate as
// blankReasoning so streaming matches the settled message.
export function hideStreamingReasoning(message) {
  if (message?.role !== "assistant" || !OPAQUE_REASONING_APIS.has(message.api)) return;
  if (!message.content?.some(block => block.type === "thinking" && block.thinking)) return;
  message.content = message.content.map(block => (block.type === "thinking" && block.thinking ? { ...block, thinking: "" } : block));
}

export function answerLines(answers, theme) {
  const head = `${theme.fg("success", BULLET)} ${theme.fg("toolTitle", `User answered pi's ${answers.length === 1 ? "question" : "questions"}`)}`;
  const line = (label, text) => indent(`${theme.fg("muted", SUB)} ${label} ${theme.fg("muted", "→")} ${text}`);
  return [head, ...answers.map(({ question, answer, notes }) => line(question, [answer, notes].filter(Boolean).join(" — ")))];
}

// A duration only ever appears formatted this one way, in a completion's own
// tail or a group member's.
const durationText = durationMs => (typeof durationMs === "number" ? formatDuration(durationMs) : null);

// One line when an async child ends; pi-subagents' own notice shows only for
// failures, so this is the transcript's record of a finished child and of how
// long it took.
export function completionLine({ agent, task, status, durationMs }, theme) {
  const ok = status === "completed";
  const colour = ok ? "success" : status === "failed" || status === "stopped" ? "error" : "warning";
  const title = `${agent} ${ok ? "finished" : status}`;
  const tail = [task && shortTitle(task, SUMMARY_WIDTH), durationText(durationMs)].filter(Boolean).map(part => ` · ${part}`).join("");
  return `${theme.fg(colour, BULLET)} ${theme.fg("toolTitle", title)}${tail ? theme.fg("muted", tail) : ""}`;
}

// Successful completion entries use distinct count keys from launches while
// carrying completionLine's shape for both their plain row and group member.
const DONE = {
  "workflow-child": { key: "agentDone", line: data => data },
  "workflow-task": { key: "taskDone", line: data => ({ agent: `task ${data.id}`, task: data.command, status: data.status, durationMs: data.durationMs }) },
};

// A completion can own a mixed group when it is the first fact. Entry renderers
// have no invalidate handle, so the component re-reads the shared timeline on
// every paint and whole-TUI repaint wakes it when later activity joins. Under
// ctrl+o it keeps leading completion members visible; later completions ride
// the preceding tool's result, after its full output, in chronological order.
class ActivityEntryComponent extends Text {
  constructor(folds, seq, mapped, theme) {
    super("", 0, 0);
    this.folds = folds;
    this.seq = seq;
    this.mapped = mapped;
    this.theme = theme;
  }
  lines() {
    const group = doneGroup(this.folds, this.seq);
    if (!group) return [completionLine(this.mapped, this.theme)];
    const sentence = summarise(group.counts);
    const members = () => group.entries.map(entry => memberLine(this.folds, entry, this.theme));
    const completionMembers = () => completionMemberLines(group, this.theme);
    if (!group.sealed) {
      return [`${this.theme.fg("success", BULLET)} ${this.theme.fg("toolTitle", sentence)}`, ...(this.folds.toolsExpanded() ? completionMembers() : members())];
    }
    const state = view(this.folds, group);
    const toolsExpanded = this.folds.toolsExpanded();
    if (toolsExpanded !== state.expandedAt) {
      state.expandedAt = toolsExpanded;
      state.open = toolsExpanded;
    }
    if (toolsExpanded) return [handleLine(sentence, state, this.theme), ...completionMembers()];
    if (state.open) return [handleLine(sentence, state, this.theme), ...members()];
    return [handleLine(sentence, state, this.theme)];
  }
  render(width) {
    this.text = this.lines().join("\n");
    return super.render(width);
  }
  handleMouse(event) {
    if (event.type !== "click" || event.button !== "left" || event.y !== 0) return undefined;
    const group = doneGroup(this.folds, this.seq);
    if (!group?.sealed || this.folds.toolsExpanded()) return undefined;
    const state = view(this.folds, group);
    state.open = !state.open;
    this.folds.repaint();
    return { handled: true };
  }
}

// A resumed/foreign completion has no fact in this process and always renders
// as a plain line. For live entries, only the group's first fact owns a
// component; returning undefined for later completion members removes their
// host spacer as well as their content.
export function doneEntryRenderer(type, folds = defaultFolds) {
  const map = DONE[type].line;
  return (entry, _options, theme) => {
    const seq = entry.data.seq;
    const fact = seq == null ? null : folds.timeline.find(item => item.kind === "activity" && item.source === "completion" && item.id === seq);
    if (!fact) return new Text(completionLine(map(entry.data), theme), 0, 0);
    const group = doneGroup(folds, seq);
    if (group && group.entries[0].id !== seq) return undefined;
    return new ActivityEntryComponent(folds, seq, map(entry.data), theme);
  };
}

const behind = (text, head) => (text.startsWith(head) ? text.slice(head.length).trimStart() : text);

// pi-subagents' control notice carries the run id and the four subagent({…})
// calls the model answers it with; the reader gets the completion line's shape
// instead, and the message's own content reaches the model untouched. Every
// notice is a "needs attention" (idle, supervisor request; 0.70.1 has no
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

const clockTime = at => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();

// Anything the harness says in its own voice: the turn line, a workspace change.
export function noteLine(text, theme) {
  return `${theme.fg("accent", TURN_GLYPH)} ${theme.fg("muted", text)}`;
}

export function formatTurn({ verb, ms, endedAt, aborted }, theme) {
  return noteLine(aborted ? `Interrupted after ${formatDuration(ms)}` : `${verb} for ${formatDuration(ms)} · done ${clockTime(endedAt)}`, theme);
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
    settledLabel(now = Date.now()) {
      return startedAt == null ? "" : `${verb[1]} for ${formatDuration(now - startedAt)}`;
    },
    stop(now = Date.now(), { aborted = false } = {}) {
      if (startedAt == null) return null;
      const turn = { verb: verb[1], ms: now - startedAt, endedAt: now, aborted };
      startedAt = null;
      return turn;
    },
  };
}
