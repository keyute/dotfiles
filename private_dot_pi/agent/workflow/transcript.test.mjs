import test from "node:test";
import assert from "node:assert/strict";
import { Container } from "@earendil-works/pi-tui";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { addFold, appendVisible, closeFolds, createFolds, doneEntryRenderer, pluginRenderers, settleFold, toolRenderers } from "./rows.mjs";

// The markdown theme reads pi's theme; the default one is enough.
initTheme();

const strip = line => line.replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
// pi's own theme singleton (what a real mount would hand a registered entry
// renderer) is not exported; this direct call takes rows.test.mjs's own stub.
const theme = { fg: (color, text) => `<${color}>${text}`, bold: text => text };

// This test mounts the real ToolExecutionComponent from pi-coding-agent, wired
// to our own renderers and folds, to pin the one fact rows.test.mjs cannot see
// from the renderer functions alone: the blank line the shell itself puts
// above a row's content disappears along with the row once it folds (see
// stability.test.mjs's "a self-shelled row that renders no lines takes no
// line at all" pin), so a whole group — live or sealed, at any level — takes
// exactly one blank line, not one per member.
test("a stretch of rows takes one blank line per plain row, then one for the whole group at every level: live, sealed, clicked open, and under ctrl+o", () => {
  let toolsExpanded = false;
  const folds = createFolds(() => toolsExpanded);
  const ui = { requestRender() {} };
  const definitions = { read: toolRenderers("read", folds) };
  const container = new Container();
  const draw = () => container.render(80).map(strip);

  const mount = (id, args) => {
    const component = new ToolExecutionComponent("read", id, args, {}, definitions.read, ui, "/repo");
    component.markExecutionStarted();
    container.addChild(component);
    return component;
  };
  const settle = (component, id) => {
    addFold(folds, id, "read");
    const result = { content: [], details: {}, isError: false };
    component.updateResult(result);
    settleFold(folds, id, false, result);
  };

  // One settled row: a plain row, its shell's one blank line above it.
  const r1 = mount("r1", { path: "a" });
  settle(r1, "r1");
  assert.deepEqual(draw(), ["", "• Read a"]);

  // A second success forms the live block; a third row mounted below it, still
  // in flight, is not yet part of anything — one blank above the block, none
  // inside it, and its own one blank above the in-flight row.
  const r2 = mount("r2", { path: "b" });
  settle(r2, "r2");
  const r3 = mount("r3", { path: "c" });
  assert.deepEqual(draw(), ["", "• Read 2 files", "  ↳ Read a", "  ↳ Read b", "", "• Read c"]);

  // `r3` settles into the same block (nothing held it back), then a boundary
  // seals it: one blank line, the dim handle alone.
  settle(r3, "r3");
  closeFolds(folds);
  assert.deepEqual(draw(), ["", "▸ Read 3 files"]);

  // Clicked open with ctrl+o off: one blank, the undimmed handle, one member
  // line per row, nothing else — `draw()` must run once first so the
  // component's own hit-test height (set by its last render) is current.
  r1.handleMouse({ type: "click", button: "left", x: 0, y: 1, height: 10 });
  assert.deepEqual(draw(), ["", "▾ Read 3 files", "  ↳ Read a", "  ↳ Read b", "  ↳ Read c"]);

  // ctrl+o outranks the click: every row renders in full, today's open layout
  // — the first row's shell carries the handle and its own row together under
  // one blank line, each row after it back to its own blank line and row.
  toolsExpanded = true;
  for (const component of [r1, r2, r3]) component.invalidate();
  assert.deepEqual(draw(), ["", "▾ Read 3 files", "• Read a", "", "• Read b", "", "• Read c"]);
});

// pi-coding-agent's `CustomEntryComponent` (the host for a registered entry
// renderer, and the one that adds the spacer this test would otherwise pin)
// is not a public export — the package's `exports` map has no dist path for
// it — so this stands in with the same component `doneEntryRenderer` hands
// pi directly, asserting `render(width)` at each stage without the spacer a
// real mount would add above it (see the transition itself: the same
// component instance updates in place as a second completion joins it, since
// an entry renderer gets no invalidate handle of its own and reads state at
// paint time instead).
test("a completion's own component moves through the same levels a tool group does: solo, joined, sealed — the later member has no component at all", () => {
  const folds = createFolds(() => false);
  const pi = { appendEntry() {} };
  const render = doneEntryRenderer("workflow-child", folds);

  const a = { agent: "researcher", task: "Delegation claims", status: "completed", durationMs: 45_000 };
  appendVisible(pi, "workflow-child", a, folds);
  const first = render({ data: a }, {}, theme);
  assert.deepEqual(first.render(80).map(strip), ["<success>• <toolTitle>researcher finished<muted> · Delegation claims · 45s"]);

  const b = { agent: "reviewer", task: "Type audit", status: "completed", durationMs: 12_000 };
  appendVisible(pi, "workflow-child", b, folds);
  assert.equal(render({ data: b }, {}, theme), undefined);
  assert.deepEqual(first.render(80).map(strip), [
    "<success>• <toolTitle>Finished 2 agents",
    "  <muted>↳ <toolTitle>researcher finished › Delegation claims<muted> · 45s",
    "  <muted>↳ <toolTitle>reviewer finished › Type audit<muted> · 12s",
  ]);

  closeFolds(folds);
  assert.deepEqual(first.render(80).map(strip), ["<muted>▸ Finished 2 agents"]);
});

