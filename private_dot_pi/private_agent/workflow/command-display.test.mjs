import test from "node:test";
import assert from "node:assert/strict";
import { Markdown } from "@earendil-works/pi-tui";
import { AssistantMessageComponent, getMarkdownTheme, initTheme, Theme } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { bulletMarkdown, installReasoningHide } from "./rows.mjs";
import { commandMarkdown, commandMarkdownTheme } from "./command-display.mjs";
import { createReplay, replayEvents, renderRows } from "./replay.mjs";

initTheme();
const strip = text => text.replace(/\x1b\][^\x07]*\x07|\x1b\[[0-9;]*m/g, "").trimEnd();

test("retained and new assistant Markdown slots follow palette reinstall and theme invalidation", () => {
  const palettes = ["mocha", "latte"].map(variant => {
    const { colors } = JSON.parse(readFileSync(new URL(`../../../node_modules/catppuccin-pi-theme/themes/catppuccin-${variant}.json`, import.meta.url)));
    return new Theme(colors, colors, "truecolor");
  });
  let palette = palettes[0];
  installReasoningHide(AssistantMessageComponent, palette);
  const nativeTheme = getMarkdownTheme();
  const main = new AssistantMessageComponent(undefined, false, nativeTheme, "Thinking...", 0, [(md, ctx) => bulletMarkdown(md, ctx, palette)]);
  const thinking = Object.freeze({ type: "thinking", thinking: "private reasoning", thinkingSignature: "sig" });
  const first = Object.freeze({ type: "text", text: "Try `!npm test` now." });
  const second = Object.freeze({ type: "text", text: "```sh\n! npm run build\n```" });
  const message = content => Object.freeze({ role: "assistant", content: Object.freeze(content) });
  const initial = message([thinking, first]);
  const settled = message([thinking, first, second]);
  const check = count => {
    const lines = main.render(80);
    assert.equal(lines.filter(line => line.includes(palette.fg("error", "!"))).length, count);
    assert.ok(!lines.map(strip).join("\n").includes(thinking.thinking));
    assert.equal(main.markdownTheme, nativeTheme, "temporary decoration is restored");
    return lines.map(strip);
  };
  main.updateContent(initial, true);
  check(1);
  const retained = main.contentContainer.children.find(child => child.constructor.name === "Markdown");
  palette = palettes[1];
  installReasoningHide(AssistantMessageComponent, palette);
  main.updateContent(settled, true);
  main.invalidate();
  assert.equal(main.contentContainer.children.find(child => child.constructor.name === "Markdown"), retained);
  const expected = check(2);
  for (const streaming of [true, true, false]) {
    main.updateContent(settled, streaming);
    assert.deepEqual(check(2), expected);
  }
  installReasoningHide(AssistantMessageComponent, () => palette);
  palette = palettes[0];
  main.invalidate();
  assert.deepEqual(check(2), expected);
  assert.equal(main.contentContainer.children.find(child => child.constructor.name === "Markdown"), retained);
  assert.deepEqual(settled.content, [thinking, first, second]);
  assert.equal(thinking.thinking, "private reasoning");
});

test("multiline inline code retains native rendering in main and peek", () => {
  const { colors } = JSON.parse(readFileSync(new URL("../../../node_modules/catppuccin-pi-theme/themes/catppuccin-mocha.json", import.meta.url)));
  const palette = new Theme(colors, colors, "truecolor");
  installReasoningHide(AssistantMessageComponent, palette);
  for (const text of ["Try `first\n! echo *glob*\nlast` now.", "Try ``first `literal`\n! echo _glob_\nlast`` now.", "Try `first\n! echo *glob*\nlast` and `next\n! echo **literal**\nend`."]) {
    const message = Object.freeze({ role: "assistant", content: Object.freeze([Object.freeze({ type: "text", text })]) });
    const expected = new Markdown(`• ${text}`, 0, 0, commandMarkdownTheme(getMarkdownTheme(), palette)).render(120).map(strip);
    const main = new AssistantMessageComponent(message, false, getMarkdownTheme(), "Thinking...", 0, [(md, ctx) => bulletMarkdown(md, ctx, palette)]);
    const state = createReplay();
    replayEvents(state, JSON.stringify({ type: "message_end", message }) + "\n");
    assert.deepEqual(main.render(120).slice(1).map(strip), expected, text);
    assert.deepEqual(renderRows(state, 120, palette).map(strip), expected, text);
    assert.equal(message.content[0].text, text);
  }
});

