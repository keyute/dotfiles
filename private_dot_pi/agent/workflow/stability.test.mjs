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

// Since pi-coding-agent 0.87.1 the event and API reference left docs/extensions.md
// ("use the exported event declarations for the complete ... contract"); the
// shipped extension declarations are the documented surface for both.
const extensionDeclarations = () => readFileSync(join(nodeModules, "@earendil-works", "pi-coding-agent", "dist", "core", "extensions", "types.d.ts"), "utf8");

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
    if (!/^(@earendil-works\/|pi-subagents)/.test(specifier)) continue;
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
    test(`${file}: pi.on("${name}") is a declared extension event`, () => {
      assert.match(extensionDeclarations(), new RegExp(`on\\(event: "${name}"`), `pi.on("${name}") in ${file} has no on() overload in the exported extension declarations`);
    });
  }

  for (const match of text.matchAll(/\bpi\.events\.(?:on|emit)\(\s*["']([^"']+)["']/g)) {
    const name = match[1];
    test(`${file}: pi.events event "${name}" is documented`, () => {
      const candidates = readdirSync(join(nodeModules, "pi-subagents", "docs")).map(f => join(nodeModules, "pi-subagents", "docs", f));
      const found = candidates.some(path => existsSync(path) && new RegExp(`(\`${name}\`|"${name}")`).test(readFileSync(path, "utf8")));
      assert.ok(found, `pi.events event "${name}" used in ${file} is not documented in pi-subagents/docs`);
    });
  }
}

// ops-worker loads the SDK lazily, out of reach of the static import scan above.
for (const name of ["detectSupportedImageMimeTypeFromFile", "truncateHead", "truncateLine"]) {
  test(`ops-worker.mjs: ${name} is exported by pi-coding-agent/dist/index.d.ts`, () => {
    assert.ok(isExported(join(nodeModules, "@earendil-works", "pi-coding-agent", "dist"), "index.d.ts", name));
  });
}

