import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { Dialog } from "./dialog.mjs";
import { formatTokens, modelLabel } from "./fleet.mjs";
import { PROMPT, formatDuration, oneLine, pad, shade } from "./rows.mjs";
import { EARLIER_NOTE, createReplay, renderRows, replayEvents, trimRows } from "./replay.mjs";

// The fleet's Enter peek (docs/pi-design.md rule 6, 2026-09-22): a rule-11
// dialog over a background child's own events.jsonl, replayed live through
// replay.mjs's row grammar, with a rule-5 composer that steers the child.

const CAP = 256 * 1024;
const MAX_ROWS = 400;
const HINT = "enter steer · /stop · ctrl+o output · esc close";

export class PeekDialog extends Dialog {
  constructor(tui, theme, keybindings, done, { id, asyncDir, describe, events, rpcCall, timeoutMs = 2_000, steerTimeoutMs = 5_000, tickMs = 1_000, signal }) {
    super(tui, theme, keybindings, done, signal, undefined);
    Object.assign(this, { id, describe, events, rpcCall, timeoutMs, steerTimeoutMs });
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
    this.frozenElapsed = null;
    this.ready = this.readChunk().then(() => {
      // Esc or a session change can dispose the dialog before the first read
      // lands; a timer started here would poll a closed peek.
      if (this.disposed) return;
      this.info = this.describe();
      this.lastShape = this.shapeKey();
      this.timer = setInterval(() => void this.tick(), tickMs);
      this.timer.unref?.();
      this.tui.requestRender();
    });
  }

  editingNow() { return this.mode !== "confirm"; }

  dispose() {
    clearInterval(this.timer);
    this.timer = undefined;
    super.dispose();
  }

  // Reads only the bytes appended since the last call; a shrink (the file was
  // replaced) rebuilds the whole tail, and the very first call caps the read
  // at CAP bytes, dropping the leading partial line it produces. Reads are
  // serialised: a tick that lands while one is in flight would otherwise read
  // the same appended bytes again and replay them twice.
  readChunk() {
    return this.reading ??= this.readOnce().finally(() => { this.reading = undefined; });
  }

  // The run directory can vanish between the stat and the open (retention
  // cleanup); any failure ends this read and the next tick retries.
  async readOnce() {
    try {
      const { size } = await stat(this.filePath);
      if (size === this.offset) return;
      if (size < this.offset) {
        this.replay = createReplay();
        this.decoder = undefined;
        this.offset = 0;
      }
      const capped = this.offset === 0 && size > CAP;
      const start = capped ? size - CAP : this.offset;
      const length = size - start;
      if (length > 0) {
        const handle = await open(this.filePath, "r");
        try {
          const buffer = Buffer.alloc(length);
          await handle.read(buffer, 0, length, start);
          // A read boundary can split a multi-byte character; the decoder carries
          // the remainder the way replayEvents carries a partial line.
          this.decoder ??= new StringDecoder("utf8");
          let text = this.decoder.write(buffer);
          if (capped) {
            const nl = text.indexOf("\n");
            text = nl === -1 ? "" : text.slice(nl + 1);
            this.replay.rows.unshift({ kind: "note", text: EARLIER_NOTE });
          }
          trimRows(replayEvents(this.replay, text), MAX_ROWS);
        } finally {
          await handle.close();
        }
      }
      this.offset = size;
    } catch {
      return;
    }
  }

  async tick() {
    await this.readChunk();
    this.info = this.describe();
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

  shapeKey() {
    const rows = this.replay.rows;
    const last = rows.at(-1);
    const pending = rows.reduce((n, row) => n + (row.pending ? 1 : 0), 0);
    return `${rows.length}|${pending}|${last?.kind}|${last?.text}|${this.headerText()}`;
  }

  headerText() {
    const info = this.info ?? {};
    const head = info.task ? `${info.agent ?? ""} › ${oneLine(info.task)}` : (info.agent ?? "");
    const parts = [];
    const model = modelLabel(info.model, info.effort);
    if (model) parts.push(model);
    const tokens = formatTokens(info.tokens?.total ?? info.tokens);
    if (tokens) parts.push(`${tokens} tokens`);
    if (info.startedAt != null) {
      if (info.terminal) this.frozenElapsed ??= formatDuration(Date.now() - info.startedAt);
      parts.push(info.terminal ? this.frozenElapsed : formatDuration(Date.now() - info.startedAt));
    }
    if (info.terminal) { if (info.state) parts.push(info.state); }
    else if (info.currentTool) parts.push(info.currentTool.replace(/^workspace_/, ""));
    const rest = parts.join(" · ");
    return `${this.theme.fg("accent", head)}${rest ? this.theme.fg("muted", ` · ${rest}`) : ""}`;
  }

  composerLines(width) {
    const active = this.focused && this.editingNow();
    const lines = this.field({ width: Math.max(1, width - 2), active, text: this.editor.getText() });
    return lines.map((line, i) => shade(this.theme, pad(`${i === 0 ? `${PROMPT} ` : "  "}${line}`, width)));
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
      if (this.busy) return;
      const draft = this.editor.getText().trim();
      if (!draft) { this.flash = "Type a message to steer"; this.refresh(); return; }
      if (draft === "/stop") { this.mode = "confirm"; this.flash = ""; this.refresh(); return; }
      this.pending = this.sendSteer(draft);
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

  render(width) {
    const usable = Math.max(1, width);
    const rows = this.tui.terminal?.rows ?? 24;
    const windowHeight = Math.max(3, Math.floor(rows * 0.8) - 7);
    const bodyLines = this.replay.rows.length
      ? renderRows(this.replay.rows, usable, this.theme, { expanded: this.expanded })
      : [this.theme.fg("dim", "no activity recorded yet")];
    const maxScroll = Math.max(0, bodyLines.length - windowHeight);
    this.maxScroll = maxScroll;
    this.windowHeight = windowHeight;
    if (this.follow) this.scroll = maxScroll;
    this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));
    const window = bodyLines.slice(this.scroll, this.scroll + windowHeight);
    const composer = this.mode === "confirm" ? [this.confirmLine()] : this.composerLines(usable);
    const hintText = this.flash || (this.mode === "confirm" ? "enter confirm · esc back" : HINT);
    const hint = `  ${this.theme.fg(this.flash ? this.flashTone : "dim", hintText)}`;
    const content = [`  ${this.headerText()}`, "", ...window, "", ...composer, hint];
    return this.frame(content, usable);
  }
}

export function openPeek(ctx, opts) {
  return ctx.ui.custom((tui, theme, keybindings, done) => new PeekDialog(tui, theme, keybindings, done, opts), {
    overlay: true,
    overlayOptions: () => ({ anchor: "center", width: "90%", maxHeight: "80%", margin: 1 }),
  });
}
