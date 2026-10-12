import test from "node:test";
import assert from "node:assert/strict";
import { Container, Spacer } from "@earendil-works/pi-tui";
import { AssistantMessageComponent, getMarkdownTheme, initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { addFold, appendVisible, bulletMarkdown, closeFolds, createFolds, doneEntryRenderer, doneGroup, installFolding, installReasoningHide, pluginRenderers, settleFold, toolRenderers } from "./rows.mjs";

// The markdown theme reads pi's theme; the default one is enough.
initTheme();

// OSC133 shell-integration markers ride on the first/last line alongside SGR
// colour codes; a real mount needs both stripped to compare rendered text.
const strip = line => line.replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
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

test("queued user input collapses the live group before pending output, without closing manual expansion", () => {
  let toolsExpanded = false;
  const folds = createFolds();
  const handlers = {};
  installFolding({ on: (name, handler) => { handlers[name] = handler; } }, { ui: { getToolsExpanded: () => toolsExpanded } }, folds);
  const container = new Container();
  const components = ["a", "b", "pending"].map(id => {
    const component = new ToolExecutionComponent("read", id, { path: id }, {}, toolRenderers("read", folds), { requestRender() {} }, "/repo");
    component.markExecutionStarted();
    container.addChild(component);
    handlers.tool_execution_start({ toolName: "workspace_read", toolCallId: id });
    return component;
  });
  for (const [index, id] of ["a", "b"].entries()) {
    const result = { content: [{ type: "text", text: `output ${id}` }], details: {} };
    components[index].updateResult(result);
    handlers.tool_execution_end({ toolCallId: id, result });
  }
  const draw = () => container.render(80).map(strip);
  assert.ok(draw().includes("• Read 2 files"));
  handlers.input({ source: "extension", text: "notification" });
  assert.ok(draw().includes("• Read 2 files"));
  handlers.input({ source: "interactive", streamingBehavior: "steer", text: "next request" });
  assert.deepEqual(draw(), ["", "▸ Read 2 files", "", "• Read pending"]);
  components[0].handleMouse({ type: "click", button: "left", x: 0, y: 1, height: 10 });
  assert.ok(draw().includes("▾ Read 2 files"));
  handlers.input({ source: "rpc", streamingBehavior: "followUp", text: "another request" });
  assert.ok(draw().includes("▾ Read 2 files"), "older manually opened groups stay open");
  toolsExpanded = true;
  for (const component of components) { component.setExpanded(true); component.invalidate(); }
  handlers.input({ source: "interactive", text: "keep expanded" });
  assert.ok(draw().includes("  output a"), "Ctrl+O remains authoritative");
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
  // Every row in full, the completions included, each a blank line below the
  // last; the live group draws its rows alone, the sealed one under its handle.
  const rows = [
    "• first finished · 1s",
    "", "• Read a", "  ↳ 1 line", "  alpha",
    "", "• second finished · 1s",
    "", "• reviewer › Audit", "  ↳ launched",
    "", "• third finished · 1s",
  ];
  for (const sealed of [false, true]) {
    if (sealed) closeFolds(folds);
    read.invalidate();
    launch.invalidate();
    assert.deepEqual(container.render(120).map(strip), sealed ? ["▾ Read 1 file, launched 1 agent, finished 3 agents", ...rows] : rows);
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
    "",
    "• researcher finished · Audit rows · 45s",
  ]);
});

test("parallel tools retain call order when their results finish in reverse", () => {
  const folds = createFolds();
  const container = new Container();
  const components = ["first", "second", "third"].map(id => {
    const component = new ToolExecutionComponent("read", id, { path: id }, {}, toolRenderers("read", folds), { requestRender() {} }, "/repo");
    component.markExecutionStarted();
    container.addChild(component);
    addFold(folds, id, "read");
    return { id, component };
  });
  for (const { id, component } of components.toReversed()) {
    const result = { content: [{ type: "text", text: id }], details: {} };
    component.updateResult(result);
    settleFold(folds, id, false, result);
  }
  assert.deepEqual(container.render(80).map(strip), ["", "• Read 3 files", "  ↳ Read first · 1 line", "  ↳ Read second · 1 line", "  ↳ Read third · 1 line"]);
});

