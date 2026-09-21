import { Type } from "typebox";
import { Editor, Key, Markdown, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const CUSTOM_LABEL = "Type something.";
const RESERVED_LABELS = new Set(["other", CUSTOM_LABEL.toLowerCase()]);
const editorTheme = theme => ({
  borderColor: text => theme.fg("borderMuted", text),
  selectList: {
    selectedPrefix: text => theme.fg("accent", text), selectedText: text => theme.fg("accent", text),
    description: text => theme.fg("muted", text), scrollInfo: text => theme.fg("dim", text), noMatch: text => theme.fg("warning", text),
  },
});
const markdownTheme = theme => ({
  heading: text => theme.fg("mdHeading", text), link: text => theme.fg("mdLink", text), linkUrl: text => theme.fg("mdLinkUrl", text),
  code: text => theme.fg("mdCode", text), codeBlock: text => theme.fg("mdCodeBlock", text), codeBlockBorder: text => theme.fg("mdCodeBlockBorder", text),
  quote: text => theme.fg("mdQuote", text), quoteBorder: text => theme.fg("mdQuoteBorder", text), hr: text => theme.fg("mdHr", text),
  listBullet: text => theme.fg("mdListBullet", text), bold: text => theme.bold(text), italic: text => theme.italic(text),
  strikethrough: text => theme.strikethrough(text), underline: text => theme.underline(text),
});
const pad = (text, width) => text + " ".repeat(Math.max(0, width - visibleWidth(text)));

export const questionnaireSchema = Type.Object({
  questions: Type.Array(Type.Object({
    question: Type.String({ minLength: 1, description: "Complete question for the user." }),
    header: Type.String({ minLength: 1, maxLength: 16, description: "Short question tab." }),
    options: Type.Array(Type.Object({
      label: Type.String({ minLength: 1, maxLength: 60 }),
      description: Type.String({ description: "Explain the choice and its trade-offs." }),
      preview: Type.Optional(Type.String({ description: "Markdown artifact to compare; single-select only." })),
    }), { minItems: 2, maxItems: 4 }),
    multiSelect: Type.Optional(Type.Boolean()),
  }), { minItems: 1, maxItems: 4 }),
});

export function validateQuestionnaire(input) {
  if (!Array.isArray(input?.questions) || input.questions.length < 1 || input.questions.length > 4) return "questions must contain 1-4 questions";
  for (const question of input.questions) {
    if (typeof question?.question !== "string" || !question.question.trim() || typeof question.header !== "string" || !question.header.trim() || question.header.length > 16) return "each question needs complete text and a header of 1-16 characters";
    if (/[\n\t]/.test(question.header)) return "question headers may not contain line breaks or tabs";
    if (!Array.isArray(question.options) || question.options.length < 2 || question.options.length > 4) return "each question needs 2-4 options";
    if (question.options.some(option => typeof option?.label !== "string" || !option.label.trim() || option.label.length > 60 || RESERVED_LABELS.has(option.label.trim().toLowerCase()))) return `option labels need 1-60 characters and may not be Other or ${CUSTOM_LABEL}`;
    if (question.options.some(option => typeof option.description !== "string" || (option.preview !== undefined && typeof option.preview !== "string"))) return "option descriptions and previews must be text";
    if (question.multiSelect !== undefined && typeof question.multiSelect !== "boolean") return "multiSelect must be a boolean";
    if (question.multiSelect && question.options.some(option => option.preview !== undefined)) return "previews are only supported for single-select questions";
    const text = [question.question, question.header, ...question.options.flatMap(option => [option.label, option.description, option.preview ?? ""])];
    if (text.some(value => /[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(value))) return "Questions and options may not contain terminal control characters; use Markdown formatting.";
  }
}

export function questionnaireResult(questions, drafts, cancelled = false) {
  if (cancelled) return { content: [{ type: "text", text: "Questionnaire cancelled; no decisions were submitted." }], details: { cancelled: true, answers: [] } };
  const answers = questions.map((question, index) => {
    const draft = drafts[index];
    const selected = [...draft.selected].sort((a, b) => a - b).map(optionIndex => {
      const answer = { number: optionIndex + 1, label: question.options[optionIndex].label };
      const note = draft.notes.get(optionIndex);
      if (note?.trim()) answer.note = note;
      return answer;
    });
    const answer = { id: index + 1, header: question.header };
    if (selected.length) answer.selected = selected;
    if (draft.customIncluded && draft.custom.trim()) answer.custom = draft.custom;
    return { answer, detail: { ...answer, question: question.question } };
  }).filter(({ answer }) => answer.selected?.length || answer.custom !== undefined);
  return {
    content: [{ type: "text", text: JSON.stringify({ answers: answers.map(({ answer }) => answer) }) }],
    details: { cancelled: false, answers: answers.map(({ detail }) => detail) },
  };
}

export class QuestionnaireComponent {
  constructor(tui, theme, keybindings, done, questions, signal) {
    Object.assign(this, { tui, theme, keybindings, done, questions, signal });
    this.questionIndex = 0;
    this.row = 0;
    this.mode = "browse";
    this.finished = false;
    this.scroll = 0;
    this.pageSize = 1;
    this.followChoice = true;
    this.notice = "";
    this.drafts = questions.map(() => ({ selected: new Set(), notes: new Map(), custom: "", customIncluded: false, row: 0 }));
    this.editor = new Editor(tui, editorTheme(theme));
    // Native submission trims text; save the expanded editor value ourselves.
    this.editor.disableSubmit = true;
    this.focused = true;
    this.onAbort = () => this.finish(null);
    if (signal?.aborted) this.onAbort();
    else signal?.addEventListener("abort", this.onAbort, { once: true });
  }
  get focused() { return this._focused; }
  set focused(value) { this._focused = value; this.editor.focused = value && this.editing(); }
  editing() { return this.mode === "note" || this.mode === "custom"; }
  question() { return this.questions[this.questionIndex]; }
  draft() { return this.drafts[this.questionIndex]; }
  isCustom() { return this.row === this.question().options.length; }
  answered(index) {
    const draft = this.drafts[index];
    return draft.selected.size > 0 || Boolean(draft.customIncluded && draft.custom.trim());
  }
  finish(value) {
    if (this.finished) return;
    this.finished = true;
    this.dispose();
    this.done(value);
  }
  refresh() {
    this.editor.focused = this.focused && this.editing();
    this.tui.requestRender();
  }
  goTo(index) {
    this.draft().row = this.row;
    this.mode = index === this.questions.length ? "review" : "browse";
    if (this.mode === "browse") {
      this.questionIndex = index;
      this.row = this.draft().row;
    }
    this.scroll = 0;
    this.followChoice = true;
    this.notice = "";
    this.refresh();
  }
  openEditor(kind) {
    this.mode = kind;
    this.editingOption = this.row;
    this.editor.setText(kind === "custom" ? this.draft().custom : this.draft().notes.get(this.row) ?? "");
    this.refresh();
  }
  saveEditor() {
    const text = this.editor.getExpandedText();
    const custom = this.mode === "custom";
    if (custom) {
      this.draft().custom = text;
      this.draft().customIncluded = Boolean(text.trim());
      if (!this.question().multiSelect && text.trim()) this.draft().selected.clear();
    } else if (text.trim()) this.draft().notes.set(this.editingOption, text);
    else this.draft().notes.delete(this.editingOption);
    this.mode = "browse";
    this.followChoice = true;
    if (custom && !this.question().multiSelect && text.trim()) this.advance();
    else this.refresh();
  }
  advance() {
    if (!this.answered(this.questionIndex)) {
      this.notice = "Choose an option or enter an answer.";
      this.refresh();
    } else if (this.questions.length === 1) this.finish(this.drafts);
    else this.goTo(this.questionIndex + 1);
  }
  confirm() {
    if (!this.question().multiSelect && !this.isCustom()) {
      this.draft().selected = new Set([this.row]);
      this.draft().customIncluded = false;
    }
    this.advance();
  }
  handleInput(data) {
    if (this.finished) return;
    const matches = action => this.keybindings.matches(data, action);
    const cancel = matches("tui.select.cancel") || matchesKey(data, Key.escape);
    if (cancel) {
      if (this.editing()) { this.mode = "browse"; this.followChoice = true; this.refresh(); }
      else this.finish(null);
      return;
    }
    if (this.tui.terminal.rows < 8) return;
    if (this.editing()) {
      if (matches("tui.input.newLine")) this.editor.handleInput(data);
      else if (matches("tui.input.submit") || matches("tui.select.confirm") || matchesKey(data, Key.enter)) { this.saveEditor(); return; }
      else this.editor.handleInput(data);
      this.refresh();
      return;
    }
    if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.pageDown)) {
      this.scroll += (matchesKey(data, Key.pageUp) ? -1 : 1) * this.pageSize;
      this.followChoice = false;
      this.refresh();
      return;
    }
    const tab = this.mode === "review" ? this.questions.length : this.questionIndex;
    if (matchesKey(data, Key.left)) { if (tab > 0) this.goTo(tab - 1); return; }
    if (matchesKey(data, Key.right)) { if (tab < this.questions.length - 1 || (this.questions.length > 1 && tab < this.questions.length)) this.goTo(tab + 1); return; }
    const enter = matches("tui.select.confirm") || matches("tui.input.submit") || matchesKey(data, Key.enter);
    if (this.mode === "review") {
      if (enter) {
        const missing = this.questions.findIndex((_, index) => !this.answered(index));
        if (missing < 0) this.finish(this.drafts);
        else { this.goTo(missing); this.notice = "Answer this question before submitting."; this.refresh(); }
      }
      return;
    }
    if (matches("tui.select.up") || matchesKey(data, Key.up)) this.row = Math.max(0, this.row - 1);
    else if (matches("tui.select.down") || matchesKey(data, Key.down)) this.row = Math.min(this.question().options.length, this.row + 1);
    else if (matches("tui.input.tab") || matchesKey(data, Key.tab)) { this.openEditor(this.isCustom() ? "custom" : "note"); return; }
    else if (matchesKey(data, Key.space) && this.question().multiSelect) {
      if (this.isCustom()) { if (this.draft().custom.trim()) this.draft().customIncluded = !this.draft().customIncluded; }
      else if (this.draft().selected.has(this.row)) this.draft().selected.delete(this.row);
      else this.draft().selected.add(this.row);
    } else if (enter) {
      if (this.isCustom() && !(this.question().multiSelect && this.draft().customIncluded)) this.openEditor("custom");
      else this.confirm();
      return;
    } else return;
    this.followChoice = true;
    this.notice = "";
    this.refresh();
  }
  choices(width) {
    const draft = this.draft();
    const lines = [];
    let focus = 0;
    const options = [...this.question().options, { label: CUSTOM_LABEL, description: draft.custom }];
    for (const [index, option] of options.entries()) {
      const custom = index === this.question().options.length;
      const selected = custom ? draft.customIncluded : draft.selected.has(index);
      const marker = this.question().multiSelect ? (selected ? "[x]" : "[ ]") : (selected ? "●" : "○");
      const title = `${index === this.row ? "→" : " "} ${marker} ${custom ? "" : `${index + 1}. `}${option.label}`;
      if (index === this.row) focus = lines.length;
      lines.push(...wrapTextWithAnsi(index === this.row ? this.theme.fg("accent", title) : title, width));
      for (const text of [option.description, !custom && draft.notes.get(index) ? `note: ${draft.notes.get(index)}` : ""]) {
        if (text) lines.push(...wrapTextWithAnsi(text, Math.max(1, width - 4)).map(line => `${" ".repeat(Math.min(4, width - 1))}${this.theme.fg("muted", line)}`));
      }
    }
    return { lines, focus };
  }
  renderPreview(preview, width) {
    if (width < 3) return new Markdown(preview, 0, 0, markdownTheme(this.theme)).render(width);
    const inner = width - 2;
    const border = text => this.theme.fg("borderMuted", text);
    const lines = new Markdown(preview, 0, 0, markdownTheme(this.theme)).render(inner);
    return [border(`┌${"─".repeat(inner)}┐`), ...lines.map(line => `${border("│")}${pad(truncateToWidth(line, inner, ""), inner)}${border("│")}`), border(`└${"─".repeat(inner)}┘`)];
  }
  render(width) {
    const usable = Math.max(1, width);
    const rows = this.tui.terminal.rows;
    const clip = line => truncateToWidth(line, usable, "");
    if (rows < 8) return [clip("Resize to at least 8 rows · Esc cancel")];
    const question = this.question();
    if (this.editing()) {
      const editor = this.editor.render(usable);
      const label = this.mode === "custom" ? "Custom answer" : `Note for ${this.editingOption + 1}. ${question.options[this.editingOption].label}`;
      const heading = clip(this.theme.fg("accent", `${question.header} · ${label}`));
      const space = Math.max(0, rows - editor.length - 1);
      const context = [...wrapTextWithAnsi(question.question, usable), "Enter save · Shift+Enter newline · Esc back"].slice(-space);
      // Reserve the complete native editor block; never crop its cursor or borders.
      return [heading, ...(space ? context.map(clip) : []), ...editor];
    }
    const multiQuestion = this.questions.length > 1;
    const frame = this.theme.fg("borderAccent", "─".repeat(usable));
    let heading;
    if (multiQuestion) {
      const active = this.mode === "review" ? this.questions.length : this.questionIndex;
      const tabs = [...this.questions.map(item => item.header), "Review"].map((label, index) =>
        index === active
          ? this.theme.bg("userMessageBg", ` ${this.theme.fg("accent", this.theme.bold(label))} `)
          : this.theme.fg("muted", ` ${label} `));
      // Each tab pads itself, so joining without a separator still leaves a
      // two-column gap between labels.
      // When the full strip does not fit, start at the active tab, not a hidden predecessor.
      const visible = visibleWidth(tabs.join("")) > usable ? tabs.slice(active) : tabs;
      heading = clip(visible.join(""));
    }
    const body = [];
    let focus = 0;
    let hint;
    if (this.mode === "review") {
      for (const [index, item] of this.questions.entries()) {
        const draft = this.drafts[index];
        body.push(...wrapTextWithAnsi(`${index + 1}. ${item.question}`, usable));
        const decisions = [...draft.selected].sort((a, b) => a - b).map(option => `${item.options[option].label}${draft.notes.get(option) ? ` — ${draft.notes.get(option)}` : ""}`);
        if (draft.customIncluded && draft.custom.trim()) decisions.push(draft.custom);
        body.push(...wrapTextWithAnsi(decisions.join("; ") || "Answer required", usable), "");
      }
      hint = "← edit questions · Enter submit · Esc cancel";
    } else {
      body.push(...wrapTextWithAnsi(question.question, usable), "");
      const preview = !question.multiSelect && !this.isCustom() ? question.options[this.row].preview : undefined;
      const natural = this.choices(Number.MAX_SAFE_INTEGER);
      const choiceWidth = Math.min(Math.max(...natural.lines.map(visibleWidth)), Math.floor((usable - 2) / 2));
      if (preview && usable >= 64) {
        const choices = this.choices(choiceWidth);
        focus = body.length + choices.focus;
        const remaining = usable - choiceWidth - 2;
        const previewWidth = Math.min(remaining, Math.max(12, ...preview.split("\n").map(line => visibleWidth(line) + 2)));
        const offset = choiceWidth + 2 + Math.floor((remaining - previewWidth) / 2);
        const right = this.renderPreview(preview, previewWidth);
        for (let index = 0; index < Math.max(choices.lines.length, right.length); index++) body.push(`${pad(choices.lines[index] ?? "", offset)}${right[index] ?? ""}`);
      } else {
        const choices = this.choices(usable);
        focus = body.length + choices.focus;
        body.push(...choices.lines);
        if (preview) body.push("", ...this.renderPreview(preview, usable));
      }
      hint = question.multiSelect ? "Space toggle · Enter continue · Tab edit · Esc cancel" : "Enter choose · Tab note · Esc cancel";
      if (this.questions.length > 1) hint = `←/→ tabs · ${hint}`;
    }
    this.pageSize = Math.max(1, rows - (multiQuestion ? 6 : 5));
    const maximum = Math.max(0, body.length - this.pageSize);
    this.scroll = Math.max(0, Math.min(this.scroll, maximum));
    if (this.followChoice) {
      if (focus < this.scroll) this.scroll = focus;
      else if (focus >= this.scroll + this.pageSize) this.scroll = focus - this.pageSize + 1;
    }
    this.scroll = Math.min(this.scroll, maximum);
    if (maximum) hint = `PgUp/PgDn scroll · ${hint}`;
    return [frame, ...(heading ? [heading] : []), "", ...body.slice(this.scroll, this.scroll + this.pageSize).map(clip), "", clip(this.theme.fg(this.notice ? "warning" : "dim", this.notice || hint)), frame];
  }
  invalidate() { this.editor.invalidate(); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.signal?.removeEventListener("abort", this.onAbort);
  }
}

