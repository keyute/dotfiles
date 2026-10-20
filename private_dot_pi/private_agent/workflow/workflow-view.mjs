import { visibleWidth } from "@earendil-works/pi-tui";
import { Dialog } from "./dialog.mjs";
import { formatTokens, progressLine } from "./fleet.mjs";
import { BULLET, alignRight, formatDuration, oneLine, slotHeight, statusTone } from "./rows.mjs";

// The fleet's workflow overview (docs/pi-design.md rule 6): a run's progress,
// its agents by phase and the pick the fleet then peeks. A rule 11 view at the
// peek's fixed half-height slot. It holds the group past its end(), so a
// finished run's children stay pickable until Esc.

export class WorkflowView extends Dialog {
  // `describe(runId)` is the fleet's live facts for a run (its tokens so far).
  constructor(tui, theme, keybindings, done, { group, signal, selected, describe = () => undefined, tickMs = 1_000 }) {
    super(tui, theme, keybindings, done, signal);
    this.group = group;
    this.describe = describe;
    this.cursor = Math.max(0, this.order().indexOf(selected));
    this.offset = 0;
    if (this.finished) return;
    this.off = group.onChange(() => this.refresh());
    // The elapsed times move between status changes.
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
  headerText(width, now) {
    const { title, records, startedAt, endedAt } = this.group;
    const right = this.theme.fg("dim", "esc back");
    const name = `${this.theme.fg("dim", "workflow")}${title ? `  ${this.theme.fg("accent", oneLine(title))}` : ""}`;
    const muted = text => this.theme.fg("muted", text);
    const left = progressLine(name, records, [formatDuration((endedAt ?? now) - startedAt)], this.theme, width - 2 - visibleWidth(right) - 2, muted);
    return alignRight(left, right, width - 2);
  }
  // Flush right: the status word unless completed or running, the elapsed
  // (live while running) and the tokens (live from the fleet while running).
  agentMeta(record, now) {
    const { status } = record;
    const running = status === "running";
    const elapsed = running ? (typeof record.startedAt === "number" ? now - record.startedAt : undefined) : record.durationMs;
    const live = running ? this.describe(record.runId)?.tokens : record.tokens;
    const tokens = formatTokens(live?.total ?? live);
    return [
      status !== "completed" && !running && this.theme.fg(statusTone(status), status),
      typeof elapsed === "number" && this.theme.fg("muted", formatDuration(elapsed)),
      tokens && this.theme.fg("muted", `${tokens} tokens`),
    ].filter(Boolean).join(this.theme.fg("muted", " · "));
  }
  render(width) {
    const windowHeight = slotHeight(this.tui.terminal?.rows ?? 24) - 4;
    const body = [];
    let at = 0;
    let selectedLine = 0;
    const now = Date.now();
    for (const [phase, records] of this.sections()) {
      const indent = phase === undefined ? "" : "  ";
      if (phase !== undefined) {
        const done = records.filter(record => record.status === "completed").length;
        body.push(`  ${this.theme.bold(phase)}${this.theme.fg("muted", ` · ${done}/${records.length}`)}`);
      }
      for (const record of records) {
        const focused = at++ === this.cursor;
        if (focused) selectedLine = body.length;
        // Running stays plain (rule 2); the label gives way to the meta.
        const bullet = record.status === "running" ? BULLET : this.theme.fg(statusTone(record.status), BULLET);
        const left = `${this.gutter(focused)}${indent}${bullet} ${this.label(`${record.agent} › ${oneLine(record.task)}`, { focused })}`;
        const meta = this.agentMeta(record, now);
        body.push(meta ? alignRight(left, meta, width) : left);
      }
    }
    if (!body.length) body.push(`  ${this.theme.fg("dim", "no agents launched yet")}`);
    this.offset = Math.min(Math.max(this.offset, selectedLine - windowHeight + 1), selectedLine);
    const window = body.slice(this.offset, this.offset + windowHeight);
    while (window.length < windowHeight) window.push("");
    return this.frame([`  ${this.headerText(width, now)}`, "", ...window], width);
  }
}

// Resolves to the picked record, or undefined on Esc or abort.
export function openWorkflowView(ctx, opts) {
  return ctx.ui.custom((tui, theme, keybindings, done) => new WorkflowView(tui, theme, keybindings, done, opts));
}
