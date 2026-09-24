import * as sdk from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { PROMPT, TURN_GLYPH, shadedBlock } from "./rows.mjs";

const INSTALLED = Symbol.for("pi-workflow:pending-input");

const fit = (line, width) => truncateToWidth(line, width, "", true);

// The host owns both queues, including messages waiting for compaction. Only
// replace its pending-area presentation; every host update reads its queues anew.
export function installPendingInput(theme, InteractiveMode = sdk.InteractiveMode) {
  const prototype = InteractiveMode.prototype;
  const installed = prototype.updatePendingMessagesDisplay[INSTALLED];
  if (installed) { installed.theme = theme; return; }
  const state = { theme };
  const display = function () {
    this.pendingMessagesContainer.clear();
    const { steering, followUp } = this.getAllQueuedMessages();
    if (!steering.length && !followUp.length) return;
    const messages = [...steering.map(text => [text, "Steering · next response"]), ...followUp.map(text => [text, "Follow-up · after current task"])];
    this.pendingMessagesContainer.addChild({ render(width) {
      const theme = state.theme();
      const lines = [];
      for (const [text, label] of messages) {
        lines.push(truncateToWidth(theme.fg("dim", `${TURN_GLYPH} ${label}`), width));
        const wrapped = text.split("\n").flatMap(line => wrapTextWithAnsi(line, Math.max(1, width - 2)));
        lines.push(...shadedBlock(theme, wrapped.map(line => theme.fg("userMessageText", line)), width, { prompt: PROMPT, fit }));
      }
      const hint = theme.fg("dim", `  ↳ ${this.keyHint} to edit all queued messages`);
      lines.push(truncateToWidth(hint, width));
      return lines;
    }, keyHint: this.getAppKeyDisplay("app.message.dequeue"), invalidate() {} });
    this.ui.requestRender();
  };
  display[INSTALLED] = state;
  prototype.updatePendingMessagesDisplay = display;
}
