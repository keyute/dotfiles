import test from "node:test";
import assert from "node:assert/strict";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { foldGroup } from "./rows.mjs";
import { EARLIER_NOTE, createReplay, renderRows, replayEvents, trimRows } from "./replay.mjs";

// The markdown theme reads pi's own theme; the default one is enough.
initTheme();

const theme = { fg: (c, t) => `<${c}>${t}`, bg: (c, t) => `[${c}]${t}`, bold: t => t };
const WIDTH = 60;

// A fixed `pick` (index 0 of rows.mjs's TURN_VERBS: "Integrating"/"Integrated")
// makes a peek's own turn line deterministic.
const feedWith = (options, ...records) => {
  const state = createReplay(options);
  replayEvents(state, records.map(r => JSON.stringify(r)).join("\n") + "\n");
  return state;
};
const feed = (...records) => feedWith({}, ...records);
const feedDeterministic = (...records) => feedWith({ pick: () => 0 }, ...records);

const render = (state, options) => renderRows(state, WIDTH, theme, options);

test("trimRows keeps the newest rows behind one note and forgets what fell off", () => {
  const state = createReplay();
  replayEvents(state, [
    JSON.stringify({ type: "tool_execution_start", toolCallId: "t1", toolName: "workspace_read", args: { path: "a" } }),
    JSON.stringify({ type: "tool_execution_start", toolCallId: "t2", toolName: "workspace_read", args: { path: "b" } }),
    JSON.stringify({ type: "subagent.steer.queued", requestId: "q1" }),
    JSON.stringify({ type: "tool_execution_start", toolCallId: "t3", toolName: "workspace_read", args: { path: "c" } }),
  ].join("\n") + "\n");
  trimRows(state, 2);
  assert.deepEqual(state.rows.map(row => (row.kind === "tool" ? row.id : row.text)), [EARLIER_NOTE, "steer queued", "t3"]);
  assert.equal(state.toolRowsById.has("t1"), false);
  assert.equal(state.toolRowsById.has("t3"), true);
  trimRows(state, 2);
  assert.equal(state.rows.filter(row => row.text === EARLIER_NOTE).length, 1);
  // A late end for a dropped start appends a settled row instead of touching the gone one.
  replayEvents(state, JSON.stringify({ type: "tool_execution_end", toolCallId: "t1", toolName: "workspace_read", result: { content: [{ type: "text", text: "x" }] }, isError: false }) + "\n");
  assert.equal(state.rows.at(-1).id, "t1");
});

test("a start/end pair settles into one row with a summary and no body", () => {
  const state = feed(
    { type: "tool_execution_start", toolCallId: "c1", toolName: "workspace_bash", args: { command: "npm test" } },
    { type: "tool_execution_end", toolCallId: "c1", toolName: "workspace_bash", isError: false, result: { content: [{ type: "text", text: "ok\n31 passing" }] } },
  );
  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].pending, false);
  const lines = render(state);
  assert.match(lines[0], /Ran npm test/);
  assert.ok(lines.some(l => l.includes("↳")));
  assert.ok(!lines.some(l => l.includes("31 passing")));
});

test("expanded adds the body", () => {
  const state = feed(
    { type: "tool_execution_start", toolCallId: "c1", toolName: "workspace_bash", args: { command: "npm test" } },
    { type: "tool_execution_end", toolCallId: "c1", toolName: "workspace_bash", isError: false, result: { content: [{ type: "text", text: "31 passing" }] } },
  );
  const lines = render(state, { expanded: true });
  assert.ok(lines.some(l => l.includes("31 passing")));
});

test("an isError bash end shows the error glyph and head/tail elision", () => {
  const errorLines = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  const state = feed(
    { type: "tool_execution_start", toolCallId: "c1", toolName: "workspace_bash", args: { command: "npm test" } },
    { type: "tool_execution_end", toolCallId: "c1", toolName: "workspace_bash", isError: true, result: { content: [{ type: "text", text: `${errorLines}\nCommand exited with code 1` }] } },
  );
  const lines = render(state);
  assert.match(lines[0], /<error>/);
  assert.ok(lines.some(l => /more lines/.test(l)));
  assert.ok(lines.some(l => l.includes("Command exited with code 1")));
});

test("an end with no matching start appends a settled row", () => {
  const state = feed({ type: "tool_execution_end", toolCallId: "c9", toolName: "workspace_ls", isError: false, result: { content: [{ type: "text", text: "a\nb" }] } });
  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].pending, false);
  const lines = render(state);
  assert.match(lines[0], /List/);
});

