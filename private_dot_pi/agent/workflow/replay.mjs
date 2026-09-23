import { Markdown, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { PAD, PROMPT, bulletMarkdown, callTitle, glyph, pad, pluginTitle, rowLines, shade, taskTitle } from "./rows.mjs";

// The fleet peek replays a background child's own events.jsonl through this
// extension's row grammar (docs/pi-design.md rule 6, 2026-09-22). Pure: no fs,
// no timers, no pi context — the caller streams file chunks in and gets back
// journal-order row facts plus a renderer.

const WORKSPACE_TOOLS = new Set(["read", "grep", "find", "ls", "bash", "edit", "write"]);
const isMcp = name => name === "mcp" || name.startsWith("mcp__");

// A large tool result would otherwise hold the whole run's output in memory
// for the life of the peek; only the fields the renderers actually read
// survive off of `details`.
const MAX_TEXT = 32 * 1024;
const capText = text => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}… truncated` : text);
function capResult(result) {
  if (!result) return result;
  const content = (result.content ?? []).map(part => (part.type === "text" ? { ...part, text: capText(part.text ?? "") } : part));
  const capped = { ...result, content };
  if (result.details) {
    const { diff, taskId, error, asyncId } = result.details;
    const details = {};
    if (diff !== undefined) details.diff = diff;
    if (taskId !== undefined) details.taskId = taskId;
    if (error !== undefined) details.error = error;
    if (asyncId !== undefined) details.asyncId = asyncId;
    if (Object.keys(details).length) capped.details = details;
    else delete capped.details;
  } else delete capped.details;
  return capped;
}

// A steer reaches the child as a user message wrapped in one of these two
// fixed prefixes and a fixed trailer (pi-subagents 0.70.1); the body is
// whatever sits between them.
const STEER_PREFIXES = ["Mid-run steering from the parent orchestrator:", "Queued follow-up from the parent orchestrator:"];
const STEER_TRAILER = "Incorporate this guidance at the next safe point. Do not restart the task unless the guidance explicitly asks you to.";
function steerBody(text) {
  const prefix = STEER_PREFIXES.find(p => text.startsWith(p));
  if (!prefix) return null;
  let body = text.slice(prefix.length);
  const trailerAt = body.lastIndexOf(STEER_TRAILER);
  if (trailerAt !== -1) body = body.slice(0, trailerAt);
  return body.trim();
}

const messageText = message => (message.content ?? []).filter(part => part.type === "text").map(part => part.text ?? "").join("\n");

const STEER_NOTE = { "subagent.steer.delivered": "steer delivered", "subagent.steer.queued": "steer queued" };

function handleRecord(state, record) {
  switch (record.type) {
    case "tool_execution_start": {
      const row = { kind: "tool", id: record.toolCallId, name: record.toolName, args: record.args ?? {}, pending: true };
      state.rows.push(row);
      state.toolRowsById.set(record.toolCallId, row);
      return;
    }
    case "tool_execution_end": {
      const isError = Boolean(record.isError);
      const result = capResult(record.result);
      const existing = state.toolRowsById.get(record.toolCallId);
      if (existing) {
        existing.pending = false;
        existing.isError = isError;
        existing.result = result;
      } else {
        const row = { kind: "tool", id: record.toolCallId, name: record.toolName, args: {}, pending: false, isError, result };
        state.rows.push(row);
        state.toolRowsById.set(record.toolCallId, row);
      }
      return;
    }
    case "message_end": {
      const message = record.message;
      if (message?.role === "assistant") {
        const text = messageText(message);
        if (text.trim()) state.rows.push({ kind: "assistant", text });
      } else if (message?.role === "user") {
        const text = messageText(message);
        const body = steerBody(text);
        state.rows.push(body === null ? { kind: "user", text } : { kind: "user", steer: true, text: body });
      }
      return;
    }
    case "subagent.steer.delivered":
    case "subagent.steer.queued": {
      const text = STEER_NOTE[record.type];
      const existing = state.noteRowsByRequestId.get(record.requestId);
      if (existing) existing.text = text;
      else {
        const row = { kind: "note", requestId: record.requestId, text };
        state.rows.push(row);
        state.noteRowsByRequestId.set(record.requestId, row);
      }
      return;
    }
    case "subagent.steer.failed": {
      const reason = record.error ?? record.reason ?? record.message;
      const text = `steer failed${reason ? ` · ${reason}` : ""}`;
      const existing = state.noteRowsByRequestId.get(record.requestId);
      if (existing) existing.text = text;
      else {
        const row = { kind: "note", requestId: record.requestId, text };
        state.rows.push(row);
        state.noteRowsByRequestId.set(record.requestId, row);
      }
      return;
    }
    case "subagent.events.truncated": {
      state.rows.push({ kind: "note", text: "further activity not recorded (event log limit)" });
      return;
    }
    default:
      // subagent.steer.requested|routed|scheduled, subagent.steering.notice,
      // agent_start/end, turn_start/end, agent_settled, compaction_*,
      // tool_result_end and unknown types carry nothing to replay.
      return;
  }
}

export function createReplay() {
  return { rows: [], partial: "", toolRowsById: new Map(), noteRowsByRequestId: new Map() };
}

export const EARLIER_NOTE = "earlier activity not shown";

// A long run would otherwise keep every row for the life of the peek and
// re-render all of them each tick; the window keeps the newest `max` rows
// behind one note, and the lookup maps forget what fell off.
export function trimRows(state, max) {
  const excess = state.rows.length - max;
  if (excess <= 0) return state;
  for (const row of state.rows.splice(0, excess)) {
    if (row.kind === "tool") state.toolRowsById.delete(row.id);
    else if (row.kind === "note" && row.requestId !== undefined) state.noteRowsByRequestId.delete(row.requestId);
  }
  if (state.rows[0]?.text !== EARLIER_NOTE) state.rows.unshift({ kind: "note", text: EARLIER_NOTE });
  return state;
}

export function replayEvents(state, chunk) {
  const lines = (state.partial + chunk).split("\n");
  state.partial = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    handleRecord(state, record);
  }
  return state;
}

function toolRowLines(row, theme, expanded) {
  const { name, args, pending, isError, result } = row;
  const stripped = name.startsWith("workspace_") ? name.slice("workspace_".length) : null;
  let title, bodyName;
  if (stripped && WORKSPACE_TOOLS.has(stripped)) {
    title = callTitle(stripped, args);
    bodyName = stripped;
  } else if (name === "workspace_task") {
    title = taskTitle(args);
    bodyName = "plugin";
  } else if (name === "subagent") {
    title = pluginTitle("subagent", args);
    bodyName = "subagent";
  } else if (isMcp(name)) {
    title = pluginTitle(name, args);
    bodyName = "mcp";
  } else {
    title = pluginTitle(name, args);
    bodyName = "plugin";
  }
  const titleLine = `${glyph(theme, { isPartial: pending, isError })} ${theme.fg("toolTitle", title)}`;
  if (pending) return [titleLine];
  return [titleLine, ...rowLines(bodyName, result, { expanded, isError }, theme)];
}

function userRowLines(row, width, theme) {
  const wrapped = wrapTextWithAnsi(row.text, Math.max(1, width - 2));
  const content = wrapped.map((line, i) => (i === 0 ? `${PROMPT} ${line}` : `  ${line}`));
  return ["", ...content, ""].map(line => shade(theme, pad(line, width)));
}

function renderRow(row, width, theme, expanded) {
  switch (row.kind) {
    case "tool":
      return toolRowLines(row, theme, expanded);
    case "assistant":
      return new Markdown(bulletMarkdown(row.text, { messageType: "assistant" }), 0, 0, getMarkdownTheme()).render(width);
    case "user":
      return userRowLines(row, width, theme);
    case "note":
      return [`${PAD}${theme.fg("muted", `↳ ${row.text}`)}`];
    default:
      return [];
  }
}

// Only these two pairs are contiguous (docs/pi-design.md rule 8 applied to
// the peek): a run of tool rows, and a note that lands directly under the
// user block it answers. Every other neighbour starts a fresh block, one
// blank line above it.
const contiguous = (prev, row) => (prev.kind === "tool" && row.kind === "tool") || (prev.kind === "user" && row.kind === "note");

function groupBlocks(rows) {
  const blocks = [];
  for (const row of rows) {
    const prev = blocks.at(-1)?.at(-1);
    if (prev && contiguous(prev, row)) blocks.at(-1).push(row);
    else blocks.push([row]);
  }
  return blocks;
}

export function renderRows(rows, width, theme, { expanded = false } = {}) {
  const output = [];
  groupBlocks(rows).forEach((block, i) => {
    if (i > 0) output.push("");
    for (const row of block) output.push(...renderRow(row, width, theme, expanded));
  });
  return output;
}