// Source pins for the undocumented behaviour the transcript rows lean on
// (docs/pi-design.md rule 7). Each names the text the code assumes; a pin bump
// that rewrites it fails here before the row does on screen.
const pins = [
  ["bundled extension loading supplies host virtual modules through Jiti", "@earendil-works/pi-coding-agent/dist/core/extensions/loader.js", [/usesEmbeddedModules = isBunBinary \|\| isNodeSeaBinary \|\| isBundledNode/, /virtualModules: await getVirtualModules\(\), tryNative: false/, /moduleCache: false/, /await jiti\.import\(extensionPath, \{ default: true \}\)/]],
  ["pending input is rebuilt from Pi's combined session/compaction queues and actual dequeue binding", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/updatePendingMessagesDisplay\(\) \{\s*this\.pendingMessagesContainer\.clear\(\);/, /const \{ steering: steeringMessages, followUp: followUpMessages \} = this\.getAllQueuedMessages\(\);/, /this\.session\.getSteeringMessages\(\)/, /this\.session\.getFollowUpMessages\(\)/, /this\.compactionQueuedMessages\.filter\(\(msg\) => msg\.mode === "steer"\)/, /this\.compactionQueuedMessages\.filter\(\(msg\) => msg\.mode === "followUp"\)/, /this\.getAppKeyDisplay\("app\.message\.dequeue"\)/]],
  ["custom editors inherit the native app-action handlers, including streaming follow-up submission", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/for \(const \[action, handler\] of this\.defaultEditor\.actionHandlers\) \{\s*customEditor\.actionHandlers\.set\(action, handler\);/, /this\.defaultEditor\.onAction\("app\.message\.followUp",/, /await this\.session\.prompt\(text, \{ streamingBehavior: "followUp" \}\);/]],
  ["shell follow-up submission can reuse native paste expansion, autocomplete cleanup and editor clearing", "@earendil-works/pi-tui/dist/components/editor.js", [/submitValue\(\) \{\s*this\.cancelAutocomplete\(\);\s*const result = this\.expandPasteMarkers\(this\.state\.lines\.join\("\\n"\)\)\.trim\(\);/, /getExpandedText\(\) \{\s*return this\.expandPasteMarkers\(this\.state\.lines\.join\("\\n"\)\);/]],
  ["display-only custom entries emit immediately and mount ahead of a streaming assistant component", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/case "entry_appended":/, /this\.addCustomEntryToChat\(event\.entry\);/, /const streamingIndex = this\.chatContainer\.children\.indexOf\(this\.streamingComponent\);\s*if \(streamingIndex >= 0\) \{\s*this\.chatContainer\.children\.splice\(streamingIndex, 0, component\);/]],
  ["appendEntry sends a custom-entry event without appending model context", "@earendil-works/pi-coding-agent/dist/core/agent-session.js", [/appendEntry: \(customType, data\) => \{\s*const entryId = this\.sessionManager\.appendCustomEntry\(customType, data\);\s*const entry = this\.sessionManager\.getEntry\(entryId\);\s*if \(entry\) \{\s*this\._emit\(\{ type: "entry_appended", entry \}\);\s*\}\s*\},/]],
  ["custom-entry renderers rebuild on Ctrl+O and theme invalidation while retaining the same entry object", "@earendil-works/pi-coding-agent/dist/modes/interactive/components/custom-entry.js", [/setExpanded\(expanded\) \{\s*if \(this\._expanded !== expanded\) \{\s*this\._expanded = expanded;\s*this\.rebuild\(\);/, /invalidate\(\) \{\s*super\.invalidate\(\);\s*this\.rebuild\(\);/, /this\.renderer\(this\.entry, \{ expanded: this\._expanded \}, theme\)/]],
  ["native skill rendering and restored editor history both use the same getUserMessageText result, and the extension starts before initial rendering", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/getUserMessageText\(message\) \{/, /const textContent = this\.getUserMessageText\(message\);[\s\S]{0,500}?const skillBlock = parseSkillBlock\(textContent\);/, /new UserMessageComponent\(textContent, this\.getMarkdownThemeWithSettings\(\), this\.outputPad, this\.getMarkdownTransformers\(\)\)/, /this\.editor\.addToHistory\?\.\(textContent\);/, /await this\.rebindCurrentSession\(\);[\s\S]{0,100}?this\.renderInitialMessages\(\);/, /this\.renderSessionEntries\(entries, \{\s*updateFooter: true,\s*populateHistory: true,/]],
  ["pi's <skills> section renders only when a tool named read or bash is active, so the workflow's before_agent_start hook lists them for the workspace_* surface itself", "@earendil-works/pi-coding-agent/dist/core/system-prompt.js", [/const skillFileReadTool = \["read", "bash"\]\.find\(\(tool\) => selectedTools\.includes\(tool\)\);/, /if \(skillFileReadTool && skills\.length > 0\) \{/]],
  ["formatSkillsForPrompt names the read tool only for \"read\" and tells the model to use bash for any other tool name", "@earendil-works/pi-coding-agent/dist/core/skills.js", [/fileReadTool === "read"\s*\? "Use the read tool to load a skill's file when the task matches its description\."\s*: "Use bash to load a skill's file when the task matches its description\."/]],
  ["native skill block parser requires the complete tag so a reconstructed command takes the ordinary user-box branch", "@earendil-works/pi-coding-agent/dist/core/agent-session.js", [/text\.match\(\/\^<skill name=/, /userMessage: match\[4\]\?\.trim\(\) \|\| undefined,/]],
  ["the user box sends transformed markdown through native wrapping and userMessageText while retaining its shade", "@earendil-works/pi-coding-agent/dist/modes/interactive/components/user-message.js", [/theme\.bg\("userMessageBg", content\)/, /theme\.fg\("userMessageText", content\)/, /transform: createMarkdownTransform\("user", false, this\.markdownTransformers\)/]],
  ["peek shapes the native editor's border-delimited content before the unshaded autocomplete list, retaining its cursor marker when clipped", "@earendil-works/pi-tui/dist/components/editor.js", [/result\.push\(this\.renderTopBorder\(width, this\.scrollOffset\)\)/, /result\.push\(this\.renderBottomBorder\(width, linesBelow\)\)/, /const autocompleteResult = this\.autocompleteList\.render\(contentWidth\)/, /const marker = emitCursorMarker \? CURSOR_MARKER : ""/]],
  ["native slash-menu Enter accepts then submits, whereas Tab only accepts", "@earendil-works/pi-tui/dist/components/editor.js", [/if \(this\.autocompletePrefix\.startsWith\("\/"\)\) \{\s*this\.cancelAutocomplete\(\);\s*\/\/ Fall through to submit/, /kb\.matches\(data, "tui\.input\.tab"\)\) \{[\s\S]{0,800}?return;/]],
  ["shell layout and navigation use the same native editor state without changing submission or undo", "@earendil-works/pi-tui/dist/components/editor.js", [/layoutText\(contentWidth\)/, /buildVisualLineMap\(width\)/, /this\.state\.lines\[i\]/, /logicalLine: i,/, /startCol: chunk\.startIndex/, /handleBackspace\(\)/, /this\.state\.cursorCol === 0/, /navigateHistory\(direction\)/, /pushUndoSnapshot\(\)/, /this\.undoStack\.push\(\{ state: this\.state,/, /this\.expandPasteMarkers\(this\.state\.lines\.join\("\\n"\)\)\.trim\(\)/]],
  ["pi-subagents registers `subagent` with its own renderers through the API it is handed", "pi-subagents/src/extension/index.js", [/name: "subagent"/, /renderCall\(args, theme\)/, /renderResult\(result, options, theme, context\)/, /pi\.registerTool\(tool\)/]],
  ["pi's MCP and tool_search extension factories are public exports", "@earendil-works/pi-coding-agent/dist/index.d.ts", [/export \{ createMcpExtension, /, /export \{ createToolSearchExtension \}/]],
  ["an MCP tool is named mcp__<server>__<tool> (sanitised, hash-shortened) and labelled <server>/<tool>, the identity plugin-api reads", "@earendil-works/pi-coding-agent/dist/extensions/mcp/tools.js", [/const name = `mcp__\$\{server\}__\$\{tool\}`\.replace\(/, /const label = `\$\{server\}\/\$\{tool\.name\}`;\s*return \{\s*name: options\.name,\s*label,/]],
  ["pi's MCP resource tools, which plugin-api hides", "@earendil-works/pi-coding-agent/dist/extensions/mcp/resources.js", [/LIST_MCP_RESOURCES_TOOL = "list_mcp_resources"/, /LIST_MCP_RESOURCE_TEMPLATES_TOOL = "list_mcp_resource_templates"/, /name: READ_MCP_RESOURCE_TOOL,/]],
  ["the resource reader's name", "@earendil-works/pi-coding-agent/dist/extensions/mcp/tools.js", [/READ_MCP_RESOURCE_TOOL = "read_mcp_resource"/]],
  // The MCP gate checks a server by name only, so the managed config must be the sole source of servers.
  ["loadConfig replaces pi's mcp.json read and updateConfig is the only write-back, both typed options", "@earendil-works/pi-coding-agent/dist/extensions/mcp/index.d.ts", [/\/\*\* Defaults to reading `mcp\.json` from the agent directory and the trusted project\. \*\/\s*loadConfig\?: \(ctx: ExtensionContext\) => LoadedMcpConfig;/, /updateConfig\?: \(entry: McpServerEntry, patch: McpServerConfigPatch\) => void;/]],
  ["/mcp never saves an extension-scoped server's changes", "@earendil-works/pi-coding-agent/dist/extensions/mcp/config.d.ts", [/`pi\.registerMcpServer\(\)`\. Changes to extension servers are not saved\.\s*\*\/\s*scope\?: "global" \| "project" \| "extension";/]],
  ["pi keeps the definition object handed to registerTool", "@earendil-works/pi-coding-agent/dist/core/extensions/loader.js", [/registerTool\(tool\) \{[\s\S]{0,600}definition: tool,/]],
  ["the bash tool's empty-output stand-in and exit-status trailer", "@earendil-works/pi-coding-agent/dist/core/tools/bash.js", [/"\(no output\)"/, /`Command exited with code \$\{exitCode\}`/]],
  ["a click toggles one row's own expanded flag, after the rendered component has declined it", "@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js", [/createResultRegion\(/, /this\.setExpanded\(!this\.expanded\)/, /y: event\.y - 1,/]],
  ["a mouse region asks its child before its own handler", "@earendil-works/pi-tui/dist/components/mouse-region.js", [/childResult \?\? this\.onMouse\(event\)/]],
  ["markdown that transforms to nothing renders no line", "@earendil-works/pi-tui/dist/components/markdown.js", [/this\.options\.transform\?\.\(this\.text, contentWidth\) \?\? this\.text/, /if \(!text \|\| text\.trim\(\) === ""\)/]],
  ["pi resets every extension surface when a session is invalidated", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/setBeforeSessionInvalidate\(\(\) => \{\s*this\.resetExtensionUI\(\);/]],
  ["pi-subagents registers bg_wait and the supervisor channel without renderers of their own", "pi-subagents/src/runs/background/wait-tool.js", [/name: "bg_wait"/]],
  ["pi-web-search registers web_search with its own renderers", "pi-web-search/src/index.ts", [/const WEB_SEARCH_TOOL = "web_search"/, /name: WEB_SEARCH_TOOL/, /renderCall\(args, theme\)/]],
  ["pi-web-search posts to the openai-codex responses endpoint", "pi-web-search/src/providers/openai.ts", [/model\.api === "openai-codex-responses"/]],
  ["pi-web-search reports failures in details.error", "pi-web-search/src/utils.ts", [/details: \{ error: true \}/]],
  ["the SDK bash schema is a plain object with a properties map", "@earendil-works/pi-coding-agent/dist/core/tools/bash.js", [/parameters: bashSchema/]],
  ["an async launch answers with asyncId", "pi-subagents/src/runs/background/async-execution.js", [/asyncId: id/]],
  ["a completion spreads the result file (agent, success, state, durationMs) plus runId and each result's resolved status", "pi-subagents/src/runs/background/result-watcher.js", [/emit\(SUBAGENT_ASYNC_COMPLETE_EVENT, \{\s*\.\.\.data,\s*runId,/, /data\.success/, /data\.state === "stopped"/, /status: child\.status,/]],
  ["the result file's durationMs runs from launch to end", "pi-subagents/src/runs/background/subagent-runner.js", [/durationMs: runEndedAt - overallStartTime/]],
  ["Tab inside a command's arguments asks for forced file completion", "@earendil-works/pi-tui/dist/components/editor.js", [/handleTabCompletion\(\) \{/, /this\.forceFileAutocomplete\(true\);/]],
  ["Tab on a command name with no argument yet is pi's own unforced slash menu, ahead of the forced branch", "@earendil-works/pi-tui/dist/components/editor.js", [/if \(this\.isInSlashCommandContext\(beforeCursor\) && !beforeCursor\.trimStart\(\)\.includes\(" "\)\) \{\s*this\.handleSlashCommandCompletion\(\);/, /handleSlashCommandCompletion\(\) \{\s*this\.requestAutocomplete\(\{ force: false, explicitTab: true \}\);/]],
  ["typing opens the menu on [A-Za-z0-9.\\-_] only, and an open one re-asks itself", "@earendil-works/pi-tui/dist/components/editor.js", [/else if \(\/\[a-zA-Z0-9\.\\-_\]\/\.test\(char\)/, /updateAutocomplete\(\) \{[\s\S]{0,200}?this\.requestAutocomplete\(\{ force: this\.autocompleteState === "force", explicitTab: false \}\);/]],
  ["tryTriggerAutocomplete is the unforced request a typed character makes", "@earendil-works/pi-tui/dist/components/editor.js", [/tryTriggerAutocomplete\(explicitTab = false\) \{\s*this\.requestAutocomplete\(\{ force: false, explicitTab \}\);/]],
  ["pi-subagents renders its control notice through a registered message renderer, and the notice names the agent; goal missions deliver through the same path, which is why the row declines them by source", "pi-subagents/src/extension/index.js", [/registerMessageRenderer\(SUBAGENT_CONTROL_MESSAGE_TYPE,/, /details: \{ source: "goal", event: notice\.event,/]],
  ["the control notice's message type is the literal the renderer keys on, and the two early returns before delivery filter active_long_running and foreground only", "pi-subagents/src/extension/control-notices.js", [/SUBAGENT_CONTROL_MESSAGE_TYPE = "subagent_control_notice"/, /input\.details\.event\.type === "active_long_running"\)\s*return;/, /input\.details\.source === "foreground"/]],
  ["the control notice's details carry the event the row is built from, the idle signal keeps the wording noticeLine strips, and its reasons are idle, active_long_running or supervisor_request (no failure notice since 0.70.1)", "pi-subagents/src/runs/shared/subagent-control.js", [/`Subagent needs attention: \$\{event\.agent\}`/, /`Signal: \$\{event\.message\}`/, /`\$\{input\.agent\} needs attention \(no observed activity for \$\{elapsedSeconds\}s\)`/, /reason: input\.reason \?\? \(type === "active_long_running" \? "active_long_running" : "idle"\)/, /event\.reason === "supervisor_request"/]],
  ["a renderer that throws or answers nothing falls back to pi's own custom-message box", "@earendil-works/pi-coding-agent/dist/modes/interactive/components/custom-message.js", [/if \(this\.customRenderer\) \{\s*try \{[\s\S]{0,600}?catch \{/]],
  ["accepting an item with Tab closes the menu without re-opening it", "@earendil-works/pi-tui/dist/components/editor.js", [/kb\.matches\(data, "tui\.input\.tab"\)\) \{\s*const selected = this\.autocompleteList\.getSelectedItem\(\);[\s\S]{0,600}?this\.cancelAutocomplete\(\);/]],
  ["the built-in provider skips its slash branch when the request is forced", "@earendil-works/pi-tui/dist/autocomplete.js", [/if \(!options\.force && textBeforeCursor\.startsWith\("\/"\)\)/, /command\.getArgumentCompletions\(argumentText\)/]],
  ["pi clears the stacked autocomplete providers when a session is invalidated", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/this\.autocompleteProviderWrappers = \[\];/]],
  ["pi's own working row is a column in under a blank line, so the extension draws its own", "@earendil-works/pi-tui/dist/components/loader.js", [/super\("", 1, 0\)/, /return \["", \.\.\.super\.render\(width\)\]/]],
  ["an aboveEditor widget sits between the status container and the composer, under the block's one blank line, and a string widget takes pi's own indent", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/this\.widgetContainerAbove,\s*this\.editorContainer,/, /if \(leadingSpacer\) \{\s*container\.addChild\(new Spacer\(1\)\);/, /container\.addChild\(new Text\(line, 1, 0\)\)/]],
  ["every assistant draw goes through updateContent — the constructor, invalidate and the setters redraw the message it last kept — which draws only from the message it is handed", "@earendil-works/pi-coding-agent/dist/modes/interactive/components/assistant-message.js", [/if \(message\) \{\s*this\.updateContent\(message\);/, /invalidate\(\) \{\s*super\.invalidate\(\);\s*if \(this\.lastMessage\) \{\s*this\.updateContent\(this\.lastMessage\);/, /updateContent\(message, isStreaming = this\.isStreaming\) \{\s*this\.lastMessage = message;/, /const hasVisibleContent = message\.content\.some\(/]],
  ["interactive mode draws a streaming, settled and restored assistant message only through AssistantMessageComponent", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/this\.chatContainer\.addChild\(this\.streamingComponent\);\s*this\.streamingComponent\.updateContent\(this\.streamingMessage, true\);/, /case "message_update":\s*if \(this\.streamingComponent && event\.message\.role === "assistant"\) \{\s*this\.streamingMessage = event\.message;\s*this\.streamingComponent\.updateContent\(this\.streamingMessage, true\);/, /this\.streamingComponent\.updateContent\(this\.streamingMessage, false\);/, /case "assistant": \{\s*const assistantComponent = new AssistantMessageComponent\(message, /]],
  ["extensions see message_end before pi's listeners and before persistence, and a returned message is copied onto the one they were handed", "@earendil-works/pi-coding-agent/dist/core/agent-session.js", [/await this\._emitExtensionEvent\(event\);\s*this\._emit\(/, /this\._replaceMessageInPlace\(event\.message, normalized\);/, /if \(target === replacement\) \{\s*return;/]],
  ["result statuses are completed, failed, partial, paused, stopped or detached", "pi-subagents/src/shared/types.d.ts", [/ExecutionProjectionStatus = "completed" \| "failed" \| "partial" \| "paused" \| "stopped" \| "detached"/]],
  ["the stored openai-codex credential carries access, a ms-epoch expires and accountId — the fields the footer's usage read scopes in without refreshing", "@earendil-works/pi-ai/dist/auth/oauth/openai-codex.js", [/type: "oauth",\s*access: token\.access,\s*refresh: token\.refresh,\s*expires: token\.expires,\s*accountId,/, /expires: Date\.now\(\) \+ json\.expires_in \* 1000,/]],
  ["the completion notice goes through sendMessage as customType subagent-notify with a computed display flag — the literal the quiet flip keys on", "pi-subagents/src/runs/background/notify.js", [/customType: "subagent-notify",\s*content,\s*display,/]],
  ["pi draws a custom message only when its display flag is truthy, so a quiet send leaves no line and no spacer", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/case "custom": \{\s*if \(message\.display\) \{/]],
  ["pi-subagents reads mutationTools, acceptanceRole and acceptance from agent frontmatter — the keys the managed roles declare so renamed workspace tools count as mutation attempts and acceptance stays explicit per role", "pi-subagents/src/agents/agents.js", [/parseFrontmatterList\(frontmatter\.mutationTools\)/, /frontmatter\.acceptanceRole === "read-only" \|\| frontmatter\.acceptanceRole === "writer"/, /parseAgentAcceptanceFrontmatter\(frontmatter\.acceptance, localName\)/]],
  ["the long-running guard counts a call as a mutation attempt when its tool name is listed in mutationTools", "pi-subagents/src/runs/shared/long-running-guard.js", [/if \(mutationTools\?\.includes\(toolName\)\)\s*return true;/]],
  ["a self-shelled row that renders no lines takes no line at all, its spacer included", "@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js", [/this\.addChild\(new Spacer\(1\)\);/, /if \(contentLines\.length === 0 && this\.imageComponents\.length === 0\) \{\s*return \[\];/]],
  ["a custom entry's spacer is added only when its renderer answered with a component, and hasContent is exactly that", "@earendil-works/pi-coding-agent/dist/modes/interactive/components/custom-entry.js", [/hasContent\(\) \{\s*return this\.customComponent !== undefined;/, /if \(!component\) \{\s*return;\s*\}\s*this\.customComponent = component;\s*this\.addChild\(new Spacer\(1\)\);/]],
  ["a custom entry that answered with no component is never added to the chat", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/addCustomEntryToChat\(entry\) \{[\s\S]{0,300}?if \(!component\.hasContent\(\)\) \{\s*return;\s*\}/]],
  ["the runner mirrors the child's pi events into events.jsonl annotated as the child's, dropping only message_update — the records the fleet peek replays", "pi-subagents/src/runs/background/run-child-session.js", [/subagentSource: "child"/, /subagentRunId: input\.childEventContext\.runId/, /event\.type !== "message_update"/]],
  ["the events log stops at a byte cap and marks the truncation once", "pi-subagents/src/runs/background/subagent-runner.js", [/TRUNCATED_EVENT_TYPE = "subagent\.events\.truncated"/, /state\.diagnosticsTruncated = true;/]],
  ["a steer's delivery outcome is logged as delivered, queued or failed", "pi-subagents/src/runs/background/subagent-runner.js", [/emitSteeringEvent\("subagent\.steer\.delivered"/, /emitSteeringEvent\("subagent\.steer\.queued"/, /emitSteeringEvent\("subagent\.steer\.failed"/]],
  ["a steer reaches the child as a user message opening with the orchestrator prefix and closing with the guidance line", "pi-subagents/src/runs/shared/subagent-prompt-runtime.js", [/"Mid-run steering from the parent orchestrator:"/, /"Queued follow-up from the parent orchestrator:"/, /"Incorporate this guidance at the next safe point\./]],
  ["the steer RPC waits up to three seconds for a receipt, longer than the fleet poll's timeout", "pi-subagents/src/runs/foreground/subagent-executor.js", [/waitForSteeringAction\(omitUndefinedProperties\(\{ asyncDir, sourceRunId: run\.id, requestId, timeoutMs: 3_000/]],
  ["fleet rows use opaque generated keys and an active step's agent and start time, falling back to the job's time", "pi-subagents/src/extension/rpc.js", [/let key = keyState\.keys\.get\(candidate\.internalKey\);\s*if \(!key\) \{\s*key = `fleet-\$\{\+\+keyState\.next\}`;\s*keyState\.keys\.set\(candidate\.internalKey, key\);\s*\}/, /if \(!activeState\(step\.status\)\)\s*continue;/, /agent: step\.agent,/, /startedAt: step\.startedAt \?\? startedAt,/, /const startedAt = job\.startedAt \?\? job\.updatedAt;/]],
  ["async status projects raw run and immediate step labels and timestamps with active state names", "pi-subagents/src/runs/shared/async-status-projection.js", [/function projectStep\(step, index, depth, ctx\) \{\s*const state = normalizeState\(step\.status\);\s*const startedAt = publicTime\(step\.startedAt\);/, /label: publicText\("label" in step && step\.label \? step\.label : step\.agent,/, /function projectRun\(job, ctx, depth, childrenByParent, liveRoots, omitSteps = false\) \{\s*const state = normalizeState\(job\.status\);\s*const startedAt = publicTime\(job\.startedAt\);/, /label: labelForAgents\(job\.agents, job\.mode \?\? "subagent"/, /const stepChildren = steps\.map\(\(step, index\) => projectLane\(step, step\.index \?\? index\)\)/]],
  ["a launch answers with its run id and artifact directory together", "pi-subagents/src/runs/background/async-execution.js", [/details: \{ mode: "single", runId: id, results: \[\], asyncId: id, asyncDir,/]],
  // /usage's Subagents row (docs/pi-design.md rule 3).
  ["ping advertises the cost RPC at report version 1, whose report carries childTotal, children and unresolvedAsyncChildren", "pi-subagents/src/extension/rpc.js", [/cost: \{ version: SUBAGENT_COST_REPORT_VERSION \},/, /if \(request\.method === "cost"\) \{[\s\S]{0,600}?return collectSubagentCost\(ctx,/]],
  ["the cost report's version and shape", "pi-subagents/src/slash/subagent-cost.js", [/export const SUBAGENT_COST_REPORT_VERSION = 1;/, /return \{ version: SUBAGENT_COST_REPORT_VERSION, parent, children, childTotal, total, unresolvedAsyncChildren \};/]],
  // The managed launch excludes the loader (dot_zshrc.tmpl); these guards are what make that leave `subagent` alone.
  ["pi-subagents' lazy loader stands down when the loader tool is excluded", "pi-subagents/src/extension/tool-activation.js", [/const LOADER_NAME = "subagents_enable";/, /pi\.on\("before_agent_start", \(event\) => \{\s*const available = pi\.getAllTools\(\);\s*if \(!Array\.isArray\(available\) \|\| !available\.some\(\(tool\) => tool\.name === LOADER_NAME\)\)\s*return;/]],
  // The keys the managed extensions/subagent/config.json sets.
  ["pi-subagents reads its config from extensions/subagent/config.json under pi's agent dir", "pi-subagents/src/extension/config.js", [/return path\.join\(getAgentDir\(\), "extensions", "subagent", "config\.json"\);/]],
  ["fleetView and asyncWidget are on unless set to false", "pi-subagents/src/extension/index.js", [/const fleetViewEnabled = config\.fleetView !== false;/, /const asyncWidgetEnabled = config\.asyncWidget !== false;/]],
  ["toolDescriptionMode takes full, compact or custom", "pi-subagents/src/extension/tool-description.js", [/const mode = config\.toolDescriptionMode;/, /expected "full", "compact", or "custom"\./]],
  ["intercomBridge.mode off deactivates the bridge", "pi-subagents/src/intercom/intercom-bridge.js", [/if \(value === "off" \|\| value === "always" \|\| value === "fork-only"\)\s*return value;/, /if \(mode === "off"\)\s*return "bridge mode is off";/]],
  ["missions.enabled false stops automatic mission creation", "pi-subagents/src/missions/lifecycle.js", [/const missionsEnabled = input\.config\?\.enabled !== false;/]],
  ["the executor hands config.missions to the mission launch", "pi-subagents/src/runs/foreground/subagent-executor.js", [/missionBinding = prepareMissionLaunch\(\{[\s\S]{0,200}?\.\.\.\(deps\.config\.missions \? \{ config: deps\.config\.missions \} : \{\}\),/]],
  ["scheduledRuns.enabled false disables scheduled runs", "pi-subagents/src/runs/background/scheduled-runs.js", [/return config\.scheduledRuns\?\.enabled !== false;/]],
  ["a container dispatches a mouse event to whichever child sits under event.y", "@earendil-works/pi-tui/dist/tui.js", [/for \(const \{ component: child, height: childHeight \} of mouseChildren\) \{\s*if \(event\.y >= childY && event\.y < childY \+ childHeight\) \{\s*const result = dispatchMouseEvent\(child, \{/]],
  ["pi wires the custom editor's submit callback to its own default editor's, so a subclass has to intercept the property itself", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/newEditor\.onSubmit = this\.defaultEditor\.onSubmit;/]],
  ["pi's ! branch strips one or two leading characters before this extension ever sees the text", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/const isExcluded = text\.startsWith\("!!"\);/, /const command = isExcluded \? text\.slice\(2\)\.trim\(\) : text\.slice\(1\)\.trim\(\);/]],
  ["pi-tui's Editor declares onSubmit as a bare class field (an own property the caret deletes to reach its accessor) and calls it from submitValue after clearing its own state", "@earendil-works/pi-tui/dist/components/editor.js", [/^\s*onSubmit;$/m, /this\.state = \{ lines: \[""\], cursorLine: 0, cursorCol: 0 \};/, /if \(this\.onSubmit\)\s*this\.onSubmit\(result\);/]],
  ["pi-tui's Editor declares addToHistory as a public method a subclass can call directly", "@earendil-works/pi-tui/dist/components/editor.d.ts", [/addToHistory\(text: string\): void;/]],
  ["bashExecutionToText's literal shape, which contextText mirrors for the `!` row and its recorded context text", "@earendil-works/pi-coding-agent/dist/core/messages.js", [/let text = `Ran \\`\$\{msg\.command\}\\`\\n`;/, /text \+= "\(no output\)";/, /text \+= "\\n\\n\(command cancelled\)";/, /text \+= `\\n\\nCommand exited with code \$\{msg\.exitCode\}`;/]],
  ["a triggerTurn: false custom message sent while the agent streams is deferred to the end of the turn rather than appended between an in-flight tool call and its result", "@earendil-works/pi-coding-agent/dist/core/agent-session.js", [/else if \(this\.isStreaming\) \{[\s\S]{0,400}?this\._pendingCustomMessages\.push\(appMessage\);/]],
  ["Alt+Enter on a non-streaming session acts like plain Enter, calling the editor's own onSubmit directly", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/else if \(this\.editor\.onSubmit\) \{\s*this\.editor\.setText\(""\);\s*this\.editor\.onSubmit\(text\);/]],
  ["ExtensionUIContext declares input(title, placeholder?, opts?) resolving to string or undefined, the call plan approval's feedback prompt makes outside the TUI", "@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts", [/input\(title: string, placeholder\?: string, opts\?: ExtensionUIDialogOptions\): Promise<string \| undefined>;/]],
  ["ExtensionContext declares isIdle, the signal this editor's Esc precedence and the shell runner's abortable() gate on", "@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts", [/isIdle\(\): boolean;/]],
  ["pi-tui's main-screen renderer throws when a rendered line's visible width exceeds the terminal's, which is why every row here wraps to width", "@earendil-works/pi-tui/dist/tui-main-screen.js", [/`Rendered line \$\{i\} exceeds terminal width \(\$\{visibleWidth\(line\)\} > \$\{width\}\)\.`/]],
  // The shell runner's shellPath/shellCommandPrefix wiring (docs/pi-coupling.md's
  // owned `!` block): the bash tool's own prefix composition, the lazy shell
  // resolution createLocalBashOperations wraps, SettingsManager's shell getters,
  // and the model's workspace_bash tool staying on bash regardless of the
  // setting.
  ["the bash tool joins commandPrefix and command with a newline before spawning, the join the shell runner keeps, with its command wrapped in an eval", "@earendil-works/pi-coding-agent/dist/core/tools/bash.js", [/const resolvedCommand = commandPrefix \? `\$\{commandPrefix\}\\n\$\{command\}` : command;/]],
  ["createLocalBashOperations resolves shellPath through getShellConfig lazily, at exec time, not at construction", "@earendil-works/pi-coding-agent/dist/core/tools/bash.js", [/export function createLocalBashOperations\(options\) \{\s*return createLocalShellOperations\("bash", \(\) => getShellConfig\(options\?\.shellPath\)\);/]],
  ["SettingsManager exposes getShellPath and getShellCommandPrefix", "@earendil-works/pi-coding-agent/dist/core/settings-manager.d.ts", [/getShellPath\(\): string \| undefined;/, /getShellCommandPrefix\(\): string \| undefined;/]],
  ["SettingsManager.create defaults projectTrusted to true and skips the project file when it is false, so the shell settings read must pass the session's trust decision", "@earendil-works/pi-coding-agent/dist/core/settings-manager.js", [/const projectTrusted = options\.projectTrusted \?\? true;/, /if \(scope === "project" && !projectTrusted\) \{/]],
  ["ExtensionContext declares isProjectTrusted, the decision the shell settings read is gated on", "@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts", [/isProjectTrusted\(\): boolean;/]],
  ["pi's grep runs rg --hidden and forwards glob as one --glob argument, which the bridge guard owns to exclude deny names", "@earendil-works/pi-coding-agent/dist/core/tools/grep.js", [/const args = \["--json", "--line-number", "--color=never", "--hidden"\];/, /args\.push\("--glob", glob\);/]],
  ["srt exports CLAUDE_CODE_TMPDIR as the wrapped command's TMPDIR", "@anthropic-ai/sandbox-runtime/dist/sandbox/sandbox-utils.js", [/export function generateProxyEnvVars\(/, /const tmpdir = process\.env\.CLAUDE_CODE_TMPDIR \|\|/, /envVars\.push\(`TMPDIR=\$\{tmpdir\}`\)/]],
  ["ExtensionContext carries a ModelRegistry", "@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts", [/modelRegistry: ModelRegistry;/]],
  ["ModelRegistry declares the find, isUsingOAuth, getAvailable and complete members the workflow calls", "@earendil-works/pi-coding-agent/dist/core/model-registry.d.ts", [/find\(provider: string, modelId: string\): Model<Api> \| undefined;/, /isUsingOAuth\(model: Model<Api>\): boolean;/, /getAvailable\(\): Model<Api>\[\];/, /complete<TApi extends Api>\(model: Model<TApi>, context: Context, options\?: ModelsApiStreamOptions<TApi>\): Promise<AssistantMessage>;/]],
  ["stream options accept transport \"sse\" and a sessionId, which the approval and web-fetch completions pass", "@earendil-works/pi-ai/dist/types.d.ts", [/export type Transport = "sse" \|/, /transport\?: Transport;/, /sessionId\?: string;/]],
  ["an MCP server's exposure and per-tool toolExposure take the McpExposure union, hidden included", "@earendil-works/pi-coding-agent/dist/core/mcp-servers.d.ts", [/export type McpExposure = "codemode" \| "codemode-deferred" \| "deferred" \| "direct" \| "hidden";/, /exposure\?: McpExposure;/, /toolExposure\?: Record<string, McpExposure>;/]],
  ["context files land in the project_context section as <project_instructions path=...> blocks, and skills in its own section, the split /usage reads", "@earendil-works/pi-coding-agent/dist/core/system-prompt.js", [/`<project_instructions path="\$\{path\}">\\n\$\{content\}\\n<\/project_instructions>`/, /promptSections\.project_context = renderProjectContext\(contextFiles\);/, /promptSections\.skills = skillsPrompt;/, /sections\[name\] = `<\$\{name\}>\\n\$\{content\}\\n<\/\$\{name\}>`;/]],
  ["pi-subagents reads inheritProjectContext, inheritGlobalContext and allowNestedSubagents from agent frontmatter as \"true\"/\"false\" strings", "pi-subagents/src/agents/agents.js", [/const inheritProjectContext = frontmatter\.inheritProjectContext === "true"\s*\? true\s*: frontmatter\.inheritProjectContext === "false"\s*\? false/, /const inheritGlobalContext = frontmatter\.inheritGlobalContext === "true";/, /if \(frontmatter\.allowNestedSubagents === "true"\)\s*allowNestedSubagents = true;\s*else if \(frontmatter\.allowNestedSubagents === "false"\)\s*allowNestedSubagents = false;/]],
  ["pi renames <cwd>/.pi/commands to .pi/prompts at startup when prompts is absent, which the bridge refuses ahead of", "@earendil-works/pi-coding-agent/dist/migrations.js", [/const commandsDir = join\(baseDir, "commands"\);\s*const promptsDir = join\(baseDir, "prompts"\);\s*if \(existsSync\(commandsDir\) && !existsSync\(promptsDir\)\) \{\s*try \{\s*renameSync\(commandsDir, promptsDir\);/, /const projectDir = join\(cwd, CONFIG_DIR_NAME\);/, /migrateCommandsToPrompts\(projectDir, "Project"\);/]],
  // GUIDELINES in index.mjs is these, spelled with the workspace_* names.
  ["the built-in read tool's guideline", "@earendil-works/pi-coding-agent/dist/core/tools/read.js", [/guidelines: \["Use read to examine files instead of cat or sed\."\],/]],
  ["the built-in write tool's guideline", "@earendil-works/pi-coding-agent/dist/core/tools/write.js", [/guidelines: \["Use write only for new files or complete rewrites\."\],/]],
  ["the built-in edit tool's guidelines", "@earendil-works/pi-coding-agent/dist/core/tools/edit.js", [/guidelines: \[\s*"Use edit for precise changes \(edits\[\]\.oldText must match exactly\)",\s*"When changing multiple separate locations in one file, use one edit call with multiple entries in edits\[\] instead of multiple edit calls",\s*"Each edits\[\]\.oldText is matched against the original file, not after earlier edits are applied\. Do not emit overlapping or nested edits\. Merge nearby changes into one edit\.",\s*"Keep edits\[\]\.oldText as small as possible while still being unique in the file\. Do not pad with large unchanged regions\.",\s*\],/]],
  // The bridge guard rewrites input.path to an absolute path it vetted, relying on these.
  ["normalizePath folds unicode spaces, strips a leading @ and converts file:// URLs, and resolvePath leaves an absolute path as is", "@earendil-works/pi-coding-agent/dist/utils/paths.js", [/normalized = normalized\.replace\(UNICODE_SPACES, " "\);/, /if \(options\.stripAtPrefix && normalized\.startsWith\("@"\)\) \{\s*normalized = normalized\.slice\(1\);/, /if \(\/\^file:\\\/\\\/\/\.test\(normalized\)\) \{\s*return fileURLToPath\(normalized\);/, /return isAbsolute\(normalized\) \? nodeResolvePath\(normalized\) :/]],
  ["tools resolve paths through resolveToCwd, and resolveReadPathAsync returns an existing path before trying variants", "@earendil-works/pi-coding-agent/dist/core/tools/path-utils.js", [/export function resolveToCwd\(filePath, cwd\) \{\s*return resolvePath\(filePath, cwd, \{ normalizeUnicodeSpaces: true, stripAtPrefix: true \}\);/, /export async function resolveReadPathAsync\(filePath, cwd\) \{\s*const resolved = resolveToCwd\(filePath, cwd\);\s*if \(await pathExists\(resolved\)\) \{\s*return resolved;\s*\}/]],
  // Pi's extension loader aliases these to its own copies, so the root pins must match for tests to run what pi runs.
  ["the root typebox and jiti pins equal pi-coding-agent's declared versions", "@earendil-works/pi-coding-agent/package.json", ["typebox", "jiti"].map(name => new RegExp(`"${name}": "${JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")).dependencies[name].replaceAll(".", "\\.")}"`))],
];
for (const [claim, file, patterns] of pins) {
  test(`pin: ${claim} (${file})`, () => {
    const text = readFileSync(join(nodeModules, file), "utf8");
    for (const pattern of patterns) assert.match(text, pattern);
  });
}

// API calls that are not events (pi.on is checked above): each `.ui.<member>` and
// `pi.<member>(` in the sources must stay a declared member of the exported
// extension declarations (method, generic method, or property). `this.ui` is
// InteractiveMode's TUI inside patched host methods, not the extension UI.
const usedApis = new Set(sourceFiles.flatMap(file => {
  const text = readFileSync(join(dir, file), "utf8");
  return [
    ...[...text.matchAll(/(?<!\bthis)\.ui\.([A-Za-z_$][\w$]*)/g)].map(m => m[1]),
    ...[...text.matchAll(/\bpi\.([A-Za-z_$][\w$]*)\(/g)].map(m => m[1]).filter(name => name !== "on"),
  ];
}));
// option and object keys the scan cannot see
for (const key of ["getArgumentCompletions", "placement"]) usedApis.add(key);
for (const api of usedApis) {
  test(`${api} is a declared extension API`, () => {
    assert.match(extensionDeclarations(), new RegExp(`\\b${api}\\b\\s*[<(?:]`), `${api} is not declared`);
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

// The model's workspace_bash tool stays on bash regardless of shellPath/
// shellCommandPrefix (docs/pi-coupling.md's owned `!` block): only the
// user-typed `!`/`!!` runner honours pi's shell settings.
test("ops-worker's bash spawn is untouched by pi's shell settings", () => {
  assert.match(readFileSync(join(dir, "ops-worker.mjs"), "utf8"), /spawn\("bash", \["-c", command\]/);
});
