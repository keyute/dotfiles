import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { CURSOR_MARKER, Editor, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Dialog, editorTheme } from "./dialog.mjs";
import { formatTokens, modelLabel } from "./fleet.mjs";
import { WorkingRow } from "./footer.mjs";
import { PROMPT, oneLine, pad, shade, shadedBlock, slotHeight } from "./rows.mjs";
import { createReplay, renderRows, replayEvents, trimRows } from "./replay.mjs";

// The fleet's Enter peek (docs/pi-design.md rule 6, 2026-09-22): a rule-11
// dialog in the composer's slot over a background child's own events.jsonl,
// replayed live through replay.mjs's row grammar, with a rule-5 composer that
// steers the child.

const CHUNK = 1024 * 1024;
const MAX_ROWS = 1000;
const stopCompletion = {
  async getSuggestions(lines, line, col) {
    const prefix = lines[0]?.slice(0, col) ?? "";
    return line === 0 && /^\/[a-z]*$/.test(prefix) && "/stop".startsWith(prefix)
      ? { items: [{ value: "/stop", label: "/stop", description: "Stop this agent after confirmation" }], prefix }
      : null;
  },
  applyCompletion(lines, line, col) {
    return { lines: [lines[0].replace(/^\S*/, "/stop"), ...lines.slice(1)], cursorLine: line, cursorCol: 5 };
  },
  shouldTriggerFileCompletion: () => false,
};

class PeekEditor extends Editor {
  constructor(tui, theme) {
    super(tui, editorTheme(theme));
    this.palette = theme;
    this.setAutocompleteProvider(stopCompletion);
  }
  renderBottomBorder(width, hidden) {
    this.bottomRow = super.renderBottomBorder(width, hidden);
    return this.bottomRow;
  }
  render(width, height) {
    const lines = super.render(Math.max(1, width - 2));
    const end = lines.lastIndexOf(this.bottomRow);
    const menu = lines.slice(end + 1, end + 1 + Math.max(0, height - 3));
    const content = lines.slice(1, end);
    const count = Math.max(1, height - menu.length - 2);
    // Native scrolling budgets 30% of the terminal, not the space left in
    // this pane. Clip its visible block around the cursor, never by colour.
    const cursor = content.findIndex(line => line.includes(CURSOR_MARKER) || line.includes("\x1b[7m"));
    const start = Math.max(0, Math.min(cursor, content.length - count));
    return [...shadedBlock(this.palette, content.slice(start, start + count), width, { prompt: PROMPT }), ...menu.map(line => `  ${line}`)];
  }
}

export class PeekDialog extends Dialog {
  constructor(tui, theme, keybindings, done, { id, asyncDir, describe, events, rpcCall, timeoutMs = 2_000, steerTimeoutMs = 5_000, tickMs = 1_000, signal }) {
    super(tui, theme, keybindings, done, signal, undefined);
    Object.assign(this, { id, describe, events, rpcCall, timeoutMs, steerTimeoutMs });
    this.editor = new PeekEditor(tui, theme);
    this.editor.focused = true;
    // Native Enter accepts a slash item and submits in one action; restore
    // the cleared draft so the ordinary confirmation path sees it.
    this.editor.onSubmit = text => { this.editor.setText(text); this.submitDraft(); };
    this.filePath = join(asyncDir, "events.jsonl");
    this.offset = 0;
    this.replay = createReplay();
    this.info = describe();
    this.lastShape = "";
    this.scroll = 0;
    this.follow = true;
    this.expanded = false;
    this.mode = "compose";
    this.flash = "";
    this.busy = false;
    this.loaded = false;
    this.working = new WorkingRow(tui, theme);
    this.ready = this.readChunk().then(() => {
      // Esc or a session change can dispose the dialog before the first read
      // lands; a timer started here would poll a closed peek.
      if (this.disposed) return;
      this.loaded = true;
      this.info = this.describe();
      this.syncWorking();
      this.lastShape = this.shapeKey();
      this.timer = setInterval(() => void this.tick(), tickMs);
      this.timer.unref?.();
      this.tui.requestRender();
    });
  }

  editingNow() { return this.mode !== "confirm"; }

  invalidate() {
    super.invalidate();
    for (const row of this.replay.rows) {
      delete row._linesKey;
      delete row._lines;
    }
  }

  dispose() {
    clearInterval(this.timer);
    this.timer = undefined;
    this.working.dispose();
    super.dispose();
  }

  // Reads only the bytes appended since the last call; a shrink (the file was
  // replaced) rebuilds the whole file from its start instead. Reads are
  // serialised: a tick that lands while one is in flight would otherwise read
  // the same appended bytes again and replay them twice.
  readChunk() {
    return this.reading ??= this.readOnce().finally(() => { this.reading = undefined; });
  }

