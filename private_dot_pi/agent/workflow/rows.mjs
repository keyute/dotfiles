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
// theme's own success/error pair. Each segment is coloured on its own rather
// than nested inside one muted wrapper, whose reset would end the muted colour
// for the rest of the line (the hazard design rule 5 records for the user box).
function summaryLine(name, summary, theme) {
  const counts = name === "edit" || name === "write" ? summary.split(" ") : null;
  if (counts?.length !== 2) return theme.fg("muted", `${SUB} ${summary}`);
  return `${theme.fg("muted", SUB)} ${theme.fg("success", counts[0])} ${theme.fg("error", counts[1])}`;
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
// things that stay visible form a group. Whatever stays visible — assistant
// text, a subagent or other plugin row, a failed row, a child's completion
// line, the turn line, the next run — closes the group, which collapses to one
// line ("Read 3 files, ran 2 shell commands"); clicking it or ctrl+o brings the
// rows back. State is per process — a resumed session renders its old rows
// unfolded.
const WORDS = { read: ["read", "file"], bash: ["ran", "shell command"], grep: ["searched for", "pattern"], edit: ["edited", "file"], write: ["wrote", "file"], list: ["listed", "path"], mcp: ["called", "MCP tool"] };
const countKey = tool => (tool === "find" || tool === "ls" ? "list" : tool);
const isMcp = name => name === "mcp" || name.startsWith("mcp__");
const foldKey = name => (name.startsWith("workspace_") ? name.slice("workspace_".length) : isMcp(name) ? "mcp" : null);

// `toolsExpanded` reads pi's global ctrl+o flag (ctx.ui.getToolsExpanded);
// a closed group reopens when that flag changes.
export function createFolds(toolsExpanded = () => undefined) {
  return { current: null, byId: new Map(), invalidate: new Map(), toolsExpanded };
}
export const defaultFolds = createFolds();

export function addFold(folds, id, tool) {
  folds.current ??= { ids: [], counts: {}, collapsed: false, open: false };
  folds.current.ids.push(id);
  const key = countKey(tool);
  folds.current.counts[key] = (folds.current.counts[key] ?? 0) + 1;
  folds.byId.set(id, folds.current);
}

export function closeFolds(folds) {
  const group = folds.current;
  if (!group) return;
  group.collapsed = true;
  group.expandedAt = folds.toolsExpanded();
  // A group that forms while ctrl+o is on joins it: it records the flag as
  // already seen, so the render's transition guard would never fire for it.
  group.open = group.expandedAt === true;
  folds.current = null;
  for (const id of group.ids) folds.invalidate.get(id)?.();
}

export function summarise(counts) {
  const text = Object.entries(WORDS).filter(([key]) => counts[key]).map(([key, [verb, noun]]) => `${verb} ${plural(counts[key], noun)}`).join(", ");
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

const speaks = event => event.message?.role === "assistant" && (event.message.content ?? []).some(c => c.type === "text" && c.text?.trim());

export function installFolding(pi, ctx, folds = defaultFolds) {
  folds.toolsExpanded = () => ctx.ui.getToolsExpanded();
  pi.on("tool_execution_start", event => {
    const key = foldKey(event.toolName);
    if (key) addFold(folds, event.toolCallId, key);
    else closeFolds(folds);
  });
  // A failed row stays visible as its group's last row (the adapter reports
  // some failures in details.error without isError). Parallel tools end in
  // completion order, so only a failure in the group still forming closes it.
  pi.on("tool_execution_end", event => {
    if ((event.isError || event.result?.details?.error) && folds.byId.get(event.toolCallId) === folds.current) closeFolds(folds);
  });
  pi.on("agent_start", () => closeFolds(folds));
  // Streaming replies announce their text in updates; non-streaming ones only at the end.
  pi.on("message_update", event => { if (speaks(event)) closeFolds(folds); });
  pi.on("message_end", event => { if (speaks(event)) closeFolds(folds); });
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

// The caret is the handle's state (docs/pi-design.md rule 2). It sits in the
// dot column so the handle lines up with the rows it owns, and the text undims
// when open so a stacked run of groups shows which one is expanded.
const handleLine = (group, theme) =>
  theme.fg(group.open ? "toolTitle" : "muted", `${group.open ? FOLD_OPEN : FOLD_CLOSED} ${summarise(group.counts)}`);

const closedFold = (folds, id) => {
  const group = folds.byId.get(id);
  return group?.collapsed ? group : null;
};

function toggleFold(folds, group, rendering) {
  group.open = !group.open;
  for (const id of group.ids) if (id !== rendering) folds.invalidate.get(id)?.();
}

// A row is `glyph title` and one ↳ line; a folded row renders nothing while the
// group's first row carries the summary at the text column. A failed row stays
// visible in full even inside a fold.
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
      const group = closedFold(folds, id);
      if (!group) return new Text(line, 0, 0);
      const first = group.ids[0] === id;
      const toolsExpanded = folds.toolsExpanded();
      if (toolsExpanded !== group.expandedAt) {
        group.expandedAt = toolsExpanded;
        if (group.open !== toolsExpanded) toggleFold(folds, group, id);
      }
      const lines = [];
      if (first) lines.push(handleLine(group, theme));
      if (group.open || context.isError) lines.push(line);
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
      const group = closedFold(folds, context.toolCallId);
      if (group && !group.open && !context.isError) return new Text("", 0, 0);
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

export const planRenderers = {
  renderShell: "self",
  renderCall(_args, theme, context) {
    return new Text(`${glyph(theme, context)} ${theme.fg("toolTitle", "Updated plan")}`, 0, 0);
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
