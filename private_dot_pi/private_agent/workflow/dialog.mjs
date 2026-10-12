import { CURSOR_MARKER, Editor, Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { CURSOR, frameRule } from "./rows.mjs";

export const editorTheme = theme => ({
  borderColor: text => theme.fg("borderMuted", text),
  selectList: {
    selectedPrefix: text => theme.fg("accent", text), selectedText: text => theme.fg("accent", text),
    description: text => theme.fg("muted", text), scrollInfo: text => theme.fg("dim", text), noMatch: text => theme.fg("warning", text),
  },
});

// The view holding the composer slot (the fleet peek, /plan show). pi's
// non-overlay ctx.ui.custom clears the slot under whatever is there, orphaning
// it, and reports only the outermost prompt span, so anything taking the slot
// closes the view first. `mount(signal)` runs at once and is aborted by the
// next view or closeView; a mount may still be preparing (an import, an RPC)
// and must then mount nothing.
let view;
export function openView(mount) {
  closeView();
  const controller = new AbortController();
  const open = { controller, mounted: undefined };
  view = open;
  open.mounted = (async () => mount(controller.signal))().finally(() => { if (view === open) view = undefined; });
  return open.mounted;
}
// Aborting finishes the view synchronously, freeing the slot; the returned
// mount settles once pi's prompt span has closed too. A mount error is the
// view's own to report. A second caller arriving before then waits on the same
// close, or its dialog would open inside the closing span.
let closing;
export function closeView() {
  const open = view;
  view = undefined;
  if (open) {
    open.controller.abort();
    const settled = open.mounted.catch(() => {}).finally(() => { if (closing === settled) closing = undefined; });
    closing = settled;
  }
  return closing;
}
// A view can open while an earlier one is still closing; the slot is free only once none remains.
export async function freeSlot() { while (view || closing) await closeView(); }

// pi wraps every ctx.ui.custom in one `custom` prompt span, a peek or a plan
// view as much as a question; a custom dialog is a view unless it mounts here.
let waits = 0;
export async function openWait(ctx, factory) {
  // Mounts synchronously when no view holds the slot.
  if (view || closing) await freeSlot();
  waits++;
  try { return await ctx.ui.custom(factory); } finally { waits--; }
}
// Whether a ui_prompt_start is something the user must answer. pi's end event
// carries the outermost prompt's kind, so consumers pair it with their own flag.
export const blocksUser = event => event?.kind !== "custom" || waits > 0;

// Rule 11: every dialog is one frame, one cursor, one accent. This is that rule in code.
export class Dialog {
  constructor(tui, theme, keybindings, done, signal, cancelValue) {
    Object.assign(this, { tui, theme, keybindings, done, signal });
    this.editor = new Editor(tui, editorTheme(theme));
    this.finished = false;
    this._focused = true;
    this.onAbort = () => this.finish(cancelValue);
    if (signal?.aborted) this.onAbort();
    else signal?.addEventListener("abort", this.onAbort, { once: true });
  }
  get focused() { return this._focused; }
  set focused(value) { this._focused = value; this.editor.focused = value && this.editingNow(); }
  finish(value) {
    if (this.finished) return;
    this.finished = true;
    this.dispose();
    this.done(value);
  }
  refresh() {
    this.editor.focused = this.focused && this.editingNow();
    this.tui.requestRender();
  }
  invalidate() { this.editor.invalidate(); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.signal?.removeEventListener("abort", this.onAbort);
  }
  keys(data) {
    const matches = action => this.keybindings.matches(data, action);
    return {
      up: matches("tui.select.up") || matchesKey(data, Key.up),
      down: matches("tui.select.down") || matchesKey(data, Key.down),
      left: matchesKey(data, Key.left),
      right: matchesKey(data, Key.right),
      enter: matches("tui.select.confirm") || matches("tui.input.submit") || matchesKey(data, Key.enter),
      newline: matches("tui.input.newLine"),
      tab: matches("tui.input.tab") || matchesKey(data, Key.tab),
      cancel: matches("tui.select.cancel") || matchesKey(data, Key.escape),
      space: matchesKey(data, Key.space),
      pageUp: matchesKey(data, Key.pageUp),
      pageDown: matchesKey(data, Key.pageDown),
    };
  }
  frame(lines, width) {
    const rule = frameRule(this.theme, width);
    return [rule, ...lines.map(line => truncateToWidth(line, width, "")), rule];
  }
  gutter(focused = false) { return focused ? `${this.theme.fg("accent", CURSOR)} ` : "  "; }
  // Named `line`, not `row`: both dialogs already use `row` for the selected option index.
  line(text, width, focused = false) {
    const lines = wrapTextWithAnsi(text, Math.max(1, width - 2));
    return lines.map((line, index) => `${index === 0 ? this.gutter(focused) : "  "}${line}`);
  }
  label(text, { focused = false, chosen = false } = {}) {
    if (focused && chosen) return this.theme.bold(this.theme.fg("accent", text));
    if (focused) return this.theme.fg("accent", text);
    if (chosen) return this.theme.bold(text);
    return text;
  }
  field({ width, active, text, placeholder }) {
    if (!text && placeholder) return [this.theme.fg("dim", active ? `${CURSOR_MARKER}\x1b[7m${placeholder[0]}\x1b[27m${placeholder.slice(1)}` : placeholder)];
    // Keep native wrapping and navigation geometry; omit only its two borders.
    if (active) return this.editor.render(Math.max(1, width)).slice(1, -1);
    // The editor wraps one short of its width to keep a cursor cell; match it so losing focus does not reflow the draft.
    return wrapTextWithAnsi(text, Math.max(1, width - 1));
  }
  hang(prefix, lines) {
    const indent = " ".repeat(visibleWidth(prefix));
    return [`${prefix}${lines[0] ?? ""}`, ...lines.slice(1).map(line => `${indent}${line}`)];
  }
}
