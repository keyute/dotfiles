import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Dialog } from "./dialog.mjs";
import { alignRight, formatDuration, oneLine, slotHeight } from "./rows.mjs";

// The fleet's workflow overview (docs/pi-design.md rule 6): a run's agents by
// phase and the pick the fleet then peeks. A rule 11 view at the peek's fixed
// half-height slot. It holds the group past its end(), so a finished run's
// children stay pickable until Esc.
const FAILED = new Set(["failed", "stopped", "unknown"]);
// The fleet's and the peek's state colours; a running record stays plain.
const tone = status => status === "completed" ? "success" : status === "launching" ? "dim" : FAILED.has(status) ? "error" : status === "running" ? undefined : "warning";

export class WorkflowView extends Dialog {
  constructor(tui, theme, keybindings, done, { group, signal, selected, tickMs = 1_000 }) {
    super(tui, theme, keybindings, done, signal);
    this.group = group;
    this.cursor = Math.max(0, this.order().indexOf(selected));
    this.offset = 0;
    if (this.finished) return;
    this.off = group.onChange(() => this.refresh());
    // The header's elapsed time moves between status changes.
    this.timer = setInterval(() => this.tui.requestRender(), tickMs);
    this.timer.unref?.();
  }
  dispose() {
    super.dispose();
    this.off?.();
    clearInterval(this.timer);
  }
  editingNow() { return false; }
  // Unphased records first, then each phase in first-appearance order.
  sections() {
    const sections = new Map([[undefined, []]]);
    for (const record of this.group.records) {
      if (!sections.has(record.phase)) sections.set(record.phase, []);
      sections.get(record.phase).push(record);
    }
    return [...sections].filter(([, records]) => records.length);
  }
  order() { return this.sections().flatMap(([, records]) => records); }
  handleInput(data) {
    const keys = this.keys(data);
    const records = this.order();
    if (keys.cancel) return this.finish(undefined);
    if (keys.enter) { if (records[this.cursor]) this.finish(records[this.cursor]); return; }
    if (keys.up) this.cursor = Math.max(0, this.cursor - 1);
    if (keys.down) this.cursor = Math.max(0, Math.min(records.length - 1, this.cursor + 1));
    this.refresh();
  }
  headerText(width) {
    const { title, records, startedAt, endedAt } = this.group;
    const count = `${records.length} agent${records.length === 1 ? "" : "s"}`;
    const meta = [count, formatDuration((endedAt ?? Date.now()) - startedAt)].join(" · ");
    const left = `${this.theme.fg("dim", "workflow")}  ${title ? `${this.theme.fg("accent", oneLine(title))}${this.theme.fg("muted", ` · ${meta}`)}` : this.theme.fg("muted", meta)}`;
    return alignRight(left, this.theme.fg("dim", "esc back"), width - 2);
  }
  render(width) {
    const windowHeight = slotHeight(this.tui.terminal?.rows ?? 24) - 4;
    const body = [];
    let at = 0;
    let selectedLine = 0;
    for (const [phase, records] of this.sections()) {
      const indent = phase === undefined ? "" : "  ";
      if (phase !== undefined) {
        const done = records.filter(record => record.status === "completed").length;
        body.push(`  ${this.theme.bold(phase)}${this.theme.fg("muted", ` · ${done}/${records.length} done`)}`);
      }
      for (const record of records) {
        const focused = at++ === this.cursor;
        if (focused) selectedLine = body.length;
        const colour = tone(record.status);
        // The label gives way so the status word survives the frame's cut.
        const room = Math.max(1, width - 2 - indent.length - visibleWidth(` · ${record.status}`));
        const label = truncateToWidth(`${record.agent} › ${oneLine(record.task)}`, room, "…");
        body.push(`${this.gutter(focused)}${indent}${this.label(label, { focused })}${this.theme.fg("muted", " · ")}${colour ? this.theme.fg(colour, record.status) : record.status}`);
      }
    }
    if (!body.length) body.push(`  ${this.theme.fg("dim", "no agents launched yet")}`);
    this.offset = Math.min(Math.max(this.offset, selectedLine - windowHeight + 1), selectedLine);
    const window = body.slice(this.offset, this.offset + windowHeight);
    while (window.length < windowHeight) window.push("");
    return this.frame([`  ${this.headerText(width)}`, "", ...window], width);
  }
}

// Resolves to the picked record, or undefined on Esc or abort.
export function openWorkflowView(ctx, opts) {
  return ctx.ui.custom((tui, theme, keybindings, done) => new WorkflowView(tui, theme, keybindings, done, opts));
}
