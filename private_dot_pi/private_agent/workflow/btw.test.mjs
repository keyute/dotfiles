import test from "node:test";
import assert from "node:assert/strict";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import { askBtw } from "./btw.mjs";
import { closeView } from "./dialog.mjs";

const keybindings = { matches: (data, action) => ({ "tui.select.cancel": ["escape"], "tui.select.confirm": ["enter"] }[action] ?? []).some(key => matchesKey(data, key)) };
const theme = { fg: (_colour, text) => text, bold: text => text };
const system = { role: "system", content: "You are pi.", toolsAdded: [{ name: "workspace_read", description: "Read", parameters: {} }], timestamp: 1 };

function fixture(reply, mode = "tui") {
  const calls = [];
  const notes = [];
  let component;
  const ctx = {
    mode, model: { provider: "anthropic", id: "fixture" },
    sessionManager: { getSessionId: () => "session-1", buildSessionProjection: () => ({ messages: [system, { role: "user", content: "edit a.txt", timestamp: 2 }, { role: "custom", customType: "note", content: "noted", timestamp: 3 }] }) },
    modelRegistry: { complete: (model, request, options) => { calls.push({ model, request, options }); return reply(options.signal); } },
    ui: {
      notify: (text, level) => notes.push([level, text]),
      custom: factory => new Promise(resolve => { component = factory({ terminal: { rows: 20 }, requestRender() {} }, theme, keybindings, resolve); }),
    },
  };
  return { ctx, calls, notes, view: () => component };
}

const answered = text => async () => ({ stopReason: "stop", content: [{ type: "thinking", thinking: "hm" }, ...(text ? [{ type: "text", text }] : [])] });
const settle = () => new Promise(resolve => setImmediate(resolve));

test("btw asks from the session's projection with no separate prompt or tools, then shows the answer", async () => {
  initTheme("dark");
  const { ctx, calls, view } = fixture(answered("You edited **a.txt**."));
  const shown = askBtw(ctx, "  what did we edit?  ");
  const [{ model, request, options }] = calls;
  assert.equal(model, ctx.model);
  assert.deepEqual(Object.keys(request), ["messages"]);
  assert.deepEqual(request.messages.slice(0, 3).map(message => message.role), ["system", "user", "user"]);
  assert.equal(request.messages[0], system);
  assert.deepEqual(request.messages[2].content, [{ type: "text", text: "noted" }]);
  assert.equal(request.messages.length, 4);
  assert.match(request.messages[3].content, /side question[^]*cannot use tools[^]*not join the conversation[^]*\n\nQuestion: what did we edit\?$/);
  assert.equal(options.sessionId, "session-1");
  assert.equal(options.transport, "sse");
  assert.ok(options.signal instanceof AbortSignal);
  assert.match(view().render(60).join("\n"), /\/btw what did we edit\?[^]*Answering…/);
  await settle();
  const lines = view().render(60);
  assert.match(lines.join("\n"), /You edited a\.txt/);
  assert.doesNotMatch(lines.join("\n"), /Answering/);
  for (const width of [3, 12, 60]) assert.ok(view().render(width).every(line => visibleWidth(line) <= width));
  view().handleInput("\r");
  assert.equal(await shown, undefined);
});

test("btw shows No answer without text, and the model's error in the error colour", async () => {
  const empty = fixture(answered(""));
  const shown = askBtw(empty.ctx, "q");
  await settle();
  assert.match(empty.view().render(40).join("\n"), /No answer/);
  empty.view().handleInput("\x1b");
  await shown;
  const failed = fixture(async () => ({ stopReason: "error", errorMessage: "overloaded", content: [] }));
  const errored = askBtw(failed.ctx, "q");
  await settle();
  const coloured = failed.view();
  coloured.theme = { ...theme, fg: (colour, text) => `<${colour}>${text}` };
  assert.match(coloured.render(40).join("\n"), /<error>overloaded/);
  coloured.handleInput("\x1b");
  await errored;
  const called = fixture(async () => ({ stopReason: "toolUse", content: [{ type: "toolCall", id: "t1", name: "workspace_read", arguments: {} }] }));
  const tool = askBtw(called.ctx, "q");
  await settle();
  assert.match(called.view().render(60).join("\n"), /tried to use a tool/);
  called.view().handleInput("\x1b");
  await tool;
});

test("a long answer scrolls a window of half the terminal, clamped at both ends", async () => {
  const { ctx, view } = fixture(answered(Array.from({ length: 30 }, (_, index) => `- item ${index + 1}`).join("\n")));
  const shown = askBtw(ctx, "q");
  await settle();
  const body = () => view().render(60).slice(3, -1);
  assert.equal(body().length, 6);
  assert.match(body()[0], /item 1\s*$/);
  view().handleInput("\x1b[6~");
  assert.match(body()[0], /item 11\s*$/);
  for (let press = 0; press < 40; press++) view().handleInput("\x1b[B");
  assert.match(body().at(-1), /item 30\s*$/);
  for (let press = 0; press < 40; press++) view().handleInput("\x1b[A");
  assert.match(body()[0], /item 1\s*$/);
  view().handleInput("\x1b");
  await shown;
});

test("closing the view, or another view taking the slot, aborts the request", async () => {
  for (const close of [view => view.handleInput("\x1b"), () => closeView()]) {
    let signal;
    const { ctx, view } = fixture(seen => { signal = seen; return new Promise(resolve => seen.addEventListener("abort", () => resolve({ stopReason: "aborted", content: [] }))); });
    const shown = askBtw(ctx, "q");
    assert.equal(signal.aborted, false);
    close(view());
    assert.equal(signal.aborted, true);
    await shown;
  }
});

test("btw without a question, or without a model, notifies and never calls the model", async () => {
  for (const [args, model] of [["", { id: "m" }], ["   ", { id: "m" }], [undefined, { id: "m" }], ["q", undefined]]) {
    const { ctx, calls, notes } = fixture(answered("x"));
    ctx.model = model;
    await askBtw(ctx, args);
    assert.equal(calls.length, 0);
    assert.equal(notes[0][0], "error");
    if (model) assert.deepEqual(notes, [["error", "Usage: /btw <question>"]]);
  }
});

test("outside the TUI the answer is notified, and an aborted one is not", async () => {
  const { ctx, notes } = fixture(answered("plain"), "rpc");
  await askBtw(ctx, "q");
  assert.deepEqual(notes, [["info", "plain"]]);
  const aborted = fixture(async () => ({ stopReason: "aborted", content: [] }), "rpc");
  await askBtw(aborted.ctx, "q");
  assert.deepEqual(aborted.notes, []);
});
