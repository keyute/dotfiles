import { Markdown, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
  DONE, TURN_VERBS,
  addCompletion, addFold, bulletMarkdown, callTitle, closeFolds, closeLive, completionLine, createFolds, createTurnClock,
  foldGroup, foldKey, formatTurn, glyph, groupLines, isMcp, liveGroup, noteLine, pluginTitle,
  rowLines, settleFold, shadedBlock, taskTitle,
} from "./rows.mjs";
import { workerTools } from "./policy.mjs";

// The fleet peek replays a background child's own events.jsonl through this
// extension's row grammar (docs/pi-design.md rule 6). Pure: no fs,
// no timers, no pi context — the caller streams file chunks in and gets back
// journal-order row facts plus a renderer.

const WORKSPACE_TOOLS = new Set(workerTools);

// A large tool result would otherwise hold the whole run's output in memory
// for the life of the peek; only the fields the renderers actually read
// survive off of `details`.
// Above pi's DEFAULT_MAX_BYTES (50 KB), so a built-in tool's result is never cut.
const MAX_TEXT = 64 * 1024;
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
// fixed prefixes and a fixed trailer; the body is
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

// pi's red line under an assistant message (assistant-message.js): a length
// stop always, an error or abort only when no tool row reports it instead. An
// errored or aborted message's tool calls get no tool events, so the peek draws
// no row for them and, unlike rows.mjs's `tails`, nothing closes there.
function tailText({ stopReason, errorMessage, content = [] }) {
  if (stopReason === "length") return "Response was truncated before completion.";
  if (content.some(part => part.type === "toolCall")) return "";
  if (stopReason === "aborted") return errorMessage && errorMessage !== "Request was aborted" ? errorMessage : "Operation aborted";
  if (stopReason === "error") return `Error: ${errorMessage || "Unknown error"}`;
  return "";
}

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
      if (key) addFold(state.folds, record.toolCallId, key, args);
      else closeFolds(state.folds);
      return;
    }
    case "tool_execution_end": {
      // Its start fell off the window still running; the earlier-activity note stands for both.
      if (state.trimmedPending.delete(record.toolCallId)) return;
      // pi-web-search reports failures in `details.error` without `isError`,
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
        // A foreign or partial log's end with no start: a visible non-member closes the run above it.
        closeFolds(state.folds);
      }
      return;
    }
    case "message_end": {
      const message = record.message;
      if (message?.role === "assistant") {
        // One row per text block, trimmed as pi draws each (assistant-message.js).
        const texts = (message.content ?? []).filter(part => part.type === "text" && part.text?.trim()).map(part => part.text.trim());
        for (const text of texts) state.rows.push({ kind: "assistant", text });
        const tail = tailText(message);
        if (tail) state.rows.push({ kind: "error", text: tail });
        if (texts.length || tail) closeFolds(state.folds);
      } else if (message?.role === "user") {
        const text = messageText(message);
        const body = steerBody(text);
        // pi draws no box for a message with no text (an image-only prompt), but the turn still closes the group.
        if ((body ?? text).trim()) state.rows.push({ kind: "user", text: body ?? text });
        // A pending tool must stay outside the group that closes here (rows.mjs's `input` handler).
        closeLive(state.folds);
      }
      return;
    }
    case "subagent.steer.failed": {
      const reason = record.reason ?? record.error;
      state.rows.push({ kind: "note", text: `steer failed${reason ? ` · ${reason}` : ""}` });
      closeFolds(state.folds);
      return;
    }
    case "entry_appended": {
      // The child's own completion lines (rows.mjs's `appendVisible`); its other entries draw nothing here.
      const { type, customType, data } = record.entry ?? {};
      if (type !== "custom" || !Object.hasOwn(DONE, customType)) return;
      const mapped = DONE[customType].line(data);
      if (data.status === "completed") {
        addCompletion(state.folds, customType, data);
        state.rows.push({ kind: "completion", seq: data.seq, mapped });
      } else {
        state.rows.push({ kind: "completion", mapped });
        closeFolds(state.folds);
      }
      return;
    }
    case "subagent.events.truncated": {
      state.rows.push({ kind: "note", text: "further activity not recorded (event log limit)" });
      closeFolds(state.folds);
      return;
    }
    case "agent_start": {
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
      // subagent.steer.requested|routed|scheduled|queued|delivered (the
      // parent's flash and the sent steer's block say it), subagent.steering.notice,
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
    // Tool rows trimmed while pending, so their late end draws nothing; each id leaves when its end arrives.
    trimmedPending: new Set(),
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
    if (row.kind === "tool") {
      state.toolRowsById.delete(row.id);
      trimmedIds.add(row.id);
      if (row.pending) state.trimmedPending.add(row.id);
    }
    else if (row.seq !== undefined) trimmedIds.add(row.seq);
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
    // A backgrounded call answered inside its grace period reads as the foreground call it was (rows.mjs's `settleFold`).
    const inline = row.name === "workspace_bash" && !row.pending && row.args.run_in_background && !row.result?.details?.taskId;
    const { title, bodyName } = toolRowMeta(row.name, inline ? { ...row.args, run_in_background: false } : row.args);
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
        return [noteLine(row.text, theme)];
      case "turn":
        return [formatTurn(row, theme)];
      case "error":
        return row.text.split("\n").flatMap(line => wrapTextWithAnsi(theme.fg("error", line), width));
      default:
        return [];
    }
  });
}

// A tool or completion row's lines — rule 2's three levels (docs/pi-design.md)
// through the main chat's own `groupLines`, `own` being the row's full
// rendering. Unlike the main chat's completion entries, every peek row draws
// itself under ctrl+o, so none rides the row before it.
// Only group-dependent lines (the sentence, member lines) are recomputed every
// render; `toolRowLines` caches the row's own full rendering.
function grouped(folds, id, own, theme, expanded) {
  const group = foldGroup(folds, id) ?? liveGroup(folds, id);
  if (!group) return own;
  return groupLines(folds, group, { first: group.entries[0].id === id, expanded, state: { open: expanded }, own }, theme);
}

// The blank-line rhythm (docs/pi-design.md rules 2 and 8 applied to the
// peek), the main chat's: one blank above every block that draws at least one
// line. A group's later members draw nothing, so a group is one block; under
// ctrl+o each full row is its own block again, the handle riding the first.
export function renderRows(state, width, theme, { expanded = false } = {}) {
  const output = [];
  for (const row of state.rows) {
    const lines = row.kind === "tool" ? grouped(state.folds, row.id, toolRowLines(row, theme, { width, expanded }), theme, expanded)
      : row.kind === "completion" ? grouped(state.folds, row.seq, [completionLine(row.mapped, theme)], theme, expanded)
      : renderRow(row, width, theme);
    if (!lines.length) continue;
    if (output.length) output.push("");
    output.push(...lines);
  }
  return output;
}