  // The run directory can vanish between the stat and the open (retention
  // cleanup); any failure ends this read and the next tick retries. No cap:
  // a late peek reads the whole journal at open, in bounded chunks so a huge
  // file never holds more than one chunk in memory at a time — `trimRows`
  // keeps the row list itself bounded as each chunk lands.
  async readOnce() {
    try {
      const { size } = await stat(this.filePath);
      if (size === this.offset) return;
      if (size < this.offset) {
        this.replay = createReplay();
        this.decoder = undefined;
        this.offset = 0;
      }
      if (size > this.offset) {
        const handle = await open(this.filePath, "r");
        try {
          this.decoder ??= new StringDecoder("utf8");
          while (this.offset < size) {
            const length = Math.min(CHUNK, size - this.offset);
            const buffer = Buffer.alloc(length);
            // A short read (the file shrank after the stat) must advance only
            // by what arrived; a zero read ends this pass and the next tick's
            // stat decides between a rebuild and more appends.
            const { bytesRead } = await handle.read(buffer, 0, length, this.offset);
            if (bytesRead === 0) break;
            // A read boundary can split a multi-byte character; the decoder
            // carries the remainder the way replayEvents carries a partial line.
            const text = this.decoder.write(buffer.subarray(0, bytesRead));
            trimRows(replayEvents(this.replay, text), MAX_ROWS);
            this.offset += bytesRead;
          }
        } finally {
          await handle.close();
        }
      }
    } catch {
      return;
    }
  }

