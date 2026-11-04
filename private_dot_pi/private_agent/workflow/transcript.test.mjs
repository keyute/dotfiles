import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { AssistantMessageComponent, InteractiveMode, getMarkdownTheme, initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { addFold, appendVisible, bulletMarkdown, closeFolds, createFolds, doneEntryRenderer, doneGroup, installActivityEntries, installFolding, installReasoningHide, pluginRenderers, settleFold, toolRenderers } from "./rows.mjs";

// The markdown theme reads pi's theme; the default one is enough.
initTheme();

// OSC133 shell-integration markers ride on the first/last line alongside SGR
// colour codes; a real mount needs both stripped to compare rendered text.
const strip = line => line.replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
// pi's own theme singleton (what a real mount would hand a registered entry
// renderer) is not exported; this direct call takes rows.test.mjs's own stub.
const theme = { fg: (color, text) => `<${color}>${text}`, bold: text => text };

function entryMode(chatContainer, folds) {
  installActivityEntries(InteractiveMode);
  const mode = Object.create(InteractiveMode.prototype);
  Object.assign(mode, { chatContainer, outputPad: 0, toolOutputExpanded: false,
    runtimeHost: { session: { extensionRunner: { getEntryRenderer: type => doneEntryRenderer(type, folds) } } } });
  return mode;
}

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

// Direct component tests cover dynamic membership; native host mounts below
// additionally cover its spacer and renderer rebuilds.
test("a completion's own component moves through the same levels a tool group does: solo, joined, sealed — the later member retains a hidden component", () => {
  const folds = createFolds(() => false);
  const pi = { appendEntry() {} };
  const render = doneEntryRenderer("workflow-child", folds);

  const a = { agent: "researcher", task: "Delegation claims", status: "completed", durationMs: 45_000 };
  appendVisible(pi, "workflow-child", a, folds);
  const first = render({ data: a }, {}, theme);
  assert.deepEqual(first.render(80).map(strip), ["<success>• <toolTitle>researcher finished<muted> · Delegation claims · 45s"]);

  const b = { agent: "reviewer", task: "Type audit", status: "completed", durationMs: 12_000 };
  appendVisible(pi, "workflow-child", b, folds);
  assert.deepEqual(render({ data: b }, {}, theme).render(80), []);
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
  const mode = entryMode(container, folds);
  mode.toolOutputExpanded = true;
  const finish = agent => {
    const data = { agent, status: "completed", durationMs: 1000 };
    appendVisible({ appendEntry() {} }, "workflow-child", data, folds);
    mode.addCustomEntryToChat({ customType: "workflow-child", data });
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
    assert.deepEqual(container.render(120).map(strip), sealed ? ["", "▾ Read 1 file, launched 1 agent, finished 3 agents", ...rows] : ["", ...rows]);
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
  const mode = entryMode(container, folds);
  mode.addCustomEntryToChat({ customType: "workflow-child", data: done });
  const host = container.children.at(-1);
  assert.deepEqual(host.render(120), [], "a retained host suppresses its spacer with its child");
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
  host.setExpanded(true);
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
  const draw = content => {
    const message = { role: "assistant", api: "openai-responses", content };
    const component = new AssistantMessageComponent(message, false, getMarkdownTheme(), "Thinking...", 0, [bulletMarkdown]);
    const expected = component.render(40).map(strip);
    for (const streaming of [true, true, false, false]) {
      component.updateContent(message, streaming);
      assert.deepEqual(component.render(40).map(strip), expected);
      component.invalidate();
      assert.deepEqual(component.render(40).map(strip), expected);
    }
    return expected;
  };
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
test("entries that land while a reply streams fold where pi mounts them, above it, and every completion retains its mount", () => {
  installReasoningHide();
  const folds = createFolds(() => false);
  const handlers = {};
  installFolding({ on: (name, handler) => { handlers[name] = handler; } }, { ui: { getToolsExpanded: () => false } }, folds);
  const chat = new Container();
  const mode = entryMode(chat, folds);
  const draw = () => chat.render(120).map(strip);
  let streaming = null;
  const mounted = new Set();
  const pi = {
    appendEntry(type, data) {
      if (data.seq) mounted.add(data.seq);
      mode.streamingComponent = streaming;
      mode.addCustomEntryToChat({ customType: type, data });
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
    assert.ok(mounted.has(fact.id), fact.data.agent);
    if (group && group.entries[0].id !== fact.id) assert.deepEqual(doneEntryRenderer("workflow-child", folds)({ data: fact.data }, {}, theme).render(80), []);
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


test("activity host seam is pinned to Pi 1.5.0 mount, rebuild and retained Markdown mechanics", () => {
  const read = file => readFileSync(new URL(`../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/${file}`, import.meta.url), "utf8");
  const host = read("interactive-mode.js");
  assert.match(host, /addCustomEntryToChat\(entry\) \{[\s\S]*?new CustomEntryComponent\(entry, renderer, this.outputPad\)/);
  assert.match(host, /this.chatContainer.children.splice\(streamingIndex, 0, component\)/);
  const entry = read("components/custom-entry.js");
  assert.match(entry, /this.customComponent = component;\s*this.addChild\(new Spacer\(1\)\);\s*this.addChild\(component\)/);
  assert.match(entry, /invalidate\(\) \{\s*super.invalidate\(\);\s*this.rebuild\(\)/);
  assert.match(entry, /setExpanded\(expanded\)[\s\S]*?this.rebuild\(\)/);
  const assistant = read("components/assistant-message.js");
  assert.match(assistant, /this.markdownTheme = markdownTheme/);
  assert.match(assistant, /const previousSlots = this.markdownSlots;\s*this.markdownSlots = \[\]/);
  assert.match(assistant, /const slot = previousSlots\[this.markdownSlots.length\];\s*const markdown = slot\?\.kind === kind \? slot.markdown : create\(\);\s*markdown.setText\(text\);\s*this.markdownSlots.push\(\{ kind, markdown \}\)/);
  assert.match(assistant, /addVisibleChild\(markdownBlock\("text", text, \(\) => new Markdown\(text, this.outputPad, 0, this.markdownTheme/);
  assert.match(assistant, /let needsSpacer = true;\s*const addVisibleChild = \(child\) => \{\s*if \(needsSpacer\) \{\s*this.contentContainer.addChild\(new Spacer\(1\)\);\s*needsSpacer = false;\s*\}\s*this.contentContainer.addChild\(child\)/);
  assert.match(assistant, /if \(hidden && !this.hiddenThinkingLabel.trim\(\)\) \{\s*continue;\s*\}/);
  assert.match(assistant, /addVisibleChild\(new MouseRegion\(thinkingComponent,[\s\S]*?needsSpacer = true/);
});

test("activity hosts render each child once per paint and suppress only spacer-only output", () => {
  const folds = createFolds(() => false);
  const chat = new Container();
  const mode = entryMode(chat, folds);
  const pi = { appendEntry: (customType, data) => mode.addCustomEntryToChat({ customType, data }) };
  appendVisible(pi, "workflow-child", { agent: "first", status: "completed" }, folds);
  appendVisible(pi, "workflow-child", { agent: "second", status: "completed" }, folds);
  closeFolds(folds);
  const calls = [0, 0];
  for (const [index, host] of chat.children.entries()) {
    const child = host.customComponent;
    const render = child.render;
    child.render = function (width) {
      calls[index] += 1;
      return render.call(this, width);
    };
  }
  assert.deepEqual(chat.render(80).map(strip), ["", "▸ Finished 2 agents"]);
  assert.deepEqual(calls, [1, 1]);
  assert.deepEqual(chat.mouseLayout.children.map(child => child.height), [2, 0]);
  chat.handleMouse({ type: "click", button: "left", x: 0, y: 1, width: 80, height: 2 });
  assert.deepEqual(calls, [1, 1], "mouse routing reuses the native paint layout");
  assert.deepEqual(chat.render(80).map(strip), ["", "▾ Finished 2 agents", "  ↳ first finished", "  ↳ second finished"]);
  assert.deepEqual(calls, [2, 2]);
  assert.deepEqual(chat.children[1].render(80), []);
  assert.deepEqual(calls, [2, 3]);
});

test("a pending tool completion edge refolds in native hosts without a permanent boundary, and rebuilds retain dynamic ownership", () => {
  for (const failed of [false, true]) {
    let expanded = false;
    const folds = createFolds(() => expanded);
    const chat = new Container();
    const mode = entryMode(chat, folds);
    const wrapped = InteractiveMode.prototype.addCustomEntryToChat;
    installActivityEntries(InteractiveMode);
    assert.equal(InteractiveMode.prototype.addCustomEntryToChat, wrapped);
    const read = (id, settle = true) => {
      const row = new ToolExecutionComponent("read", id, { path: id }, {}, toolRenderers("read", folds), { requestRender() {} }, "/repo");
      row.markExecutionStarted();
      chat.addChild(row);
      addFold(folds, id, "read");
      if (settle) {
        row.updateResult({ content: [], details: {} });
        settleFold(folds, id, false);
      }
      return row;
    };
    read("a");
    const pending = read("pending", false);
    const data = { agent: "reviewer", status: "completed", durationMs: 1000 };
    appendVisible({ appendEntry: (customType, data) => mode.addCustomEntryToChat({ customType, data }) }, "workflow-child", data, folds);
    const host = chat.children.at(-1);
    read("b");
    assert.equal(folds.timeline.some(fact => fact.kind === "boundary"), false);
    assert.ok(chat.render(80).map(strip).includes("• reviewer finished · 1s"));
    pending.updateResult({ content: [{ type: "text", text: failed ? "boom" : "ok" }], isError: failed });
    settleFold(folds, "pending", failed);
    closeFolds(folds);
    host.invalidate();
    if (failed) {
      assert.deepEqual(host.render(80).map(strip), ["", "▸ Read 1 file, finished 1 agent"]);
      host.handleMouse({ type: "click", button: "left", x: 0, y: 1, height: 10 });
      assert.ok(host.render(80).map(strip).some(line => line.includes("reviewer finished")));
    } else assert.deepEqual(host.render(80), []);
    expanded = true;
    host.setExpanded(true);
    assert.deepEqual(host.render(80).map(strip), failed ? ["", "▾ Read 1 file, finished 1 agent", "• reviewer finished · 1s"] : ["", "• reviewer finished · 1s"]);
    expanded = false;
    host.setExpanded(false);
    if (!failed) assert.deepEqual(host.render(80), []);
  }
});

for (const completionFirst of [false, true]) test(`group member bodies expand independently in native hosts, completion-first=${completionFirst}`, () => {
  let expanded = false;
  const folds = createFolds(() => expanded);
  const chat = new Container();
  const mode = entryMode(chat, folds);
  const draw = () => chat.render(100).map(strip);
  const click = y => chat.handleMouse({ type: "click", button: "left", x: 3, y, width: 100, height: draw().length });
  if (completionFirst) appendVisible({ appendEntry: (customType, data) => mode.addCustomEntryToChat({ customType, data }) }, "workflow-child", { agent: "reviewer", status: "completed" }, folds);
  const rows = [];
  const mount = id => {
    const row = new ToolExecutionComponent("edit", id, { path: `${id}.mjs` }, {}, toolRenderers("edit", folds), { requestRender() {} }, "/repo");
    row.markExecutionStarted();
    chat.addChild(row);
    addFold(folds, id, "edit");
    const result = { content: [{ type: "text", text: "edited" }], details: { diff: `-  1 old_${id}\n+  1 new_${id}` } };
    row.updateResult(result);
    settleFold(folds, id, false, result);
    rows.push(row);
    return row;
  };
  const first = mount("first");
  if (!completionFirst) first.setExpanded(true); // Standalone expansion must not leak into the group.
  const second = mount("second");
  const member = id => draw().findIndex(line => line.includes(`↳ Edited ${id}.mjs`));
  const has = text => draw().some(line => line.includes(text));
  assert.equal(has("new_first"), false);
  click(member("second"));
  assert.equal(has("new_second"), true);
  assert.equal(has("new_first"), false);
  click(member("first"));
  assert.equal(has("new_first"), true);
  assert.equal(has("new_second"), true);
  assert.ok(chat.render(100).some(line => /\x1b\[/.test(line) && line.includes("new_second")), "edit bodies retain native diff highlighting");
  const flags = rows.map(row => row.expanded);
  click(draw().findIndex(line => line.includes("new_first")));
  assert.deepEqual(rows.map(row => row.expanded), flags, "body clicks never reach the first host's native toggle");
  click(member("second"));
  assert.equal(has("new_second"), false);
  assert.equal(has("new_first"), true);
  mount("third");
  assert.equal(has("new_first"), true, "live growth retains existing selections");
  assert.equal(has("new_third"), false);
  closeFolds(folds);
  assert.equal(has("new_first"), false, "auto-seal clears live selections");
  click(1);
  assert.equal(has("new_first"), false);
  click(member("second"));
  assert.equal(has("new_second"), true);
  click(1);
  click(1);
  assert.equal(has("new_second"), false, "collapse/reopen starts with every member collapsed");
  click(member("first"));
  expanded = true;
  for (const row of rows) { row.setExpanded(true); row.invalidate(); }
  assert.equal(has("• Edited second.mjs"), true);
  const before = draw();
  click(before.findIndex(line => line.includes("new_second")));
  click(before.findIndex(line => line.includes("• Edited second.mjs")));
  assert.deepEqual(draw(), before, "global output mode consumes clicks without changing native flags");
  expanded = false;
  for (const row of rows) { row.setExpanded(false); row.invalidate(); }
  assert.equal(draw().length, 2);
  click(1);
  assert.equal(has("new_first"), false);
  assert.equal(has("new_second"), false);
  if (completionFirst) {
    const before = draw();
    click(before.findIndex(line => line.includes("↳ reviewer finished")));
    assert.deepEqual(draw(), before, "completion labels have no invented output");
  }
});

test("wrapped labels and expanded body heights route member clicks at narrow widths; native standalone behavior survives", () => {
  let expanded = false;
  const folds = createFolds(() => expanded);
  const chat = new Container();
  const rows = ["a_very_long_path_with_many_characters.mjs", "second.mjs"].map((path, index) => {
    const id = `n${index}`;
    const row = new ToolExecutionComponent("read", id, { path }, {}, toolRenderers("read", folds), { requestRender() {} }, "/repo");
    row.markExecutionStarted();
    chat.addChild(row);
    addFold(folds, id, "read");
    const result = { content: [{ type: "text", text: index ? "SECOND_BODY" : "FIRST_BODY with enough words to wrap across several rows\nlast body line" }], details: {} };
    row.updateResult(result);
    settleFold(folds, id, false, result);
    return row;
  });
  const draw = () => chat.render(24).map(strip);
  const click = y => chat.handleMouse({ type: "click", button: "left", x: 1, y, width: 24, height: draw().length });
  let lines = draw();
  const label = lines.findIndex(line => line.includes("↳ Read"));
  assert.ok(label > 0);
  click(label + 1); // The wrapped continuation, not the label's first line.
  assert.ok(draw().some(line => line.includes("FIRST_BODY")));
  lines = draw();
  click(lines.findIndex(line => line.includes("↳ Read second")));
  assert.ok(draw().some(line => line.includes("SECOND_BODY")), "second member is below the first member's wrapped body");
  const before = draw();
  for (const event of [{ type: "scroll", button: "none" }, { type: "down", button: "left" }, { type: "drag", button: "left" }, { type: "click", button: "right" }]) {
    assert.equal(chat.handleMouse({ ...event, x: 1, y: label, width: 24, height: before.length }), undefined);
  }
  assert.deepEqual(draw(), before);
  expanded = true;
  rows.forEach(row => { row.setExpanded(true); row.invalidate(); });
  draw();
  expanded = false;
  rows.forEach(row => { row.setExpanded(false); row.invalidate(); });
  assert.ok(!draw().some(line => line.includes("FIRST_BODY")), "live Ctrl+O cycle clears member selections too");

  const solo = new ToolExecutionComponent("read", "solo", { path: "solo" }, {}, toolRenderers("read", createFolds(() => false)), { requestRender() {} }, "/repo");
  solo.updateResult({ content: [{ type: "text", text: "solo output" }], details: {} });
  solo.render(80);
  solo.handleMouse({ type: "click", button: "left", x: 0, y: 2, width: 80, height: 3 });
  assert.equal(solo.expanded, true);
  assert.ok(solo.render(80).map(strip).includes("  solo output"));
});

for (const completionFirst of [false, true]) test(`group paints retain native wrapping caches and current click geometry, completion-first=${completionFirst}`, t => {
  let expanded = false;
  let color = "\x1b[32m";
  const palette = { fg: (_name, text) => `${color}${text}\x1b[39m` };
  const folds = createFolds(() => expanded);
  let component;
  if (completionFirst) {
    const data = { agent: "reviewer", status: "completed" };
    appendVisible({ appendEntry() {} }, "workflow-child", data, folds);
    component = doneEntryRenderer("workflow-child", folds)({ data }, {}, palette);
  }
  const renderer = toolRenderers("read", folds);
  const results = [];
  for (const [index, id] of ["first", "second"].entries()) {
    const ctx = { toolCallId: id, state: {}, invalidate() {} };
    renderer.renderCall({ path: index ? "second" : "a_very_long_path_with_many_characters.mjs" }, palette, ctx);
    addFold(folds, id, "read");
    const text = index ? "SECOND_BODY" : ["FIRST_BODY with enough words to wrap", "", ...Array.from({ length: 1000 }, (_, i) => `body ${i}`)].join("\n");
    const result = { content: [{ type: "text", text }], details: {} };
    results.push(result);
    settleFold(folds, id, false, result);
  }
  if (!component) component = renderer.renderCall({ path: "a_very_long_path_with_many_characters.mjs" }, palette, { toolCallId: "first", state: {}, invalidate() {} });
  let width = 24;
  const draw = () => component.render(width).map(strip);
  const click = y => component.handleMouse({ type: "click", button: "left", x: 1, y });
  let lines = draw();
  const label = lines.findIndex(line => line.includes("↳ Read"));
  click(label + 1);
  assert.ok(draw().some(line => line.includes("FIRST_BODY")), "wrapped label continuation opens its own body");

  const render = Text.prototype.render;
  const previous = new WeakMap();
  let misses = 0;
  t.mock.method(Text.prototype, "render", function (width) {
    const lines = render.call(this, width);
    if (previous.get(this) !== lines) misses += 1;
    previous.set(this, lines);
    return lines;
  });
  lines = draw();
  assert.ok(misses >= 1003, "the large body exercises native per-line wrapping");
  const stable = () => {
    misses = 0;
    const before = draw();
    assert.equal(misses, 0, "unchanged paint reuses all native wrapped arrays");
    assert.deepEqual(draw(), before);
  };
  stable();
  assert.ok(lines.includes(""), "blank body lines keep their layout row");
  width = 42;
  assert.notDeepEqual(draw(), lines, "resize recomputes wrapping");
  stable();
  results[0].content[0].text = "CHANGED_BODY\n\nlast";
  assert.ok(draw().includes("  CHANGED_BODY"));
  stable();
  click(draw().findIndex(line => line.includes("↳ Read second")));
  assert.ok(draw().includes("  SECOND_BODY"), "body size changes update the following label's click target");
  const handle = completionFirst ? component.groupComponent : component;
  assert.equal(handle.lineComponents.length, completionFirst ? 8 : 7, "retained slots shrink to the current logical layout");
  color = "\x1b[35m";
  component.invalidate();
  assert.ok(component.render(width).some(line => line.includes(color)), "theme invalidation refreshes styled content");
  draw();
  stable();
  closeFolds(folds);
  if (!completionFirst) {
    const previous = component;
    component = renderer.renderCall({ path: "a_very_long_path_with_many_characters.mjs" }, palette, { toolCallId: "first", state: {}, invalidate() {}, lastComponent: component });
    assert.equal(component, previous, "the native call-slot rebuild retains its group handle");
  }
  assert.equal(draw().length, 1, "sealing clears member output");
  assert.equal(handle.lineComponents.length, 1, "sealed layout releases body slots");
  stable();
  click(0);
  assert.ok(!draw().some(line => line.includes("CHANGED_BODY")));
  expanded = true;
  draw();
  stable();
  expanded = false;
  assert.equal(draw().length, 1);
  stable();
});

test("async subagent launch members stay summary-only while synchronous members expand", () => {
  let expanded = false;
  const folds = createFolds(() => expanded);
  const chat = new Container();
  const rows = ["async", "sync"].map(id => {
    const row = new ToolExecutionComponent("subagent", id, { agent: id, task: "Audit" }, {}, pluginRenderers("subagent", { folds }), { requestRender() {} }, "/repo");
    row.markExecutionStarted();
    chat.addChild(row);
    addFold(folds, id, "agent");
    const result = { content: [{ type: "text", text: `${id}_BODY` }], details: id === "async" ? { asyncId: "run" } : {} };
    row.updateResult(result);
    settleFold(folds, id, false, result);
    return row;
  });
  const draw = () => chat.render(100).map(strip);
  const click = y => chat.handleMouse({ type: "click", button: "left", x: 3, y, width: 100, height: draw().length });
  for (const sealed of [false, true]) {
    if (sealed) { closeFolds(folds); draw(); click(1); }
    const before = draw();
    click(before.findIndex(line => line.includes("↳ async")));
    assert.deepEqual(draw(), before);
    click(draw().findIndex(line => line.includes("↳ sync")));
    assert.ok(draw().includes("  sync_BODY"));
    assert.ok(!draw().includes("  async_BODY"));
  }
  expanded = true;
  rows.forEach(row => { row.setExpanded(true); row.invalidate(); });
  assert.ok(draw().includes("  ↳ launched"));
  assert.ok(!draw().includes("  async_BODY"));
  assert.ok(draw().includes("  sync_BODY"));
});
