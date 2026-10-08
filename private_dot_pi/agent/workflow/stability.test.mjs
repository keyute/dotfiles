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

// The event and API reference left docs/extensions.md
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

// Source pins for the undocumented behaviour the transcript rows lean on
// (docs/pi-design.md rule 7). Each names the text the code assumes; a pin bump
// that rewrites it fails here before the row does on screen.
const pins = [
  ["Codex SSE forwards response headers through onResponse and raw SSE and reused WS events through the same pre-normalization callback", "@earendil-works/pi-ai/dist/api/openai-codex-responses.js", [/await options\?\.onResponse\?\.\(\{ status: response\.status, headers: headersToRecord\(response\.headers\) \}, model\);/, /async function processStream\([^\n]+\) \{\s*await processResponsesStream\(mapCodexEvents\(parseSSE\(response, options\?\.signal\), output, model, options\?\.onProviderStreamEvent\)/, /async function\* mapCodexEvents\(events, output, model, onProviderStreamEvent\) \{\s*for await \(const event of events\) \{\s*try \{\s*await onProviderStreamEvent\?\.\(event, model\);[\s\S]{0,700}?const type = typeof event\.type === "string" \? event\.type : undefined;/, /async function processWebSocketStream\([^\n]+\) \{\s*const \{ socket, entry, reused, release \} = await acquireWebSocket\([^\n]+\);[\s\S]{0,2500}?processResponsesStream\(startWebSocketOutputOnFirstEvent\(mapCodexEvents\(parseWebSocket\(socket, options\?\.signal, idleTimeoutMs\), output, model, options\?\.onProviderStreamEvent\)/]],
  ["SDK forwards provider response headers and raw provider events into extension events", "@earendil-works/pi-coding-agent/dist/core/sdk.js", [/type: "after_provider_response",\s*status: response\.status,\s*headers: response\.headers,/, /type: "provider_stream_event",\s*provider: model\.provider,\s*api: model\.api,\s*model: model\.id,/, /data,\s*type: "provider_stream_event",/]],
  ["bundled extension loading supplies host virtual modules through Jiti", "@earendil-works/pi-coding-agent/dist/core/extensions/loader.js", [/usesEmbeddedModules = isBunBinary \|\| isNodeSeaBinary \|\| isBundledNode/, /virtualModules: await getVirtualModules\(\), tryNative: false/, /moduleCache: false/, /await jiti\.import\(extensionPath, \{ default: true \}\)/]],
  ["pending input is rebuilt from Pi's combined session/compaction queues and actual dequeue binding", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/updatePendingMessagesDisplay\(\) \{\s*this\.pendingMessagesContainer\.clear\(\);/, /const \{ steering: steeringMessages, followUp: followUpMessages \} = this\.getAllQueuedMessages\(\);/, /this\.session\.getSteeringMessages\(\)/, /this\.session\.getFollowUpMessages\(\)/, /this\.compactionQueuedMessages\.filter\(\(msg\) => msg\.mode === "steer"\)/, /this\.compactionQueuedMessages\.filter\(\(msg\) => msg\.mode === "followUp"\)/, /this\.getAppKeyDisplay\("app\.message\.dequeue"\)/]],
  ["send-now can hold the host's compaction flush without removing pending input", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/async flushCompactionQueue\(options\) \{/, /void this\.flushCompactionQueue\(\{ willRetry: event\.willRetry \}\);/, /this\.compactionQueuedMessages = \[\];/, /isExtensionCommand\(text\) \{/]],
  ["send-now abort awaits idle without using the UI's clear-and-restore path", "@earendil-works/pi-coding-agent/dist/core/agent-session.js", [/async abort\(\) \{[\s\S]{0,500}?this\.agent\.abort\(\);\s*await this\.waitForIdle\(\);/, /async _queueUserInput\(text, images, behavior, source\)/, /async _runAgentPrompt\(messages\)/]],
  ["an empty-prompt run polls steering before its first response and follow-ups after the inner task loop", "@earendil-works/pi-agent-core/dist/agent-loop.js", [/let pendingMessages = \(await config\.getSteeringMessages\?\.\(\)\) \|\| \[\];/, /for \(const message of declareToolChanges\(currentContext, \[\.\.\.preparedMessages, \.\.\.pendingMessages\]\)\)/, /const followUpMessages = \(await config\.getFollowUpMessages\?\.\(\)\) \|\| \[\];/]],
  ["custom editors inherit the native app-action handlers, including streaming follow-up submission", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/for \(const \[action, handler\] of this\.defaultEditor\.actionHandlers\) \{\s*customEditor\.actionHandlers\.set\(action, handler\);/, /this\.defaultEditor\.onAction\("app\.message\.followUp",/, /await this\.session\.prompt\(text, \{ streamingBehavior: "followUp" \}\);/]],
  ["shell follow-up submission can reuse native paste expansion, autocomplete cleanup and editor clearing", "@earendil-works/pi-tui/dist/components/editor.js", [/submitValue\(\) \{\s*this\.cancelAutocomplete\(\);\s*const result = this\.expandPasteMarkers\(this\.state\.lines\.join\("\\n"\)\)\.trim\(\);/, /getExpandedText\(\) \{\s*return this\.expandPasteMarkers\(this\.state\.lines\.join\("\\n"\)\);/]],
  ["display-only custom entries emit immediately and mount ahead of a streaming assistant component", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/case "entry_appended":/, /this\.addCustomEntryToChat\(event\.entry\);/, /const streamingIndex = this\.chatContainer\.children\.indexOf\(this\.streamingComponent\);\s*if \(streamingIndex >= 0\) \{\s*this\.chatContainer\.children\.splice\(streamingIndex, 0, component\);/]],
  ["the streaming component, and with it that splice, lasts until the assistant's message_end or agent_end — where installFolding drops the reply's boundary", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/case "message_end":[\s\S]{0,200}?if \(this\.streamingComponent && event\.message\.role === "assistant"\) \{[\s\S]{0,2500}?this\.streamingComponent = undefined;/, /case "agent_end":[\s\S]{0,300}?if \(this\.streamingComponent\) \{\s*this\.chatContainer\.removeChild\(this\.streamingComponent\);\s*this\.streamingComponent = undefined;/]],
  ["extensions see session_compact before compaction_end, on the manual and the automatic path", "@earendil-works/pi-coding-agent/dist/core/agent-session.js", [/type: "session_compact",\s*compactionEntry: savedCompactionEntry,\s*fromExtension,\s*reason: "manual",[\s\S]{0,700}?this\._emit\(\{\s*type: "compaction_end",\s*reason: "manual",/, /type: "session_compact",\s*compactionEntry: savedCompactionEntry,\s*fromExtension,\s*reason,\s*willRetry,\s*\}\);\s*\}[\s\S]{0,300}?this\._emit\(\{ type: "compaction_end", reason, result, aborted: false, willRetry \}\);/]],
  ["compaction_end rebuilds the chat from the kept context entries and appends the summary below them", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/case "compaction_end": \{[\s\S]{0,1000}?const entries = this\.sessionManager\.buildContextEntries\(\);[\s\S]{0,300}?this\.chatContainer\.clear\(\);[\s\S]{0,200}?this\.renderSessionEntries\(entries\.slice\(1\)\);\s*this\.addMessageToChat\(createCompactionSummaryMessage\(/]],
  ["appendEntry sends a custom-entry event without appending model context", "@earendil-works/pi-coding-agent/dist/core/agent-session.js", [/appendEntry: \(customType, data\) => \{\s*const entryId = this\.sessionManager\.appendCustomEntry\(customType, data\);\s*const entry = this\.sessionManager\.getEntry\(entryId\);\s*if \(entry\) \{\s*this\._emit\(\{ type: "entry_appended", entry \}\);\s*\}\s*\},/]],
  ["custom-entry renderers rebuild on Ctrl+O and theme invalidation while retaining the same entry object", "@earendil-works/pi-coding-agent/dist/modes/interactive/components/custom-entry.js", [/setExpanded\(expanded\) \{\s*if \(this\._expanded !== expanded\) \{\s*this\._expanded = expanded;\s*this\.rebuild\(\);/, /invalidate\(\) \{\s*super\.invalidate\(\);\s*this\.rebuild\(\);/, /this\.renderer\(this\.entry, \{ expanded: this\._expanded \}, theme\)/]],
  ["native skill rendering and restored editor history both use the same getUserMessageText result, and the extension starts before initial rendering", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/getUserMessageText\(message\) \{/, /const textContent = this\.getUserMessageText\(message\);[\s\S]{0,500}?const skillBlock = parseSkillBlock\(textContent\);/, /new UserMessageComponent\(textContent, this\.getMarkdownThemeWithSettings\(\), this\.outputPad, this\.getMarkdownTransformers\(\)\)/, /this\.editor\.addToHistory\?\.\(textContent\);/, /await this\.rebindCurrentSession\(\);[\s\S]{0,100}?this\.renderInitialMessages\(\);/, /this\.renderSessionEntries\(entries, \{\s*updateFooter: true,\s*populateHistory: true,/]],
  ["pi's <skills> section renders only when a tool named read or bash is declared or selected, so with only workspace_* tools selected the workflow's before_agent_start hook lists them itself", "@earendil-works/pi-coding-agent/dist/core/system-prompt.js", [/const readers = \["read", "bash"\];\s*const skillFileReadTool = readers\.find\(\(tool\) => declaredTools\.includes\(tool\)\) \?\?\s*\(readers\.some\(\(tool\) => selectedTools\.includes\(tool\)\) \? "indirect" : undefined\);/, /if \(skillFileReadTool && skills\.length > 0\) \{/]],
  ["formatSkillsForPrompt names the read tool only for \"read\"", "@earendil-works/pi-coding-agent/dist/core/skills.js", [/fileReadTool === "read"\s*\? "Use the read tool to load a skill's file when the task matches its description\."/]],
  ["the user box sends transformed markdown through native wrapping and userMessageText while retaining its shade", "@earendil-works/pi-coding-agent/dist/modes/interactive/components/user-message.js", [/theme\.bg\("userMessageBg", content\)/, /theme\.fg\("userMessageText", content\)/, /transform: createMarkdownTransform\("user", false, this\.markdownTransformers\)/]],
  ["peek shapes the native editor's border-delimited content before the unshaded autocomplete list, retaining its cursor marker when clipped", "@earendil-works/pi-tui/dist/components/editor.js", [/result\.push\(this\.renderTopBorder\(width, this\.scrollOffset\)\)/, /result\.push\(this\.renderBottomBorder\(width, linesBelow\)\)/, /const autocompleteResult = this\.autocompleteList\.render\(contentWidth\)/, /const marker = emitCursorMarker \? CURSOR_MARKER : ""/]],
  ["native slash-menu Enter accepts then submits, whereas Tab only accepts", "@earendil-works/pi-tui/dist/components/editor.js", [/if \(this\.autocompletePrefix\.startsWith\("\/"\)\) \{\s*this\.cancelAutocomplete\(\);\s*\/\/ Fall through to submit/, /kb\.matches\(data, "tui\.input\.tab"\)\) \{[\s\S]{0,800}?return;/]],
  ["shell layout and navigation use the same native editor state without changing submission or undo", "@earendil-works/pi-tui/dist/components/editor.js", [/layoutText\(contentWidth\)/, /buildVisualLineMap\(width\)/, /this\.state\.lines\[i\]/, /logicalLine: i,/, /startCol: chunk\.startIndex/, /handleBackspace\(\)/, /this\.state\.cursorCol === 0/, /navigateHistory\(direction\)/, /pushUndoSnapshot\(\)/, /this\.undoStack\.push\(\{ state: this\.state,/, /this\.expandPasteMarkers\(this\.state\.lines\.join\("\\n"\)\)\.trim\(\)/]],
  ["pi-subagents registers `subagent` with its own renderers through the API it is handed", "pi-subagents/src/extension/index.js", [/name: "subagent"/, /renderCall\(args, theme\)/, /renderResult\(result, options, theme, context\)/, /pi\.registerTool\(tool\)/]],
  ["an MCP tool is named mcp__<server>__<tool> (sanitised to [A-Za-z0-9_], hash-shortened) and labelled <server>/<tool>, the identity plugin-api reads and pi-roles' mcp__ tool names rely on", "@earendil-works/pi-coding-agent/dist/extensions/mcp/tools.js", [/const name = `mcp__\$\{server\}__\$\{tool\}`\.replace\(\/\[\^A-Za-z0-9_\]\/g, "_"\);/, /const label = `\$\{server\}\/\$\{tool\.name\}`;\s*return \{\s*name: options\.name,\s*label,/]],
  // The MCP gate checks a server by name only, so the managed config must be the sole source of servers.
  ["loadConfig replaces pi's mcp.json read and updateConfig is the only write-back, both typed options", "@earendil-works/pi-coding-agent/dist/extensions/mcp/index.d.ts", [/\/\*\* Defaults to reading `mcp\.json` from the agent directory and the trusted project\. \*\/\s*loadConfig\?: \(ctx: ExtensionContext\) => LoadedMcpConfig;/, /updateConfig\?: \(entry: McpServerEntry, patch: McpServerConfigPatch\) => void;/]],
  ["/mcp never saves an extension-scoped server's changes", "@earendil-works/pi-coding-agent/dist/extensions/mcp/config.d.ts", [/`pi\.registerMcpServer\(\)`\. Changes to extension servers are not saved\.\s*\*\/\s*scope\?: "global" \| "project" \| "extension";/]],
  ["the bash tool's empty-output stand-in and exit-status trailer", "@earendil-works/pi-coding-agent/dist/core/tools/bash.js", [/"\(no output\)"/, /`Command exited with code \$\{exitCode\}`/]],
  ["a click toggles one row's own expanded flag, after the rendered component has declined it", "@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js", [/createResultRegion\(/, /this\.setExpanded\(!this\.expanded\)/, /y: event\.y - 1,/]],
  ["a mouse region asks its child before its own handler", "@earendil-works/pi-tui/dist/components/mouse-region.js", [/childResult \?\? this\.onMouse\(event\)/]],
  ["pi-subagents registers bg_wait and the supervisor channel without renderers of their own", "pi-subagents/src/runs/background/wait-tool.js", [/name: "bg_wait"/]],
  ["pi-web-search registers web_search with its own renderers", "pi-web-search/src/index.ts", [/const WEB_SEARCH_TOOL = "web_search"/, /name: WEB_SEARCH_TOOL/, /renderCall\(args, theme\)/]],
  ["pi-web-search reports failures in details.error", "pi-web-search/src/utils.ts", [/details: \{ error: true \}/]],
  ["the SDK bash schema is a plain object with a properties map", "@earendil-works/pi-coding-agent/dist/core/tools/bash.js", [/parameters: bashSchema/]],
  ["a completion spreads the result file (agent, success, state, durationMs) plus runId and each result's resolved status", "pi-subagents/src/runs/background/result-watcher.js", [/emit\(SUBAGENT_ASYNC_COMPLETE_EVENT, \{\s*\.\.\.data,\s*runId,/, /data\.success/, /data\.state === "stopped"/, /status: child\.status,/]],
  ["the result file's durationMs runs from launch to end", "pi-subagents/src/runs/background/subagent-runner.js", [/durationMs: runEndedAt - overallStartTime/]],
  ["Tab inside a command's arguments asks for forced file completion", "@earendil-works/pi-tui/dist/components/editor.js", [/handleTabCompletion\(\) \{/, /this\.forceFileAutocomplete\(true\);/]],
  ["Tab on a command name with no argument yet is pi's own unforced slash menu, ahead of the forced branch", "@earendil-works/pi-tui/dist/components/editor.js", [/if \(this\.isInSlashCommandContext\(beforeCursor\) && !beforeCursor\.trimStart\(\)\.includes\(" "\)\) \{\s*this\.handleSlashCommandCompletion\(\);/, /handleSlashCommandCompletion\(\) \{\s*this\.requestAutocomplete\(\{ force: false, explicitTab: true \}\);/]],
  ["typing opens the menu on [A-Za-z0-9.\\-_] only, and an open one re-asks itself", "@earendil-works/pi-tui/dist/components/editor.js", [/else if \(\/\[a-zA-Z0-9\.\\-_\]\/\.test\(char\)/, /updateAutocomplete\(\) \{[\s\S]{0,200}?this\.requestAutocomplete\(\{ force: this\.autocompleteState === "force", explicitTab: false \}\);/]],
  ["tryTriggerAutocomplete is the unforced request a typed character makes", "@earendil-works/pi-tui/dist/components/editor.js", [/tryTriggerAutocomplete\(explicitTab = false\) \{\s*this\.requestAutocomplete\(\{ force: false, explicitTab \}\);/]],
  ["pi-subagents renders its control notice through a registered message renderer, and the notice names the agent", "pi-subagents/src/extension/index.js", [/registerMessageRenderer\(SUBAGENT_CONTROL_MESSAGE_TYPE,/]],
  ["the control notice's message type is the literal the renderer keys on, and the two early returns before delivery filter active_long_running and foreground only", "pi-subagents/src/extension/control-notices.js", [/SUBAGENT_CONTROL_MESSAGE_TYPE = "subagent_control_notice"/, /input\.details\.event\.type === "active_long_running"\)\s*return;/, /input\.details\.source === "foreground"/]],
  ["the control notice's details carry the event the row is built from, and the idle signal keeps the wording noticeLine strips", "pi-subagents/src/runs/shared/subagent-control.js", [/`\$\{title\}: \$\{event\.agent\}`/, /\.\.\.head\("Subagent needs attention"\)/, /`Signal: \$\{event\.message\}`/, /`\$\{input\.agent\} needs attention \(no observed activity for \$\{elapsedSeconds\}s\)`/, /reason: input\.reason \?\? \(type === "active_long_running" \? "active_long_running" : "idle"\)/, /event\.reason === "supervisor_request"/]],
  ["accepting an item with Tab closes the menu without re-opening it", "@earendil-works/pi-tui/dist/components/editor.js", [/kb\.matches\(data, "tui\.input\.tab"\)\) \{\s*const selected = this\.autocompleteList\.getSelectedItem\(\);[\s\S]{0,600}?this\.cancelAutocomplete\(\);/]],
  ["the built-in provider skips its slash branch when the request is forced", "@earendil-works/pi-tui/dist/autocomplete.js", [/const commandText = textBeforeCursor\.trimStart\(\);\s*if \(!options\.force && commandText\.startsWith\("\/"\)\)/, /command\.getArgumentCompletions\(argumentText\)/]],
  ["pi's own working row is a column in under a blank line, so the extension draws its own", "@earendil-works/pi-tui/dist/components/loader.js", [/super\("", 1, 0\)/, /return \["", \.\.\.super\.render\(width\)\]/]],
  ["an aboveEditor widget sits between the status container and the composer, under the block's one blank line, and a string widget takes pi's own indent", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/this\.widgetContainerAbove,\s*this\.editorContainer,/, /if \(leadingSpacer\) \{\s*container\.addChild\(new Spacer\(1\)\);/, /container\.addChild\(new Text\(line, 1, 0\)\)/]],
  ["every assistant draw goes through updateContent — the constructor, invalidate and the setters redraw the message it last kept — which draws only from the message it is handed", "@earendil-works/pi-coding-agent/dist/modes/interactive/components/assistant-message.js", [/if \(message\) \{\s*this\.updateContent\(message\);/, /invalidate\(\) \{\s*super\.invalidate\(\);\s*if \(this\.lastMessage\) \{\s*this\.updateContent\(this\.lastMessage\);/, /updateContent\(message, isStreaming = this\.isStreaming\) \{\s*this\.lastMessage = message;/, /const hasVisibleContent = message\.content\.some\(/]],
  ["an assistant message draws each text block as its own unpadded Markdown in contentContainer, spaced from the next only after a thinking run — the gap the reasoning hide restores", "@earendil-works/pi-coding-agent/dist/modes/interactive/components/assistant-message.js", [/this\.contentContainer = new Container\(\);/, /this\.contentContainer\.clear\(\);/, /this\.contentContainer\.addChild\(new Markdown\(content\.text\.trim\(\), this\.outputPad, 0,/, /if \(hasVisibleContentAfter\) \{\s*this\.contentContainer\.addChild\(new Spacer\(1\)\);/]],
  ["the reasoning hide finds text blocks by pi-tui's Markdown class name", "@earendil-works/pi-tui/dist/components/markdown.js", [/^export class Markdown \{/m]],
  ["pi draws an assistant tail on a length stop, or on an error or abort with no tool call — the boundary installFolding mirrors", "@earendil-works/pi-coding-agent/dist/modes/interactive/components/assistant-message.js", [/const hasToolCalls = message\.content\.some\(\(c\) => c\.type === "toolCall"\);/, /if \(message\.stopReason === "length"\) \{\s*this\.contentContainer\.addChild\(new Spacer\(1\)\);/, /else if \(!hasToolCalls\) \{\s*if \(message\.stopReason === "aborted"\) \{/, /else if \(message\.stopReason === "error"\) \{/]],
  ["interactive mode draws a streaming, settled and restored assistant message only through AssistantMessageComponent", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/this\.chatContainer\.addChild\(this\.streamingComponent\);\s*this\.streamingComponent\.updateContent\(this\.streamingMessage, true\);/, /case "message_update":\s*if \(this\.streamingComponent && event\.message\.role === "assistant"\) \{\s*this\.streamingMessage = event\.message;\s*this\.streamingComponent\.updateContent\(this\.streamingMessage, true\);/, /this\.streamingComponent\.updateContent\(this\.streamingMessage, false\);/, /case "assistant": \{\s*const assistantComponent = new AssistantMessageComponent\(message, /]],
  ["extensions see message_end before pi's listeners and before persistence, and a returned message is copied onto the one they were handed", "@earendil-works/pi-coding-agent/dist/core/agent-session.js", [/await this\._emitExtensionEvent\(event\);\s*this\._emit\(/, /this\._replaceMessageInPlace\(event\.message, normalized\);/, /if \(target === replacement\) \{\s*return;/]],
  ["result statuses are completed, failed, partial, paused, stopped or detached", "pi-subagents/src/shared/types.d.ts", [/ExecutionProjectionStatus = "completed" \| "failed" \| "partial" \| "paused" \| "stopped" \| "detached"/]],
  ["the stored openai-codex credential carries access, a ms-epoch expires and accountId — the fields the footer's usage read scopes in without refreshing", "@earendil-works/pi-ai/dist/auth/oauth/openai-codex.js", [/type: "oauth",\s*access: token\.access,\s*refresh: token\.refresh,\s*expires: token\.expires,\s*accountId,/, /expires: Date\.now\(\) \+ json\.expires_in \* 1000,/]],
  ["the completion notice goes through sendMessage as customType subagent-notify with a computed display flag — the literal the quiet flip keys on", "pi-subagents/src/runs/background/notify.js", [/customType: "subagent-notify",\s*content,\s*display,/]],
  ["a self-shelled row that renders no lines takes no line at all, its spacer included", "@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js", [/this\.addChild\(new Spacer\(1\)\);/, /if \(contentLines\.length === 0 && this\.imageComponents\.length === 0\) \{\s*return \[\];/]],
  ["a custom entry's spacer is added only when its renderer answered with a component, and hasContent is exactly that", "@earendil-works/pi-coding-agent/dist/modes/interactive/components/custom-entry.js", [/hasContent\(\) \{\s*return this\.customComponent !== undefined;/, /if \(!component\) \{\s*return;\s*\}\s*this\.customComponent = component;\s*this\.addChild\(new Spacer\(1\)\);/]],
  ["a custom entry that answered with no component is never added to the chat", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/addCustomEntryToChat\(entry\) \{[\s\S]{0,300}?if \(!component\.hasContent\(\)\) \{\s*return;\s*\}/]],
  ["the runner mirrors the child's pi events into events.jsonl annotated as the child's, dropping only message_update — the records the fleet peek replays", "pi-subagents/src/runs/background/run-child-session.js", [/subagentSource: "child"/, /subagentRunId: input\.childEventContext\.runId/, /event\.type !== "message_update"/]],
  ["the events log stops at a byte cap and marks the truncation once", "pi-subagents/src/runs/background/subagent-runner.js", [/TRUNCATED_EVENT_TYPE = "subagent\.events\.truncated"/, /state\.diagnosticsTruncated = true;/]],
  ["a steer reaches the child as a user message opening with the orchestrator prefix and closing with the guidance line", "pi-subagents/src/runs/shared/subagent-prompt-runtime.js", [/"Mid-run steering from the parent orchestrator:"/, /"Queued follow-up from the parent orchestrator:"/, /"Incorporate this guidance at the next safe point\./]],
  ["the steer RPC waits up to three seconds for a receipt, longer than the fleet poll's timeout", "pi-subagents/src/runs/foreground/subagent-executor.js", [/waitForSteeringAction\(omitUndefinedProperties\(\{ asyncDir, sourceRunId: run\.id, requestId, timeoutMs: 3_000/]],
  ["fleet rows use opaque generated keys and an active step's agent and start time, falling back to the job's time", "pi-subagents/src/extension/rpc.js", [/let key = keyState\.keys\.get\(candidate\.internalKey\);\s*if \(!key\) \{\s*key = `fleet-\$\{\+\+keyState\.next\}`;\s*keyState\.keys\.set\(candidate\.internalKey, key\);\s*\}/, /if \(!activeState\(step\.status\)\)\s*continue;/, /agent: step\.agent,/, /startedAt: step\.startedAt \?\? startedAt,/, /const startedAt = job\.startedAt \?\? job\.updatedAt;/]],
  ["async status projects raw run and immediate step labels and timestamps with active state names", "pi-subagents/src/runs/shared/async-status-projection.js", [/function projectStep\(step, index, depth, ctx\) \{\s*const state = normalizeState\(step\.status\);\s*const startedAt = publicTime\(step\.startedAt\);/, /label: publicText\("label" in step && step\.label \? step\.label : step\.agent,/, /function projectRun\(job, ctx, depth, childrenByParent, liveRoots, omitSteps = false\) \{\s*const state = normalizeState\(job\.status\);\s*const startedAt = publicTime\(job\.startedAt\);/, /label: labelForAgents\(job\.agents, job\.mode \?\? "subagent"/, /const stepChildren = steps\.map\(\(step, index\) => projectLane\(step, step\.index \?\? index\)\)/]],
  ["a launch answers with its run id and artifact directory together", "pi-subagents/src/runs/background/async-execution.js", [/details: \{ mode: "single", runId: id, results: \[\], asyncId: id, asyncDir,/]],
  // /usage's Subagents row (docs/pi-design.md rule 3).
  ["ping advertises the cost RPC at report version 1, whose report carries childTotal, children and unresolvedAsyncChildren", "pi-subagents/src/extension/rpc.js", [/cost: \{ version: SUBAGENT_COST_REPORT_VERSION \},/, /if \(request\.method === "cost"\) \{[\s\S]{0,600}?return collectSubagentCost\(ctx,/]],
  ["the cost report's version and shape", "pi-subagents/src/slash/subagent-cost.js", [/export const SUBAGENT_COST_REPORT_VERSION = 1;/, /return \{ version: SUBAGENT_COST_REPORT_VERSION, parent, children, childTotal, total, unresolvedAsyncChildren \};/]],
  ["a container dispatches a mouse event to whichever child sits under event.y", "@earendil-works/pi-tui/dist/tui.js", [/for \(const \{ component: child, height: childHeight \} of mouseChildren\) \{\s*if \(event\.y >= childY && event\.y < childY \+ childHeight\) \{\s*const result = dispatchMouseEvent\(child, \{/]],
  ["pi wires the custom editor's submit callback to its own default editor's, so a subclass has to intercept the property itself", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/newEditor\.onSubmit = this\.defaultEditor\.onSubmit;/]],
  ["pi-tui's Editor declares onSubmit as a bare class field (an own property the caret deletes to reach its accessor) and calls it from submitValue after clearing its own state", "@earendil-works/pi-tui/dist/components/editor.js", [/^\s*onSubmit;$/m, /this\.state = \{ lines: \[""\], cursorLine: 0, cursorCol: 0 \};/, /if \(this\.onSubmit\)\s*this\.onSubmit\(result\);/]],
  ["isStreaming is _isAgentRunActive, which _runAgentPrompt sets before its first await and abort() flags; its finally resets _runSystemPromptOptions, flushes and settles, and prompt() prepares a run with the private members installManagedRun mirrors for a run it did not prepare; _appendCustomMessage records a message without a turn, as a run that never reaches agent.prompt keeps its caller's messages", "@earendil-works/pi-coding-agent/dist/core/agent-session.js", [/_appendCustomMessage\(appMessage\) \{\s*this\.sessionManager\.appendCustomMessageEntry\(appMessage\.customType, appMessage\.content, appMessage\.display, appMessage\.details\);/, /get isStreaming\(\) \{\s*return this\._isAgentRunActive;\s*\}/, /async _runAgentPrompt\(messages\) \{[^}]{0,600}?this\._isAgentRunActive = true;\s*try \{\s*await this\.agent\.prompt\(messages\);/, /async _runAgentPrompt\(messages\) \{[\s\S]{0,1200}?\}\s*finally \{[\s\S]{0,200}?this\._runSystemPromptOptions = undefined;\s*this\._flushPendingBashMessages\(\);\s*this\._flushPendingCustomMessages\(\);\s*await this\._emitAgentSettled\(\);/, /async abort\(\) \{\s*if \(this\._isAgentRunActive\) \{\s*this\._agentRunAbortRequested = true;/, /const selectedToolsBefore = this\._baseSystemPromptOptions\.selectedTools;\s*const result = await this\._extensionRunner\.emitBeforeAgentStart\(expandedText, currentImages, this\._baseSystemPromptOptions\);[\s\S]{0,600}?if \(!handlerEditedTools\)\s*result\.systemPromptOptions\.selectedTools = this\.getActiveToolNames\(\);[\s\S]{0,800}?for \(const msg of this\._pendingNextTurnMessages\) \{\s*messages\.push\(msg\);\s*\}\s*this\._pendingNextTurnMessages = \[\];\s*for \(const msg of result\.messages\) \{\s*messages\.push\(\{\s*role: "custom",[\s\S]{0,400}?const updateMessage = this\._preparePromptAndToolLoadout\(result\.systemPromptOptions\);\s*this\._runSystemPromptOptions = result\.systemPromptOptions;\s*if \(updateMessage\)\s*messages\.unshift\(updateMessage\);\s*preflightResult\?\.\("started"\);\s*await this\._runAgentPrompt\(messages\);/]],
  ["pi's grep runs rg --hidden and forwards glob as one --glob argument, which the bridge guard owns to exclude deny names", "@earendil-works/pi-coding-agent/dist/core/tools/grep.js", [/const args = \["--json", "--line-number", "--color=never", "--hidden"\];/, /args\.push\("--glob", glob\);/]],
  ["srt exports CLAUDE_CODE_TMPDIR as the wrapped command's TMPDIR", "@anthropic-ai/sandbox-runtime/dist/sandbox/sandbox-utils.js", [/export function generateProxyEnvVars\(/, /const tmpdir = process\.env\.CLAUDE_CODE_TMPDIR \|\|/, /envVars\.push\(`TMPDIR=\$\{tmpdir\}`\)/]],
  ["ModelRegistry declares the find, isUsingOAuth, getAvailable and complete members the workflow calls", "@earendil-works/pi-coding-agent/dist/core/model-registry.d.ts", [/find\(provider: string, modelId: string\): Model<Api> \| undefined;/, /isUsingOAuth\(model: Model<Api>\): boolean;/, /getAvailable\(\): Model<Api>\[\];/, /complete<TApi extends Api>\(model: Model<TApi>, context: Context, options\?: ModelsApiStreamOptions<TApi>\): Promise<AssistantMessage>;/]],
  ["stream options accept transport \"sse\" and a sessionId, which the approval and web-fetch completions pass", "@earendil-works/pi-ai/dist/types.d.ts", [/export type Transport = "sse" \|/, /transport\?: Transport;/, /sessionId\?: string;/]],
  ["an MCP server's exposure and per-tool toolExposure take the McpExposure union, hidden included", "@earendil-works/pi-coding-agent/dist/core/mcp-servers.d.ts", [/export type McpExposure = "codemode" \| "deferred" \| "direct" \| "hidden";/, /exposure\?: McpExposure;/, /toolExposure\?: Record<string, McpExposure>;/]],
  ["context files land in the project_context section as <project_instructions path=...> blocks, and skills in its own section, the split /usage reads", "@earendil-works/pi-coding-agent/dist/core/system-prompt.js", [/`<project_instructions path="\$\{path\}">\\n\$\{content\}\\n<\/project_instructions>`/, /promptSections\.project_context = renderProjectContext\(contextFiles\);/, /promptSections\.skills = skillsPrompt;/, /sections\[name\] = `<\$\{name\}>\\n\$\{content\}\\n<\/\$\{name\}>`;/]],
  ["pi renames <cwd>/.pi/commands to .pi/prompts at startup when prompts is absent, which the bridge refuses ahead of", "@earendil-works/pi-coding-agent/dist/migrations.js", [/const commandsDir = join\(baseDir, "commands"\);\s*const promptsDir = join\(baseDir, "prompts"\);\s*if \(existsSync\(commandsDir\) && !existsSync\(promptsDir\)\) \{\s*try \{\s*renameSync\(commandsDir, promptsDir\);/, /const projectDir = join\(cwd, CONFIG_DIR_NAME\);/, /migrateCommandsToPrompts\(projectDir, "Project"\);/]],
  // The bridge guard rewrites input.path to an absolute path it vetted, relying on these.
  ["normalizePath folds unicode spaces, strips a leading @ and converts file:// URLs, and resolvePath leaves an absolute path as is", "@earendil-works/pi-coding-agent/dist/utils/paths.js", [/normalized = normalized\.replace\(UNICODE_SPACES, " "\);/, /if \(options\.stripAtPrefix && normalized\.startsWith\("@"\)\) \{\s*normalized = normalized\.slice\(1\);/, /if \(\/\^file:\\\/\\\/\/\.test\(normalized\)\) \{\s*return fileURLToPath\(normalized\);/, /return isAbsolute\(normalized\) \? nodeResolvePath\(normalized\) :/]],
  ["tools resolve paths through resolveToCwd, and resolveReadPathAsync returns an existing path before trying variants", "@earendil-works/pi-coding-agent/dist/core/tools/path-utils.js", [/export function resolveToCwd\(filePath, cwd\) \{\s*return resolvePath\(filePath, cwd, \{ normalizeUnicodeSpaces: true, stripAtPrefix: true \}\);/, /export async function resolveReadPathAsync\(filePath, cwd\) \{\s*const resolved = resolveToCwd\(filePath, cwd\);\s*if \(await pathExists\(resolved\)\) \{\s*return resolved;\s*\}/]],
  // Group closing for messages and entries drawn outside the agent stream (docs/pi-design.md rule 7).
  ["_appendCustomMessage emits only through _emit, never to extensions, so the workflow closes the group itself", "@earendil-works/pi-coding-agent/dist/core/agent-session.js", [/_appendCustomMessage\(appMessage\) \{\s*this\.sessionManager\.appendCustomMessageEntry\(appMessage\.customType, appMessage\.content, appMessage\.display, appMessage\.details\);\s*this\._refreshFinalizedContext\(\);\s*this\._emit\(\{ type: "message_start", message: appMessage \}\);\s*this\._emit\(\{ type: "message_end", message: appMessage \}\);\s*\}/]],
  ["sendCustomMessage branches nextTurn, then streaming steer/followUp unless triggerTurn is false, then triggerTurn, then a streaming deferral, else an immediate append — the order pluginApi's sendMessage mirrors", "@earendil-works/pi-coding-agent/dist/core/agent-session.js", [/async sendCustomMessage\(message, options\) \{[\s\S]{0,400}?if \(options\?\.deliverAs === "nextTurn"\) \{\s*this\._pendingNextTurnMessages\.push\(appMessage\);\s*\}\s*else if \(this\.isStreaming && options\?\.triggerTurn !== false\) \{[\s\S]{0,250}?this\.agent\.followUp\(appMessage\);[\s\S]{0,100}?this\.agent\.steer\(appMessage\);\s*\}\s*\}\s*else if \(options\?\.triggerTurn\) \{[\s\S]{0,300}?await this\._runAgentPrompt\(appMessage\);\s*\}\s*else if \(this\.isStreaming\) \{[\s\S]{0,400}?this\._pendingCustomMessages\.push\(appMessage\);\s*\}\s*else \{\s*this\._appendCustomMessage\(appMessage\);\s*\}\s*\}/]],
  ["deferred custom messages flush at turn_end after the extension dispatch, and at run end before agent_settled", "@earendil-works/pi-coding-agent/dist/core/agent-session.js", [/await this\._emitExtensionEvent\(event\);[\s\S]{0,3000}?if \(event\.type === "turn_end"\) \{[\s\S]{0,100}?this\._flushPendingCustomMessages\(\);/, /\}\s*finally \{[\s\S]{0,300}?this\._flushPendingCustomMessages\(\);\s*await this\._emitAgentSettled\(\);/]],
  ["the watchdog warning entry renderer draws only with summary, evidence and recommendedAction — the guard DRAWN_ENTRIES mirrors", "pi-subagents/src/watchdog/register-main.js", [/pi\.registerEntryRenderer\(SUBAGENT_WATCHDOG_WARNING_TYPE, \(entry, renderOptions, theme\) => \{\s*const details = entry\.data;\s*return details\?\.summary && details\.evidence && details\.recommendedAction\s*\? renderWatchdogWarning\(/]],
  ["the watchdog warning entry type is subagent_watchdog_warning", "pi-subagents/src/watchdog/types.js", [/SUBAGENT_WATCHDOG_WARNING_TYPE = "subagent_watchdog_warning"/]],
  ["the supervisor reply entry (subagent_supervisor_reply) draws only when replyData holds: requestId, runId, agent and message strings, finite childIndex and createdAt", "pi-subagents/src/intercom/supervisor-ui.js", [/SUPERVISOR_REPLY_ENTRY_TYPE = "subagent_supervisor_reply"/, /typeof value\.requestId !== "string" \|\| typeof value\.runId !== "string" \|\| typeof value\.agent !== "string" \|\| typeof value\.message !== "string"\)\s*return undefined;/, /typeof value\.childIndex !== "number" \|\| !Number\.isFinite\(value\.childIndex\) \|\| typeof value\.createdAt !== "number" \|\| !Number\.isFinite\(value\.createdAt\)\)\s*return undefined;/, /export function renderSupervisorReply\(entry, options, theme\) \{\s*const data = replyData\(entry\.data\);\s*if \(!data\)\s*return undefined;/]],
  ["an incremental child notice's first line is `Workflow child <status>: **<key>**`, the line NOTICE_RENDERERS parses", "pi-subagents/src/runs/background/notify.js", [/export function formatIncrementalChildCompletion\(child\) \{\s*const statusText = child\.outcome === "completed" \? "completed"\s*: child\.outcome === "failed" \? "failed"\s*: child\.outcome === "paused" \? "paused \(needs attention\)"\s*: "stopped";[\s\S]{0,200}?return \[\s*`Workflow child \$\{statusText\}: \*\*\$\{child\.childKey\}\*\*`,/]],
  ["pi-subagents wakes an idle parent by sending the notice without a turn, then steering the wake literal pluginApi rewrites as a user message, through the API it is handed", "pi-subagents/src/shared/parent-wake.js", [/export const PARENT_WAKE_TEXT = "Subagent updates above\.";/, /pi\.sendMessage\(message, \{ triggerTurn: false \}\);\s*if \(!reserved\(\)\) \{\s*reservation\.sentAt = now\(\);[\s\S]{0,100}?pi\.sendUserMessage\(PARENT_WAKE_TEXT, \{ deliverAs: "steer" \}\);/]],
  ["pi-subagents builds its parent wake from the extension API it is handed", "pi-subagents/src/extension/index.js", [/const parentWake = createParentWake\(pi\);/]],
  ["agent_settled reports aborted from _agentRunAbortRequested, which _runAgentPrompt clears only on starting, so settle leaves it set", "@earendil-works/pi-coding-agent/dist/core/agent-session.js", [/async _runAgentPrompt\(messages\) \{\s*this\._agentRunAbortRequested = false;/, /async _emitAgentSettled\(\) \{[\s\S]{0,300}?const aborted = this\._agentRunAbortRequested;\s*await this\._extensionRunner\.emit\(\{ type: "agent_settled", aborted \}\);/]],
  ["the incremental child and result-write-failed notices go through sendMessage under their customType literals", "pi-subagents/src/runs/foreground/subagent-executor.js", [/customType: "subagent-incremental-child-notify",\s*content: formatIncrementalChildCompletion\(notification\),/, /customType: "subagent-workflow-result-write-failed",\s*content: message,\s*display: true,/]],
  ["the watchdog clarification goes through sendMessage as subagent_watchdog_clarification, and the watchdog registers a message renderer for its warning only", "pi-subagents/src/watchdog/register-main.js", [/pi\.sendMessage\(\{ customType: "subagent_watchdog_clarification", content, display: true \}/, /^(?![\s\S]*registerMessageRenderer\((?!SUBAGENT_WATCHDOG_WARNING_TYPE,))/]],
  ["pi-subagents' extension registers message renderers only for its supervisor request, slash results, completion, steering and control notices — none for the notices NOTICE_RENDERERS draws", "pi-subagents/src/extension/index.js", [/^(?![\s\S]*registerMessageRenderer\((?!(?:SUPERVISOR_REQUEST_MESSAGE_TYPE|SLASH_RESULT_TYPE|SLASH_TEXT_RESULT_TYPE|"subagent-notify"|SUBAGENT_STEERING_MESSAGE_TYPE|SUBAGENT_CONTROL_MESSAGE_TYPE),))/]],
  // Pi's extension loader aliases typebox to its own copy, so the root pin must match for tests to run what pi runs.
  ["the root typebox pin equals pi-coding-agent's declared version", "@earendil-works/pi-coding-agent/package.json", ["typebox"].map(name => new RegExp(`"${name}": "${JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")).dependencies[name].replaceAll(".", "\\.")}"`))],
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
// call site has to remember one — this holds the rest of them to that path.
test("pi.appendEntry is only reached through appendVisible", () => {
  const offenders = sourceFiles.filter(file => file !== "rows.mjs" && readFileSync(join(dir, file), "utf8").includes("pi.appendEntry("));
  assert.deepEqual(offenders, [], `these call pi.appendEntry directly instead of appendVisible: ${offenders.join(", ")}`);
});