  async tick() {
    await this.readChunk();
    // Esc during the read: syncWorking would otherwise start a spinner
    // interval nothing stops, dispose having already run.
    if (this.disposed) return;
    this.info = this.describe();
    this.syncWorking();
    const shape = this.shapeKey();
    if (shape !== this.lastShape) {
      this.lastShape = shape;
      this.tui.requestRender();
    }
    if (this.info.terminal && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  // `state.version` bumps on every settle even when no row is added (a tool
  // whose fold membership just changed), so a sentence's count catches up
  // without the length/last-row fields noticing anything happened.
  shapeKey() {
    const rows = this.replay.rows;
    const last = rows.at(-1);
    const pending = rows.reduce((n, row) => n + (row.pending ? 1 : 0), 0);
    return `${this.replay.version}|${rows.length}|${pending}|${last?.kind}|${last?.text}|${this.headerText()}`;
  }

  // Reserve the metadata and back cue before spending columns on the task.
  headerText(width = 80) {
    const info = this.info ?? {};
    const model = modelLabel(info.model, info.effort);
    const tokens = formatTokens(info.tokens?.total ?? info.tokens);
    const state = info.terminal && info.state ? info.state : "";
    const tone = state === "completed" ? "success" : ["failed", "stopped"].includes(state) ? "error" : "warning";
    const parts = [model, tokens && `${tokens} tokens`].filter(Boolean);
    const cue = "esc back";
    const agent = info.agent ?? "";
    const stateText = state ? ` · ${state}` : "";
    const suffix = () => `${parts.length ? ` · ${parts.join(" · ")}` : ""}${stateText}`;
    const free = width - 2 - visibleWidth(`peek  ${agent}  ${cue}`);
    // Once even identity plus metadata cannot fit, cost then model yield;
    // terminal state and the way back remain visible.
    while (parts.length && visibleWidth(suffix()) > free) parts.pop();
    const budget = Math.max(0, free - visibleWidth(suffix()) - 3);
    const task = budget > 0 ? truncateToWidth(oneLine(info.task), budget, "…") : "";
    const nameWidth = Math.max(1, width - 2 - visibleWidth(`peek    ${cue}${suffix()}`));
    return `${this.theme.fg("dim", "peek")}  ${this.theme.fg("accent", truncateToWidth(agent, nameWidth, "…"))}${task ? ` › ${task}` : ""}${parts.length ? this.theme.fg("muted", ` · ${parts.join(" · ")}`) : ""}${state ? this.theme.fg(tone, stateText) : ""}  ${this.theme.fg("dim", cue)}`;
  }

  confirmLine() {
    const agent = this.info?.agent ?? "";
    return `${this.gutter(true)}${this.theme.fg("warning", `Stop ${agent}?`)}`;
  }

  async sendSteer(message) {
    this.busy = true;
    const reply = await this.rpcCall(this.events, "steer", { id: this.id, message, mode: "steer" }, this.steerTimeoutMs);
    this.busy = false;
    // The reply is the tool result (`text`, `details`, `isError`); the receipt
    // with its request id and delivery status sits in details.steering.
    const receipt = reply && !reply.isError ? reply.details?.steering : undefined;
    if (!receipt) {
      this.say("steer failed", "warning");
      return;
    }
    // The journal carries the sent message and its receipt in its own order;
    // the reply only says what the receipt said, in the hint slot.
    this.editor.setText("");
    this.say(receipt.deliveryStatus === "queued" ? "steer queued" : "steer delivered", "success");
  }

  // Stop's data is the acknowledgement itself (`{ runId, state: "stopping" }`,
  // as the fleet's own cleanup reads it); anything else leaves the child
  // running, so the peek stays open and says so.
  async confirmStop() {
    const reply = await this.rpcCall(this.events, "stop", { id: this.id }, this.timeoutMs);
    if (reply?.runId === this.id && reply.state === "stopping") return this.finish(undefined);
    this.mode = "compose";
    this.say("stop failed", "warning");
  }

  say(text, tone) {
    this.flash = text;
    this.flashTone = tone;
    this.refresh();
  }

  handleInput(data) {
    if (this.finished) return;
    const keys = this.keys(data);
    const confirm = this.mode === "confirm";
    if (!confirm && this.editor.isShowingAutocomplete() && (keys.up || keys.down || keys.cancel || keys.tab || keys.enter)) {
      this.editor.handleInput(data);
      this.refresh();
      return;
    }
    if (keys.up || keys.down) {
      const draftEmpty = !this.editor.getText().trim();
      const cursor = this.editor.getCursor();
      const atEdge = confirm || draftEmpty || (keys.up ? cursor.line === 0 : cursor.line === this.editor.getLines().length - 1);
      if (atEdge) {
        const max = this.maxScroll ?? 0;
        this.scroll = keys.up ? Math.max(0, this.scroll - 1) : Math.min(max, this.scroll + 1);
        this.follow = this.scroll >= max;
        this.flash = "";
        this.refresh();
        return;
      }
      this.editor.handleInput(data);
      this.refresh();
      return;
    }
    if (keys.pageUp || keys.pageDown) {
      const max = this.maxScroll ?? 0;
      const h = this.windowHeight ?? 1;
      this.scroll = keys.pageUp ? Math.max(0, this.scroll - h) : Math.min(max, this.scroll + h);
      this.follow = this.scroll >= max;
      this.flash = "";
      this.refresh();
      return;
    }
    if (this.keybindings.matches(data, "app.tools.expand")) {
      this.expanded = !this.expanded;
      this.refresh();
      return;
    }
    if (keys.enter) {
      if (confirm) { this.pending = this.confirmStop(); return; }
      this.submitDraft();
      return;
    }
    if (keys.cancel) {
      if (confirm) { this.mode = "compose"; this.flash = ""; this.refresh(); return; }
      this.finish(undefined);
      return;
    }
    if (!confirm) {
      this.editor.handleInput(data);
      this.flash = "";
      this.refresh();
    }
  }

  submitDraft() {
    if (this.busy) return;
    const draft = this.editor.getText().trim();
    if (!draft) { this.flash = "Type a message to steer"; this.refresh(); return; }
    if (draft === "/stop") { this.mode = "confirm"; this.flash = ""; this.refresh(); return; }
    this.pending = this.sendSteer(draft);
  }

  // The working row (rule 3): the same row footer.mjs docks above pi's own
  // composer, owned here since the peek is its own dialog. Driven from the
  // tick, never from render: Loader's start() and setMessage() each request a
  // render, so syncing inside render would re-render the peek every frame and
  // restart the spinner's interval before it could ever advance. start/stop
  // fire on the transition only. A run that ends without a settle record
  // (pi-subagents' forced finish) still stands the row down via `terminal`.
  syncWorking() {
    const running = this.replay.clock.running() && !this.info?.terminal;
    if (running) {
      if (!this.spinning) { this.working.start(); this.spinning = true; }
      this.working.setMessage(this.replay.clock.label(Date.now()));
    } else if (this.spinning) {
      this.working.setMessage("");
      this.working.stop();
      this.spinning = false;
    }
  }

  render(width) {
    const usable = Math.max(1, width);
    const feedback = this.flash ? this.theme.fg(this.flashTone ?? "dim", this.flash) : "";
    const working = this.working.render(Math.max(1, usable - (feedback ? visibleWidth(feedback) + 3 : 0)));
    const workingLine = `${working[0] ?? ""}${feedback ? `${working.length ? " · " : "  "}${feedback}` : ""}`;
    // Both gaps are explicit: one before the progress row, one before the
    // shaded composer. Reserve one transcript line even with a long draft.
    const height = slotHeight(this.tui.terminal?.rows ?? 24);
    const chrome = 7;
    const available = height - chrome - 1;
    const composer = this.mode === "confirm"
      ? [shade(this.theme, pad("", usable)), `${this.confirmLine()} ${this.theme.fg("dim", "enter confirm · esc back")}`, shade(this.theme, pad("", usable))]
      : this.editor.render(usable, available);
    const windowHeight = height - chrome - composer.length;
    const bodyLines = !this.loaded
      ? [this.theme.fg("dim", "loading history…")]
      : this.replay.rows.length
        ? renderRows(this.replay, usable, this.theme, { expanded: this.expanded })
        : [this.theme.fg("dim", "no activity recorded yet")];
    const maxScroll = Math.max(0, bodyLines.length - windowHeight);
    this.maxScroll = maxScroll;
    this.windowHeight = windowHeight;
    if (this.follow) this.scroll = maxScroll;
    this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));
    const window = bodyLines.slice(this.scroll, this.scroll + windowHeight);
    while (window.length < windowHeight) window.push("");
    const content = [`  ${this.headerText(usable)}`, "", ...window, "", workingLine, "", ...composer];
    return this.frame(content, usable);
  }
}

export function openPeek(ctx, opts) {
  return ctx.ui.custom((tui, theme, keybindings, done) => new PeekDialog(tui, theme, keybindings, done, opts));
}