export function registerQuestionnaire(pi) {
  pi.registerTool({
    name: "ask_user_question", label: "Ask user question",
    description: "Ask related questions together when a user decision is needed. A custom-answer row is supplied; do not add Other or Type something. Use single-select previews only for artifacts worth comparing. Put a recommended option first and suffix its label with (Recommended).",
    promptSnippet: "Ask structured questions when a user decision is needed.", parameters: questionnaireSchema, executionMode: "sequential", renderShell: "self",
    renderCall() { return { render: () => [], invalidate() {} }; }, renderResult() { return { render: () => [], invalidate() {} }; },
    async execute(_id, params, signal, _update, ctx) {
      const invalid = validateQuestionnaire(params);
      if (invalid) throw new Error(invalid);
      if (ctx.mode !== "tui" || !ctx.hasUI) return { content: [{ type: "text", text: "Questionnaire unavailable: this client cannot render interactive questions." }], details: { cancelled: false, answers: [], error: "unavailable" } };
      if (signal?.aborted) return questionnaireResult(params.questions, [], true);
      let component;
      try {
        const drafts = await ctx.ui.custom((tui, theme, keybindings, done) => {
          component = new QuestionnaireComponent(tui, theme, keybindings, done, params.questions, signal);
          return component;
        });
        return questionnaireResult(params.questions, drafts, !drafts);
      } finally { component?.dispose(); }
    },
  });
}
