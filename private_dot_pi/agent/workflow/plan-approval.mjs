import { Editor, Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export const PLAN_APPROVED = "approved";
export const PLAN_REVISION = "revision_requested";
export const PLAN_CANCELLED = "cancelled";

const trimFeedback = value => String(value ?? "").trim();

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
      this.editing = false;
      this.selected = (this.selected + 1) % 3;
      this.refresh();
      return;
    }
    if (!this.editing && (kb.matches(data, "tui.select.up") || matchesKey(data, Key.up))) {
      this.selected = Math.max(0, this.selected - 1);
      this.refresh();
      return;
    }
    if (!this.editing && (kb.matches(data, "tui.select.down") || matchesKey(data, Key.down))) {
      this.selected = Math.min(2, this.selected + 1);
      this.refresh();
      return;
    }
    if (!this.editing) {
      if (!(kb.matches(data, "tui.select.confirm") || kb.matches(data, "tui.input.submit") || matchesKey(data, Key.enter))) return;
      if (this.selected === 0) this.finish({ decision: PLAN_APPROVED });
      else if (this.selected === 1) {
        this.editing = true;
        this.refresh();
      } else this.finish({ decision: PLAN_CANCELLED });
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
    const lines = wrapTextWithAnsi(this.theme.fg("text", "Approve the current plan?"), usable);
    const option = (index, label) => index === this.selected
      ? this.theme.fg("accent", `> ${label}`)
      : `  ${label}`;
    for (const [index, label] of [[0, "Yes, approve and execute"], [1, "Give feedback…"], [2, "No, cancel"]]) {
      lines.push(...wrapTextWithAnsi(option(index, label), usable));
    }
    if (this.editing) {
      lines.push(...wrapTextWithAnsi(this.theme.fg("muted", "Optional feedback:"), usable));
      lines.push(...this.editor.render(usable));
      lines.push(...wrapTextWithAnsi(this.theme.fg("dim", "Enter submit · Shift+Enter newline · Tab next option · Esc cancel"), usable));
    } else {
      lines.push(...wrapTextWithAnsi(this.theme.fg("dim", "Up/down move · Tab next option · Enter select · Esc cancel"), usable));
    }
    return lines.map(line => truncateToWidth(line, usable, ""));
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
