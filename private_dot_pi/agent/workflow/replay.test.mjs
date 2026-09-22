import test from "node:test";
import assert from "node:assert/strict";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { EARLIER_NOTE, createReplay, renderRows, replayEvents, trimRows } from "./replay.mjs";

// The markdown theme reads pi's own theme; the default one is enough.
initTheme();

const theme = { fg: (c, t) => `<${c}>${t}`, bg: (c, t) => `[${c}]${t}`, bold: t => t };
const WIDTH = 60;

const feed = (...records) => {
  const state = createReplay();
  replayEvents(state, records.map(r => JSON.stringify(r)).join("\n") + "\n");
  return state;
};

const render = (state, options) => renderRows(state.rows, WIDTH, theme, options);

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

test("toolResult, agent_* and turn_* events produce no rows", () => {
  const state = feed(
    { type: "message_end", message: { role: "toolResult", content: [{ type: "text", text: "x" }] } },
    { type: "agent_start" },
    { type: "agent_end" },
    { type: "turn_start" },
    { type: "turn_end" },
    { type: "agent_settled" },
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
