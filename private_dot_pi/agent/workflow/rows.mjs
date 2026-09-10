import { Container, Markdown, Text } from "@earendil-works/pi-tui";
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

const firstLine = value => String(value ?? "").split("\n")[0];
const resultText = result => {
  const text = (result?.content ?? []).filter(c => c.type === "text").map(c => c.text ?? "").join("\n").trim();
  return text === NO_OUTPUT ? "" : text;
};
const nonEmpty = text => text.split("\n").filter(line => line.trim());
const plural = (n, noun, nouns = `${noun}s`) => `${n} ${n === 1 ? noun : nouns}`;
const indent = line => `${PAD}${line}`;
export const oneLine = text => (text ?? "").replace(/\s+/g, " ").trim();

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

function renderBody(name, result, options, theme, context) {
  const lines = [];
  const summary = context.isError ? "" : resultSummary(name, result);
  if (summary) lines.push(summaryLine(name, summary, theme));
  for (const line of bodyLines(name, result, { expanded: options.expanded, isError: context.isError })) {
    if (context.isError && ELIDED.test(line)) lines.push(theme.fg("muted", line));
    else lines.push(name === "edit" && !context.isError ? line : theme.fg(context.isError ? "error" : "toolOutput", line));
  }
  return new Text(lines.map(indent).join("\n"), 0, 0);
}

// Folding, as Claude Code does it: the workspace and MCP rows between two
// things that stay visible form a group, which collapses to one line
// ("Read 3 files, ran 2 shell commands"); clicking it or ctrl+o brings the rows
// back. State is per process — a resumed session renders its old rows unfolded.
//
// The extent is derived, never edited (docs/pi-design.md rule 2, 2026-09-10).
// The timeline holds ordered facts — one per tool row plus its outcome, one
// boundary per line that stays visible — and a run is read back out of them on
// demand. Three times the extent was maintained by hand and three times a
// producer of a visible line failed to close the group it interrupted; a fact
// that has to be appended for the line to be drawn at all cannot be forgotten
// the same way.
const WORDS = { read: ["read", "file"], bash: ["ran", "shell command"], grep: ["searched for", "pattern"], edit: ["edited", "file"], write: ["wrote", "file"], list: ["listed", "path"], mcp: ["called", "MCP tool"] };
const countKey = tool => (tool === "find" || tool === "ls" ? "list" : tool);
const isMcp = name => name === "mcp" || name.startsWith("mcp__");
// `workspace_task` stays out: a background task is running work (rule 4), its
// output is the thing that was asked for, and its completion line refers back
// to the row's title — the reason rule 2 exempts subagent rows too.
const foldKey = name => (name.startsWith("workspace_") && name !== "workspace_task" ? name.slice("workspace_".length) : isMcp(name) ? "mcp" : null);

// One row behind one header line hides nothing and draws a caret over content
// that is not there, so a run needs two rows to be worth a handle.
const MIN_RUN = 2;

// `toolsExpanded` reads pi's global ctrl+o flag (ctx.ui.getToolsExpanded);
// a sealed group reopens when that flag changes.
export function createFolds(toolsExpanded = () => undefined) {
  return { timeline: [], invalidate: new Map(), views: new Map(), revision: 0, derived: null, boundaries: 0, toolsExpanded };
}
export const defaultFolds = createFolds();

export function addFold(folds, id, tool) {
  refold(folds, () => {
    folds.timeline.push({ kind: "tool", id, key: countKey(tool), outcome: "pending" });
    folds.revision += 1;
  });
}

export function settleFold(folds, id, failed) {
  const fact = folds.timeline.find(entry => entry.kind === "tool" && entry.id === id);
  if (!fact || fact.outcome !== "pending") return;
  refold(folds, () => {
    fact.outcome = failed ? "failed" : "success";
    folds.revision += 1;
  });
}

// Every line that stays visible ends the run above it. Two of them in a row
// need only one boundary — there is no run between them to seal.
export function closeFolds(folds) {
  const last = folds.timeline[folds.timeline.length - 1];
  if (!last || last.kind === "boundary") return;
  refold(folds, () => {
    folds.timeline.push({ kind: "boundary", id: `b${(folds.boundaries += 1)}` });
    folds.revision += 1;
  });
}

const tally = entries => {
  const counts = {};
  for (const entry of entries) counts[entry.key] = (counts[entry.key] ?? 0) + 1;
  return counts;
};

