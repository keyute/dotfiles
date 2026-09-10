import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const dir = new URL(".", import.meta.url).pathname;
const nodeModules = new URL("../../../node_modules/", import.meta.url).pathname;

const sourceFiles = readdirSync(dir).filter(f => f.endsWith(".mjs") && !f.endsWith(".test.mjs"));

function isExported(distDir, entryFile, name, seen = new Set()) {
  const path = join(distDir, entryFile);
  if (seen.has(path) || !existsSync(path)) return false;
  seen.add(path);
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    if (!line.startsWith("export")) continue;
    if (new RegExp(`\\b${name}\\b`).test(line) && !/^export \* from/.test(line)) return true;
  }
  for (const match of text.matchAll(/^export \* from "(\.[^"]+)"/gm)) {
    const ref = match[1].endsWith(".ts") || match[1].endsWith(".d.ts") ? match[1] : `${match[1]}.d.ts`;
    const resolved = ref.replace(/\.ts$/, ".d.ts");
    if (isExported(distDir, join(dirname(entryFile), resolved), name, seen)) return true;
  }
  return false;
}

for (const file of sourceFiles) {
  const text = readFileSync(join(dir, file), "utf8");

  for (const match of text.matchAll(/^import\s*\{([^}]+)\}\s*from\s*"(@earendil-works\/[^"]+)"/gm)) {
    const [, names, specifier] = match;
    const pkg = specifier.slice("@earendil-works/".length);
    const distDir = join(nodeModules, "@earendil-works", pkg, "dist");
    for (const raw of names.split(",")) {
      const original = raw.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, "").trim();
      if (!original) continue;
      test(`${file}: ${original} is exported by ${pkg}/dist/index.d.ts`, () => {
        assert.ok(isExported(distDir, "index.d.ts", original), `${original} imported in ${file} is not an export of ${pkg}/dist/index.d.ts`);
      });
    }
  }

  if (/^import\s*\*\s*as\s+sdk\s+from\s*"@earendil-works\/pi-coding-agent"/m.test(text)) {
    const distDir = join(nodeModules, "@earendil-works", "pi-coding-agent", "dist");
    const members = new Set([...text.matchAll(/\bsdk\.([A-Za-z_$][A-Za-z0-9_$]*)/g)].map(m => m[1]));
    for (const name of members) {
      test(`${file}: sdk.${name} is exported by pi-coding-agent/dist/index.d.ts`, () => {
        assert.ok(isExported(distDir, "index.d.ts", name), `sdk.${name} used in ${file} is not an export of pi-coding-agent/dist/index.d.ts`);
      });
    }
  }

  const specifiers = [
    ...[...text.matchAll(/\bimport\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/g)].map(m => m[1]),
    ...[...text.matchAll(/\bjiti\.import\(\s*["']([^"']+)["']/g)].map(m => m[1]),
    ...[...text.matchAll(/\bimport\(\s*["']([^"']+)["']/g)].map(m => m[1]),
  ];
  for (const specifier of specifiers) {
    if (!/^(@earendil-works\/|pi-subagents|pi-mcp-adapter)/.test(specifier)) continue;
    test(`${file}: "${specifier}" does not reach into dist/ or src/`, () => {
      assert.ok(!specifier.includes("/dist/") && !specifier.includes("/src/"), `${specifier} imported in ${file} reaches into an internal package path`);
    });
    if (specifier.startsWith("pi-subagents/")) {
      const subpath = `./${specifier.slice("pi-subagents/".length)}`;
      test(`${file}: "${specifier}" is a declared subpath export of pi-subagents`, () => {
        const pkgJson = JSON.parse(readFileSync(join(nodeModules, "pi-subagents", "package.json"), "utf8"));
        assert.ok(Object.hasOwn(pkgJson.exports, subpath), `${subpath} is not a key of pi-subagents' package.json exports map`);
      });
    }
  }

  for (const match of text.matchAll(/\bpi\.on\(\s*["']([^"']+)["']/g)) {
    const name = match[1];
    test(`${file}: pi.on("${name}") is documented in pi-coding-agent/docs/extensions.md`, () => {
      const docs = readFileSync(join(nodeModules, "@earendil-works", "pi-coding-agent", "docs", "extensions.md"), "utf8");
      assert.match(docs, new RegExp(`(\`${name}\`|"${name}"|^#+.*\\b${name}\\b)`, "m"), `pi.on("${name}") in ${file} is not documented in extensions.md`);
    });
  }

  for (const match of text.matchAll(/\bpi\.events\.(?:on|emit)\(\s*["']([^"']+)["']/g)) {
    const name = match[1];
    test(`${file}: pi.events event "${name}" is documented`, () => {
      const candidates = [
        ...readdirSync(join(nodeModules, "pi-subagents", "docs")).map(f => join(nodeModules, "pi-subagents", "docs", f)),
        join(nodeModules, "pi-mcp-adapter", "README.md"),
      ];
      const found = candidates.some(path => existsSync(path) && new RegExp(`(\`${name}\`|"${name}")`).test(readFileSync(path, "utf8")));
      assert.ok(found, `pi.events event "${name}" used in ${file} is not documented in pi-subagents/docs or pi-mcp-adapter/README.md`);
    });
  }
}

const indexPath = join(dir, "index.mjs");
if (existsSync(indexPath)) {
  const indexText = readFileSync(indexPath, "utf8");
  const foldingMatch = indexText.match(/function\s+installFolding\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  if (foldingMatch) {
    for (const match of foldingMatch[1].matchAll(/\bpi\.on\(\s*["']([^"']+)["']/g)) {
      const name = match[1];
      test(`installFolding: pi.on("${name}") is documented in pi-coding-agent/docs/extensions.md`, () => {
        const docs = readFileSync(join(nodeModules, "@earendil-works", "pi-coding-agent", "docs", "extensions.md"), "utf8");
        assert.match(docs, new RegExp(`(\`${name}\`|"${name}"|^#+.*\\b${name}\\b)`, "m"), `pi.on("${name}") in installFolding is not documented in extensions.md`);
      });
    }
  }
}

// Source pins for the undocumented behaviour the transcript rows lean on
// (docs/pi-design.md rule 7). Each names the text the code assumes; a pin bump
// that rewrites it fails here before the row does on screen.
const pins = [
  ["pi-subagents registers `subagent` with its own renderers through the API it is handed", "pi-subagents/src/extension/index.ts", [/name: "subagent"/, /renderCall\(args, theme\)/, /renderResult\(result, options, theme, context\)/, /pi\.registerTool\(tool\)/]],
  ["pi-mcp-adapter registers direct tools with its own renderers through the API it is handed", "pi-mcp-adapter/index.ts", [/name: spec\.prefixedName/, /renderCall: createMcpDirectToolCallRenderer\(/, /renderResult: renderMcpToolResult/]],
  ["pi-mcp-adapter reports failures in details.error without isError", "pi-mcp-adapter/direct-tools.ts", [/details: \{ error: "auth_required"/, /details: \{ error: "server_unavailable"/]],
  ["pi keeps the definition object handed to registerTool", "@earendil-works/pi-coding-agent/dist/core/extensions/loader.js", [/registerTool\(tool\) \{[\s\S]{0,200}definition: tool,/]],
  ["the bash tool's empty-output stand-in and exit-status trailer", "@earendil-works/pi-coding-agent/dist/core/tools/bash.js", [/"\(no output\)"/, /`Command exited with code \$\{exitCode\}`/]],
  ["a click toggles one row's own expanded flag, after the rendered component has declined it", "@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js", [/createResultRegion\(/, /this\.setExpanded\(!this\.expanded\)/, /y: event\.y - 1,/]],
  ["a mouse region asks its child before its own handler", "@earendil-works/pi-tui/dist/components/mouse-region.js", [/childResult \?\? this\.onMouse\(event\)/]],
  ["markdown that transforms to nothing renders no line", "@earendil-works/pi-tui/dist/components/markdown.js", [/this\.options\.transform\?\.\(this\.text, contentWidth\) \?\? this\.text/, /if \(!text \|\| text\.trim\(\) === ""\)/]],
  ["pi resets every extension surface when a session is invalidated", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/setBeforeSessionInvalidate\(\(\) => \{\s*this\.resetExtensionUI\(\);/]],
  ["pi-subagents registers bg_wait and the supervisor channel without renderers of their own", "pi-subagents/src/runs/background/wait-tool.ts", [/name: "bg_wait"/]],
  ["the questionnaire plugin registers ask_user_question without renderers of its own", "@juicesharp/rpiv-ask-user-question/ask-user-question.ts", [/ASK_USER_QUESTION_TOOL_NAME = "ask_user_question"/, /pi\.registerTool\(\{/]],
  ["pi-web-search registers web_search and a Gemini-only url_context with its own renderers", "pi-web-search/src/index.ts", [/const WEB_SEARCH_TOOL = "web_search"/, /const URL_CONTEXT_TOOL = "url_context"/, /name: WEB_SEARCH_TOOL/, /renderCall\(args, theme\)/]],
  ["pi-web-search takes the model's credentials from pi and posts to the Codex responses endpoint", "pi-web-search/src/api.ts", [/ctx\.modelRegistry\.getApiKeyAndHeaders\(model\)/, /model\.api === "openai-codex-responses"/, /`\$\{base\}\/codex\/responses`/]],
  ["pi-web-search reports failures in details.error", "pi-web-search/src/utils.ts", [/details: \{ error: true \}/]],
  ["the SDK bash schema is a plain object with a properties map", "@earendil-works/pi-coding-agent/dist/core/tools/bash.js", [/parameters: bashSchema/]],
  ["an async launch answers with asyncId", "pi-subagents/src/runs/background/async-execution.ts", [/asyncId: id/]],
  ["a completion spreads the result file (agent, success, state, durationMs) plus runId and each result's resolved status", "pi-subagents/src/runs/background/result-watcher.ts", [/emit\(SUBAGENT_ASYNC_COMPLETE_EVENT, \{\s*\.\.\.data,\s*runId,/, /data\.success/, /data\.state === "stopped"/, /status: child\.status,/]],
  ["the result file's durationMs runs from launch to end", "pi-subagents/src/runs/background/subagent-runner.ts", [/durationMs: runEndedAt - overallStartTime/]],
  ["Tab inside a command's arguments asks for forced file completion", "@earendil-works/pi-tui/dist/components/editor.js", [/handleTabCompletion\(\) \{/, /this\.forceFileAutocomplete\(true\);/]],
  ["Tab on a command name with no argument yet is pi's own unforced slash menu, ahead of the forced branch", "@earendil-works/pi-tui/dist/components/editor.js", [/if \(this\.isInSlashCommandContext\(beforeCursor\) && !beforeCursor\.trimStart\(\)\.includes\(" "\)\) \{\s*this\.handleSlashCommandCompletion\(\);/, /handleSlashCommandCompletion\(\) \{\s*this\.requestAutocomplete\(\{ force: false, explicitTab: true \}\);/]],
  ["typing opens the menu on [A-Za-z0-9.\\-_] only, and an open one re-asks itself", "@earendil-works/pi-tui/dist/components/editor.js", [/else if \(\/\[a-zA-Z0-9\.\\-_\]\/\.test\(char\)\) \{/, /updateAutocomplete\(\) \{[\s\S]{0,200}?this\.requestAutocomplete\(\{ force: this\.autocompleteState === "force", explicitTab: false \}\);/]],
  ["tryTriggerAutocomplete is the unforced request a typed character makes", "@earendil-works/pi-tui/dist/components/editor.js", [/tryTriggerAutocomplete\(explicitTab = false\) \{\s*this\.requestAutocomplete\(\{ force: false, explicitTab \}\);/]],
  ["pi-subagents renders its control notice through a registered message renderer, and the notice names the agent; goal missions deliver through the same path, which is why the row declines them by source", "pi-subagents/src/extension/index.ts", [/registerMessageRenderer<SubagentControlMessageDetails>\(SUBAGENT_CONTROL_MESSAGE_TYPE,/, /handleSubagentControlNotice\(\{[\s\S]{0,200}?details: \{ source: "goal",/]],
  ["the control notice's message type is the literal the renderer keys on, and the two early returns before delivery filter active_long_running and foreground only", "pi-subagents/src/extension/control-notices.ts", [/SUBAGENT_CONTROL_MESSAGE_TYPE = "subagent_control_notice"/, /input\.details\.event\.type === "active_long_running"\) return;/, /input\.details\.source === "foreground"/]],
  ["the control notice's details carry the event the row is built from, and the idle signal keeps the wording noticeLine strips", "pi-subagents/src/runs/shared/subagent-control.ts", [/`Subagent needs attention: \$\{event\.agent\}`/, /`Subagent failed: \$\{event\.agent\}`/, /`Signal: \$\{event\.message\}`/, /`\$\{input\.agent\} needs attention \(no observed activity for \$\{elapsedSeconds\}s\)`/]],
  ["a renderer that throws or answers nothing falls back to pi's own custom-message box", "@earendil-works/pi-coding-agent/dist/modes/interactive/components/custom-message.js", [/if \(this\.customRenderer\) \{\s*try \{[\s\S]{0,600}?catch \{/]],
  ["accepting an item with Tab closes the menu without re-opening it", "@earendil-works/pi-tui/dist/components/editor.js", [/kb\.matches\(data, "tui\.input\.tab"\)\) \{\s*const selected = this\.autocompleteList\.getSelectedItem\(\);[\s\S]{0,600}?this\.cancelAutocomplete\(\);/]],
  ["the built-in provider skips its slash branch when the request is forced", "@earendil-works/pi-tui/dist/autocomplete.js", [/if \(!options\.force && textBeforeCursor\.startsWith\("\/"\)\)/, /command\.getArgumentCompletions\(argumentText\)/]],
  ["pi clears the stacked autocomplete providers when a session is invalidated", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/this\.autocompleteProviderWrappers = \[\];/]],
  ["pi's own working row is a column in under a blank line, so the extension draws its own", "@earendil-works/pi-tui/dist/components/loader.js", [/super\("", 1, 0\)/, /return \["", \.\.\.super\.render\(width\)\]/]],
  ["an aboveEditor widget sits between the status container and the composer, under the block's one blank line, and a string widget takes pi's own indent", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/this\.widgetContainerAbove,\s*this\.editorContainer,/, /if \(leadingSpacer\) \{\s*container\.addChild\(new Spacer\(1\)\);/, /container\.addChild\(new Text\(line, 1, 0\)\)/]],
  ["pi spaces an assistant message from its raw reasoning and renders nothing for a blank block, so blanking the text removes the line", "@earendil-works/pi-coding-agent/dist/modes/interactive/components/assistant-message.js", [/const hasVisibleContent = message\.content\.some\(\(c\) => \(c\.type === "text" && c\.text\.trim\(\)\) \|\| \(c\.type === "thinking" && c\.thinking\.trim\(\)\)\);/, /if \(thinkingBlocks\.length === 0\) \{\s*continue;/]],
  ["extensions see message_end before pi's listeners and before persistence, and a returned message is copied onto the one they were handed", "@earendil-works/pi-coding-agent/dist/core/agent-session.js", [/await this\._emitExtensionEvent\(event\);\s*\/\/ Notify all listeners\s*this\._emit\(/, /this\._replaceMessageInPlace\(event\.message, normalized\);/, /if \(target === replacement\) \{\s*return;/]],
  ["the OpenAI responses replay sends the opaque reasoning item alone, and stores the provider's summary inside it", "@earendil-works/pi-ai/dist/api/openai-responses-shared.js", [/const reasoningItem = JSON\.parse\(block\.thinkingSignature\);\s*output\.push\(reasoningItem\);/, /slot\.block\.thinkingSignature = JSON\.stringify\(item\);/]],
  ["any change of model identity (provider, api or model id) forwards the earlier reasoning as plain text, and drops a block whose text is empty", "@earendil-works/pi-ai/dist/api/transform-messages.js", [/const isSameModel = assistantMsg\.provider === model\.provider &&\s*assistantMsg\.api === model\.api &&\s*assistantMsg\.model === model\.id;/, /if \(isSameModel && block\.thinkingSignature\)\s*return block;\s*\/\/ Skip empty thinking blocks, convert others to plain text\s*if \(!block\.thinking \|\| block\.thinking\.trim\(\) === ""\)\s*return \[\];/, /return \{\s*type: "text",\s*text: block\.thinking,/]],
  ["the Anthropic replay carries the thinking text with its signature, which is why blanking is gated by api", "@earendil-works/pi-ai/dist/api/anthropic-messages.js", [/type: "thinking",\s*thinking: sanitizeSurrogates\(block\.thinking\),\s*signature: thinkingSignature,/]],
  ["result statuses are completed, failed, partial, paused, stopped or detached", "pi-subagents/src/shared/types.ts", [/ExecutionProjectionStatus = "completed" \| "failed" \| "partial" \| "paused" \| "stopped" \| "detached"/]],
];
for (const [claim, file, patterns] of pins) {
  test(`pin: ${claim} (${file})`, () => {
    const text = readFileSync(join(nodeModules, file), "utf8");
    for (const pattern of patterns) assert.match(text, pattern);
  });
}

// API calls that are not events: each must stay documented.
const documentedApis = ["pi.sendMessage(", "ctx.ui.select(", "getArgumentCompletions", "ctx.ui.addAutocompleteProvider(", "pi.appendEntry(", "pi.registerEntryRenderer(", "pi.registerMessageRenderer(", "ctx.ui.setWidget(", "setWorkingVisible", "placement"];
for (const api of documentedApis) {
  test(`${api} is documented in pi-coding-agent/docs/extensions.md`, () => {
    const docs = readFileSync(join(nodeModules, "@earendil-works", "pi-coding-agent", "docs", "extensions.md"), "utf8");
    assert.ok(docs.includes(api), `${api} is not documented`);
  });
}

// Every line that stays visible ends the run of folded rows above it
// (docs/pi-design.md rule 2). The boundary rides with `appendVisible` so no
// call site has to remember one — this holds the rest of them to that path,
// which prose did not: four of six sites drifted off it before 2026-09-10.
test("pi.appendEntry is only reached through appendVisible", () => {
  const offenders = sourceFiles.filter(file => file !== "rows.mjs" && readFileSync(join(dir, file), "utf8").includes("pi.appendEntry("));
  assert.deepEqual(offenders, [], `these call pi.appendEntry directly instead of appendVisible: ${offenders.join(", ")}`);
});
