import * as sdk from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { PAD, PROMPT, TURN_GLYPH, padRow, shadedBlock } from "./rows.mjs";
import { skillCommand } from "./skill-display.mjs";

const INSTALLED = Symbol.for("pi-workflow:pending-input");

// The host owns both queues, including messages waiting for compaction.
export function installPendingInput(theme, InteractiveMode = sdk.InteractiveMode) {
  const prototype = InteractiveMode.prototype;
  const installed = prototype.updatePendingMessagesDisplay[INSTALLED];
  if (installed) { installed.theme = theme; installed.reset(); return installed; }
  const state = {
    theme, host: null, sending: null, epoch: 0,
    reset() { this.epoch++; this.host = null; this.sending = null; },
    async sendNow(editor) {
      const host = this.host;
      if (!host) { editor.submitValue(); return; }
      if (host.editor !== editor || this.sending) return;
      const session = host.session;
      const draft = (editor.getExpandedText?.() ?? editor.getText()).trim();
      const queued = host.getAllQueuedMessages().steering.length;
      if (!queued && !draft) return;
      // Native submission owns slash commands and idle input (including paste
      // expansion, history and attachments); send-now changes only live messages.
      if (draft.startsWith("/") || (session.isIdle && !queued)) {
        editor.submitValue();
        return;
      }
      const action = { host, session, epoch: this.epoch };
      this.sending = action;
      const current = () => this.epoch === action.epoch && host.session === session && host.editor === editor;
      try {
        if (draft) {
          // Claim input synchronously in Pi's existing raw pending queue. Enter,
          // follow-up and dequeue must not submit a second copy during abort.
          host.compactionQueuedMessages.push({ text: draft, mode: "steer" });
          editor.addToHistory?.(draft);
          editor.setText("");
          host.updatePendingMessagesDisplay();
        }
        await session.abort();
        if (!current()) return;
        // These entries have not passed input handlers/expansion yet. Existing
        // native queues have, so leave them untouched (attachments included).
        while (host.compactionQueuedMessages.length) {
          const message = host.compactionQueuedMessages.shift();
          try {
            if (host.isExtensionCommand(message.text)) await session.prompt(message.text);
            else if (message.mode === "followUp") await session.followUp(message.text);
            else await session.steer(message.text);
          } catch (error) {
            if (current()) host.compactionQueuedMessages.unshift(message);
            throw error;
          }
          if (!current()) return;
        }
        host.updatePendingMessagesDisplay();
        if (!session.getSteeringMessages().length) return;
        // A notification may already have started a response during abort cleanup.
        // Its native initial steering poll owns delivery; never start a second run.
        if (session.isStreaming) return;
        // Reuse the managed run entry rather than prompt(""): its initial poll
        // drains steering before the first request, without a fake user message,
        // re-expanding queued text, or promoting follow-ups into steering.
        action.starting = true;
        void session._runAgentPrompt([]).catch(error => {
          if (current()) host.showError(`Send now failed: ${error instanceof Error ? error.message : error}`);
        }).finally(() => {
          if (this.sending === action) this.sending = null;
        });
      } catch (error) {
        if (current()) {
          host.updatePendingMessagesDisplay();
          host.showError(`Send now failed: ${error instanceof Error ? error.message : error}`);
        }
      } finally {
        if (this.sending === action && !action.starting) this.sending = null;
      }
    },
  };
  const flush = prototype.flushCompactionQueue;
  prototype.flushCompactionQueue = function (...args) {
    // compaction_end would otherwise start a response while abort is settling.
    if (state.sending?.host === this && state.sending.session === this.session) return Promise.resolve();
    return flush.apply(this, args);
  };
  const display = function () {
    state.host = this;
    this.pendingMessagesContainer.clear();
    const { steering, followUp } = this.getAllQueuedMessages();
    if (state.sending?.host === this && state.sending.starting && !steering.length) state.sending = null;
    if (!steering.length && !followUp.length) return;
    const groups = [[steering, "Steering · next response", "ctrl+enter send now"], [followUp, "Follow-up · after current task", ""]].filter(([messages]) => messages.length);
    this.pendingMessagesContainer.addChild({ render(width) {
      if (width <= 0) return [];
      const theme = state.theme();
      const lines = [];
      for (const [index, [messages, label, sendHint]] of groups.entries()) {
        lines.push("");
        const count = messages.length > 1 ? ` · ${messages.length} messages` : "";
        const editHint = index === 0 ? `${this.keyHint} edit all queued` : "";
        const header = [`${TURN_GLYPH} ${label}${count}`, sendHint, editHint].filter(Boolean).join(" · ");
        const indent = width > PAD.length ? PAD : "";
        lines.push(...wrapTextWithAnsi(theme.fg("dim", header), width - indent.length).map((line, i) => i ? `${indent}${line}` : line));
        for (const [messageIndex, text] of messages.entries()) {
          if (messageIndex) lines.push("");
          const wrapped = skillCommand(text).split("\n").flatMap(line => wrapTextWithAnsi(line, Math.max(1, width - 2)));
          lines.push(...shadedBlock(theme, wrapped.map(line => theme.fg("userMessageText", line)), width, { prompt: PROMPT, fit: padRow }));
        }
      }
      // Pi's above-editor container supplies the single gap below this section.
      return lines;
    }, keyHint: this.getAppKeyDisplay("app.message.dequeue"), invalidate() {} });
    this.ui.requestRender();
  };
  display[INSTALLED] = state;
  prototype.updatePendingMessagesDisplay = display;
  return state;
}