// A run is a maximal stretch of successful foldable rows, every outcome
// settled, with a separator on its right — a failed row is that separator, not
// a member of what it interrupts. Sealed on those terms a run can never need
// splitting: by the time one exists, every fact that could have divided it is
// already in the timeline. It is keyed by that right-hand boundary, the one
// part of it that is fixed from the moment it seals, which is what lets the
// view state below outlive a re-derivation.
function derive(folds) {
  if (folds.derived?.revision === folds.revision) return folds.derived;
  const byId = new Map();
  let run = [];
  let waiting = false;
  const seal = boundaryId => {
    if (!waiting && run.length >= MIN_RUN) {
      const group = { boundaryId, entries: run, counts: tally(run) };
      for (const entry of run) byId.set(entry.id, group);
    }
    run = [];
    waiting = false;
  };
  for (const fact of folds.timeline) {
    if (fact.kind === "boundary") seal(fact.id);
    else if (fact.outcome === "success") run.push(fact);
    else if (fact.outcome === "failed") seal(`failed:${fact.id}`);
    // A pending row holds its whole run back rather than just the rows after it:
    // its outcome decides both whether it is a member and where the run starts,
    // and a run that sealed without it would grow a row and move its handle when
    // it lands.
    else waiting = true;
  }
  folds.derived = { revision: folds.revision, byId };
  return folds.derived;
}

// The read side of the model: which sealed run, if any, owns a row.
export const foldGroup = (folds, id) => derive(folds).byId.get(id) ?? null;
const signature = group => (group ? `${group.boundaryId} ${group.entries.map(entry => entry.id).join(",")}` : "");

// Membership is recomputed rather than edited, so a fact only has to wake the
// rows whose group changed — and the cache is whole before any of them render,
// since pi's invalidate rebuilds a row synchronously. A missed wake leaves a
// stale line; it cannot put a separator inside a group.
function refold(folds, mutate) {
  const before = new Map(derive(folds).byId);
  mutate();
  const after = derive(folds).byId;
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    if (signature(before.get(id)) !== signature(after.get(id))) folds.invalidate.get(id)?.();
  }
}

// Appending the entry is what draws the line, so the boundary rides with it and
// no call site has to remember one. `stability.test.mjs` holds the rest of the
// producers to this path.
export function appendVisible(pi, type, data, folds = defaultFolds) {
  closeFolds(folds);
  pi.appendEntry(type, data);
}

export function summarise(counts) {
  const text = Object.entries(WORDS).filter(([key]) => counts[key]).map(([key, [verb, noun]]) => `${verb} ${plural(counts[key], noun)}`).join(", ");
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

const speaks = event => event.message?.role === "assistant" && (event.message.content ?? []).some(c => c.type === "text" && c.text?.trim());
// A visible custom message — pi-subagents' control notice, and anything else a
// plugin displays — is a transcript line like any other. `message_end` is where
// the session appends it (`_appendCustomMessage`, which the deferred flush also
// goes through), so the boundary lands at its position rather than at the
// enqueue that can precede it.
const displays = event => Boolean(event.message?.customType) && Boolean(event.message.display);

export function installFolding(pi, ctx, folds = defaultFolds) {
  folds.toolsExpanded = () => ctx.ui.getToolsExpanded();
  pi.on("tool_execution_start", event => {
    const key = foldKey(event.toolName);
    if (key) addFold(folds, event.toolCallId, key);
    else closeFolds(folds);
  });
  // The adapter reports some failures in `details.error` without `isError`.
  pi.on("tool_execution_end", event => settleFold(folds, event.toolCallId, Boolean(event.isError || event.result?.details?.error)));
  pi.on("agent_start", () => closeFolds(folds));
  // Streaming replies announce their text in updates; non-streaming ones only at the end.
  pi.on("message_update", event => { if (speaks(event)) closeFolds(folds); });
  pi.on("message_end", event => { if (speaks(event) || displays(event)) closeFolds(folds); });
}

// The group's first row draws the summary line whether the group is open or
// closed, so the handle never moves. The handle answers its own clicks (pi's
// MouseRegion asks the child before its own toggle), so a row's `expanded`
// flag only ever expands its body. The handle toggles its own group; pi's
// global ctrl+o flag drives every group to match it, so a group clicked open
// against the flag follows it again at the next press.
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
// when open so a stacked run of groups shows which one is expanded.
const handleLine = (group, state, theme) =>
  theme.fg(state.open ? "toolTitle" : "muted", `${state.open ? FOLD_OPEN : FOLD_CLOSED} ${summarise(group.counts)}`);

function toggleFold(folds, group, rendering) {
  const state = view(folds, group);
  state.open = !state.open;
  for (const entry of group.entries) if (entry.id !== rendering) folds.invalidate.get(entry.id)?.();
}

// A row is `glyph title` and one ↳ line; a folded row renders nothing while the
// group's first row carries the summary at the text column. A failed row is
// never a member, so it needs no exception here to stay visible.
function rowRenderers({ name, title, folds = defaultFolds, failed = (_result, context) => context.isError }) {
  const status = context => (context.state?.failed ? { ...context, isError: true } : context);
  return {
    renderShell: "self",
    renderCall(args, theme, rawContext) {
      // The first render precedes tool_execution_start, so every render records the invalidator.
      const id = rawContext.toolCallId;
      folds.invalidate.set(id, rawContext.invalidate);
      const context = status(rawContext);
      const line = `${glyph(theme, context)} ${theme.fg("toolTitle", title(args))}`;
      const group = foldGroup(folds, id);
      if (!group) return new Text(line, 0, 0);
      const state = view(folds, group);
      const first = group.entries[0].id === id;
      const toolsExpanded = folds.toolsExpanded();
      if (toolsExpanded !== state.expandedAt) {
        state.expandedAt = toolsExpanded;
        if (state.open !== toolsExpanded) toggleFold(folds, group, id);
      }
      const lines = [];
      if (first) lines.push(handleLine(group, state, theme));
      if (state.open) lines.push(line);
      return first ? new FoldHandle(lines.join("\n"), () => toggleFold(folds, group)) : new Text(lines.join("\n"), 0, 0);
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
      const group = foldGroup(folds, context.toolCallId);
      if (group && !view(folds, group).open) return new Text("", 0, 0);
      return renderBody(name, result, options, theme, context);
    },
  };
}

export function toolRenderers(name, folds = defaultFolds) {
  return rowRenderers({ name, title: args => callTitle(name, args), folds });
}

// pi-mcp-adapter reports init, auth and server failures in details.error
// without isError; a subagent launch answers with its run id and finishes
// later. The questionnaire tool is an overlay while it runs and a
// workflow-answers entry once it ends, so its own row would say nothing.
const NOTHING = { renderShell: "self", renderCall: () => new Text("", 0, 0), renderResult: () => new Text("", 0, 0) };

export function pluginRenderers(name, { servers = [], folds = defaultFolds } = {}) {
  if (name === "ask_user_question") return NOTHING;
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
      if (result?.details?.asyncId && !context.isError) return new Text(indent(theme.fg("muted", `${SUB} launched`)), 0, 0);
      return renderers.renderResult(result, options, theme, context);
    },
  };
}

