import test from "node:test";
import assert from "node:assert/strict";
import { CURSOR_MARKER, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import { QuestionnaireComponent, questionnaireResult, registerQuestionnaire, validateQuestionnaire } from "./questionnaire.mjs";

const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: text => text, italic: text => text, strikethrough: text => text, underline: text => text };
const keybindings = { matches(data, action) { return ({ "tui.select.cancel": ["escape"], "tui.select.up": ["up"], "tui.select.down": ["down"], "tui.select.confirm": ["enter"], "tui.input.submit": ["enter"], "tui.input.tab": ["tab"], "tui.input.newLine": ["shift+enter", "ctrl+j"] }[action] ?? []).some(key => matchesKey(data, key)); } };
const questions = [{ question: "Choose a direction without exposing this prose.", header: "Direction", options: [{ label: "Fast", description: "Quick path", preview: "# Fast\n\n`code`" }, { label: "Safe", description: "Careful path" }] }, { question: "Pick all that apply", header: "Scope", multiSelect: true, options: [{ label: "Tests", description: "Cover it" }, { label: "Docs", description: "Explain it" }] }];

function prompt(signal) {
  let component; let value; let renders = 0;
  const tui = { terminal: { rows: 8 }, requestRender() { renders++; } };
  component = new QuestionnaireComponent(tui, theme, keybindings, result => { value = result; }, questions, signal);
  return { component, result: () => value, renders: () => renders };
}

test("single choice, notes, and multiline custom input follow native Editor interactions", () => {
  const p = prompt(); const c = p.component;
  c.handleInput("\t"); c.handleInput("private note"); c.handleInput("\x1b[13;2~"); c.handleInput("line two");
  // The preview column narrows the inline note field, so only the cursor's own line is guaranteed visible.
  assert.match(c.render(80).join("\n"), /line two/);
  assert.ok(c.render(80).join("\n").includes(CURSOR_MARKER));
  c.handleInput("\r");
  c.handleInput("\r"); // selects Fast and proceeds to Scope
  c.handleInput(" "); c.handleInput("\x1b[B"); c.handleInput(" "); c.handleInput("\r"); c.handleInput("\r");
  const result = questionnaireResult(questions, p.result());
  assert.deepEqual(JSON.parse(result.content[0].text), { answers: [{ id: 1, header: "Direction", selected: [{ number: 1, label: "Fast", note: "private note\nline two" }] }, { id: 2, header: "Scope", selected: [{ number: 1, label: "Tests" }, { number: 2, label: "Docs" }] }] });
  assert.equal(p.renders() > 0, true);
});

test("note drafts are isolated, deselected notes are omitted, and custom text is unparsed", () => {
  const p = prompt(); const c = p.component;
  c.handleInput("\t"); c.handleInput("one"); c.handleInput("\r"); c.handleInput("\x1b[B"); c.handleInput("\t"); c.handleInput("two"); c.handleInput("\r");
  c.handleInput("\x1b[B"); c.handleInput(" options 1 and 3\n "); c.handleInput("\r");
  const first = c.drafts[0];
  assert.equal(first.custom, " options 1 and 3\n ");
  assert.equal(first.notes.get(0), "one"); assert.equal(first.notes.get(1), "two");
  const result = questionnaireResult(questions, c.drafts);
  assert.doesNotMatch(result.content[0].text, /one|two|Choose a direction|Quick path|code/);
  assert.match(result.content[0].text, /options 1 and 3/);
});

test("multi-select custom inclusion can be toggled and cancellation submits no drafts", () => {
  const p = prompt(); const c = p.component;
  c.handleInput("\r"); // selects Fast, advances to Scope
  c.handleInput(" "); // selects Tests
  c.handleInput("\x1b[B"); c.handleInput("\x1b[B"); // Docs, then the custom row (typing starts immediately)
  c.handleInput("custom");
  c.handleInput("\x01"); c.handleInput("\x0b"); // clear the draft to exclude it
  c.handleInput("\x1b[A"); // leave the custom row
  c.handleInput("\r");
  const result = questionnaireResult(questions, c.drafts);
  assert.deepEqual(JSON.parse(result.content[0].text).answers[1].selected, [{ number: 1, label: "Tests" }]);
  assert.equal(JSON.parse(result.content[0].text).answers[1].custom, undefined);
  const cancelled = prompt(); cancelled.component.handleInput("\x1b");
  assert.equal(cancelled.result(), null);
  assert.deepEqual(questionnaireResult(questions, [], true).details, { cancelled: true, answers: [] });
});