test("native HTML blocks retain literal commands in main and peek without changing stored text", () => {
  const { colors } = JSON.parse(readFileSync(new URL("../../../node_modules/catppuccin-pi-theme/themes/catppuccin-mocha.json", import.meta.url)));
  const palette = new Theme(colors, colors, "truecolor");
  installReasoningHide(AssistantMessageComponent, palette);
  for (const html of ["<pre>\n! echo *glob*\n</pre>", "<!--\n```\n! echo *glob*\n-->", "<div>\n`literal\n! echo *glob*\n</div>"]) {
    for (const suffix of ["", "\n\n! echo _outside_"]) {
      const text = `Example:\n\n${html}${suffix}`;
      const expectedText = text.replace("! echo _outside_", "` ! echo _outside_ `");
      const message = Object.freeze({ role: "assistant", content: Object.freeze([Object.freeze({ type: "text", text })]) });
      const source = JSON.stringify(message);
      const expected = new Markdown(`• ${expectedText}`, 0, 0, commandMarkdownTheme(getMarkdownTheme(), palette)).render(120).map(strip);
      const main = new AssistantMessageComponent(message, false, getMarkdownTheme(), "Thinking...", 0, [(md, ctx) => bulletMarkdown(md, ctx, palette)]);
      const state = createReplay();
      replayEvents(state, JSON.stringify({ type: "message_end", message }) + "\n");
      for (const lines of [main.render(120).slice(1), renderRows(state, 120, palette)]) {
        assert.deepEqual(lines.map(strip), expected, text);
        assert.ok(lines.map(strip).some(line => line.includes("! echo *glob*")), text);
      }
      assert.equal(commandMarkdown(text, palette), expectedText);
      assert.equal(JSON.stringify(message), source);
    }
  }
});

for (const fence of ["```", "~~~"]) test(`${fence} fences require whitespace-only closers in main and peek`, () => {
  const { colors } = JSON.parse(readFileSync(new URL("../../../node_modules/catppuccin-pi-theme/themes/catppuccin-mocha.json", import.meta.url)));
  const palette = new Theme(colors, colors, "truecolor");
  installReasoningHide(AssistantMessageComponent, palette);
  const text = `Commands:\n\n${fence}sh\ncat <<'EOF'\n${fence}example\n! echo *glob*\nEOF\n${fence} \t\n! echo _outside_`;
  const expectedText = text.replace("! echo _outside_", "` ! echo _outside_ `");
  const message = Object.freeze({ role: "assistant", content: Object.freeze([Object.freeze({ type: "text", text })]) });
  const source = JSON.stringify(message);
  const expected = new Markdown(`• ${expectedText}`, 0, 0, commandMarkdownTheme(getMarkdownTheme(), palette)).render(120).map(strip);
  const main = new AssistantMessageComponent(message, false, getMarkdownTheme(), "Thinking...", 0, [(md, ctx) => bulletMarkdown(md, ctx, palette)]);
  const state = createReplay();
  replayEvents(state, JSON.stringify({ type: "message_end", message }) + "\n");
  assert.equal(commandMarkdown(text, palette), expectedText);
  for (const lines of [main.render(120).slice(1), renderRows(state, 120, palette)]) {
    assert.deepEqual(lines.map(strip), expected);
    assert.ok(lines.map(strip).some(line => line.includes("! echo *glob*")));
  }
  assert.equal(JSON.stringify(message), source);
});

test("unmatched backticks in the same native block leave literal commands on separate lines in main and peek", () => {
  const { colors } = JSON.parse(readFileSync(new URL("../../../node_modules/catppuccin-pi-theme/themes/catppuccin-mocha.json", import.meta.url)));
  const palette = new Theme(colors, colors, "truecolor");
  installReasoningHide(AssistantMessageComponent, palette);
  for (const ticks of ["`", "``", "```", "````"]) {
    for (const text of [`An unmatched ${ticks} here\n! echo *glob*`, `! echo *glob*\nAn unmatched ${ticks} here`]) {
      const message = Object.freeze({ role: "assistant", content: Object.freeze([Object.freeze({ type: "text", text })]) });
      const source = JSON.stringify(message);
      const main = new AssistantMessageComponent(message, false, getMarkdownTheme(), "Thinking...", 0, [(md, ctx) => bulletMarkdown(md, ctx, palette)]);
      const state = createReplay();
      replayEvents(state, JSON.stringify({ type: "message_end", message }) + "\n");
      for (const lines of [main.render(120), renderRows(state, 120, palette)]) {
        const plain = lines.map(strip);
        assert.ok(plain.includes(text.startsWith("!") ? "• ! echo *glob*" : "! echo *glob*"), text);
        assert.ok(plain.some(line => line.includes(`An unmatched ${ticks} here`) && !line.includes("! echo")), text);
        assert.ok(lines.join("\n").includes(palette.fg("error", "!")), text);
      }
      assert.equal(JSON.stringify(message), source);
    }
  }
});

