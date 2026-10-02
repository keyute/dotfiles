import { Markdown, visibleWidth } from "@earendil-works/pi-tui";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Dialog } from "./dialog.mjs";
import { TASK_CHARS } from "./approval.mjs";

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

function updatePlanTask(userTask, { decision, plan, feedback }) {
  const addition = decision === PLAN_APPROVED
    ? `Approved plan: ${plan}`
    : decision === PLAN_REVISION && trimFeedback(feedback)
      ? `Plan feedback: ${trimFeedback(feedback)}`
      : "";
  return addition ? `${userTask}\n${addition}`.slice(-TASK_CHARS) : userTask;
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
  const plan = calls.find(block => block.name === "submit_plan" && block.arguments?.action !== "read");
  if (!plan || calls.length === 1) return undefined;
  message.content = message.content.filter(block => block.type !== "toolCall" || block === plan);
  return message;
}

// Tool-result snapshots follow the branch, including entries summarized by compaction.
export class PlanState {
  snapshot;
  generation = 0;

  restore(ctx) {
    this.generation++;
    this.snapshot = undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      const message = entry.message;
      if (entry.type !== "message" || message?.role !== "toolResult" || message.toolName !== "submit_plan" || message.isError) continue;
      const details = message.details;
      if (details?.action !== "read" && typeof details?.plan === "string" && Number.isInteger(details.revision)) this.snapshot = { ...details };
    }
  }

  revise(args) {
    if (args.plan !== undefined && args.edits !== undefined) throw new Error("Use plan or edits, not both");
    let plan = this.snapshot?.plan;
    if (args.plan !== undefined) {
      if (typeof args.plan !== "string" || !args.plan.trim()) throw new Error("plan must be nonempty Markdown");
      plan = args.plan;
    }
    if (args.edits !== undefined) {
      if (!this.snapshot || !Number.isInteger(args.revision) || args.revision !== this.snapshot.revision) throw new Error("Edits require the current revision");
      if (!Array.isArray(args.edits) || !args.edits.length) throw new Error("edits must be a nonempty array");
      const matches = args.edits.map(({ oldText, newText }) => {
        if (typeof oldText !== "string" || !oldText || typeof newText !== "string") throw new Error("Malformed plan edit");
        const start = plan.indexOf(oldText);
        if (start < 0 || plan.indexOf(oldText, start + 1) !== -1) throw new Error("oldText must match uniquely");
        return { start, end: start + oldText.length, newText };
      }).sort((a, b) => a.start - b.start);
      if (matches.some((match, i) => i && match.start < matches[i - 1].end)) throw new Error("Plan edits overlap");
      for (const match of matches.reverse()) plan = plan.slice(0, match.start) + match.newText + plan.slice(match.end);
      if (!plan.trim()) throw new Error("plan must be nonempty Markdown");
    }
    if (plan === undefined) throw new Error("No current plan; provide plan first");
    if (plan !== this.snapshot?.plan) this.snapshot = { plan, revision: (this.snapshot?.revision ?? 0) + 1, decision: "pending" };
    return this.snapshot;
  }
}

class PlanViewComponent extends Dialog {
  constructor(tui, theme, keybindings, done, snapshot) {
    super(tui, theme, keybindings, done);
    this.snapshot = snapshot;
    this.markdown = new Markdown(snapshot.plan, 2, 0, getMarkdownTheme());
    this.offset = 0;
  }
  invalidate() {
    super.invalidate();
    this.markdown.invalidate();
  }
  editingNow() { return false; }
  handleInput(data) {
    const keys = this.keys(data);
    if (keys.cancel || keys.enter) this.finish();
    if (keys.up || keys.pageUp) this.offset = Math.max(0, this.offset - (keys.pageUp ? 10 : 1));
    if (keys.down || keys.pageDown) this.offset = Math.min(this.maxOffset ?? 0, this.offset + (keys.pageDown ? 10 : 1));
    this.refresh();
  }
  render(width) {
    const body = this.markdown.render(width);
    const height = Math.max(1, Math.floor(this.tui.terminal.rows / 2) - 4);
    this.maxOffset = Math.max(0, body.length - height);
    this.offset = Math.min(this.offset, this.maxOffset);
    return this.frame([...this.line(this.theme.bold(`Plan · revision ${this.snapshot.revision}`), width), "", ...body.slice(this.offset, this.offset + height)], width);
  }
}

export async function showPlan(ctx, snapshot) {
  if (!snapshot) return ctx.ui.notify("No current plan", "info");
  if (ctx.mode !== "tui") return ctx.ui.notify(`Plan · revision ${snapshot.revision}\n\n${snapshot.plan}`, "info");
  return ctx.ui.custom((tui, theme, keybindings, done) => new PlanViewComponent(tui, theme, keybindings, done, snapshot));
}

class PlanApprovalComponent extends Dialog {
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
  if (ctx.mode !== "tui") return { decision: PLAN_CANCELLED };
  return ctx.ui.custom((tui, theme, keybindings, done) => new PlanApprovalComponent(tui, theme, keybindings, done, signal));
}