test("single-question browse hides navigation and preserves the framed blank-row layout", () => {
  const p = questionnaire([questions[0]], 8);
  const lines = p.component.render(80);
  assert.equal(lines.length, 8);
  assert.equal(lines[1], "");
  assert.doesNotMatch(lines.join("\n"), /Direction|Review|\[/);
  assert.equal(p.component.pageSize, 3);
});

test("multi-question browse and review paint a background only on the active tab", () => {
  const calls = [];
  const palette = {
    ...theme,
    fg(color, text) { calls.push(["fg", color, text]); return `\x1b[36m${text}\x1b[0m`; },
    bg(color, text) { calls.push(["bg", color, text]); return `\x1b[44m${text}\x1b[0m`; },
    bold(text) { calls.push(["bold", text]); return `\x1b[1m${text}\x1b[22m`; },
  };
  const p = questionnaire(questions, 8, palette);
  for (const mode of ["browse", "review"]) {
    if (mode === "review") p.component.goTo(questions.length);
    calls.length = 0;
    const lines = p.component.render(40);
    const band = lines[1];
    assert.ok(visibleWidth(band) <= 40);
    assert.match(band, /Direction|Review/);
    assert.doesNotMatch(band.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ""), /\[/);
    const activeLabel = mode === "review" ? " Review " : " Direction ";
    assert.ok(calls.some(([kind, color, text]) => kind === "bg" && color === "userMessageBg" && visibleWidth(text) === visibleWidth(activeLabel) && text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "") === activeLabel));
    assert.ok(!calls.some(([kind, color, text]) => kind === "bg" && visibleWidth(text) === 40));
    assert.ok(calls.some(([kind, color, text]) => kind === "fg" && color === "accent" && (/Direction|Review/).test(text)));
    assert.ok(calls.some(([kind, color, text]) => kind === "fg" && color === "muted" && text === " Scope "));
    assert.ok(calls.some(([kind, text]) => kind === "bold" && (text === "Direction" || text === "Review")));
    assert.equal(lines.length, 8);
    assert.equal(p.component.pageSize, 2);
    assert.equal(lines[2], "");
    assert.equal(lines.at(-3), "");
  }
});

test("narrow multi-question headers keep every active tab and Review visible", () => {
  const items = ["First long title", "Second long name", "Third long label", "Fourth long name"].map(header => ({ ...questions[0], header }));
  const palette = { ...theme, fg: (color, text) => color === "accent" ? `\x1b[36m${text}\x1b[39m` : text, bold: text => `\x1b[1m${text}\x1b[22m` };
  const p = questionnaire(items, 12, palette);
  for (let index = 0; index <= items.length; index++) {
    p.component.goTo(index);
    const header = index === items.length ? "Review" : items[index].header;
    const band = p.component.render(20)[1];
    assert.ok(band.includes(`\x1b[36m\x1b[1m${header}\x1b[22m\x1b[39m`), `active header missing: ${header}`);
    assert.ok(visibleWidth(band) <= 20);
  }
});