test("unmatched inline delimiters cannot cross native blocks to claim a later command", () => {
  const { colors } = JSON.parse(readFileSync(new URL("../../../node_modules/catppuccin-pi-theme/themes/catppuccin-mocha.json", import.meta.url)));
  const palette = new Theme(colors, colors, "truecolor");
  installReasoningHide(AssistantMessageComponent, palette);
  for (const boundary of ["```sh\necho hello\n```", "~~~sh\necho hello\n~~~", "# Heading", "> Quote", "---", "\n[ref]: https://example.com\n"]) {
    const text = `An unmatched \` here\n${boundary}\n! echo *glob* \`pwd\``;
    const message = Object.freeze({ role: "assistant", content: Object.freeze([Object.freeze({ type: "text", text })]) });
    const main = new AssistantMessageComponent(message, false, getMarkdownTheme(), "Thinking...", 0, [(md, ctx) => bulletMarkdown(md, ctx, palette)]);
    const state = createReplay();
    replayEvents(state, JSON.stringify({ type: "message_end", message }) + "\n");
    for (const lines of [main.render(120), renderRows(state, 120, palette)]) {
      assert.ok(lines.map(strip).some(line => line.includes("! echo *glob* `pwd`")), text);
    }
    assert.equal(message.content[0].text, text);
  }
});

test("assistant shell markers share semantic error styling in native main and peek, leaving source and syntax intact", () => {
  for (const variant of ["mocha", "latte"]) {
    const { colors } = JSON.parse(readFileSync(new URL(`../../../node_modules/catppuccin-pi-theme/themes/catppuccin-${variant}.json`, import.meta.url)));
    const palette = new Theme(colors, colors, "truecolor");
    installReasoningHide(AssistantMessageComponent, palette);
    const bareCommands = [
      "!npm test",
      "! npm test",
      `! python3 -c 'print("*/*.jsonl")'`,
      "! echo _one_ __two__ **three**",
      "! echo `pwd` ``literal`` ```longest```",
      "! echo `pwd`",
      String.raw`! printf '%s\\n' "a\\b" '\\*'`,
      "! echo [label](https://example.com) ![image](path) <tag> &amp;",
      "! echo trailing spaces  ",
    ];
    for (const text of [...bareCommands, "Try `!npm test` now.", "Try `! npm test` now.", "```sh\n! npm test\n```", "```bash\n!npm test\n```", "```\n! npm test\n```", "~~~zsh\n!npm test\n~~~", "Commands:\n\n  ! echo '*/*.jsonl' `pwd`\n\nOrdinary *prose*."]) {
      const message = Object.freeze({ role: "assistant", content: Object.freeze([Object.freeze({ type: "text", text })]) });
      const source = JSON.stringify(message);
      const main = new AssistantMessageComponent(message, false, getMarkdownTheme(), "Thinking...", 0, [(md, ctx) => bulletMarkdown(md, ctx, palette)]);
      const state = createReplay();
      replayEvents(state, JSON.stringify({ type: "message_end", message }) + "\n");
      const a = main.render(80), b = renderRows(state, 80, palette);
      assert.deepEqual(a.slice(1).map(strip), b.map(strip), text);
      for (const lines of [a, b]) {
        assert.ok(lines.join("\n").includes(palette.fg("error", "!")), `${variant}: ${text}`);
        if (bareCommands.includes(text)) assert.ok(lines.map(strip).includes(`• ${text.trimEnd()}`), text);
        if (text.startsWith("Commands:")) {
          assert.ok(lines.map(strip).includes("  ! echo '*/*.jsonl' `pwd`"));
          assert.ok(lines.map(strip).includes("Ordinary prose."));
        }
      }
      assert.equal(JSON.stringify(message), source);
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
