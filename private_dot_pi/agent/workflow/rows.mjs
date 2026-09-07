import { Container, Markdown, Text } from "@earendil-works/pi-tui";
import { getMarkdownTheme, keyHint, renderDiff } from "@earendil-works/pi-coding-agent";

// Transcript glyphs (docs/pi-design.md): Codex's bullet for rows, ↳ for the
// line under a row, π for anything the harness says in its own voice.
export const BULLET = "•";
export const TURN_GLYPH = "π";
export const SUB = "↳";

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

const firstLine = value => String(value ?? "").split("\n")[0];
const resultText = result => (result?.content ?? []).filter(c => c.type === "text").map(c => c.text ?? "").join("\n").trim();
const nonEmpty = text => text.split("\n").filter(line => line.trim());
const plural = (n, noun, nouns = `${noun}s`) => `${n} ${n === 1 ? noun : nouns}`;
const indent = line => `  ${line}`;

// The glyph carries the row's state, as Claude Code's does: plain while the
// call is running, then success or error.
export function glyph(theme, { isPartial, isError }) {
  if (isPartial) return BULLET;
  return theme.fg(isError ? "error" : "success", BULLET);
}

export function callTitle(name, args = {}) {
  const where = args.path ? ` in ${args.path}` : "";
  switch (name) {
    case "bash": return `Ran ${firstLine(args.command) || "…"}`;
    case "read": return `Read ${args.path ?? ""}${args.offset ? `:${args.offset}` : ""}`;
    case "edit": return `Edited ${args.path ?? ""}`;
    case "write": return `Wrote ${args.path ?? ""}`;
    case "grep": return `Search "${args.pattern ?? ""}"${where}`;
    case "find": return `Find ${args.pattern ?? ""}${where}`;
    case "ls": return `List ${args.path ?? "."}`;
    default: return name;
  }
}

// The one line under a collapsed row: what the result was, never what it said.
export function resultSummary(name, result) {
  if (!result) return "";
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
  return text ? plural(text.split("\n").length, "line") : "";
}

// Errors always show in full; everything else waits for ctrl+o.
export function bodyLines(name, result, { expanded = false, isError = false } = {}) {
  if (!result) return [];
  const text = resultText(result);
  if (isError) return nonEmpty(text);
  if (!expanded) return [];
  if (name === "edit") return typeof result.details?.diff === "string" ? renderDiff(result.details.diff).split("\n") : [];
  if (name === "write") return [];
  return text ? text.split("\n") : [];
}

function renderBody(name, result, options, theme, context) {
  const lines = [];
  const summary = context.isError ? "" : resultSummary(name, result);
  const hint = summary && !options.expanded && (name === "bash" || name === "read") ? ` · ${keyHint("app.tools.expand", "to expand")}` : "";
  if (summary) lines.push(theme.fg("muted", `${SUB} ${summary}${hint}`));
  for (const line of bodyLines(name, result, { expanded: options.expanded, isError: context.isError })) {
    lines.push(name === "edit" && !context.isError ? line : theme.fg(context.isError ? "error" : "toolOutput", line));
  }
  return new Text(lines.map(indent).join("\n"), 0, 0);
}

// Fold-on-speak, as Claude Code does it: the workspace rows since the last
// assistant text form a group; when the assistant speaks again the group
// collapses to one line ("Read 3 files, ran 2 shell commands") and ctrl+o
// brings the rows back. State is per process — a resumed session renders its
// old rows unfolded.
const WORDS = { read: ["read", "file"], bash: ["ran", "shell command"], grep: ["searched for", "pattern"], edit: ["edited", "file"], write: ["wrote", "file"], list: ["listed", "path"] };
const countKey = tool => (tool === "find" || tool === "ls" ? "list" : tool);

export function createFolds() {
  return { current: null, byId: new Map(), invalidate: new Map() };
}
export const defaultFolds = createFolds();

export function addFold(folds, id, tool) {
  folds.current ??= { ids: [], counts: {}, collapsed: false };
  folds.current.ids.push(id);
  const key = countKey(tool);
  folds.current.counts[key] = (folds.current.counts[key] ?? 0) + 1;
  folds.byId.set(id, folds.current);
}