test("layout honors ANSI and Unicode widths, preview placement, narrow stacking, resize, and native cursor", () => {
  const p = prompt(); const c = p.component;
  c.handleInput("\t"); c.handleInput("👩‍💻 long editor text that wraps across a short terminal");
  for (const width of [14, 40, 90]) for (const line of c.render(width)) assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} > ${width}`);
  assert.ok(c.render(14).join("\n").includes(CURSOR_MARKER));
  c.handleInput("\x1b");
  c.tui.terminal.rows = 24;
  const wide = c.render(80).join("\n"); assert.match(wide, /┌─/); assert.match(wide, /1\. Fast.*┌/);
  const narrow = c.render(40).join("\n"); assert.ok(narrow.indexOf("┌") > narrow.indexOf("1. Fast"));
});

test("validation rejects boundaries and registration handles unavailable, abort, and cleanup once", async () => {
  assert.match(validateQuestionnaire({ questions: [{ ...questions[0], options: [{ label: "Other", description: "x" }, questions[0].options[1]] }] }), /may not/);
  assert.match(validateQuestionnaire({ questions: [{ ...questions[0], multiSelect: true }] }), /previews/);
  let tool; registerQuestionnaire({ registerTool(value) { tool = value; } });
  assert.equal(tool.name, "ask_user_question"); assert.equal(tool.executionMode, "sequential");
  const unavailable = await tool.execute("x", { questions }, undefined, undefined, { mode: "rpc", hasUI: true, ui: {} });
  assert.equal(unavailable.details.error, "unavailable");
  const controller = new AbortController(); controller.abort();
  const aborted = await tool.execute("x", { questions }, controller.signal, undefined, { mode: "tui", hasUI: true, ui: {} });
  assert.equal(aborted.details.cancelled, true);
  const p = prompt(controller.signal); assert.equal(p.result(), null); p.component.dispose(); controller.abort(); assert.equal(p.result(), null);
});

function questionnaire(items, rows = 24, palette = theme) {
  let result;
  const component = new QuestionnaireComponent({ terminal: { rows }, requestRender() {} }, palette, keybindings, value => { result = value; }, items);
  return { component, result: () => result };
}
const keys = (component, ...inputs) => inputs.forEach(input => component.handleInput(input));

test("every multi-question form requires review and unanswered questions cannot submit", () => {
  const items = [questions[0], { ...questions[0], header: "Second" }];
  const p = questionnaire(items);
  keys(p.component, "\r", "\r");
  assert.equal(p.result(), undefined);
  assert.match(p.component.render(80).join("\n"), /Fast/);
  keys(p.component, "\r");
  assert.equal(p.result().length, 2);

  const incomplete = questionnaire(items);
  keys(incomplete.component, "\x1b[C", "\r", "\r");
  assert.equal(incomplete.result(), undefined);
  keys(incomplete.component, "\r", "\r", "\r");
  assert.equal(incomplete.result().length, 2);
});

test("an empty multi-select cannot advance out of bounds or count an excluded custom draft", () => {
  const p = questionnaire([questions[1]]);
  keys(p.component, "\r");
  assert.doesNotThrow(() => p.component.render(80));
  assert.equal(p.result(), undefined);
  keys(p.component, "\x1b[B", "\x1b[B", "draft", "\x01", "\x0b", "\r");
  assert.equal(p.result(), undefined);
  keys(p.component, "\x1b[A", " ", "\r");
  const answer = JSON.parse(questionnaireResult([questions[1]], p.result()).content[0].text).answers[0];
  assert.deepEqual(answer.selected, [{ number: 2, label: "Docs" }]);
  assert.equal(answer.custom, undefined);
});

test("large native pastes return expanded text for both custom answers and notes", () => {
  const text = Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n");
  for (const note of [false, true]) {
    const p = questionnaire([questions[0]]);
    keys(p.component, ...(note ? ["\t"] : ["\x1b[B", "\x1b[B"]));
    keys(p.component, `\x1b[200~${text}\x1b[201~`, "\r");
    if (note) keys(p.component, "\r");
    const answer = JSON.parse(questionnaireResult([questions[0]], p.result()).content[0].text).answers[0];
    assert.equal(note ? answer.selected[0].note : answer.custom, text);
  }
});

test("eight-row editor viewport keeps the native cursor visible through resize", () => {
  const p = questionnaire([questions[0]], 8);
  keys(p.component, "\t", "a long note ".repeat(40));
  for (const width of [14, 40, 90]) {
    const lines = p.component.render(width);
    assert.ok(lines.length <= 8, `${lines.length} rows`);
    assert.ok(lines.some(line => line.includes(CURSOR_MARKER)));
    assert.ok(lines.every(line => visibleWidth(line) <= width));
  }
});

test("single-choice revisiting returns either its choice or literal custom text, not stale alternatives", () => {
  const p = questionnaire(questions);
  keys(p.component, "\r", "\x1b[D", "\x1b[B", "\x1b[B", "1,3", "\r");
  let answer = JSON.parse(questionnaireResult(questions, p.component.drafts).content[0].text).answers[0];
  assert.equal(answer.custom, "1,3");
  assert.equal(answer.selected, undefined);
  keys(p.component, "\x1b[D", "\x1b[A", "\r");
  answer = JSON.parse(questionnaireResult(questions, p.component.drafts).content[0].text).answers[0];
  assert.ok(answer.selected);
  assert.equal(answer.custom, undefined);
});

test("notes reopen, cancel and clear independently; editor arrows do not change question tabs", () => {
  const p = questionnaire(questions);
  keys(p.component, "\t", "saved", "\r", "\t", " draft", "\x1b");
  assert.match(p.component.render(80).join("\n"), /saved/);
  assert.doesNotMatch(p.component.render(80).join("\n"), /draft/);
  keys(p.component, "\t", "\x1b[D", "\x1b[C");
  assert.equal(p.component.questionIndex, 0);
  assert.equal(p.component.editor.getText(), "saved");
  keys(p.component, "\x01", "\x0b", "\r");
  assert.equal(p.component.drafts[0].notes.size, 0);
  assert.equal(p.component.drafts[0].selected.size, 0);
});

test("focusing the custom row starts typing immediately without pressing Enter", () => {
  const p = questionnaire(questions);
  keys(p.component, "\x1b[B", "\x1b[B", "hello");
  const output = p.component.render(80).join("\n");
  assert.match(output, /1\. Fast/);
  assert.match(output, /2\. Safe/);
  assert.match(output, /hello/);
  assert.ok(output.includes(CURSOR_MARKER));
});

test("leaving the custom row without submitting keeps the typed draft", () => {
  const p = questionnaire(questions);
  keys(p.component, "\x1b[B", "\x1b[B", "keep me", "\x1b[A");
  assert.equal(p.component.drafts[0].custom, "keep me");
  assert.match(p.component.render(80).join("\n"), /keep me/);
});

test("Enter on an empty custom row shows the notice over the open field until typing resumes", () => {
  const p = questionnaire([questions[0]]);
  keys(p.component, "\x1b[B", "\x1b[B", "\r");
  assert.equal(p.result(), undefined);
  assert.match(p.component.render(80).join("\n"), /Choose an option or enter an answer\./);
  keys(p.component, "x");
  const output = p.component.render(80).join("\n");
  assert.doesNotMatch(output, /Choose an option/);
  assert.ok(output.includes(CURSOR_MARKER));
});

test("an open note renders under its option with the other option still visible", () => {
  const p = questionnaire(questions);
  keys(p.component, "\t", "why fast");
  const output = p.component.render(80).join("\n");
  assert.match(output, /1\. Fast/);
  assert.match(output, /2\. Safe/);
  assert.match(output, /note: /);
  assert.match(output, /why fast/);
});

test("a retained free answer stays on one line beside a preview", () => {
  const p = questionnaire(questions);
  keys(p.component, "\x1b[B", "\x1b[B", "my own custom answer text here", "\x1b[A", "\x1b[A");
  assert.match(p.component.render(80).join("\n"), /my own custom answer text here/);
});

test("Left and Right switch question tabs from the custom row only while it is empty", () => {
  const p = questionnaire(questions);
  keys(p.component, "\x1b[B", "\x1b[B", "\x1b[C");
  assert.equal(p.component.questionIndex, 1);
  keys(p.component, "\x1b[D", "x", "\x1b[C");
  assert.equal(p.component.questionIndex, 0);
});

test("short previews are centred in remaining space and ANSI borders stay aligned", () => {
  const colors = { ...theme, fg: (_color, text) => `\x1b[36m${text}\x1b[0m` };
  const p = questionnaire([{ ...questions[0], options: [{ label: "界", description: "Quick", preview: "tiny" }, questions[0].options[1]] }], 30, colors);
  const lines = p.component.render(120);
  assert.ok(lines.every(line => visibleWidth(line) <= 120));
  const top = lines.find(line => line.includes("┌"));
  const left = visibleWidth(top.slice(0, top.indexOf("┌")));
  const boxWidth = visibleWidth(top.slice(top.indexOf("┌"), top.indexOf("┐") + 1));
  assert.ok(boxWidth < 40, `short preview unnecessarily spans ${boxWidth} columns`);
  assert.ok(left > 40 && left + boxWidth < 110, `preview starts at ${left}`);
  const inside = lines.find(line => line.includes("tiny"));
  assert.equal(visibleWidth(inside.slice(0, inside.lastIndexOf("│"))), left + boxWidth - 1);
});

test("long preview content is accessible by paging on a short terminal", () => {
  const preview = Array.from({ length: 40 }, (_, index) => `preview line ${index}`).join("\n\n");
  const p = questionnaire([{ ...questions[0], options: [{ ...questions[0].options[0], preview }, questions[0].options[1]] }], 10);
  let reached = false;
  for (let page = 0; page < 40; page++) {
    const lines = p.component.render(40);
    assert.ok(lines.length <= 10);
    if (lines.join("\n").includes("preview line 39")) reached = true;
    keys(p.component, "\x1b[6~");
  }
  assert.ok(reached);
  keys(p.component, "\x1b[B");
  assert.match(p.component.render(40).join("\n"), /2\. Safe/);
});

test("multi-select custom text can accompany selections and be confirmed from its own row", () => {
  const p = questionnaire([questions[1]]);
  keys(p.component, " ", "\x1b[B", "\x1b[B", " 1,3 \n", "\r", "\r");
  const answer = JSON.parse(questionnaireResult([questions[1]], p.result()).content[0].text).answers[0];
  assert.equal(answer.custom, " 1,3 \n");
  assert.deepEqual(answer.selected, [{ number: 1, label: "Tests" }]);
});

const stripCsi = text => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

test("no legacy glyphs remain and every non-frame line sits at the cursor column or column 2", () => {
  const p = questionnaire(questions);
  keys(p.component, "\t", "a note");
  for (const width of [18, 40, 80]) {
    const lines = p.component.render(width).map(stripCsi);
    assert.ok(!lines.some(line => /[○●]|→/.test(line)));
    for (const line of lines) {
      if (!line || /^─+$/.test(line)) continue;
      assert.ok(line.startsWith("❭ ") || line.startsWith("  "), `column violation: ${JSON.stringify(line)}`);
    }
  }
});

test("revisiting an answered single-select question marks only the chosen row", () => {
  const p = questionnaire(questions);
  keys(p.component, "\x1b[B", "\r", "\x1b[D");
  const lines = p.component.render(80);
  assert.doesNotMatch(lines.find(line => line.includes("1. Fast")), /✔/);
  assert.match(lines.find(line => line.includes("2. Safe")), /✔/);
});

test("an answered inactive tab paints success while an unanswered one stays muted", () => {
  const calls = [];
  const palette = { ...theme, fg(color, text) { calls.push(["fg", color, text]); return text; } };
  const p = questionnaire(questions, 24, palette);
  keys(p.component, "\r", "\x1b[C"); // answer Direction, then move off Scope onto Review so both are inactive
  calls.length = 0;
  p.component.render(60);
  assert.ok(calls.some(([, color, text]) => color === "success" && text === " Direction "));
  assert.ok(calls.some(([, color, text]) => color === "muted" && text === " Scope "));
});

test("validation refuses tabbed or multiline headers while allowing multiline content", () => {
  for (const header of ["Line\nbreak", "tab\theader"]) {
    const question = structuredClone(questions[0]);
    question.header = header;
    assert.match(validateQuestionnaire({ questions: [question] }), /header.*line breaks or tabs/i);
  }
  const question = structuredClone(questions[0]);
  question.question = "First line\nSecond line";
  question.options[0].description = "First line\nSecond line";
  question.options[0].preview = "# Preview\n\nSecond line";
  assert.equal(validateQuestionnaire({ questions: [question] }), undefined);
});

test("model-supplied terminal controls are refused before opening the questionnaire", async () => {
  let tool;
  registerQuestionnaire({ registerTool(value) { tool = value; } });
  const control = "text\x1b]52;c;QUJD\x07";
  const mutations = [
    question => { question.question = control; },
    question => { question.header = "\x1b[2J"; },
    question => { question.options[0].label = control; },
    question => { question.options[0].description = control; },
    question => { question.options[0].preview = control; },
  ];
  for (const mutate of mutations) {
    const question = structuredClone(questions[0]);
    mutate(question);
    await assert.rejects(tool.execute("test", { questions: [question] }, undefined, undefined, {
      mode: "tui", hasUI: true, ui: { custom() { throw new Error("must not display controls"); } },
    }), /terminal control/);
  }
});

test("abort, host teardown and final cleanup release the listener only once", () => {
  let abort;
  let removed = 0;
  let completed = 0;
  const signal = { aborted: false, addEventListener(_event, callback) { abort = callback; }, removeEventListener() { removed++; } };
  const component = new QuestionnaireComponent({ terminal: { rows: 24 }, requestRender() {} }, theme, keybindings, () => { completed++; }, questions, signal);
  abort();
  component.dispose();
  component.dispose();
  component.handleInput("\r");
  assert.equal(completed, 1);
  assert.equal(removed, 1);
});
