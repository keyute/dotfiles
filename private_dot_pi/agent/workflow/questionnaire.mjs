import { Type } from "typebox";
import { CURSOR_MARKER, Markdown, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Dialog } from "./dialog.mjs";
import { pad } from "./rows.mjs";

const CUSTOM_LABEL = "Type something.";
const RESERVED_LABELS = new Set(["other", CUSTOM_LABEL.toLowerCase()]);
const markdownTheme = theme => ({
  heading: text => theme.fg("mdHeading", text), link: text => theme.fg("mdLink", text), linkUrl: text => theme.fg("mdLinkUrl", text),
  code: text => theme.fg("mdCode", text), codeBlock: text => theme.fg("mdCodeBlock", text), codeBlockBorder: text => theme.fg("mdCodeBlockBorder", text),
  quote: text => theme.fg("mdQuote", text), quoteBorder: text => theme.fg("mdQuoteBorder", text), hr: text => theme.fg("mdHr", text),
  listBullet: text => theme.fg("mdListBullet", text), bold: text => theme.bold(text), italic: text => theme.italic(text),
  strikethrough: text => theme.strikethrough(text), underline: text => theme.underline(text),
});

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

export class QuestionnaireComponent extends Dialog {
  constructor(tui, theme, keybindings, done, questions, signal) {
    super(tui, theme, keybindings, done, signal, null);
    Object.assign(this, { questions });
    this.questionIndex = 0;
    this.row = 0;
    this.mode = "browse";
    this.scroll = 0;
    this.pageSize = 1;
    this.followChoice = true;
    this.notice = "";
    this.drafts = questions.map(() => ({ selected: new Set(), notes: new Map(), custom: "", customIncluded: false, row: 0 }));
    // Native submission trims text; save the expanded editor value ourselves.
    this.editor.disableSubmit = true;
  }
  editingNow() { return this.mode === "note" || this.mode === "custom"; }
  question() { return this.questions[this.questionIndex]; }
  draft() { return this.drafts[this.questionIndex]; }
  isCustom() { return this.row === this.question().options.length; }
  answered(index) {
    const draft = this.drafts[index];
    return draft.selected.size > 0 || Boolean(draft.customIncluded && draft.custom.trim());
  }
  goTo(index) {
    this.draft().row = this.row;
    this.mode = index === this.questions.length ? "review" : "browse";
    if (this.mode === "browse") {
      this.questionIndex = index;
      this.row = this.draft().row;
      if (this.isCustom()) this.openEditor("custom");
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
    this.followChoice = true;
    this.notice = "";
    this.refresh();
  }
  // Custom text is committed on every keystroke so leaving the row (Up, tab switch) keeps the draft.
  syncCustom() {
    if (this.mode !== "custom") return;
    this.draft().custom = this.editor.getExpandedText();
    if (this.question().multiSelect) this.draft().customIncluded = Boolean(this.draft().custom.trim());
  }
  saveEditor() {
    const text = this.editor.getExpandedText();
    if (this.mode === "custom") {
      this.draft().custom = text;
      if (!this.question().multiSelect) {
        this.draft().customIncluded = Boolean(text.trim());
        if (text.trim()) this.draft().selected.clear();
      }
      // Stay in custom mode: advance() either leaves the question or shows its notice over the open field.
      this.advance();
      return;
    }
    if (text.trim()) this.draft().notes.set(this.editingOption, text);
    else this.draft().notes.delete(this.editingOption);
    this.mode = "browse";
    this.followChoice = true;
    this.refresh();
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
    const keys = this.keys(data);
    if (keys.cancel) {
      // A note discards back to browse; the custom row cancels like any other browse row.
      if (this.mode === "note") { this.mode = "browse"; this.followChoice = true; this.refresh(); }
      else this.finish(null);
      return;
    }
    if (this.tui.terminal.rows < 8) return;
    if (this.editingNow()) {
      if (keys.tab) {
        if (this.mode === "note") this.saveEditor();
        return;
      }
      if (keys.newline) { this.editor.handleInput(data); this.syncCustom(); this.refresh(); return; }
      if (keys.enter) { this.saveEditor(); return; }
      if (this.mode === "custom") {
        if (keys.up && this.editor.getCursor().line === 0) {
          this.mode = "browse";
          this.row = Math.max(0, this.row - 1);
          this.followChoice = true;
          this.refresh();
          return;
        }
        if (!this.draft().custom.trim()) {
          if (keys.left) { if (this.questionIndex > 0) this.goTo(this.questionIndex - 1); return; }
          if (keys.right) { if (this.questionIndex < this.questions.length - 1 || this.questions.length > 1) this.goTo(this.questionIndex + 1); return; }
        }
      }
      this.editor.handleInput(data);
      this.syncCustom();
      this.notice = "";
      this.refresh();
      return;
    }
    if (keys.pageUp || keys.pageDown) {
      this.scroll += (keys.pageUp ? -1 : 1) * this.pageSize;
      this.followChoice = false;
      this.refresh();
      return;
    }
    const tab = this.mode === "review" ? this.questions.length : this.questionIndex;
    if (keys.left) { if (tab > 0) this.goTo(tab - 1); return; }
    if (keys.right) { if (tab < this.questions.length - 1 || (this.questions.length > 1 && tab < this.questions.length)) this.goTo(tab + 1); return; }
    if (this.mode === "review") {
      if (keys.enter) {
        const missing = this.questions.findIndex((_, index) => !this.answered(index));
        if (missing < 0) this.finish(this.drafts);
        else { this.goTo(missing); this.notice = "Answer this question before submitting."; this.refresh(); }
      }
      return;
    }
    if (keys.up) this.row = Math.max(0, this.row - 1);
    else if (keys.down) { this.row = Math.min(this.question().options.length, this.row + 1); if (this.isCustom()) { this.openEditor("custom"); return; } }
    else if (keys.tab) { if (!this.isCustom()) this.openEditor("note"); return; }
    else if (keys.space && this.question().multiSelect) {
      if (this.draft().selected.has(this.row)) this.draft().selected.delete(this.row);
      else this.draft().selected.add(this.row);
    } else if (keys.enter) {
      if (this.isCustom()) this.openEditor("custom");
      else this.confirm();
      return;
    } else return;
    this.followChoice = true;
    this.notice = "";
    this.refresh();
  }
  // `live` renders the active native editor (with its cursor); disable it for the natural-width
  // measuring pass so a huge width is never handed to Editor.render.
  choices(width, live = true) {
    const draft = this.draft();
    const question = this.question();
    const lines = [];
    let focus = 0;
    const mark = selected => question.multiSelect ? this.theme.fg(selected ? "accent" : "muted", selected ? "[✔] " : "[ ] ") : "";
    const describe = text => wrapTextWithAnsi(text, Math.max(1, width - 2)).map(line => `  ${this.theme.fg("muted", line)}`);
    question.options.forEach((option, index) => {
      const focused = index === this.row;
      const chosen = draft.selected.has(index);
      const title = `${mark(chosen)}${this.label(`${index + 1}. ${option.label}${chosen && !question.multiSelect ? " ✔" : ""}`, { focused, chosen })}`;
      if (focused) focus = lines.length;
      lines.push(...this.line(title, width, focused));
      lines.push(...describe(option.description));
      const note = draft.notes.get(index);
      if (this.mode === "note" && this.editingOption === index) {
        const prefix = `  ${this.theme.fg("muted", "↳ note: ")}`;
        lines.push(...this.hang(prefix, this.field({ width: width - visibleWidth(prefix), active: live && this.focused, text: this.editor.getText() })));
      } else if (note) {
        lines.push(...describe(`↳ note: ${note}`));
      }
    });
    const editingCustom = this.mode === "custom";
    const focused = question.options.length === this.row;
    const rawPrefix = `${this.gutter(focused)}${mark(draft.customIncluded)}${question.options.length + 1}. `;
    const indent = visibleWidth(rawPrefix);
    if (focused) focus = lines.length;
    const active = editingCustom && live && this.focused;
    let bodyLines = this.field({ width: Math.max(1, width - indent), active, text: draft.custom, placeholder: CUSTOM_LABEL });
    if (!active && draft.customIncluded && draft.custom.trim()) {
      bodyLines = bodyLines.map(line => this.theme.bold(line));
      if (!question.multiSelect) bodyLines[bodyLines.length - 1] += this.theme.bold(" ✔");
    }
    lines.push(...this.hang(rawPrefix, bodyLines));
    const cursor = lines.findIndex(line => line.includes(CURSOR_MARKER));
    return { lines, focus: cursor >= 0 ? cursor : focus };
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
    if (rows < 8) return [truncateToWidth("  Resize to at least 8 rows · Esc cancel", usable, "")];
    const question = this.question();
    const multiQuestion = this.questions.length > 1;
    let heading;
    if (multiQuestion) {
      const active = this.mode === "review" ? this.questions.length : this.questionIndex;
      const tabs = [...this.questions.map(item => item.header), "Submit"].map((label, index) => {
        const mark = index === this.questions.length ? "✔" : this.answered(index) ? "☑" : "☐";
        const text = `${mark} ${label}`;
        return index === active
          ? this.theme.bg("userMessageBg", ` ${this.theme.fg("accent", this.theme.bold(text))} `)
          : this.theme.fg(index < this.questions.length && this.answered(index) ? "success" : "muted", ` ${text} `);
      });
      // Each tab pads itself, so joining without a separator still leaves a
      // two-column gap between labels.
      // When the full strip does not fit, start at the active tab, not a hidden predecessor.
      const stripWidth = Math.max(0, usable - 2);
      const visible = visibleWidth(tabs.join("")) > stripWidth ? tabs.slice(active) : tabs;
      heading = `  ${visible.join("")}`;
    }
    const body = [];
    let focus = 0;
    let hint;
    if (this.mode === "review") {
      for (const [index, item] of this.questions.entries()) {
        const draft = this.drafts[index];
        if (index) body.push("");
        body.push(...this.line(this.theme.bold(`${index + 1}. ${item.question}`), usable));
        const decisions = [...draft.selected].sort((a, b) => a - b).map(option => {
          const note = draft.notes.get(option);
          return `${item.options[option].label}${note ? this.theme.fg("muted", ` — ${note}`) : ""}`;
        });
        if (draft.customIncluded && draft.custom.trim()) decisions.push(draft.custom);
        const answer = decisions.length ? decisions.join("; ") : this.theme.fg("warning", "Answer required");
        const prefix = `  ${this.theme.fg("muted", "↳ ")}`;
        body.push(...this.hang(prefix, wrapTextWithAnsi(answer, Math.max(1, usable - visibleWidth(prefix)))));
      }
      hint = "← edit questions · Enter submit · Esc cancel";
    } else {
      body.push(...this.line(this.theme.bold(question.question), usable), "");
      const preview = !question.multiSelect && !this.isCustom() ? question.options[this.row].preview : undefined;
      const natural = this.choices(Number.MAX_SAFE_INTEGER, false);
      // A field wraps one short of its width, the cell the native editor keeps for its cursor.
      const choiceWidth = Math.min(Math.max(...natural.lines.map(visibleWidth)) + 1, Math.floor((usable - 2) / 2));
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
        if (preview) body.push("", ...this.renderPreview(preview, Math.max(1, usable - 2)).map(line => `  ${line}`));
      }
      if (this.mode === "note") hint = "Enter save · Shift+Enter newline · Esc back";
      else if (this.mode === "custom") hint = "Enter submit · Shift+Enter newline · ↑ options · Esc cancel";
      else hint = question.multiSelect ? "Space toggle · Enter continue · Tab note · Esc cancel" : "Enter choose · Tab note · Esc cancel";
      if (multiQuestion && this.mode !== "note") hint = `←/→ tabs · ${hint}`;
    }
    this.pageSize = Math.max(1, rows - (multiQuestion ? 6 : 5));
    const maximum = Math.max(0, body.length - this.pageSize);
    this.scroll = Math.max(0, Math.min(this.scroll, maximum));
    if (this.followChoice) {
      if (focus < this.scroll) this.scroll = focus;
      else if (focus >= this.scroll + this.pageSize) this.scroll = focus - this.pageSize + 1;
    }
    this.scroll = Math.min(this.scroll, maximum);
    if (maximum && !this.editingNow()) hint = `PgUp/PgDn scroll · ${hint}`;
    const content = [...(heading ? [heading] : []), "", ...body.slice(this.scroll, this.scroll + this.pageSize), "", `  ${this.theme.fg(this.notice ? "warning" : "dim", this.notice || hint)}`];
    return this.frame(content, usable);
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