test("a chunk split mid-line parses once across two calls", () => {
  const state = createReplay();
  const record = JSON.stringify({ type: "tool_execution_start", toolCallId: "c1", toolName: "workspace_bash", args: { command: "npm test" } });
  replayEvents(state, record.slice(0, 10));
  replayEvents(state, `${record.slice(10)}\n`);
  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].id, "c1");
});

test("assistant text becomes a bullet with markdown, thinking-only becomes nothing", () => {
  const state = feed(
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Done." }] } },
    { type: "message_end", message: { role: "assistant", content: [{ type: "thinking", thinking: "hmm" }] } },
  );
  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].kind, "assistant");
  const lines = render(state);
  assert.ok(lines.some(l => l.includes("Done.")));
});

test("a leading heading rides the bullet line", () => {
  const state = feed({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "# Title\nbody" }] } });
  const lines = render(state);
  assert.ok(lines.some(l => l.includes("Title")));
});

test("a steer-prefixed user message renders a shaded block with only the body", () => {
  const text = "Mid-run steering from the parent orchestrator:\n\nFocus on tests\n\nIncorporate this guidance at the next safe point. Do not restart the task unless the guidance explicitly asks you to.";
  const state = feed({ type: "message_end", message: { role: "user", content: [{ type: "text", text }] } });
  assert.equal(state.rows[0].kind, "user");
  assert.equal(state.rows[0].steer, true);
  assert.equal(state.rows[0].text, "Focus on tests");
  const lines = render(state);
  assert.ok(lines.some(l => l.includes("Focus on tests")));
  assert.ok(!lines.some(l => l.includes("Incorporate this guidance")));
});

test("a plain user message is the task block", () => {
  const state = feed({ type: "message_end", message: { role: "user", content: [{ type: "text", text: "Task: fix the bug" }] } });
  assert.equal(state.rows[0].kind, "user");
  assert.equal(state.rows[0].steer, undefined);
  const lines = render(state);
  assert.ok(lines.some(l => l.includes("Task: fix the bug")));
});

test("user Markdown retains inline formatting, ordered markers, and the theme's text colour", () => {
  const state = feed({ type: "message_end", message: { role: "user", content: [{ type: "text", text: "Try **bold** and `code`\n\n3. third\n4. fourth" }] } });
  const lines = render(state);
  assert.ok(lines.length > 4);
  assert.ok(lines.every(line => line.startsWith("[userMessageBg]")));
  assert.ok(lines[1].includes("<userMessageText>❯ Try"));
  assert.ok(lines.some(line => line.includes("bold") && !line.includes("**bold**")));
  assert.ok(lines.some(line => line.includes("code") && !line.includes("`code`")));
  const plain = lines.map(line => line.replace(/\x1b\[[\d;]*m|<userMessageText>/g, ""));
  assert.ok(plain.some(line => line.includes("3. third")));
  assert.ok(plain.some(line => line.includes("4. fourth")));
});

test("task, steer, and multiline blocks retain Markdown paragraphs and shaded blank rows", () => {
  const task = "First paragraph\n\nSecond paragraph\nwith another line\n\n> quoted";
  const steer = `Queued follow-up from the parent orchestrator:\n\n${task}\n\nIncorporate this guidance at the next safe point. Do not restart the task unless the guidance explicitly asks you to.`;
  for (const text of [task, steer]) {
    const state = feed({ type: "message_end", message: { role: "user", content: [{ type: "text", text }] } });
    const lines = render(state);
    assert.ok(lines.every(line => line.startsWith("[userMessageBg]")));
    assert.equal(lines.filter(line => line.includes("❯")).length, 1);
    assert.ok(lines[1].includes("❯ First paragraph"));
    assert.ok(lines.some(line => line.includes("Second paragraph")));
    assert.ok(lines.some(line => line.includes("with another line")));
    assert.ok(lines.some(line => line.includes("quoted")));
    assert.ok(lines.some(line => line === "[userMessageBg]" + " ".repeat(WIDTH)));
    assert.ok(!lines.some(line => line.includes("Incorporate this guidance")));
  }
});

test("clearing a replay row's line cache repaints it under a changed theme", () => {
  const state = feed({ type: "message_end", message: { role: "user", content: [{ type: "text", text: "Hello" }] } });
  render(state);
  state.rows[0]._linesKey = undefined;
  state.rows[0]._lines = undefined;
  const changed = { ...theme, fg: (c, t) => `{${c}}${t}` };
  assert.ok(renderRows(state, WIDTH, changed).some(line => line.includes("{userMessageText}❯ Hello")));
});

test("toolResult and turn_* events produce no rows", () => {
  const state = feed(
    { type: "message_end", message: { role: "toolResult", content: [{ type: "text", text: "x" }] } },
    { type: "turn_start" },
    { type: "turn_end" },
  );
  assert.equal(state.rows.length, 0);
});

test("queued then delivered for one requestId settles to one note with the final text", () => {
  const state = feed(
    { type: "subagent.steer.queued", requestId: "r1" },
    { type: "subagent.steer.delivered", requestId: "r1" },
  );
  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].kind, "note");
  assert.equal(state.rows[0].text, "steer delivered");
});

