import test from "node:test";
import assert from "node:assert/strict";
import { WorkflowView, openWorkflowView } from "./workflow-view.mjs";

// accent → *text*, dim → ~text~, success → +text+, error → !text!, bold → _text_;
// rules and muted text plain, so the assertions show which parts are styled.
const MARKS = { accent: "*", dim: "~", success: "+", error: "!" };
const theme = { fg: (colour, text) => (MARKS[colour] ? `${MARKS[colour]}${text}${MARKS[colour]}` : colour === "borderAccent" ? "-".repeat(text.length) : text), bold: text => `_${text}_` };
const KEYS = { "tui.select.up": "\x1b[A", "tui.select.down": "\x1b[B", "tui.select.confirm": "\r", "tui.select.cancel": "\x1b" };
const keybindings = { matches: (data, action) => KEYS[action] === data };

function makeGroup(records) {
  const listeners = new Set();
  return {
    title: "Audit", records, startedAt: Date.now() - 134_000, endedAt: undefined,
    onChange: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    changed: () => { for (const listener of listeners) listener(); },
    listeners,
  };
}

function makeDialog({ records, rows = 24, selected, signal } = {}) {
  let renders = 0;
  const doneCalls = [];
  const group = makeGroup(records);
  const tui = { requestRender: () => renders++, terminal: { rows } };
  const dialog = new WorkflowView(tui, theme, keybindings, value => doneCalls.push(value), { group, signal, selected, tickMs: 1e6 });
  return { dialog, group, doneCalls, renderCount: () => renders };
}

const RECORDS = () => [
  { runId: "r1", agent: "scout", task: "Map the repo", status: "completed" },
  { runId: "r2", agent: "reviewer", task: "Check auth", status: "completed", phase: "Review" },
  { runId: "r3", agent: "reviewer", task: "Check io", status: "failed", phase: "Review" },
  { runId: "r4", agent: "worker", task: "Patch", status: "running", phase: "Fix" },
  { runId: "r5", agent: "reviewer", task: "Check ui", status: "launching", phase: "Review" },
];

test("phases in first-appearance order with counts, the unphased block first, the cursor on the first agent", () => {
  const { dialog } = makeDialog({ records: RECORDS() });
  assert.deepEqual(dialog.render(60), [
    "-".repeat(60),
    "  ~workflow~  *Audit* · 5 agents · 2m 14s         ~esc back~",
    "",
    "*❭* *scout › Map the repo* · +completed+",
    "  _Review_ · 1/3 done",
    "    reviewer › Check auth · +completed+",
    "    reviewer › Check io · !failed!",
    "    reviewer › Check ui · ~launching~",
    "  _Fix_ · 0/1 done",
    "    worker › Patch · running",
    "",
    "-".repeat(60),
  ]);
});

test("up and down move the cursor, which scrolls the fixed window; a status change re-renders", () => {
  const records = Array.from({ length: 12 }, (_, i) => ({ runId: `r${i}`, agent: "scout", task: `t${i}`, status: "running", phase: "Survey" }));
  const { dialog, group, renderCount } = makeDialog({ records });
  // slotHeight(24) = 12 rows: two rules, the header and its blank leave 8.
  const window = () => dialog.render(40).slice(3, -1);
  assert.equal(window().length, 8);
  assert.deepEqual(window().slice(0, 2), ["  _Survey_ · 0/12 done", "*❭*   *scout › t0* · running"]);
  for (let i = 0; i < 9; i++) dialog.handleInput("\x1b[B");
  assert.deepEqual([window()[0], window().at(-1)], ["    scout › t2 · running", "*❭*   *scout › t9* · running"]);
  for (let i = 0; i < 20; i++) dialog.handleInput("\x1b[B");
  assert.equal(window().at(-1), "*❭*   *scout › t11* · running");
  for (let i = 0; i < 12; i++) dialog.handleInput("\x1b[A");
  assert.deepEqual(window().slice(0, 1), ["*❭*   *scout › t0* · running"]);
  const before = renderCount();
  records[0].status = "completed";
  group.changed();
  assert.equal(renderCount(), before + 1);
  assert.equal(window()[0], "*❭*   *scout › t0* · +completed+");
});

test("Enter resolves the selected record, a finished one included; the view reopens on it", () => {
  const records = RECORDS();
  const { dialog, doneCalls, group } = makeDialog({ records });
  dialog.handleInput("\x1b[B");
  dialog.handleInput("\x1b[B");
  dialog.handleInput("\r");
  assert.deepEqual(doneCalls, [records[2]]);
  assert.equal(group.listeners.size, 0, "a settled view stops listening");
  const reopened = makeDialog({ records, selected: records[2] }).dialog;
  assert.equal(reopened.render(60)[6], "*❭*   *reviewer › Check io* · !failed!");
});

test("Esc or an abort resolves undefined", () => {
  const { dialog, doneCalls } = makeDialog({ records: RECORDS() });
  dialog.handleInput("\x1b");
  assert.deepEqual(doneCalls, [undefined]);
  const controller = new AbortController();
  const aborted = makeDialog({ records: RECORDS(), signal: controller.signal });
  controller.abort();
  assert.deepEqual(aborted.doneCalls, [undefined]);
  const preAborted = makeDialog({ records: RECORDS(), signal: AbortSignal.abort() });
  assert.deepEqual([preAborted.doneCalls, preAborted.group.listeners.size], [[undefined], 0]);
});

test("openWorkflowView mounts the view in pi's custom slot", async () => {
  const records = RECORDS();
  const ctx = { ui: { custom: async make => new Promise(resolve => make({ requestRender() {}, terminal: { rows: 24 } }, theme, keybindings, resolve).handleInput("\r")) } };
  assert.equal(await openWorkflowView(ctx, { group: makeGroup(records), tickMs: 1e6 }), records[0]);
});
