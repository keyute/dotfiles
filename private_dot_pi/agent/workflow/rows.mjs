import { Container, Markdown, Text } from "@earendil-works/pi-tui";
import { getMarkdownTheme, keyHint, renderDiff } from "@earendil-works/pi-coding-agent";

// Transcript glyphs: Codex's bullet for rows (Claude Code's ⏺ is its own
// signature), π for the turn line, ↳ for sub-lines as in the fleet rows.
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

const PREVIEW_HEAD = 2;
const PREVIEW_TAIL = 2;

const firstLine = value => String(value ?? "").split("\n")[0];
const resultText = result => (result?.content ?? []).filter(c => c.type === "text").map(c => c.text ?? "").join("\n").trim();
const nonEmpty = text => text.split("\n").filter(line => line.trim());

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

// What the collapsed row says about its result, on the title line.
export function resultSuffix(name, result, isError = false) {
  if (!result || isError) return "";
  if (name === "edit" || name === "write") {
    const diff = result.details?.diff;
    if (typeof diff !== "string") return "";
    const lines = diff.split("\n");
    const added = lines.filter(line => /^\+(?!\+\+)/.test(line)).length;
    const removed = lines.filter(line => /^-(?!--)/.test(line)).length;
    return `+${added} −${removed}`;
  }
  if (name === "grep") {
    const matches = resultText(result).split("\n").filter(line => /^[^:\n]+:\d+: /.test(line)).length;
    return `(${matches} ${matches === 1 ? "match" : "matches"})`;
  }
  if (name === "find" || name === "ls") {
    const text = resultText(result);
    if (!text || /^No /.test(text)) return "";
    const entries = nonEmpty(text).length;
    return `(${entries} ${entries === 1 ? "entry" : "entries"})`;
  }
  return "";
}

// Collapsed shell output keeps the head and tail, as Codex does; everything
// else shows nothing until expanded. Errors always show in full.
export function bodyLines(name, result, { expanded = false, isError = false } = {}) {
  if (!result) return [];
  const text = resultText(result);
  if (isError) return nonEmpty(text);
  if (name === "edit") return expanded && typeof result.details?.diff === "string" ? renderDiff(result.details.diff).split("\n") : [];
  if (name === "write") return [];
  const lines = text ? text.split("\n") : [];
  if (expanded || name !== "bash") return expanded ? lines : [];
  if (lines.length <= PREVIEW_HEAD + PREVIEW_TAIL + 1) return lines;
  const hidden = lines.length - PREVIEW_HEAD - PREVIEW_TAIL;
  return [...lines.slice(0, PREVIEW_HEAD), { hidden }, ...lines.slice(-PREVIEW_TAIL)];
}

const indent = line => `  ${line}`;

function renderBody(name, result, options, theme, context) {
  const lines = bodyLines(name, result, { expanded: options.expanded, isError: context.isError }).map(line => {
    if (typeof line === "object") return theme.fg("muted", `… +${line.hidden} lines `) + keyHint("app.tools.expand", "to expand");
    return name === "edit" && options.expanded ? line : theme.fg(context.isError ? "error" : "toolOutput", line);
  });
  return new Text(lines.map(indent).join("\n"), 0, 0);
}

// Renderers for the sandboxed workspace tools. The result suffix lands on the
// title line through the row's shared state: the call renderer runs before the
// result renderer in every pass, so the result schedules one more pass when
// the suffix changes (never inside the current pass, which would rebuild the
// row's container while it is being filled).
export function toolRenderers(name) {
  return {
    renderShell: "self",
    renderCall(args, theme, context) {
      const suffix = context.state.suffix ? theme.fg("muted", ` ${context.state.suffix}`) : "";
      return new Text(`${glyph(theme, context)} ${theme.fg("toolTitle", callTitle(name, args))}${suffix}`, 0, 0);
    },
    renderResult(result, options, theme, context) {
      const suffix = options.isPartial ? "" : resultSuffix(name, result, context.isError);
      if (suffix !== context.state.suffix) {
        context.state.suffix = suffix;
        setTimeout(() => context.invalidate(), 0);
      }
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

export function formatTurn({ verb, ms, endedAt }, theme) {
  return `${theme.fg("accent", TURN_GLYPH)} ${theme.fg("muted", `${verb} for ${formatDuration(ms)} · done ${clockTime(endedAt)}`)}`;
}

// One turn from agent_start to agent_settled (agent_end fires before retries
// and queued continuations). The verb is drawn once per turn.
export function createTurnClock(verbs = TURN_VERBS, pick = () => Math.floor(Math.random() * verbs.length)) {
  let startedAt = null;
  let verb = null;
  return {
    start(now = Date.now()) {
      if (startedAt != null) return;
      startedAt = now;
      verb = verbs[pick()];
    },
    label(now = Date.now()) {
      return startedAt == null ? "" : `${TURN_GLYPH} ${verb[0]}… ${formatDuration(now - startedAt)}`;
    },
    stop(now = Date.now()) {
      if (startedAt == null) return null;
      const turn = { verb: verb[1], ms: now - startedAt, endedAt: now };
      startedAt = null;
      return turn;
    },
  };
}
