import { CURSOR_MARKER, Editor, Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export const PLAN_APPROVED = "approved";
export const PLAN_REVISION = "revision_requested";
export const PLAN_CANCELLED = "cancelled";

const trimFeedback = value => String(value ?? "").trim();
const FEEDBACK_PLACEHOLDER = "What should change?";

export function planDecisionResult(decision, feedback = "") {
  if (decision === PLAN_APPROVED) return {
    content: [{ type: "text", text: "Plan approved; scoped execution enabled." }],
    details: { decision: PLAN_APPROVED },
  };
  const text = trimFeedback(feedback);
  if (decision === PLAN_REVISION && text) return {
    content: [{ type: "text", text: `Plan revision requested.\n\nFeedback:\n${text}` }],
    details: { decision: PLAN_REVISION, feedback: text },
  };
  return {
    content: [{ type: "text", text: "Plan approval cancelled; remain in planning mode." }],
    details: { decision: PLAN_CANCELLED },
    terminate: true,
  };
}

export function updatePlanTask(userTask, { decision, plan, feedback }) {
  const addition = decision === PLAN_APPROVED
    ? `Approved plan: ${plan}`
    : decision === PLAN_REVISION && trimFeedback(feedback)
      ? `Plan feedback: ${trimFeedback(feedback)}`
      : "";
  return addition ? `${userTask}\n${addition}`.slice(-8000) : userTask;
}

export async function applyPlanDecision(decision, { plan, userTask, setUserTask, setMode, abort }) {
  const feedback = trimFeedback(decision?.feedback);
  if (decision?.decision === PLAN_APPROVED) {
    setUserTask(updatePlanTask(userTask, { decision: PLAN_APPROVED, plan }));
    await setMode();
    return planDecisionResult(PLAN_APPROVED);
  }
  if (decision?.decision === PLAN_REVISION && feedback) {
    setUserTask(updatePlanTask(userTask, { decision: PLAN_REVISION, feedback }));
    return planDecisionResult(PLAN_REVISION, feedback);
  }
  abort();
  return planDecisionResult(PLAN_CANCELLED);
}

// A cancelled approval aborts the run and returns a terminating result, but pi
// only stops a tool batch when every finalized result terminates. Remove sibling
// calls at message_end, the documented barrier before preflight, so none can
// finalize first and force an acknowledgement request after cancellation.
export function isolatePlanApproval(message) {
  if (message?.role !== "assistant") return undefined;
  const calls = (message.content ?? []).filter(block => block.type === "toolCall");
  const plan = calls.find(block => block.name === "submit_plan");
  if (!plan || calls.length === 1) return undefined;
  message.content = message.content.filter(block => block.type !== "toolCall" || block === plan);
  return message;
}

export class PlanApprovalComponent {
  constructor(tui, theme, keybindings, done, signal) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.selected = 0;
    this.editing = false;
    this.isFocused = true;
    this.finished = false;
    this.editor = new Editor(tui, {
      borderColor: text => theme.fg("borderMuted", text),
      selectList: {
        selectedPrefix: text => theme.fg("accent", text),
        selectedText: text => theme.fg("accent", text),
        description: text => theme.fg("muted", text),
        scrollInfo: text => theme.fg("dim", text),
        noMatch: text => theme.fg("warning", text),
      },
    });
    this.onAbort = () => this.finish({ decision: PLAN_CANCELLED });
    signal?.addEventListener("abort", this.onAbort, { once: true });
    this.signal = signal;
    if (signal?.aborted) this.onAbort();
  }

  get focused() { return this.isFocused; }
  set focused(value) {
    this.isFocused = value;
    this.editor.focused = value && this.editing;
  }

  finish(result) {
    if (this.finished) return;
    this.finished = true;
    this.done(result);
  }

  refresh() {
    this.editor.focused = this.isFocused && this.editing;
    this.tui.requestRender();
  }

  handleInput(data) {
    const kb = this.keybindings;
    if (kb.matches(data, "tui.select.cancel") || matchesKey(data, Key.escape)) {
      this.finish({ decision: PLAN_CANCELLED });
      return;
    }
    if (kb.matches(data, "tui.input.tab") || matchesKey(data, Key.tab)) {
      if (this.editing) {
        this.editing = false;
        this.selected = 0;
      } else {
        this.selected = 1;
        this.editing = true;
      }
      this.refresh();
      return;
    }
    if ((!this.editing || this.editor.getCursor().line === 0) && (kb.matches(data, "tui.select.up") || matchesKey(data, Key.up))) {
      this.editing = false;
      this.selected = 0;
      this.refresh();
      return;
    }
    if (!this.editing && (kb.matches(data, "tui.select.down") || matchesKey(data, Key.down))) {
      this.selected = 1;
      this.editing = true;
      this.refresh();
      return;
    }
    if (!this.editing) {
      if (!(kb.matches(data, "tui.select.confirm") || kb.matches(data, "tui.input.submit") || matchesKey(data, Key.enter))) return;
      this.finish({ decision: PLAN_APPROVED });
      return;
    }
    if (kb.matches(data, "tui.input.newLine")) {
      this.editor.handleInput(data);
      this.refresh();
      return;
    }
    if (kb.matches(data, "tui.input.submit") || kb.matches(data, "tui.select.confirm") || matchesKey(data, Key.enter)) {
      const feedback = this.editor.getText();
      this.finish(trimFeedback(feedback) ? { decision: PLAN_REVISION, feedback } : { decision: PLAN_CANCELLED });
      return;
    }
    this.editor.handleInput(data);
    this.refresh();
  }

  render(width) {
    const usable = Math.max(1, width);
    const inset = usable > 1 ? " " : "";
    const contentWidth = usable - inset.length;
    const option = (index, label) => index === this.selected
      ? this.theme.fg("accent", `→ ${label}`)
      : `  ${label}`;
    const noPrefix = `${option(1, "No")}  `;
    const prefixWidth = visibleWidth(noPrefix);
    const feedbackWidth = Math.max(1, contentWidth - prefixWidth);
    const feedback = this.editor.getText();
    const focused = this.isFocused && this.editing;
    let feedbackLines;
    if (!feedback) {
      const placeholder = focused
        ? `${CURSOR_MARKER}\x1b[7m${FEEDBACK_PLACEHOLDER[0]}\x1b[27m${FEEDBACK_PLACEHOLDER.slice(1)}`
        : FEEDBACK_PLACEHOLDER;
      feedbackLines = [this.theme.fg("dim", placeholder)];
    } else if (focused) {
      // Keep native wrapping and navigation geometry; omit only its two borders.
      feedbackLines = this.editor.render(feedbackWidth).slice(1, -1);
    } else {
      feedbackLines = wrapTextWithAnsi(feedback, Math.max(1, feedbackWidth - 1));
    }
    const content = [
      ...wrapTextWithAnsi(this.theme.bold(this.theme.fg("accent", "Approve the current plan?")), contentWidth),
      "",
      option(0, "Yes"),
      ...feedbackLines.map((line, index) => `${index === 0 ? noPrefix : " ".repeat(prefixWidth)}${line}`),
    ];
    const border = this.theme.fg("borderAccent", "─".repeat(usable));
    return [border, ...content.map(line => truncateToWidth(`${inset}${line}`, usable, "")), border];
  }

  invalidate() { this.editor.invalidate(); }

  dispose() { this.signal?.removeEventListener("abort", this.onAbort); }
}

export async function requestPlanApproval(ctx, signal) {
  if (ctx.mode === "tui") {
    return ctx.ui.custom((tui, theme, keybindings, done) => new PlanApprovalComponent(tui, theme, keybindings, done, signal));
  }
  if (!ctx.hasUI) return { decision: PLAN_CANCELLED };
  const choice = await ctx.ui.select("Approve the current plan?", ["Yes", "No"], { signal });
  if (choice === "Yes") return { decision: PLAN_APPROVED };
  if (choice !== "No" || signal?.aborted) return { decision: PLAN_CANCELLED };
  const feedback = await ctx.ui.input("Optional plan feedback", "Enter feedback, or leave blank to cancel", { signal });
  return trimFeedback(feedback) ? { decision: PLAN_REVISION, feedback } : { decision: PLAN_CANCELLED };
}
