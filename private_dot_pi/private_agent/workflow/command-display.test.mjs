import test from "node:test";
import assert from "node:assert/strict";
import { Markdown } from "@earendil-works/pi-tui";
import { AssistantMessageComponent, getMarkdownTheme, initTheme, Theme } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { bulletMarkdown, installReasoningHide } from "./rows.mjs";
import { commandMarkdownTheme } from "./command-display.mjs";
import { createReplay, replayEvents, renderRows } from "./replay.mjs";

initTheme();
const strip = text => text.replace(/\x1b\][^\x07]*\x07|\x1b\[[0-9;]*m/g, "").trimEnd();

test("assistant shell markers share semantic error styling in native main and peek, leaving source and syntax intact", () => {
  for (const variant of ["mocha", "latte"]) {
    const { colors } = JSON.parse(readFileSync(new URL(`../../../node_modules/catppuccin-pi-theme/themes/catppuccin-${variant}.json`, import.meta.url)));
    const palette = new Theme(colors, colors, "truecolor");
    installReasoningHide(AssistantMessageComponent, palette);
    for (const text of ["!npm test", "! npm test", "Try `!npm test` now.", "Try `! npm test` now.", "```sh\n! npm test\n```", "```bash\n!npm test\n```", "```\n! npm test\n```", "~~~zsh\n!npm test\n~~~"]) {
      const message = Object.freeze({ role: "assistant", content: Object.freeze([{ type: "text", text }]) });
      const main = new AssistantMessageComponent(message, false, getMarkdownTheme(), "Thinking...", 0, [(md, ctx) => bulletMarkdown(md, ctx, palette)]);
      const state = createReplay();
      replayEvents(state, JSON.stringify({ type: "message_end", message }) + "\n");
      const a = main.render(80), b = renderRows(state, 80, palette);
      assert.deepEqual(a.slice(1).map(strip), b.map(strip), text);
      for (const lines of [a, b]) assert.ok(lines.join("\n").includes(palette.fg("error", "!")), `${variant}: ${text}`);
      assert.equal(message.content[0].text, text);
      main.invalidate();
      assert.deepEqual(main.render(80).map(strip), a.map(strip));
    }
    for (const text of ["This ! command is prose.", "```js\n!value\n```", "```python\n!value\n```", "`value != other`", "!", "!! npm test"]) {
      const markdown = new Markdown(bulletMarkdown(text, { messageType: "assistant" }, palette), 0, 0, commandMarkdownTheme(getMarkdownTheme(), palette));
      assert.ok(!markdown.render(80).join("\n").includes(palette.fg("error", "!")), text);
    }
  }
});