export function closeFolds(folds) {
  const group = folds.current;
  if (!group) return;
  group.collapsed = true;
  folds.current = null;
  for (const id of group.ids) folds.invalidate.get(id)?.();
}

export function summarise(counts) {
  const text = Object.entries(WORDS).filter(([key]) => counts[key]).map(([key, [verb, noun]]) => `${verb} ${plural(counts[key], noun)}`).join(", ");
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

const speaks = event => event.message?.role === "assistant" && (event.message.content ?? []).some(c => c.type === "text" && c.text?.trim());

export function installFolding(pi, folds = defaultFolds) {
  pi.on("tool_execution_start", event => {
    if (event.toolName.startsWith("workspace_")) addFold(folds, event.toolCallId, event.toolName.slice("workspace_".length));
  });
  // Streaming replies announce their text in updates; non-streaming ones only at the end.
  pi.on("message_update", event => { if (speaks(event)) closeFolds(folds); });
  pi.on("message_end", event => { if (speaks(event)) closeFolds(folds); });
}

// Renderers for the sandboxed workspace tools. A folded row renders nothing;
// the group's last row carries the summary instead of its title. A failed row
// stays visible in full even inside a fold.
export function toolRenderers(name, folds = defaultFolds) {
  const folded = context => { const group = folds.byId.get(context.toolCallId); return group?.collapsed && !context.expanded ? group : null; };
  return {
    renderShell: "self",
    renderCall(args, theme, context) {
      // The first render precedes tool_execution_start, so every render records the invalidator.
      folds.invalidate.set(context.toolCallId, context.invalidate);
      const title = `${glyph(theme, context)} ${theme.fg("toolTitle", callTitle(name, args))}`;
      const group = folded(context);
      if (!group) return new Text(title, 0, 0);
      const lines = [];
      if (group.ids.at(-1) === context.toolCallId) lines.push(theme.fg("muted", summarise(group.counts)));
      if (context.isError) lines.push(title);
      return new Text(lines.join("\n"), 0, 0);
    },
    renderResult(result, options, theme, context) {
      if (folded(context) && !context.isError) return new Text("", 0, 0);
      return renderBody(name, result, options, theme, context);
    },
  };
}

export const planRenderers = {
  renderShell: "self",
  renderCall(_args, theme, context) {
    return new Text(`${glyph(theme, context)} ${theme.fg("toolTitle", "Updated plan")}`, 0, 0);
  },
  renderResult(result, options, theme, context) {
    const approved = /approved;/.test(resultText(result));
    const container = new Container();
    container.addChild(new Text(indent(`${theme.fg("muted", SUB)} ${theme.fg(approved ? "success" : "warning", approved ? "approved" : "not approved")}`), 0, 0));
    if (options.expanded && context.args?.plan) container.addChild(new Markdown(context.args.plan, 2, 0, getMarkdownTheme()));
    return container;
  },
};

// Assistant text gets the bullet as a plain prefix (pi-tui's list marker is a
// fixed dash, so a list item would not give this glyph). Block-level starts
// keep their syntax by taking the bullet as their own paragraph.
export function bulletMarkdown(markdown, { messageType }) {
  if (messageType !== "assistant") return markdown;
  const body = markdown.trimStart();
  if (!body) return markdown;
  return /^(#{1,6}\s|```|~~~|>|[-*+]\s|\d+[.)]\s|\|)/.test(body) ? `${BULLET}\n\n${body}` : `${BULLET} ${body}`;
}

export function answerLines(answers, theme) {
  const head = `${theme.fg("success", BULLET)} ${theme.fg("toolTitle", `User answered pi's ${answers.length === 1 ? "question" : "questions"}`)}`;
  return [head, ...answers.map(({ question, answer }) => indent(`${theme.fg("muted", SUB)} ${question} ${theme.fg("muted", "→")} ${answer}`))];
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

export function formatTurn({ verb, ms, endedAt, aborted }, theme) {
  const text = aborted ? `Interrupted after ${formatDuration(ms)}` : `${verb} for ${formatDuration(ms)} · done ${clockTime(endedAt)}`;
  return `${theme.fg("accent", TURN_GLYPH)} ${theme.fg("muted", text)}`;
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
