import { Markdown } from "@earendil-works/pi-tui";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
  PAD, TURN_VERBS,
  addFold, bulletMarkdown, callTitle, closeFolds, closeLive, createFolds, createTurnClock,
  foldGroup, foldKey, formatTurn, glyph, groupLines, isMcp, liveGroup, pluginTitle,
  rowLines, settleFold, shadedBlock, taskTitle,
} from "./rows.mjs";

// The fleet peek replays a background child's own events.jsonl through this
// extension's row grammar (docs/pi-design.md rule 6, 2026-09-22). Pure: no fs,
// no timers, no pi context — the caller streams file chunks in and gets back
// journal-order row facts plus a renderer.

const WORKSPACE_TOOLS = new Set(["read", "grep", "find", "ls", "bash", "edit", "write"]);

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

// The row's title and body kind, exactly as the main chat's tool rows
// resolve them; shared between the fact stored for grouping (`folds.titles`)
// and the row's own full rendering.
function toolRowMeta(name, args) {
  const stripped = name.startsWith("workspace_") ? name.slice("workspace_".length) : null;
  if (stripped && WORKSPACE_TOOLS.has(stripped)) return { title: callTitle(stripped, args), bodyName: stripped };
  if (name === "workspace_task") return { title: taskTitle(args), bodyName: "plugin" };
  if (name === "subagent") return { title: pluginTitle("subagent", args), bodyName: "subagent" };
  if (isMcp(name)) return { title: pluginTitle(name, args), bodyName: "mcp" };
  return { title: pluginTitle(name, args), bodyName: "plugin" };
}