test("a failed steer records the reason", () => {
  const state = feed({ type: "subagent.steer.failed", requestId: "r1", error: "child gone" });
  assert.equal(state.rows[0].text, "steer failed · child gone");
});

test("the truncation marker appends a note and sets the flag", () => {
  const state = feed({ type: "subagent.events.truncated" });
  assert.equal(state.rows[0].kind, "note");
  const lines = render(state);
  assert.ok(lines.some(l => l.includes("further activity not recorded")));
});

test("malformed JSON and an unknown type are skipped without throwing", () => {
  const state = createReplay();
  assert.doesNotThrow(() => {
    replayEvents(state, `not json\n${JSON.stringify({ type: "some_unknown_event" })}\n`);
  });
  assert.equal(state.rows.length, 0);
});

test("workspace_task titles its own row", () => {
  const state = feed(
    { type: "tool_execution_start", toolCallId: "c1", toolName: "workspace_task", args: { id: "t1", action: "output" } },
    { type: "tool_execution_end", toolCallId: "c1", toolName: "workspace_task", isError: false, result: { content: [{ type: "text", text: "log line" }] } },
  );
  const lines = render(state);
  assert.match(lines[0], /Task t1 output/);
});

test("an mcp__ tool takes pluginTitle", () => {
  const state = feed({ type: "tool_execution_start", toolCallId: "c1", toolName: "mcp__server_tool", args: { query: "hi" } });
  const lines = render(state);
  assert.match(lines[0], /server › tool/);
});

test("a 100 KiB result text is capped at 32 KiB in the stored row", () => {
  const big = "x".repeat(100 * 1024);
  const state = feed(
    { type: "tool_execution_start", toolCallId: "c1", toolName: "workspace_read", args: { path: "a.txt" } },
    { type: "tool_execution_end", toolCallId: "c1", toolName: "workspace_read", isError: false, result: { content: [{ type: "text", text: big }] } },
  );
  const stored = state.rows[0].result.content[0].text;
  assert.ok(stored.length < big.length);
  assert.ok(stored.endsWith("… truncated"));
  assert.ok(stored.length <= 32 * 1024 + "… truncated".length);
});

const readOk = (id, path) => [
  { type: "tool_execution_start", toolCallId: id, toolName: "workspace_read", args: { path } },
  { type: "tool_execution_end", toolCallId: id, toolName: "workspace_read", isError: false, result: { content: [{ type: "text", text: "hi" }] } },
];
const says = text => ({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }] } });

test("two successful tool rows sealed by assistant text collapse to one sentence; ctrl+o expands both full rows", () => {
  const state = feedDeterministic(
    ...readOk("c1", "a"),
    { type: "tool_execution_start", toolCallId: "c2", toolName: "workspace_bash", args: { command: "npm test" } },
    { type: "tool_execution_end", toolCallId: "c2", toolName: "workspace_bash", isError: false, result: { content: [{ type: "text", text: "ok" }] } },
    says("Done"),
  );
  const closed = render(state);
  assert.ok(closed.some(l => l.includes("▸") && l.includes("Read 1 file, ran 1 shell command")));
  assert.ok(!closed.some(l => l.includes("Ran npm test")));
  const open = render(state, { expanded: true });
  assert.ok(open.some(l => l.includes("▾") && l.includes("Read 1 file, ran 1 shell command")));
  assert.ok(open.some(l => /Read a/.test(l)));
  assert.ok(open.some(l => /Ran npm test/.test(l)));
});

test("two successes with nothing after form a live group: a sentence plus one member line per row", () => {
  const state = feedDeterministic(...readOk("c1", "a"), ...readOk("c2", "b"));
  const lines = render(state);
  assert.ok(lines.some(l => l.includes("•") && l.includes("Read 2 files")));
  assert.equal(lines.filter(l => l.includes("↳")).length, 2);
});