test("a folded image result with image display disabled adds neither preview nor gap", () => {
  const folds = createFolds(() => false);
  const container = new Container();
  const ui = { requestRender() {} };
  const mount = id => {
    const component = new ToolExecutionComponent("read", id, { path: id }, { showImages: false }, toolRenderers("read", folds), ui, "/repo");
    component.markExecutionStarted();
    container.addChild(component);
    addFold(folds, id, "read");
    const result = { content: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }], details: {}, isError: false };
    component.updateResult(result);
    settleFold(folds, id, false, result);
    return component;
  };
  const first = mount("image", "a");
  const second = mount("text", "b");
  assert.equal(first.imageComponents.length, 0);
  assert.equal(second.imageComponents.length, 0);
  assert.equal(first.result.content[0].type, "image");
  assert.deepEqual(container.render(80).map(strip), ["", "• Read 2 files", "  ↳ Read image", "  ↳ Read text"]);
});

// pi's component decides its spacers from the raw thinking text, so the wrap
// hands it a copy without reasoning on every streaming update and at the end.
test("a streaming reply with reasoning draws exactly as the reply alone, reasoning alone draws nothing, and the streamed message keeps its reasoning", () => {
  installReasoningHide();
  const stream = updates => {
    const component = new AssistantMessageComponent(undefined, false, getMarkdownTheme(), "Thinking...", 0, [bulletMarkdown]);
    updates.forEach((message, i) => component.updateContent(message, i < updates.length - 1));
    return component.render(40).map(strip);
  };
  const thinking = { type: "thinking", thinking: "weighing it up" };
  const reply = { type: "text", text: "Done." };
  const partial = { role: "assistant", api: "openai-responses", content: [thinking] };
  const settled = { role: "assistant", api: "openai-responses", content: [thinking, reply] };
  assert.deepEqual(stream([partial]), []);
  assert.deepEqual(stream([partial, settled]), stream([{ ...settled, content: [reply] }]));
  assert.deepEqual(stream([partial, settled]), ["", "• Done."]);
  assert.deepEqual(settled.content, [thinking, reply]);
  assert.equal(thinking.thinking, "weighing it up");
});

// pi spaces two text blocks of one message only after a thinking run between
// them; the hide removes the run, so it puts that one blank line back for
// every shape a second text block arrives in.
test("two text blocks in one message are two bullets one blank line apart, however the message is shaped", () => {
  installReasoningHide();
  const draw = content => new AssistantMessageComponent({ role: "assistant", api: "openai-responses", content }, false, getMarkdownTheme(), "Thinking...", 0, [bulletMarkdown]).render(40).map(strip);
  const first = { type: "text", text: "First." };
  const second = { type: "text", text: "Second." };
  const thinking = { type: "thinking", thinking: "weighing it up" };
  const call = { type: "toolCall", id: "t1", name: "read", arguments: {} };
  for (const content of [[first, thinking, second], [first, second], [first, call, second]]) {
    assert.deepEqual(draw(content), ["", "• First.", "", "• Second."], JSON.stringify(content.map(block => block.type)));
  }
  assert.deepEqual(draw([first]), ["", "• First."]);
  // pi's own tail keeps its one spacer.
  const truncated = new AssistantMessageComponent({ role: "assistant", api: "openai-responses", content: [first, second], stopReason: "length" }, false, getMarkdownTheme(), "Thinking...", 0, [bulletMarkdown]).render(80).map(strip);
  assert.deepEqual(truncated, ["", "• First.", "", "• Second.", "", "Response was truncated before completion."]);
});