function handleRecord(state, record) {
  state.version += 1;
  switch (record.type) {
    case "tool_execution_start": {
      const args = record.args ?? {};
      const row = { kind: "tool", id: record.toolCallId, name: record.toolName, args, pending: true, version: 0 };
      state.rows.push(row);
      state.toolRowsById.set(record.toolCallId, row);
      state.folds.titles.set(record.toolCallId, toolRowMeta(record.toolName, args).title);
      const key = foldKey(record.toolName, args);
      if (key) addFold(state.folds, record.toolCallId, key);
      else closeFolds(state.folds);
      return;
    }
    case "tool_execution_end": {
      // The adapter reports some failures in `details.error` without `isError`,
      // same as `installFolding`; `settleFold` reads the uncapped result so its
      // summary matches the main chat before the row keeps only the capped one.
      const isError = Boolean(record.isError || record.result?.details?.error);
      settleFold(state.folds, record.toolCallId, isError, record.result);
      const result = capResult(record.result);
      const existing = state.toolRowsById.get(record.toolCallId);
      if (existing) {
        existing.pending = false;
        existing.isError = isError;
        existing.result = result;
        existing.version += 1;
      } else {
        const row = { kind: "tool", id: record.toolCallId, name: record.toolName, args: {}, pending: false, isError, result, version: 0 };
        state.rows.push(row);
        state.toolRowsById.set(record.toolCallId, row);
      }
      return;
    }
    case "message_end": {
      const message = record.message;
      if (message?.role === "assistant") {
        const text = messageText(message);
        if (text.trim()) {
          state.rows.push({ kind: "assistant", text });
          closeFolds(state.folds);
        }
      } else if (message?.role === "user") {
        const text = messageText(message);
        const body = steerBody(text);
        state.rows.push(body === null ? { kind: "user", text } : { kind: "user", steer: true, text: body });
        // A pending tool must stay outside the group that closes here (rows.mjs's `input` handler).
        closeLive(state.folds);
      }
      return;
    }
    case "subagent.steer.delivered":
    case "subagent.steer.queued": {
      const text = STEER_NOTE[record.type];
      const existing = state.noteRowsByRequestId.get(record.requestId);
      if (existing) { existing.text = text; existing.version = (existing.version ?? 0) + 1; }
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
      if (existing) { existing.text = text; existing.version = (existing.version ?? 0) + 1; }
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
    case "agent_start": {
      closeFolds(state.folds);
      state.clock.start(record.observedAt ?? Date.now());
      return;
    }
    case "agent_end": {
      const aborted = record.messages?.findLast(m => m.role === "assistant")?.stopReason === "aborted";
      if (!aborted) return;
      const turn = state.clock.stop(record.observedAt ?? Date.now(), { aborted: true });
      if (turn) {
        state.rows.push({ kind: "turn", ...turn });
        closeFolds(state.folds);
      }
      return;
    }
    case "agent_settled": {
      const turn = state.clock.stop(record.observedAt ?? Date.now());
      if (turn) {
        state.rows.push({ kind: "turn", ...turn });
        closeFolds(state.folds);
      }
      return;
    }
    default:
      // subagent.steer.requested|routed|scheduled, subagent.steering.notice,
      // turn_start/end, compaction_*, tool_result_end and unknown types carry
      // nothing to replay.
      return;
  }
}

// `pick` is injectable so a peek's own turn line is deterministic in tests
// (see rows.mjs's `createTurnClock`); every persisted record carries its own
// `observedAt`, so the clock never reads the wall clock itself.
export function createReplay({ pick } = {}) {
  return {
    rows: [],
    partial: "",
    toolRowsById: new Map(),
    noteRowsByRequestId: new Map(),
    // Quiet: a bulk replay has no rendered components to invalidate, so the
    // before/after diff `refold` otherwise does is dead weight here.
    folds: createFolds(() => false, { quiet: true }),
    clock: createTurnClock(TURN_VERBS, pick),
    version: 0,
  };
}

export const EARLIER_NOTE = "earlier activity not shown";

// A long run would otherwise keep every row for the life of the peek and
// re-render all of them each tick; the window keeps the newest `max` rows
// behind one note, and the lookup maps forget what fell off.
export function trimRows(state, max) {
  const excess = state.rows.length - max;
  if (excess <= 0) return state;
  const trimmed = state.rows.splice(0, excess);
  const trimmedIds = new Set();
  for (const row of trimmed) {
    if (row.kind === "tool") { state.toolRowsById.delete(row.id); trimmedIds.add(row.id); }
    else if (row.kind === "note" && row.requestId !== undefined) state.noteRowsByRequestId.delete(row.requestId);
  }
  // A dropped row's fact would otherwise still count toward a sentence that
  // no longer has the row to show for it; leading boundaries left behind are
  // harmless (`derive` only seals a run that has members).
  if (trimmedIds.size) {
    state.folds.timeline = state.folds.timeline.filter(fact => !(fact.kind === "activity" && trimmedIds.has(fact.id)));
    for (const id of trimmedIds) {
      state.folds.titles.delete(id);
      state.folds.facts.delete(id);
    }
    state.folds.revision += 1;
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

// A row's own lines are cached on the row: the spinner redraws the whole
// dialog several times a second, and a Markdown parse per assistant row per
// frame would not keep up. Nothing cached depends on the row's group, so a
// group forming or sealing around it never invalidates the cache.
function cached(row, key, compute) {
  if (row._linesKey !== key) {
    row._linesKey = key;
    row._lines = compute();
  }
  return row._lines;
}

// A tool row's own full rendering — title line plus its body, never the
// group's sentence or member line.
function toolRowLines(row, theme, { width, expanded } = {}) {
  return cached(row, `${width}|${expanded}|${row.version ?? 0}`, () => {
    const { title, bodyName } = toolRowMeta(row.name, row.args);
    const titleLine = `${glyph(theme, { isPartial: row.pending, isError: row.isError })} ${theme.fg("toolTitle", title)}`;
    return row.pending ? [titleLine] : [titleLine, ...rowLines(bodyName, row.result, { expanded, isError: row.isError }, theme)];
  });
}

function userRowLines(row, width, theme) {
  const markdown = new Markdown(bulletMarkdown(row.text, { messageType: "user" }), 0, 0, getMarkdownTheme(),
    { color: content => theme.fg("userMessageText", content) },
    { preserveOrderedListMarkers: true, preserveBackslashEscapes: true });
  return shadedBlock(theme, markdown.render(width), width);
}

function renderRow(row, width, theme) {
  return cached(row, `${width}|${row.version ?? 0}`, () => {
    switch (row.kind) {
      case "assistant":
        return new Markdown(bulletMarkdown(row.text, { messageType: "assistant" }), 0, 0, getMarkdownTheme()).render(width);
      case "user":
        return userRowLines(row, width, theme);
      case "note":
        return [`${PAD}${theme.fg("muted", `↳ ${row.text}`)}`];
      case "turn":
        return [formatTurn(row, theme)];
      default:
        return [];
    }
  });
}

// A tool row's lines and the id of the group it belongs to, if any — rule 2's
// three levels (docs/pi-design.md) through the main chat's own `groupLines`.
// Only group-dependent lines (the sentence, member lines) are recomputed every
// render; `toolRowLines` caches the row's own full rendering.
function renderTool(row, folds, width, theme, expanded) {
  const own = toolRowLines(row, theme, { width, expanded });
  const group = foldGroup(folds, row.id) ?? liveGroup(folds, row.id);
  if (!group) return { lines: own, groupId: undefined };
  const lines = groupLines(folds, group, { first: group.entries[0].id === row.id, expanded, state: { open: expanded }, own }, theme);
  return { lines, groupId: group.boundaryId };
}

// The blank-line rhythm (docs/pi-design.md rules 2 and 8 applied to the
// peek): one blank above every block that draws at least one line, none
// between a group's own members (a member that draws nothing contributes no
// blank either), and none between a note and the user block it answers.
export function renderRows(state, width, theme, { expanded = false } = {}) {
  const output = [];
  let prevGroupId;
  let prevRow;
  for (const row of state.rows) {
    const { lines, groupId } = row.kind === "tool" ? renderTool(row, state.folds, width, theme, expanded) : { lines: renderRow(row, width, theme), groupId: undefined };
    if (!lines.length) {
      prevRow = row;
      continue;
    }
    const sameGroup = groupId !== undefined && groupId === prevGroupId;
    const notePair = row.kind === "note" && prevRow?.kind === "user";
    if (output.length && !sameGroup && !notePair) output.push("");
    output.push(...lines);
    prevGroupId = groupId;
    prevRow = row;
  }
  return output;
}
