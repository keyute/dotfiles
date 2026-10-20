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

function makeDialog({ records, rows = 24, selected, signal, describe } = {}) {
  let renders = 0;
  const doneCalls = [];
  const group = makeGroup(records);
  const tui = { requestRender: () => renders++, terminal: { rows } };
  const dialog = new WorkflowView(tui, theme, keybindings, value => doneCalls.push(value), { group, signal, selected, describe, tickMs: 1e6 });
  return { dialog, group, doneCalls, renderCount: () => renders };
}

const RECORDS = (now = Date.now()) => [
  { runId: "r1", agent: "scout", task: "Map the repo", status: "completed", startedAt: now - 134e3, durationMs: 40e3, tokens: 12_300 },
  { runId: "r2", agent: "reviewer", task: "Check auth", status: "completed", phase: "Review", startedAt: now - 90e3, durationMs: 50e3, tokens: 9_000 },
  { runId: "r3", agent: "reviewer", task: "Check io", status: "failed", phase: "Review", startedAt: now - 90e3, durationMs: 62e3 },
  { runId: "r4", agent: "worker", task: "Patch", status: "running", phase: "Fix", startedAt: now - 30e3 },
  { runId: "r5", agent: "reviewer", task: "Check ui", status: "launching", phase: "Fix" },
];

test("a progress header, phases in first-appearance order with counts, agent rows with status, elapsed and tokens", () => {
  const { dialog } = makeDialog({ records: RECORDS(), describe: id => (id === "r4" ? { tokens: { total: 8_000 } } : undefined) });
  assert.deepEqual(dialog.render(90), [
    "-".repeat(90),
    "  ~workflow~  *Audit*  +▰▰▰▰▰▰+!▰▰▰▰!*▰▰▰*~▱▱▱~  2/5 · 1 failed · 2m 14s        ~esc back~",
    "",
    `*❭* +•+ *scout › Map the repo*${" ".repeat(42)}40s · 12.3k tokens`,
    "  _Review_ · 1/2",
    `    +•+ reviewer › Check auth${" ".repeat(46)}50s · 9k tokens`,
    `    !•! reviewer › Check io${" ".repeat(46)}!failed! · 1m 02s`,
    "  _Fix_ · 0/2",
    `    • worker › Patch${" ".repeat(55)}30s · 8k tokens`,
    `    ~•~ reviewer › Check ui${" ".repeat(52)}~launching~`,
    "",
    "-".repeat(90),
  ]);
  // Too narrow for the bar beside the name: it goes whole.
  assert.equal(dialog.render(60)[1], "  ~workflow~  *Audit*  2/5 · 1 failed · 2m 14s    ~esc back~");
});

test("up and down move the cursor, which scrolls the fixed window; a status change re-renders", () => {
  const records = Array.from({ length: 12 }, (_, i) => ({ runId: `r${i}`, agent: "scout", task: `t${i}`, status: "running", phase: "Survey" }));
  const { dialog, group, renderCount } = makeDialog({ records });
  // slotHeight(24) = 12 rows: two rules, the header and its blank leave 8.
  const window = () => dialog.render(40).slice(3, -1);
  assert.equal(window().length, 8);
  assert.deepEqual(window().slice(0, 2), ["  _Survey_ · 0/12", "*❭*   • *scout › t0*"]);
  for (let i = 0; i < 9; i++) dialog.handleInput("\x1b[B");
  assert.deepEqual([window()[0], window().at(-1)], ["    • scout › t2", "*❭*   • *scout › t9*"]);
  for (let i = 0; i < 20; i++) dialog.handleInput("\x1b[B");
  assert.equal(window().at(-1), "*❭*   • *scout › t11*");
  for (let i = 0; i < 12; i++) dialog.handleInput("\x1b[A");
  assert.deepEqual(window().slice(0, 1), ["*❭*   • *scout › t0*"]);
  const before = renderCount();
  records[0].status = "completed";
  group.changed();
  assert.equal(renderCount(), before + 1);
  assert.equal(window()[0], "*❭*   +•+ *scout › t0*");
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
  assert.equal(reopened.render(60)[6], `*❭*   !•! *reviewer › Check io*${" ".repeat(12)}!failed! · 1m 02s`);
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