test("ctrl+o keeps interleaved completions after their preceding tool output, live and sealed", () => {
  const folds = createFolds(() => true);
  const container = new Container();
  const plainTheme = { fg: (_color, text) => text, bold: text => text };
  const finish = agent => {
    const data = { agent, status: "completed", durationMs: 1000 };
    appendVisible({ appendEntry() {} }, "workflow-child", data, folds);
    const component = doneEntryRenderer("workflow-child", folds)({ data }, {}, plainTheme);
    if (component) container.addChild(component);
  };
  const tool = (name, id, args, key, result) => {
    const definition = name === "read" ? toolRenderers(name, folds) : pluginRenderers(name, { folds });
    const component = new ToolExecutionComponent(name, id, args, {}, definition, { requestRender() {} }, "/repo");
    component.markExecutionStarted();
    component.setExpanded(true);
    container.addChild(component);
    addFold(folds, id, key);
    component.updateResult(result);
    settleFold(folds, id, false, result);
    return component;
  };
  finish("first");
  const read = tool("read", "r1", { path: "a" }, "read", { content: [{ type: "text", text: "alpha" }], details: {} });
  finish("second");
  const launch = tool("subagent", "s1", { agent: "reviewer", task: "Audit" }, "agent", { content: [], details: { asyncId: "run" } });
  finish("third");
  for (const sealed of [false, true]) {
    if (sealed) closeFolds(folds);
    read.invalidate();
    launch.invalidate();
    const lines = container.render(120).map(strip).filter(Boolean);
    assert.deepEqual(lines.slice(1), [
      "  ↳ first finished · 1s",
      "• Read a", "  ↳ 1 line", "  alpha",
      "  ↳ second finished · 1s",
      "• reviewer › Audit", "  ↳ launched",
      "  ↳ third finished · 1s",
    ]);
  }
});

test("a tool-led mixed group keeps one blank line, hides completion host spacers, and restores full tool output under ctrl+o", () => {
  let toolsExpanded = false;
  const folds = createFolds(() => toolsExpanded);
  const ui = { requestRender() {} };
  const definition = toolRenderers("read", folds);
  const container = new Container();
  const draw = () => container.render(120).map(strip);
  const mount = (id, path, text) => {
    const component = new ToolExecutionComponent("read", id, { path }, {}, definition, ui, "/repo");
    component.markExecutionStarted();
    container.addChild(component);
    addFold(folds, id, "read");
    const result = { content: [{ type: "text", text }], details: {}, isError: false };
    component.updateResult(result);
    settleFold(folds, id, false, result);
    return component;
  };

  const r1 = mount("r1", "a", "alpha");
  const r2 = mount("r2", "b", "beta");
  const done = { agent: "researcher", task: "Audit rows", status: "completed", durationMs: 45_000 };
  appendVisible({ appendEntry() {} }, "workflow-child", done, folds);
  assert.equal(doneEntryRenderer("workflow-child", folds)({ data: done }, {}, theme), undefined, "a later completion adds neither content nor its custom-entry spacer");
  assert.deepEqual(draw(), [
    "",
    "• Read 2 files, finished 1 agent",
    "  ↳ Read a · 1 line",
    "  ↳ Read b · 1 line",
    "  ↳ researcher finished › Audit rows · 45s",
  ]);

  closeFolds(folds);
  assert.deepEqual(draw(), ["", "▸ Read 2 files, finished 1 agent"]);

  toolsExpanded = true;
  for (const component of [r1, r2]) {
    component.setExpanded(true);
    component.invalidate();
  }
  assert.deepEqual(draw(), [
    "",
    "▾ Read 2 files, finished 1 agent",
    "• Read a",
    "  ↳ 1 line",
    "  alpha",
    "",
    "• Read b",
    "  ↳ 1 line",
    "  beta",
    "  ↳ researcher finished › Audit rows · 45s",
  ]);
});
