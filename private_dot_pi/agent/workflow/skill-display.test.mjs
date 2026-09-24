import test from "node:test";
import assert from "node:assert/strict";
import { Container, visibleWidth } from "@earendil-works/pi-tui";
import { InteractiveMode, UserMessageComponent, initTheme, parseSkillBlock, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { installSkillDisplay } from "./index.mjs";
import { bulletMarkdown } from "./rows.mjs";

initTheme();
const strip = line => line.replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
const palette = { fg: (color, text) => `\x1b[${color === "accent" ? 35 : 37}m${text}\x1b[39m` };
const skill = (name, args = "") => `<skill name="${name}" location="/fixture/${name}/SKILL.md">\n# Internal instructions\n\nNever show this.\n</skill>${args ? `\n\n${args}` : ""}`;
const freeze = value => {
  Object.freeze(value);
  for (const child of Object.values(value)) if (child && typeof child === "object" && !Object.isFrozen(child)) freeze(child);
  return value;
};

function receiver() {
  const mode = Object.create(InteractiveMode.prototype);
  mode.chatContainer = new Container();
  mode.outputPad = 0;
  mode.toolOutputExpanded = true;
  mode.getMarkdownThemeWithSettings = () => getMarkdownTheme();
  mode.getMarkdownTransformers = () => [(text, context) => bulletMarkdown(text, context, palette)];
  const history = [];
  mode.editor = { addToHistory: text => history.push(text) };
  return { mode, history };
}

test("native skill display uses one ordinary user box and restores command-only history without modifying messages", () => {
  installSkillDisplay();
  const wrapped = InteractiveMode.prototype.getUserMessageText;
  installSkillDisplay();
  assert.equal(InteractiveMode.prototype.getUserMessageText, wrapped, "reload does not stack wrappers");
  for (const args of ["", "first line\nsecond line with **markdown**"]) {
    const { mode, history } = receiver();
    const raw = skill("audit", args);
    const message = freeze({ role: "user", content: [{ type: "text", text: raw }], timestamp: 1 });
    mode.addMessageToChat(message, { populateHistory: true });
    const expected = `/skill:audit${args ? ` ${args}` : ""}`;
    assert.equal(mode.getUserMessageText(message), expected);
    assert.equal(parseSkillBlock(mode.getUserMessageText(message)), null);
    assert.deepEqual(history, [expected]);
    assert.equal(mode.chatContainer.children.filter(child => child instanceof UserMessageComponent).length, 1);
    assert.equal(mode.chatContainer.children.length, 1);
    const lines = mode.chatContainer.render(32);
    assert.ok(lines.every(line => visibleWidth(line) <= 32));
    assert.ok(mode.chatContainer.render(12).every(line => visibleWidth(line) <= 12), "command and arguments wrap in a narrow box");
    assert.match(lines.map(strip).join("\n"), /❯ \/skill:audit/);
    assert.match(lines.join("\n"), /\x1b\[35m\/skill:audit\x1b\[39m/);
    if (args) {
      assert.match(lines.join("\n"), /\x1b\[37m first line/);
      assert.match(lines.map(strip).join("\n"), /second line with markdown/);
    }
    assert.doesNotMatch(lines.map(strip).join("\n"), /Internal instructions|Never show/);
    assert.equal(message.content[0].text, raw);
  }
  const { mode } = receiver();
  const ordinary = freeze({ role: "user", content: "ordinary message", timestamp: 2 });
  assert.equal(mode.getUserMessageText(ordinary), "ordinary message");
  mode.addMessageToChat(ordinary);
  assert.doesNotMatch(mode.chatContainer.render(24).join("\n"), /\x1b\[35m/);
});
