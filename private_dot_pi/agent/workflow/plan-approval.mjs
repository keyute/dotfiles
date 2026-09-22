import { visibleWidth } from "@earendil-works/pi-tui";
import { Dialog } from "./dialog.mjs";

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

export class PlanApprovalComponent extends Dialog {
  constructor(tui, theme, keybindings, done, signal) {
    super(tui, theme, keybindings, done, signal, { decision: PLAN_CANCELLED });
    this.selected = 0;
    this.editing = false;
  }

  editingNow() { return this.editing; }

  handleInput(data) {
    const keys = this.keys(data);
    if (keys.cancel) {
      this.finish({ decision: PLAN_CANCELLED });
      return;
    }
    if (keys.tab) {
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
    if ((!this.editing || this.editor.getCursor().line === 0) && keys.up) {
      this.editing = false;
      this.selected = 0;
      this.refresh();
      return;
    }
    if (!this.editing && keys.down) {
      this.selected = 1;
      this.editing = true;
      this.refresh();
      return;
    }
    if (!this.editing) {
      if (!keys.enter) return;
      this.finish({ decision: PLAN_APPROVED });
      return;
    }
    if (keys.newline) {
      this.editor.handleInput(data);
      this.refresh();
      return;
    }
    if (keys.enter) {
      const feedback = this.editor.getText();
      this.finish(trimFeedback(feedback) ? { decision: PLAN_REVISION, feedback } : { decision: PLAN_CANCELLED });
      return;
    }
    this.editor.handleInput(data);
    this.refresh();
  }

  render(width) {
    const usable = Math.max(1, width);
    const yesFocused = this.selected === 0;
    const noFocused = this.selected === 1;
    const noPrefix = `${this.gutter(noFocused)}${this.label("No  ", { focused: noFocused })}`;
    const active = this.focused && this.editing;
    const feedback = this.field({ width: Math.max(1, usable - visibleWidth(noPrefix)), active, text: this.editor.getText(), placeholder: FEEDBACK_PLACEHOLDER });
    const content = [
      ...this.line(this.theme.bold("Approve the current plan?"), usable),
      "",
      ...this.line(this.label("Yes", { focused: yesFocused }), usable, yesFocused),
      ...this.hang(noPrefix, feedback),
    ];
    return this.frame(content, usable);
  }
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
