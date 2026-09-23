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
    test(`${file}: pi.on("${name}") is a declared extension event`, () => {
      assert.match(extensionDeclarations(), new RegExp(`on\\(event: "${name}"`), `pi.on("${name}") in ${file} has no on() overload in the exported extension declarations`);
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
      test(`installFolding: pi.on("${name}") is a declared extension event`, () => {
        assert.match(extensionDeclarations(), new RegExp(`on\\(event: "${name}"`), `pi.on("${name}") in installFolding has no on() overload in the exported extension declarations`);
      });
    }
  }
}

// Source pins for the undocumented behaviour the transcript rows lean on
// (docs/pi-design.md rule 7). Each names the text the code assumes; a pin bump
// that rewrites it fails here before the row does on screen.
const pins = [
  ["shell layout and navigation use the same native editor state without changing submission or undo", "@earendil-works/pi-tui/dist/components/editor.js", [/layoutText\(contentWidth\)/, /buildVisualLineMap\(width\)/, /this\.state\.lines\[i\]/, /logicalLine: i,/, /startCol: chunk\.startIndex/, /handleBackspace\(\)/, /this\.state\.cursorCol === 0/, /navigateHistory\(direction\)/, /pushUndoSnapshot\(\)/, /this\.undoStack\.push\(\{ state: this\.state,/, /this\.expandPasteMarkers\(this\.state\.lines\.join\("\\n"\)\)\.trim\(\)/]],
  ["pi-subagents registers `subagent` with its own renderers through the API it is handed", "pi-subagents/src/extension/index.js", [/name: "subagent"/, /renderCall\(args, theme\)/, /renderResult\(result, options, theme, context\)/, /pi\.registerTool\(tool\)/]],
  ["pi-mcp-adapter registers direct tools with its own renderers through the API it is handed", "pi-mcp-adapter/index.ts", [/name: spec\.prefixedName/, /renderCall: createMcpDirectToolCallRenderer\(/, /renderResult: renderMcpToolResult/]],
  ["pi-mcp-adapter reports failures in details.error without isError", "pi-mcp-adapter/direct-tools.ts", [/details: \{ error: "auth_required"/, /details: \{ error: "server_unavailable"/]],
  ["pi keeps the definition object handed to registerTool", "@earendil-works/pi-coding-agent/dist/core/extensions/loader.js", [/registerTool\(tool\) \{[\s\S]{0,600}definition: tool,/]],
  ["the bash tool's empty-output stand-in and exit-status trailer", "@earendil-works/pi-coding-agent/dist/core/tools/bash.js", [/"\(no output\)"/, /`Command exited with code \$\{exitCode\}`/]],
  ["a click toggles one row's own expanded flag, after the rendered component has declined it", "@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js", [/createResultRegion\(/, /this\.setExpanded\(!this\.expanded\)/, /y: event\.y - 1,/]],
  ["a mouse region asks its child before its own handler", "@earendil-works/pi-tui/dist/components/mouse-region.js", [/childResult \?\? this\.onMouse\(event\)/]],
  ["markdown that transforms to nothing renders no line", "@earendil-works/pi-tui/dist/components/markdown.js", [/this\.options\.transform\?\.\(this\.text, contentWidth\) \?\? this\.text/, /if \(!text \|\| text\.trim\(\) === ""\)/]],
  ["pi resets every extension surface when a session is invalidated", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/setBeforeSessionInvalidate\(\(\) => \{\s*this\.resetExtensionUI\(\);/]],
  ["pi-subagents registers bg_wait and the supervisor channel without renderers of their own", "pi-subagents/src/runs/background/wait-tool.js", [/name: "bg_wait"/]],
  ["pi-web-search registers web_search and a Gemini-only url_context with its own renderers", "pi-web-search/src/index.ts", [/const WEB_SEARCH_TOOL = "web_search"/, /const URL_CONTEXT_TOOL = "url_context"/, /name: WEB_SEARCH_TOOL/, /renderCall\(args, theme\)/]],
  ["pi-web-search takes the model's credentials from pi", "pi-web-search/src/providers/auth.ts", [/ctx\.modelRegistry\.getApiKeyAndHeaders\(model\)/]],
  ["pi-web-search posts to the openai-codex responses endpoint", "pi-web-search/src/providers/openai.ts", [/model\.api === "openai-codex-responses"/, /`\$\{base\}\/codex\/responses`/]],
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
  ["pi spaces an assistant message from its raw reasoning and renders nothing for a blank block, so blanking the text removes the line", "@earendil-works/pi-coding-agent/dist/modes/interactive/components/assistant-message.js", [/const hasVisibleContent = message\.content\.some\(\(c\) => \(c\.type === "text" && c\.text\.trim\(\)\) \|\| \(c\.type === "thinking" && c\.thinking\.trim\(\)\)\);/, /if \(thinkingBlocks\.length === 0\) \{\s*continue;/]],
  ["extensions see message_update before pi's listeners, and the extension event carries the same message object pi is about to render", "@earendil-works/pi-coding-agent/dist/core/agent-session.js", [/await this\._emitExtensionEvent\(event\);\s*this\._emit\(/, /else if \(event\.type === "message_update"\) \{\s*const extensionEvent = \{\s*type: "message_update",\s*message: event\.message,/]],
  ["the extension runner hands each handler the event itself, not a copy, so a handler's change to event.message reaches pi's listeners", "@earendil-works/pi-coding-agent/dist/core/extensions/runner.js", [/async emit\(event\) \{\s*const ctx = this\.createContext\(\);\s*let result;\s*for \(const \{ ext, handlers \} of snapshotEventHandlers\(this\.extensions, event\.type\)\) \{\s*for \(const handler of handlers\) \{\s*try \{\s*const handlerResult = await handler\(event, ctx\);/]],
  ["pi's interactive mode renders message_update by pointing its streaming component straight at event.message", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/case "message_update":\s*if \(this\.streamingComponent && event\.message\.role === "assistant"\) \{\s*this\.streamingMessage = event\.message;\s*this\.streamingComponent\.updateContent\(this\.streamingMessage, true\);/]],
  ["a message_update event's message is a fresh shallow copy of the partial each time, so mutating its content array does not touch the one still being built", "@earendil-works/pi-agent-core/dist/agent-loop.js", [/type: "message_update",\s*assistantMessageEvent: event,\s*message: \{ \.\.\.partialMessage \},/]],
  ["extensions see message_end before pi's listeners and before persistence, and a returned message is copied onto the one they were handed", "@earendil-works/pi-coding-agent/dist/core/agent-session.js", [/await this\._emitExtensionEvent\(event\);\s*this\._emit\(/, /this\._replaceMessageInPlace\(event\.message, normalized\);/, /if \(target === replacement\) \{\s*return;/]],
  ["the OpenAI responses replay sends the opaque reasoning item alone, and stores the provider's summary inside it", "@earendil-works/pi-ai/dist/api/openai-responses-shared.js", [/const reasoningItem = JSON\.parse\(block\.thinkingSignature\);\s*output\.push\(reasoningItem\);/, /slot\.block\.thinkingSignature = JSON\.stringify\(item\);/]],
  ["any change of model identity (provider, api or model id) forwards the earlier reasoning as plain text, and drops a block whose text is empty", "@earendil-works/pi-ai/dist/api/transform-messages.js", [/const isSameModel = assistantMsg\.provider === model\.provider &&\s*assistantMsg\.api === model\.api &&\s*assistantMsg\.model === model\.id;/, /if \(isSameModel && block\.thinkingSignature\)\s*return block;\s*\/\/ Skip empty thinking blocks, convert others to plain text\s*if \(!block\.thinking \|\| block\.thinking\.trim\(\) === ""\)\s*return \[\];/, /return \{\s*type: "text",\s*text: block\.thinking,/]],
  ["the Anthropic replay carries the thinking text with its signature, which is why blanking is gated by api", "@earendil-works/pi-ai/dist/api/anthropic-messages.js", [/type: "thinking",\s*thinking: sanitizeSurrogates\(block\.thinking\),\s*signature: thinkingSignature,/]],
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
  ["a container dispatches a mouse event to whichever child sits under event.y", "@earendil-works/pi-tui/dist/tui.js", [/for \(const \{ component: child, height: childHeight \} of mouseChildren\) \{\s*if \(event\.y >= childY && event\.y < childY \+ childHeight\) \{\s*const result = dispatchMouseEvent\(child, \{/]],
  ["pi wires the custom editor's submit callback to its own default editor's, so a subclass has to intercept the property itself", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/newEditor\.onSubmit = this\.defaultEditor\.onSubmit;/]],
  ["pi's ! branch strips one or two leading characters before this extension ever sees the text", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/const isExcluded = text\.startsWith\("!!"\);/, /const command = isExcluded \? text\.slice\(2\)\.trim\(\) : text\.slice\(1\)\.trim\(\);/]],
  ["pi-tui's Editor declares onSubmit as a bare class field (an own property the caret deletes to reach its accessor) and calls it from submitValue after clearing its own state", "@earendil-works/pi-tui/dist/components/editor.js", [/^\s*onSubmit;$/m, /this\.state = \{ lines: \[""\], cursorLine: 0, cursorCol: 0 \};/, /if \(this\.onSubmit\)\s*this\.onSubmit\(result\);/]],
  ["pi-tui's Editor declares addToHistory as a public method a subclass can call directly", "@earendil-works/pi-tui/dist/components/editor.d.ts", [/addToHistory\(text: string\): void;/]],
  ["bashExecutionToText's literal shape, which contextText mirrors for the `!` row and its recorded context text", "@earendil-works/pi-coding-agent/dist/core/messages.js", [/let text = `Ran \\`\$\{msg\.command\}\\`\\n`;/, /text \+= "\(no output\)";/, /text \+= "\\n\\n\(command cancelled\)";/, /text \+= `\\n\\nCommand exited with code \$\{msg\.exitCode\}`;/]],
  ["a triggerTurn: false custom message sent while the agent streams is deferred to the end of the turn rather than appended between an in-flight tool call and its result", "@earendil-works/pi-coding-agent/dist/core/agent-session.js", [/else if \(this\.isStreaming\) \{[\s\S]{0,400}?this\._pendingCustomMessages\.push\(appMessage\);/]],
  ["Alt+Enter on a non-streaming session acts like plain Enter, calling the editor's own onSubmit directly", "@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", [/else if \(this\.editor\.onSubmit\) \{\s*this\.editor\.setText\(""\);\s*this\.editor\.onSubmit\(text\);/]],
  ["ExtensionContext declares isIdle, the signal this editor's Esc precedence and the shell runner's abortable() gate on", "@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts", [/isIdle\(\): boolean;/]],
  ["pi-tui's main-screen renderer throws when a rendered line's visible width exceeds the terminal's, which is why every row here wraps to width", "@earendil-works/pi-tui/dist/tui-main-screen.js", [/`Rendered line \$\{i\} exceeds terminal width \(\$\{visibleWidth\(line\)\} > \$\{width\}\)\.`/]],
  // The shell runner's shellPath/shellCommandPrefix wiring (docs/pi-coupling.md's
  // owned `!` block): the bash tool's own prefix composition, the lazy shell
  // resolution createLocalBashOperations wraps, SettingsManager's shell getters
  // and export, and the model's workspace_bash tool staying on bash regardless
  // of the setting.
  ["the bash tool joins commandPrefix and command with a newline before spawning, the composition the shell runner mirrors", "@earendil-works/pi-coding-agent/dist/core/tools/bash.js", [/const resolvedCommand = commandPrefix \? `\$\{commandPrefix\}\\n\$\{command\}` : command;/]],
  ["createLocalBashOperations resolves shellPath through getShellConfig lazily, at exec time, not at construction", "@earendil-works/pi-coding-agent/dist/core/tools/bash.js", [/export function createLocalBashOperations\(options\) \{\s*return createLocalShellOperations\("bash", \(\) => getShellConfig\(options\?\.shellPath\)\);/]],
  ["SettingsManager exposes getShellPath and getShellCommandPrefix", "@earendil-works/pi-coding-agent/dist/core/settings-manager.d.ts", [/getShellPath\(\): string \| undefined;/, /getShellCommandPrefix\(\): string \| undefined;/]],
  ["SettingsManager is exported from the package index", "@earendil-works/pi-coding-agent/dist/index.js", [/export \{ SettingsManager, \} from "\.\/core\/settings-manager\.js";/]],
  ["SettingsManager.create defaults projectTrusted to true and skips the project file when it is false, so the shell settings read must pass the session's trust decision", "@earendil-works/pi-coding-agent/dist/core/settings-manager.js", [/const projectTrusted = options\.projectTrusted \?\? true;/, /if \(scope === "project" && !projectTrusted\) \{/]],
  ["ExtensionContext declares isProjectTrusted, the decision the shell settings read is gated on", "@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts", [/isProjectTrusted\(\): boolean;/]],
];
for (const [claim, file, patterns] of pins) {
  test(`pin: ${claim} (${file})`, () => {
    const text = readFileSync(join(nodeModules, file), "utf8");
    for (const pattern of patterns) assert.match(text, pattern);
  });
}

// API calls that are not events: each must stay a declared member of the
// exported extension declarations (method, generic method, or property).
const declaredApis = ["sendMessage", "select", "getArgumentCompletions", "addAutocompleteProvider", "appendEntry", "registerEntryRenderer", "registerMessageRenderer", "setWidget", "setWorkingVisible", "placement"];
for (const api of declaredApis) {
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
