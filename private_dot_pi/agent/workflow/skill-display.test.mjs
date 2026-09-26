import test from "node:test";
import assert from "node:assert/strict";
import { Container, visibleWidth } from "@earendil-works/pi-tui";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { createJiti } from "jiti";
import { InteractiveMode, UserMessageComponent, initTheme, parseSkillBlock, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { installSkillDisplay, installWorkflow } from "./index.mjs";
import { bulletMarkdown } from "./rows.mjs";

initTheme();
const entry = readFileSync(new URL("../extensions/workflow.ts.tmpl", import.meta.url), "utf8");
const chunks = new URL("../../../node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks/", import.meta.url);
const virtual = readdirSync(chunks).find(name => /^virtual-modules-.*\.js$/.test(name));
assert.ok(virtual, "bundled Pi virtual modules exist");
const { VIRTUAL_MODULES } = await import(new URL(virtual, chunks));
const host = VIRTUAL_MODULES["@earendil-works/pi-coding-agent"];

const strip = line => line.replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
const palette = { fg: (color, text) => `\x1b[${color === "accent" ? 35 : 37}m${text}\x1b[39m`, bg: (_color, text) => `\x1b[44m${text}\x1b[49m` };
const skill = (name, args = "") => `<skill name="${name}" location="/fixture/${name}/SKILL.md">\n# Internal instructions\n\nNever show this.\n</skill>${args ? `\n\n${args}` : ""}`;
const freeze = value => {
  Object.freeze(value);
  for (const child of Object.values(value)) if (child && typeof child === "object" && !Object.isFrozen(child)) freeze(child);
  return value;
};

function receiver(Mode = InteractiveMode) {
  const mode = Object.create(Mode.prototype);
  mode.chatContainer = new Container();
  mode.outputPad = 0;
  mode.toolOutputExpanded = true;
  mode.getMarkdownThemeWithSettings = () => getMarkdownTheme();
  mode.getMarkdownTransformers = () => [(text, context) => bulletMarkdown(text, context, palette)];
  const history = [];
  mode.editor = { addToHistory: text => history.push(text) };
  return { mode, history };
}

test("bundled extension entry installs skill and pending-input displays through root session_start", async t => {
  const root = mkdtempSync(join(tmpdir(), "pi-skill-display-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  });
  writeFileSync(join(root, "subagent-tool-description.md"), "Fixture children.");
  writeFileSync(join(root, "workflow.json"), JSON.stringify({ models: { provider: "openai-codex", tiers: { frontier: "gpt-6-astra" }, classifierFilter: { model: "gpt-6-sol" }, classifierJudge: { model: "gpt-6-sol" } }, agents: {}, mcp: {} }));
  const path = join(root, "workflow.ts");
  writeFileSync(path, entry.replace(/\{\{[^\n]+\}\}/, '"fixture:workflow"'));
  const broker = { env: {}, policy: { mode: "plan", epoch: 1 }, async setMode() {}, async close() {} };
  // Use Pi's bundled virtual modules; only the broker and child launcher are fixtures.
  const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: false, virtualModules: {
    ...VIRTUAL_MODULES,
    "fixture:workflow": { installWorkflow: (pi, configPath, role, runtime) => installWorkflow(pi, configPath, role, {
      ...runtime, startBroker: async () => broker, installSubagents: async styled => {
        styled.events.on("subagents:rpc:v1:request", request => styled.events.emit(`subagents:rpc:v1:reply:${request.requestId}`, { success: true,
          data: request.method === "ping" ? { capabilities: { fleetStatus: { version: 1 }, stop: true, processTerminalProof: { version: 1 } } }
            : { fleet: { entries: [], totalActive: 0 }, asyncSnapshot: { version: 1, omitted: { runs: 0 }, runs: [] } },
        }));
      },
    }) },
  } });
  const start = await jiti.import(path, { default: true });
  const handlers = new Map();
  const tools = new Map();
  const events = new EventEmitter();
  const pi = {
    events: { on(name, fn) { events.on(name, fn); return () => events.off(name, fn); }, emit: (...args) => events.emit(...args) },
    on(name, fn) { const list = handlers.get(name) ?? []; list.push(fn); handlers.set(name, list); },
    registerTool(tool) { tools.set(tool.name, tool); }, getAllTools: () => [...tools.values()], getActiveTools: () => [...tools.keys()],
    registerCommand() {}, registerFlag() {}, getFlag() {}, registerEntryRenderer() {}, registerMessageRenderer() {}, registerMarkdownTransformer() {},
    setActiveTools() {},
  };
  await start(pi);
  const ctx = { cwd: root, mode: "tui", hasUI: true, isProjectTrusted: () => false,
    sessionManager: { getSessionId: () => "skill-fixture", getBranch: () => [], getEntries: () => [] },
    // The classifier's shared id is off subscription OAuth; the frontier is on it.
    modelRegistry: { find: (provider, id) => ({ provider, id }), isUsingOAuth: model => model.id !== "gpt-6-sol" },
    ui: { theme: palette, setStatus() {}, setToolsExpanded() {}, setWorkingVisible() {}, setWidget() {}, setFooter() {}, setHeader() {}, setEditorComponent() {}, addAutocompleteProvider() {}, notify(message, level) { notices.push([message, level]); } },
  };
  const notices = [];
  t.after(async () => { for (const handler of handlers.get("session_shutdown") ?? []) await handler({}, ctx); });
  assert.notEqual(host.InteractiveMode, InteractiveMode, "bundled Pi does not use the native SDK prototype");
  for (const handler of [...handlers.get("session_start")]) await handler({ reason: "startup" }, ctx);
  assert.deepEqual(notices.filter(([message]) => message.includes("unavailable")),
    [["gpt-6-sol is pinned but unavailable on subscription OAuth in this Pi model catalog; no fallback will be used.", "warning"]]);
  const raw = skill("ship-check", "first line\nsecond line");
  const message = freeze({ role: "user", content: [{ type: "text", text: raw }], timestamp: 1 });
  const { mode, history } = receiver(host.InteractiveMode);
  mode.addMessageToChat(message, { populateHistory: true });
  assert.deepEqual(history, ["/skill:ship-check first line\nsecond line"]);
  assert.equal(mode.chatContainer.children.length, 1);
  assert.match(mode.chatContainer.render(40).map(strip).join("\n"), /❯ \/skill:ship-check/);
  assert.doesNotMatch(mode.chatContainer.render(40).map(strip).join("\n"), /Internal instructions|Never show/);
  assert.equal(message.content[0].text, raw);
  const queue = { steering: ["next response"], followUp: ["after task"] };
  mode.pendingMessagesContainer = new Container();
  mode.getAllQueuedMessages = () => queue;
  mode.getAppKeyDisplay = () => "alt+up";
  mode.ui = { requestRender() {} };
  mode.updatePendingMessagesDisplay();
  const pending = mode.pendingMessagesContainer.render(60);
  assert.match(pending.map(strip).join("\n"), /π Steering · next response\n\n❯ next response/);
  assert.match(pending.map(strip).join("\n"), /π Follow-up · after current task\n\n❯ after task/);
  assert.equal(pending.filter(line => line.startsWith("\x1b[44m")).length, 6);
  assert.deepEqual(queue, { steering: ["next response"], followUp: ["after task"] });
});

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