// pi mounts an entry that lands while a reply streams above that reply, and
// asks its renderer for a component only then (stability.test.mjs pins both),
// so this host does the same; a real mount adds the spacer it adds here.
test("entries that land while a reply streams fold where pi mounts them, above it, and only a mounted completion ever leads a group", () => {
  installReasoningHide();
  const folds = createFolds(() => false);
  const handlers = {};
  installFolding({ on: (name, handler) => { handlers[name] = handler; } }, { ui: { getToolsExpanded: () => false } }, folds);
  const plainTheme = { fg: (_color, text) => text, bold: text => text };
  const chat = new Container();
  const draw = () => chat.render(120).map(strip);
  let streaming = null;
  const mounted = new Set();
  const render = doneEntryRenderer("workflow-child", folds);
  const pi = {
    appendEntry(_type, data) {
      const component = render({ data }, {}, plainTheme);
      if (!component) return;
      if (data.seq) mounted.add(data.seq);
      const entry = new Container();
      entry.addChild(new Spacer(1));
      entry.addChild(component);
      const at = streaming ? chat.children.indexOf(streaming) : -1;
      if (at >= 0) chat.children.splice(at, 0, entry);
      else chat.addChild(entry);
    },
  };
  const finish = (agent, status = "completed") => appendVisible(pi, "workflow-child", { agent, status, durationMs: 1000 }, folds);
  const rows = ["a", "b"].map(id => {
    const component = new ToolExecutionComponent("read", id, { path: id }, {}, toolRenderers("read", folds), { requestRender() {} }, "/repo");
    component.markExecutionStarted();
    chat.addChild(component);
    handlers.tool_execution_start({ toolName: "workspace_read", toolCallId: id, args: { path: id } });
    const result = { content: [{ type: "text", text: id }], details: {} };
    component.updateResult(result);
    handlers.tool_execution_end({ toolCallId: id, result });
    return component;
  });

  const reply = { role: "assistant", api: "openai-responses", content: [{ type: "text", text: "Reply." }] };
  handlers.message_start({ message: { ...reply, content: [] } });
  streaming = new AssistantMessageComponent(undefined, false, getMarkdownTheme(), "Thinking...", 0, [bulletMarkdown]);
  chat.addChild(streaming);
  streaming.updateContent(reply, true);
  handlers.message_update({ message: reply });
  finish("first");
  assert.deepEqual(draw(), ["", "▸ Read 2 files, finished 1 agent", "", "• Reply."]);
  // The group keeps its key, so a click survives the entries that land below it.
  rows[0].handleMouse({ type: "click", button: "left", x: 0, y: 1, height: 10 });
  finish("broken", "failed");
  finish("second");
  handlers.message_update({ message: reply });
  finish("third");
  handlers.message_end({ message: { ...reply, stopReason: "stop" } });
  streaming = null;
  finish("fourth");
  assert.deepEqual(draw(), [
    "", "▾ Read 2 files, finished 1 agent", "  ↳ Read a · 1 line", "  ↳ Read b · 1 line", "  ↳ first finished · 1s",
    "", "• broken failed · 1s",
    "", "▸ Finished 2 agents",
    "", "• Reply.",
    "", "• fourth finished · 1s",
  ]);
  for (const fact of folds.facts.values()) {
    if (fact.source !== "completion") continue;
    const group = doneGroup(folds, fact.id);
    assert.equal(mounted.has(fact.id), !group || group.entries[0].id === fact.id, fact.data.agent);
  }
});

test("a run a quiet notice starts, opening with a tool-only message, continues the group above it", () => {
  const folds = createFolds(() => false);
  const handlers = {};
  installFolding({ on: (name, handler) => { handlers[name] = handler; } }, { ui: { getToolsExpanded: () => false } }, folds);
  const container = new Container();
  const read = id => {
    const component = new ToolExecutionComponent("read", id, { path: id }, {}, toolRenderers("read", folds), { requestRender() {} }, "/repo");
    component.markExecutionStarted();
    container.addChild(component);
    handlers.tool_execution_start({ toolName: "workspace_read", toolCallId: id, args: { path: id } });
    const result = { content: [{ type: "text", text: id }], details: {} };
    component.updateResult(result);
    handlers.tool_execution_end({ toolCallId: id, result });
  };
  read("a");
  read("b");
  handlers.agent_start?.({});
  const notice = { role: "custom", customType: "subagent-notify", display: false, content: "researcher finished" };
  handlers.message_start({ message: notice });
  handlers.message_end({ message: notice });
  const toolOnly = { role: "assistant", content: [{ type: "toolCall", id: "c", name: "workspace_read", arguments: { path: "c" } }], stopReason: "toolUse" };
  handlers.message_start({ message: toolOnly });
  handlers.message_end({ message: toolOnly });
  read("c");
  assert.deepEqual(container.render(80).map(strip), ["", "• Read 3 files", "  ↳ Read a · 1 line", "  ↳ Read b · 1 line", "  ↳ Read c · 1 line"]);
});
