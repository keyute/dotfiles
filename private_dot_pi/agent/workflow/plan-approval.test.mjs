import test from "node:test";
import assert from "node:assert/strict";
import { runAgentLoop } from "@earendil-works/pi-agent-core";
import { CURSOR_MARKER, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import {
  PLAN_APPROVED,
  PLAN_CANCELLED,
  PLAN_REVISION,
  applyPlanDecision,
  isolatePlanApproval,
  planDecisionResult,
  requestPlanApproval,
} from "./plan-approval.mjs";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = (content, stopReason = "toolUse") => ({ role: "assistant", content, api: "openai-codex-responses", provider: "openai-codex", model: "fixture", usage, stopReason, timestamp: Date.now() });
const response = message => ({ async *[Symbol.asyncIterator]() { yield { type: "done" }; }, async result() { return message; } });
const call = (id, name, args = {}) => ({ type: "toolCall", id, name, arguments: args });

async function planProviderCalls(toolCalls, decision) {
  const controller = new AbortController();
  let providerCalls = 0;
  const tools = [
    { name: "read", description: "read", parameters: { type: "object", properties: {} }, async execute() { return { content: [{ type: "text", text: "read" }], details: {} }; } },
    { name: "submit_plan", description: "plan", parameters: { type: "object", properties: {} }, executionMode: "sequential", async execute() {
      if (decision === PLAN_CANCELLED) controller.abort();
      return planDecisionResult(decision, "make it smaller");
    } },
  ];
  const context = { systemPrompt: "", messages: [], tools };
  const config = {
    model: { provider: "openai-codex", id: "fixture" },
    convertToLlm: messages => messages,
  };
  await runAgentLoop([{ role: "user", content: [{ type: "text", text: "plan" }], timestamp: Date.now() }], context, config, async event => {
    if (event.type === "message_end") isolatePlanApproval(event.message);
  }, controller.signal, async () => {
    providerCalls += 1;
    return response(providerCalls === 1 ? assistant(toolCalls) : assistant([{ type: "text", text: "ack" }], "stop"));
  });
  return providerCalls;
}

test("a cancelled plan makes no follow-up provider call for single or mixed tool batches", async () => {
  assert.equal(await planProviderCalls([call("p", "submit_plan")], PLAN_CANCELLED), 1);
  assert.equal(await planProviderCalls([call("r", "read"), call("p", "submit_plan")], PLAN_CANCELLED), 1);
  assert.equal(await planProviderCalls([call("p", "submit_plan"), call("r", "read")], PLAN_CANCELLED), 1);
  // Revision is a decision the model must receive, so it deliberately continues once.
  assert.equal(await planProviderCalls([call("r", "read"), call("p", "submit_plan")], PLAN_REVISION), 2);
});

test("submit_plan is isolated before execution so no sibling can finalize nonterminating", () => {
  const text = { type: "text", text: "Here is the plan." };
  const plan = call("p", "submit_plan");
  const mixed = assistant([text, call("r", "read"), plan, call("u", "unknown")]);
  assert.equal(isolatePlanApproval(mixed), mixed);
  assert.deepEqual(mixed.content, [text, plan]);
  assert.equal(isolatePlanApproval(assistant([call("r", "read")])), undefined);
  assert.equal(isolatePlanApproval(assistant([plan])), undefined);
  assert.equal(isolatePlanApproval({ role: "user", content: [plan] }), undefined);
});

test("approval commits its annotation before a pending mode transition and preserves concurrent input", async () => {
  let resolveMode;
  const modeTransition = new Promise(resolve => { resolveMode = resolve; });
  let userTask = "Original";
  const applied = applyPlanDecision({ decision: PLAN_APPROVED }, {
    plan: "1. Change it",
    userTask,
    setUserTask: value => { userTask = value; },
    setMode: () => modeTransition,
    abort: () => assert.fail("approval must not abort"),
  });
  assert.match(userTask, /Approved plan: 1\. Change it/);
  userTask = `${userTask}\nInput while mode transition is pending`;
  resolveMode();
  await applied;
  assert.match(userTask, /Input while mode transition is pending/);
});

test("plan decisions preserve the execute transition and deliver revision feedback once", async () => {
  const modes = [];
  let aborts = 0;
  let userTask = "Original";
  const common = {
    plan: "1. Change it",
    setUserTask: value => { userTask = value; },
    setMode: async () => modes.push("execute"),
    abort: () => aborts++,
  };
  const approved = await applyPlanDecision({ decision: PLAN_APPROVED }, { ...common, userTask });
  assert.deepEqual(modes, ["execute"]);
  assert.equal(aborts, 0);
  assert.match(userTask, /Approved plan: 1\. Change it/);
  assert.deepEqual(approved.details, { decision: PLAN_APPROVED });

  const feedback = "Keep the public API stable.";
  const revision = await applyPlanDecision({ decision: PLAN_REVISION, feedback }, { ...common, userTask });
  assert.deepEqual(modes, ["execute"], "revision must remain in plan mode");
  assert.equal(revision.content[0].text.split(feedback).length - 1, 1);
  assert.equal(userTask.split(feedback).length - 1, 1);
  assert.deepEqual(revision.details, { decision: PLAN_REVISION, feedback });
  assert.equal(revision.terminate, undefined);

  const taskBeforeCancellation = userTask;
  const cancelled = await applyPlanDecision({ decision: PLAN_REVISION, feedback: " \n " }, { ...common, userTask });
  assert.equal(aborts, 1);
  assert.equal(userTask, taskBeforeCancellation);
  assert.deepEqual(cancelled.details, { decision: PLAN_CANCELLED });
  assert.equal(cancelled.terminate, true);
});

const keybindings = {
  matches(data, action) {
    const bindings = {
      "tui.select.cancel": ["escape", "ctrl+c"],
      "tui.input.tab": ["tab"],
      "tui.input.submit": ["enter"],
      "tui.input.newLine": ["shift+enter", "ctrl+j"],
      "tui.select.confirm": ["enter"],
      "tui.select.up": ["up"],
      "tui.select.down": ["down"],
    }[action] ?? [];
    return bindings.some(binding => matchesKey(data, binding));
  },
};
const theme = { fg: (_colour, text) => text, bold: text => text };

function tuiApproval(signal) {
  let component;
  let renders = 0;
  let completions = 0;
  const tui = { terminal: { rows: 40 }, requestRender() { renders += 1; } };
  const ui = {
    custom(factory) {
      return new Promise(resolve => {
        let completedBeforeCreate = false;
        const done = value => {
          completions += 1;
          if (component) component.dispose();
          else completedBeforeCreate = true;
          resolve(value);
        };
        component = factory(tui, theme, keybindings, done);
        if (completedBeforeCreate) component.dispose();
      });
    },
  };
  return {
    promise: requestPlanApproval({ mode: "tui", hasUI: true, ui }, signal),
    component: () => component,
    stats: () => ({ renders, completions }),
  };
}

test("approval renders its placeholder inline and focuses No immediately", async () => {
  const prompt = tuiApproval();
  const component = prompt.component();
  const initial = component.render(80).join("\n");
  assert.match(initial, /Approve the current plan\?/);
  assert.match(initial, /❭ Yes/);
  assert.match(initial, /  No  What should change\?/);
  assert.equal(initial.split("\n")[0], "─".repeat(80));
  assert.equal(initial.split("\n").at(-1), "─".repeat(80));
  assert.doesNotMatch(initial, /[╭╮╰╯│]/);
  assert.doesNotMatch(initial, /approve and execute|Give feedback|cancel|Optional feedback|Enter submit|Up\/down/);

  component.handleInput("\x1b[B");
  const selected = component.render(80).join("\n");
  assert.equal(component.editor.focused, true);
  assert.match(selected.replaceAll(CURSOR_MARKER, "").replace(/\x1b\[(?:7|27)m/g, ""), /❭ No  What should change\?/);
  assert.ok(selected.includes(CURSOR_MARKER));
  assert.equal(selected.split("\n").length, initial.split("\n").length, "No adds no editor spacer or box");
  component.handleInput("ab");
  component.handleInput("\x1b[D");
  component.handleInput("X");
  component.handleInput("\x1b[13;2~");
  component.handleInput("second");
  component.handleInput("\x1b[A");
  component.handleInput("X");
  assert.match(component.render(80).join("\n"), /❭ No  aXX/);
  component.handleInput("\r");
  assert.deepEqual(await prompt.promise, { decision: PLAN_REVISION, feedback: "aXX\nsecondb" });
  assert.ok(prompt.stats().renders >= 6);
});

test("empty No shows a visible cursor and wrapped feedback keeps editor navigation geometry", () => {
  const prompt = tuiApproval();
  const component = prompt.component();
  component.handleInput("\x1b[B");
  assert.match(component.render(80).join("\n"), /\x1b\[7mW\x1b\[27m/);
  component.handleInput("abc");
  component.handleInput("\x1b[13;2~");
  component.handleInput("0123456789012345");
  component.render(18);
  component.handleInput("\x1b[A");
  assert.deepEqual(component.editor.getCursor(), { line: 1, col: 5 });
  component.handleInput("\x1b");
});

test("inline draft replaces and restores the No placeholder without losing it on Yes", () => {
  const prompt = tuiApproval();
  const component = prompt.component();
  component.handleInput("\x1b[B");
  component.handleInput("draft");
  assert.match(component.render(80).join("\n"), /❭ No  draft/);
  assert.equal(component.render(80).length, 6, "native editor contributes only its inline content row");
  component.handleInput("\x7f");
  component.handleInput("\x7f");
  component.handleInput("\x7f");
  component.handleInput("\x7f");
  component.handleInput("\x7f");
  assert.match(component.render(80).join("\n").replaceAll(CURSOR_MARKER, "").replace(/\x1b\[(?:7|27)m/g, ""), /❭ No  What should change\?/);
  component.handleInput("draft");
  component.handleInput("\t");
  const onYes = component.render(80).join("\n");
  assert.match(onYes, /❭ Yes/);
  assert.match(onYes, /  No  draft/);
  assert.ok(!onYes.includes(CURSOR_MARKER));
  component.handleInput("\x1b");
});

test("inline No input wraps multiline Unicode text after its prefix", () => {
  const prompt = tuiApproval();
  const component = prompt.component();
  component.handleInput("\x1b[B");
  component.handleInput("a👩‍💻");
  component.handleInput("\x1b[D");
  const unicodeCursor = component.render(18).join("\n");
  assert.match(unicodeCursor, /\x1b\[7m👩‍💻\x1b\[(?:0|27)m/);
  component.handleInput("e\u0301 long feedback");
  const focused = component.render(18).join("\n");
  assert.match(focused, /❭ No  /);
  assert.ok(focused.includes(CURSOR_MARKER));
  component.handleInput("\x1b[13;2~");
  component.handleInput("second line");
  const lines = component.render(18);
  assert.ok(lines.some(line => line.includes("second")));
  for (const line of lines) assert.ok(visibleWidth(line) <= 18, `${visibleWidth(line)} > 18: ${line}`);
  component.focused = false;
  assert.ok(!component.render(18).join("\n").includes(CURSOR_MARKER));
  component.handleInput("\x1b");
});

test("Tab returns from No to Yes without submitting its draft", async () => {
  const prompt = tuiApproval();
  const component = prompt.component();
  component.handleInput("\t");
  component.handleInput("draft");
  component.handleInput("\t");
  assert.match(component.render(80).join("\n"), /❭ Yes/);
  component.handleInput("\r");
  assert.deepEqual(await prompt.promise, { decision: PLAN_APPROVED });
});

test("a retained draft keeps its wrapping when focus moves from No to Yes", () => {
  const component = tuiApproval().component();
  component.handleInput("\x1b[B");
  component.handleInput("aaaaaaa bbbbbb");
  const editing = component.render(20).length;
  component.handleInput("\t");
  assert.equal(component.render(20).length, editing);
  component.handleInput("\x1b");
});

test("Up from the first No feedback line returns to Yes without submitting its draft", async () => {
  const prompt = tuiApproval();
  const component = prompt.component();
  component.handleInput("\x1b[B");
  component.handleInput("draft");
  component.handleInput("\x1b[A");
  assert.equal(component.editing, false);
  assert.equal(component.selected, 0);
  assert.equal(prompt.stats().completions, 0);
  component.handleInput("\x1b[B");
  assert.equal(component.editor.getText(), "draft");
  component.handleInput("\t");
  component.handleInput("\r");
  assert.deepEqual(await prompt.promise, { decision: PLAN_APPROVED });
});

test("blank No submission and Esc from choices or input cancel", async () => {
  const blank = tuiApproval();
  blank.component().handleInput("\x1b[B");
  blank.component().handleInput("\r");
  assert.deepEqual(await blank.promise, { decision: PLAN_CANCELLED });

  const choice = tuiApproval();
  choice.component().handleInput("\x1b");
  assert.deepEqual(await choice.promise, { decision: PLAN_CANCELLED });

  const editor = tuiApproval();
  editor.component().handleInput("\x1b[B");
  editor.component().handleInput("draft");
  editor.component().handleInput("\x1b");
  assert.deepEqual(await editor.promise, { decision: PLAN_CANCELLED });
});

test("framed approval rendering stays within narrow widths", () => {
  const prompt = tuiApproval();
  const component = prompt.component();
  component.handleInput("\x1b[B");
  component.handleInput("draft");
  for (const width of [1, 2, 14, 80]) {
    for (const line of component.render(width)) assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} > ${width}: ${line}`);
  }
  component.handleInput("\x1b");
});

test("no legacy glyphs remain and every non-frame line sits at the cursor column or column 2", () => {
  const prompt = tuiApproval();
  const component = prompt.component();
  component.handleInput("\x1b[B");
  component.handleInput("draft");
  const stripCsi = text => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  for (const width of [14, 40, 80]) {
    const lines = component.render(width).map(stripCsi);
    assert.ok(!lines.some(line => /[○●]|→/.test(line)));
    for (const line of lines) {
      if (!line || /^─+$/.test(line)) continue;
      assert.ok(line.startsWith("❭ ") || line.startsWith("  "), `column violation: ${JSON.stringify(line)}`);
    }
  }
  component.handleInput("\x1b");
});

test("feedback editor keeps its component focus", () => {
  const prompt = tuiApproval();
  const component = prompt.component();
  component.focused = false;
  component.handleInput("\x1b[B");
  assert.equal(component.focused, false);
  assert.equal(component.editor.focused, false);
  component.focused = true;
  assert.equal(component.editor.focused, true);
  component.handleInput("\x1b");
});

test("the active signal dismisses inline approval and cleanup prevents duplicate completion", async () => {
  const controller = new AbortController();
  const prompt = tuiApproval(controller.signal);
  controller.abort();
  assert.deepEqual(await prompt.promise, { decision: PLAN_CANCELLED });
  controller.abort();
  assert.equal(prompt.stats().completions, 1);
});

test("RPC uses supported dialogs while unattended modes cancel instead of autoapproving", async () => {
  const calls = [];
  const rpc = (choice, feedback) => ({
    mode: "rpc",
    hasUI: true,
    ui: {
      async select(title, options, opts) { calls.push(["select", title, options, opts]); return choice; },
      async input(title, placeholder, opts) { calls.push(["input", title, placeholder, opts]); return feedback; },
    },
  });
  assert.deepEqual(await requestPlanApproval(rpc("Yes")), { decision: PLAN_APPROVED });
  assert.deepEqual(await requestPlanApproval(rpc("No", "line one\nline two")), { decision: PLAN_REVISION, feedback: "line one\nline two" });
  assert.deepEqual(await requestPlanApproval(rpc("No", "  ")), { decision: PLAN_CANCELLED });
  assert.deepEqual(await requestPlanApproval(rpc(undefined)), { decision: PLAN_CANCELLED });
  assert.deepEqual(await requestPlanApproval({ mode: "print", hasUI: false, ui: {} }), { decision: PLAN_CANCELLED });
  assert.ok(calls.some(([method]) => method === "select"));
  assert.ok(calls.some(([method]) => method === "input"));
});