test("a pending third tool renders as a plain row below the live group", () => {
  const state = feedDeterministic(...readOk("c1", "a"), ...readOk("c2", "b"), { type: "tool_execution_start", toolCallId: "c3", toolName: "workspace_bash", args: { command: "npm test" } });
  const lines = render(state);
  assert.ok(lines.some(l => l.includes("Read 2 files")));
  assert.ok(lines.some(l => /Ran npm test/.test(l)));
});

test("a failed row seals the run above it and renders in full with the error glyph, never as a member", () => {
  const state = feedDeterministic(
    { type: "tool_execution_start", toolCallId: "r1", toolName: "workspace_read", args: { path: "a" } },
    { type: "tool_execution_start", toolCallId: "r2", toolName: "workspace_read", args: { path: "b" } },
    { type: "tool_execution_start", toolCallId: "f", toolName: "workspace_bash", args: { command: "boom" } },
    { type: "tool_execution_end", toolCallId: "r1", toolName: "workspace_read", isError: false, result: { content: [{ type: "text", text: "hi" }] } },
    { type: "tool_execution_end", toolCallId: "r2", toolName: "workspace_read", isError: false, result: { content: [{ type: "text", text: "hi" }] } },
    { type: "tool_execution_end", toolCallId: "f", toolName: "workspace_bash", isError: true, result: { content: [{ type: "text", text: "boom\nCommand exited with code 1" }] } },
    says("Done"),
  );
  assert.equal(foldGroup(state.folds, "f"), null);
  const lines = render(state);
  assert.ok(lines.some(l => l.includes("Read 2 files")));
  assert.ok(lines.some(l => l.includes("<error>") && /Ran boom/.test(l)));
  assert.ok(lines.some(l => l.includes("Command exited with code 1")));
});

test("a user block arriving while a tool is pending seals the successes before it, leaving the pending tool outside", () => {
  const state = feedDeterministic(
    { type: "tool_execution_start", toolCallId: "r1", toolName: "workspace_read", args: { path: "a" } },
    { type: "tool_execution_start", toolCallId: "r2", toolName: "workspace_read", args: { path: "b" } },
    { type: "tool_execution_start", toolCallId: "pending", toolName: "workspace_bash", args: { command: "npm test" } },
    { type: "tool_execution_end", toolCallId: "r1", toolName: "workspace_read", isError: false, result: { content: [{ type: "text", text: "hi" }] } },
    { type: "tool_execution_end", toolCallId: "r2", toolName: "workspace_read", isError: false, result: { content: [{ type: "text", text: "hi" }] } },
    { type: "message_end", message: { role: "user", content: [{ type: "text", text: "keep going" }] } },
  );
  assert.deepEqual(foldGroup(state.folds, "r1")?.counts, { read: 2 });
  assert.equal(foldGroup(state.folds, "pending"), null);
  const lines = render(state);
  assert.ok(lines.some(l => l.includes("Read 2 files")));
  assert.ok(lines.some(l => l.includes("keep going")));
});

test("a settled turn 12s after agent_start renders the deterministic verb and duration", () => {
  const state = feedDeterministic({ type: "agent_start", observedAt: 1000 }, { type: "agent_settled", observedAt: 13000 });
  const lines = render(state);
  assert.ok(lines.some(l => /Integrated for 12s · done/.test(l)));
});

test("an aborted agent_end prints Interrupted at once; the following agent_settled prints no second turn line", () => {
  const state = feedDeterministic(
    { type: "agent_start", observedAt: 1000 },
    { type: "agent_end", observedAt: 5000, messages: [{ role: "assistant", stopReason: "aborted" }] },
    { type: "agent_settled", observedAt: 9000 },
  );
  const lines = render(state);
  const turnLines = lines.filter(l => l.includes("π"));
  assert.equal(turnLines.length, 1);
  assert.ok(turnLines[0].includes("Interrupted after"));
});

test("trimRows dropping the first row of a group leaves its sentence counting only the retained rows", () => {
  const state = feedDeterministic(...readOk("r1", "a"), ...readOk("r2", "b"), ...readOk("r3", "c"), ...readOk("r4", "d"), says("Done"));
  assert.deepEqual(foldGroup(state.folds, "r1")?.counts, { read: 4 });
  trimRows(state, 4);
  assert.equal(state.toolRowsById.has("r1"), false);
  assert.deepEqual(foldGroup(state.folds, "r2")?.counts, { read: 3 });
});