// The background-task tool: its result is a status line and the task's output.
export const taskRenderers = rowRenderers({ name: "plugin", title: args => (args.action === "stop" ? `Stopped task ${args.id ?? ""}` : `Task ${args.id ?? ""} output`) });

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
    const approved = /approved;/.test(resultText(result));
    const container = new Container();
    container.addChild(new Text(indent(`${theme.fg("muted", SUB)} ${theme.fg(approved ? "success" : "warning", approved ? "approved" : "not approved")}`), 0, 0));
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
export function bulletMarkdown(markdown, { messageType }) {
  if (messageType === "assistant-thinking") return "";
  // A sent message opens with the composer's glyph at the same column: pi's
  // user box renders its content at outputPad, which is 0. The glyph takes the
  // box's own colour rather than the accent — the box colours its content
  // through one function, and an inner colour's reset would end it for the rest
  // of the line.
  if (messageType === "user") return markdown.trim() ? `${PROMPT} ${markdown.trimStart()}` : markdown;
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

export function answerLines(answers, theme, globalNote = "") {
  const head = `${theme.fg("success", BULLET)} ${theme.fg("toolTitle", `User answered pi's ${answers.length === 1 ? "question" : "questions"}`)}`;
  const line = (label, text) => indent(`${theme.fg("muted", SUB)} ${label} ${theme.fg("muted", "→")} ${text}`);
  return [head, ...answers.map(({ question, answer, notes }) => line(question, [answer, notes].filter(Boolean).join(" — "))), ...(globalNote ? [line("Note", globalNote)] : [])];
}

// One line when an async child ends; pi-subagents' own notice shows only for
// failures, so this is the transcript's record of a finished child and of how
// long it took.
export function completionLine({ agent, task, status, durationMs }, theme) {
  const ok = status === "completed";
  const colour = ok ? "success" : status === "failed" || status === "stopped" ? "error" : "warning";
  const title = `${agent} ${ok ? "finished" : status}`;
  const tail = [task && shortTitle(task, SUMMARY_WIDTH), typeof durationMs === "number" && formatDuration(durationMs)].filter(Boolean).map(part => ` · ${part}`).join("");
  return `${theme.fg(colour, BULLET)} ${theme.fg("toolTitle", title)}${tail ? theme.fg("muted", tail) : ""}`;
}

const behind = (text, head) => (text.startsWith(head) ? text.slice(head.length).trimStart() : text);

// pi-subagents' control notice carries the run id and the four subagent({…})
// calls the model answers it with; the reader gets the completion line's shape
// instead, and the message's own content reaches the model untouched. The
// signal opens by naming the agent and, on the idle and tool-failure notices,
// its state too — both of which the title has said, and the default idle
// signal parenthesizes what is left of it.
export function noticeLine({ agent, failed, message }, theme) {
  const state = failed ? "failed" : "needs attention";
  const reason = behind(behind(oneLine(message), `${agent} `), state);
  const tail = shortTitle(reason.startsWith("(") && reason.endsWith(")") ? reason.slice(1, -1) : reason, SUMMARY_WIDTH);
  return `${theme.fg(failed ? "error" : "warning", BULLET)} ${theme.fg("toolTitle", `${agent} ${state}`)}${tail ? theme.fg("muted", ` · ${tail}`) : ""}`;
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
    stop(now = Date.now(), { aborted = false } = {}) {
      if (startedAt == null) return null;
      const turn = { verb: verb[1], ms: now - startedAt, endedAt: now, aborted };
      startedAt = null;
      return turn;
    },
  };
}
