import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { Type } from "typebox";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import * as sdk from "@earendil-works/pi-coding-agent";
import { startBroker as createPolicyBroker, requestBroker as callPolicyBroker, acquireChild } from "./broker.mjs";
import { startToolWorker, workerOperations, executeSandboxGrep } from "./operations.mjs";
import { rootTools, canonical, expand, publicToolName, unsandboxed } from "./policy.mjs";
import { hostEnvironment } from "./sandbox-runner.mjs";
import { reviewAction } from "./approval.mjs";
import { allowedChildAgents, checkChildLaunch, narrowSubagentSchema } from "./children.mjs";
import { installFooter } from "./footer.mjs";
import { installHeader } from "./header.mjs";
import { installFleet } from "./fleet.mjs";
import { createTasks } from "./tasks.mjs";
import { applyPlanDecision, isolatePlanApproval, requestPlanApproval } from "./plan-approval.mjs";
import { registerQuestionnaire } from "./questionnaire.mjs";
import { PAD, PROMPT, answerLines, appendVisible, blankReasoning, bulletMarkdown, doneEntryRenderer, hideStreamingReasoning, installFolding, noteLine, noticeLine, planRenderers, pluginRenderers, shade, taskRenderers, toolRenderers } from "./rows.mjs";

const runnerPath = fileURLToPath(new URL("./sandbox-runner.mjs", import.meta.url));
// The classifier's only evidence source: a shell command's record (command,
// sandboxed, exit code; never output) is taken where the worker returns it. A
// rejected exec keeps exitCode null. The command is cut to keep the classifier
// message compact. Exported for its test.
export function recordingExec(history, args, exec) {
  return async (...params) => {
    const entry = { command: args.command.slice(0, 2000), sandboxed: !unsandboxed("bash", args), exitCode: null };
    if (history.push(entry) > 20) history.shift();
    const result = await exec(...params);
    entry.exitCode = result.exitCode ?? null;
    return result;
  };
}
// What an authorization carries: the newest records whose JSON fits the
// budget, since the broker drops any request line over 128 KiB and escaping
// can multiply a command's size. Exported for its test.
export function trimHistory(history, budget = 16 * 1024) {
  const kept = [...history];
  while (kept.length && JSON.stringify(kept).length > budget) kept.shift();
  return kept;
}
const resultText = text => ({ content: [{ type: "text", text }], details: {} });
// The SDK's own guidelines for the pinned version, spelled with the managed
// tool names (the SDK's mention plain `read`/`edit`, which do not exist here).
const GUIDELINES = {
  read: ["Use workspace_read to examine files instead of cat or sed."],
  write: ["Use workspace_write only for new files or complete rewrites."],
  edit: [
    "Use workspace_edit for precise changes (edits[].oldText must match exactly)",
    "When changing multiple separate locations in one file, use one workspace_edit call with multiple entries in edits[] instead of multiple workspace_edit calls",
    "Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.",
    "Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
  ],
};

// Definitions stay stable across sessions of the same role: pi-mcp-adapter keys its
// metadata cache on them, env included, and a cold cache costs a connect and
// describe round trip per server per session. The runner takes the broker
// socket and token from the inherited process environment, never from here.
export const mcpServerDefinitions = (config, role) => Object.fromEntries(Object.entries(config.mcp).map(([name, entry]) => [name, {
  command: process.execPath, args: [runnerPath, "server", name], env: { PI_WORKFLOW_ROLE: role },
  excludeTools: entry.policy.denied_tools, ...(entry.policy.allowed_tools?.length ? { includeTools: entry.policy.allowed_tools } : {}), approveTools: true,
  directTools: entry.policy.direct_tools === true,
}]));
export const mcpAdapterSettings = { hostConfigDiscovery: "off", directTools: false, freezeDirectTools: true, toolPrefix: "mcp", namespaceProxyTools: false, scriptMode: false, jev: false, approveTools: true, autoAuth: false, sampling: false, elicitation: false };
// Direct MCP tools carry the adapter's mcp__<server> prefix; the proxy stays
// for servers left behind it (playwright).
const isDirectMcpTool = name => name.startsWith("mcp__");

// The prompt glyph and its trailing space take the editor's padding columns.
const PROMPT_PADDING = PAD.length;

// pi-subagents' control notice: a message whose content is the model's
// instructions (run id, four subagent({…}) calls) and whose own renderer draws
// all of it in a box. The content is left alone — the model acts on it — and
// only the row is ours. A payload missing the fields the row needs is the
// plugin's to draw, so the guard is total and never throws: pi drops a throwing
// renderer to its own box, which is the notice in full.
const CONTROL_NOTICE = "subagent_control_notice";
// pi-subagents' completion notice: real model context (it can trigger the next
// turn), but its box duplicates the completion line the fleet already draws
// from the same completion — and its collapsed preview's first line is the
// bare agent name, so the visible box said nothing. pi draws a custom message
// only when `display` is truthy, so the wrapper sends it quiet; the content,
// session-file path included, still reaches the model.
const SUBAGENT_NOTIFY = "subagent-notify";
export const controlNotice = (message, _options, theme) => {
  const event = message?.details?.event;
  if (!event?.agent || !event.message) return undefined;
  // A goal mission's body is several lines opening "Goal mission needs attention:",
  // which the row's "<agent> <state>" strip cannot read; the plugin's box draws it.
  if (message.details.source === "goal") return undefined;
  return new Text(noticeLine({ agent: event.agent, message: event.message }, theme), 0, 0);
};

// Plugins register their tools and their custom message renderers through the
// API they are handed and pi keeps what they pass, so a Proxy that decorates
// every registration gives their rows the transcript's shape without touching
// execution or message content. The subagent schema and description reflect
// only the managed launch/control surface. A message renderer we own is composed
// over the plugin's, which stays as the fallback: ours answers undefined for a
// payload it does not recognise, so a plugin that changes its details shape
// renders its own way again rather than losing its notice. A customType in
// quietMessages is sent with display off — in the session and the model's
// context, never drawn. Everything else
// (events included) is the original, and the raw function is called on the raw
// API because the adapter extracts it.
export function pluginApi(pi, renderersFor, messageRenderers = {}, quietMessages = [], narrowSchema, isShuttingDown = () => false, subagentDescription) {
  return new Proxy(pi, {
    get(target, key, receiver) {
      if (key === "registerTool") return tool => target.registerTool({
        ...tool,
        ...(tool.name === "subagent" && narrowSchema ? { parameters: narrowSchema(tool.parameters) } : {}),
        ...(tool.name === "subagent" && subagentDescription !== undefined ? { description: subagentDescription } : {}),
        ...renderersFor(tool.name),
      });
      if (key === "sendMessage") return (message, options) => {
        if (!quietMessages.includes(message?.customType)) return target.sendMessage(message, options);
        return target.sendMessage({ ...message, display: false }, isShuttingDown() ? { ...options, triggerTurn: false } : options);
      };
      if (key !== "registerMessageRenderer") return Reflect.get(target, key, receiver);
      return (type, renderer) => target.registerMessageRenderer(type, Object.hasOwn(messageRenderers, type)
        ? (message, options, theme) => messageRenderers[type](message, options, theme) ?? renderer(message, options, theme)
        : renderer);
    },
  });
}

// pi routes Tab inside a command's arguments to forced file completion, and its
// built-in provider guards the whole slash branch on `!options.force`, so the
// command's own getArgumentCompletions never runs and Tab offers raw paths. The
// forced request asked again unforced is the command's candidates.
const WRAPPED = Symbol.for("pi-workflow:argument-completions");
// The path separators pi does not treat as typing.
const SEPARATORS = [" ", "/", "~"];
// Whether the cursor sits in a command's arguments, and which command's.
// pi runs a slash command from the first line only (`isSlashMenuAllowed`), so a
// later line opening with one is prose.
const commandArgument = (lines, cursorLine, cursorCol) => cursorLine === 0 && (lines[0] ?? "").slice(0, cursorCol).match(/^\/(\S+) /)?.[1];
export function argumentCompletions(current) {
  // pi keeps stacked providers across /reload, where session_start runs again
  // without the invalidation that clears them.
  if (current[WRAPPED]) return current;
  return {
    [WRAPPED]: true,
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const name = options.force && commandArgument(lines, cursorLine, cursorCol);
      if (!name) return current.getSuggestions(lines, cursorLine, cursorCol, options);
      // Unforced answers with the command's own candidates, and with null where
      // it declares none. That null is the answer: Tab offers what a command
      // accepts, never a file path it never asked for.
      return current.getSuggestions(lines, cursorLine, cursorCol, { ...options, force: false });
    },
    applyCompletion: (...args) => current.applyCompletion(...args),
    // Tab forces completion, and this gate is the only thing consulted on that
    // path, so answering it narrows Tab to a command's arguments. pi's own
    // provider says yes to everything but a half-typed slash command, which put
    // a file menu under Tab in ordinary prose; `@path` and the command-name
    // menu are unaffected, both being unforced.
    shouldTriggerFileCompletion: (lines, cursorLine, cursorCol) => Boolean(commandArgument(lines, cursorLine, cursorCol)),
  };
}

const padRow = (text, width) => truncateToWidth(text, width, "", true);

// The composer takes the user box's shape (docs/pi-design.md rule 5): pi's rule
// lines become blank shaded rows, the content rows between them are shaded,
// and "❯ " sits in the padding columns of the first content line. The working
// spinner is not embedded here: it is the footer's own row above the composer,
// since pi's embedded status renders inside this top row and its standalone one
// is a column in under a blank line. Rendered lines carry their cursor marker
// inline, so replacing the padding shifts the cursor correctly; if the render
// shape ever changes, the prompt silently disappears instead of corrupting the
// editor.
export class CaretEditor extends sdk.CustomEditor {
  // The editor factory is handed an EditorTheme (borders and autocomplete only),
  // so the palette for the shade and the caret arrives separately.
  constructor(tui, theme, keybindings, { fleet, palette } = {}) {
    super(tui, theme, keybindings, { paddingX: PROMPT_PADDING, embedWorkingStatus: false });
    this.fleet = fleet;
    this.palette = palette;
  }
  // The palette is pi's live theme (a theme switch invalidates this editor
  // rather than rebuilding it), so the sequence is read per render, never cached.
  shade(line) {
    return this.shellMode() ? shade(this.palette, line, "toolErrorBg", "userMessageText") : shade(this.palette, line);
  }
  shellPrefix() {
    return this.state.lines[0].match(/^!{1,2}/)?.[0].length ?? 0;
  }
  shellMode() {
    return this.shellPrefix() > 0;
  }
  // Keep native text, history, paste expansion and dispatch untouched. Layout
  // and visual navigation see only the command; their columns map back below.
  commandView(draw) {
    const prefix = this.shellPrefix();
    if (!prefix) return draw();
    const state = this.state;
    this.state = { ...state, lines: [state.lines[0].slice(prefix), ...state.lines.slice(1)], cursorCol: state.cursorLine === 0 ? Math.max(0, state.cursorCol - prefix) : state.cursorCol };
    try { return draw(); } finally { this.state = state; }
  }
  layoutText(width) {
    return this.commandView(() => super.layoutText(width));
  }
  buildVisualLineMap(width) {
    const prefix = this.shellPrefix();
    return this.commandView(() => super.buildVisualLineMap(width)).map(line => line.logicalLine === 0 ? { ...line, startCol: line.startCol + prefix } : line);
  }
  setCursorCol(col) {
    super.setCursorCol(Math.max(this.state.cursorLine === 0 ? this.shellPrefix() : 0, col));
  }
  handleBackspace() {
    const prefix = this.shellPrefix();
    if (!prefix || this.state.cursorLine !== 0 || this.state.cursorCol !== prefix) return super.handleBackspace();
    this.exitHistoryBrowsing();
    this.lastAction = null;
    this.pushUndoSnapshot();
    this.state.lines[0] = this.state.lines[0].slice(prefix);
    this.setCursorCol(0);
    this.onChange?.(this.getText());
  }
  // Fleet navigation is an editor-owned mode (widgets cannot take focus). Down
  // enters it only when the editor itself had nothing left to do with the key,
  // so wrapped lines, line-end moves, history and autocomplete keep priority.
  handleInput(data) {
    const fleet = this.fleet;
    if (fleet?.focused()) {
      const action = ["down", "up", "confirm", "cancel"].find(name => this.keybindings.matches(data, `tui.select.${name}`)) ?? "other";
      if (fleet.handleKey(action)) return;
    } else if (fleet && this.keybindings.matches(data, "tui.editor.cursorDown") && !this.isShowingAutocomplete()) {
      const before = JSON.stringify([this.getCursor(), this.getLines()]);
      super.handleInput(data);
      if (JSON.stringify([this.getCursor(), this.getLines()]) === before) fleet.handleKey("enter");
      return;
    }
    // Native history uses logical column zero; shell mode starts after its
    // hidden prefix instead.
    if (this.shellMode() && this.keybindings.matches(data, "tui.editor.cursorUp") && !this.isShowingAutocomplete() && this.state.cursorLine === 0 && this.state.cursorCol === this.shellPrefix()) {
      this.navigateHistory(-1);
      return;
    }
    // Accepting an item with Tab closes the menu and nothing re-opens it, so the
    // command's arguments show nothing until a character is typed (and `~` and
    // `/`, where an added directory starts, are not pi's natural triggers). An
    // accept that changes the text and leaves the cursor on the command's space
    // or on a directory separator has a next level to show, so that level is
    // asked for — as the request a typed character makes, not as another Tab:
    // pi applies a lone candidate outright on an explicit Tab, so a level
    // holding one entry would be walked into as well, descending twice on the
    // one keypress.
    if (this.keybindings.matches(data, "tui.input.tab") && this.isShowingAutocomplete()) {
      const before = this.getText();
      super.handleInput(data);
      if (this.isShowingAutocomplete() || this.getText() === before) return;
      const { line, col } = this.getCursor();
      const lines = this.getLines();
      if (/[ /]$/.test((lines[line] ?? "").slice(0, col)) && commandArgument(lines, line, col)) this.tryTriggerAutocomplete();
      return;
    }
    const at = this.getCursor();
    const was = (this.getLines()[at.line] ?? "").length;
    super.handleInput(data);
    // pi opens the argument menu while typing on [A-Za-z0-9.\-_] only, so the
    // characters a path is typed with — the command's space, `/` and `~` — left
    // it closed. The same unforced request a letter makes is made for them,
    // through the gate the completion wrapper uses so the two cannot drift. The
    // character pi inserted is read back instead of matching `data`: a terminal
    // negotiating kitty or modifyOtherKeys sends a printable as an escape
    // sequence, and pi decodes it. The line has to have grown by that one
    // character too: moving the cursor right across a `/` advances it just the
    // same, and history recall replaces the whole line. An open menu has
    // already re-asked itself for the character; asking again would cancel that
    // request and start it over.
    const { line, col } = this.getCursor();
    if (line !== at.line || col !== at.col + 1 || this.isShowingAutocomplete()) return;
    const lines = this.getLines();
    const text = lines[line] ?? "";
    if (text.length !== was + 1) return;
    if (SEPARATORS.includes(text[col - 1]) && commandArgument(lines, line, col)) this.tryTriggerAutocomplete();
  }
  // The host copies the settings editorPaddingX (default 0) onto custom
  // editors right after construction and on settings reloads; the caret
  // needs its padding columns.
  setPaddingX(padding) {
    super.setPaddingX(Math.max(PROMPT_PADDING, padding));
  }
  // The rule lines become shaded rows (a scroll count when clipped, blank
  // otherwise), so the block keeps its line count and pi's mouse and
  // autocomplete row offsets stay valid.
  renderTopBorder(width, hidden) {
    return this.shade(padRow(hidden ? `${PAD}↑ ${hidden} more` : "", width));
  }
  renderBottomBorder(width, hidden) {
    this.bottomRow = this.shade(padRow(hidden ? `${PAD}↓ ${hidden} more` : "", width));
    return this.bottomRow;
  }
  render(width) {
    const lines = super.render(width);
    // Content sits between the two shaded rows; autocomplete follows the
    // bottom one and stays unshaded.
    const end = lines.lastIndexOf(this.bottomRow);
    const shell = this.shellMode();
    for (let i = 1; i < end; i++) {
      const prompt = i === 1 && lines[i].startsWith(" ".repeat(PROMPT_PADDING));
      const content = prompt ? lines[i].slice(PROMPT_PADDING) : lines[i];
      lines[i] = this.shade((prompt ? this.palette.fg(shell ? "error" : "accent", `${shell ? "!" : PROMPT} `) : "") + (shell ? this.palette.fg("userMessageText", content) : content));
    }
    return lines;
  }
}

// `readonly` is also every read-only role's state in execute mode, so the
// planning workflow is gated on the root in plan mode: a child has neither
// submit_plan nor ask_user_question (policy.mjs rootTools).
// Fills the `workflow` system prompt section (see before_agent_start).
export function workflowPrompt({ mode, readonly, isRoot }) {
  const planning = isRoot && mode === "plan" ? " Research the request to the point of a plan without being asked: read what the change touches, delegate the independent exploration, and ask with ask_user_question where different readings would lead to materially different work. Then submit the plan for explicit approval yourself — the user should not have to ask for it. Approval switches the mode and revokes running child sessions, aborting their work: settle async children before submitting the plan, or launch them after." : "";
  return `Workflow mode: ${mode}. ${readonly ? `Investigate only; source edits and external mutations are disabled.${planning}` : "Execute only the user-approved task."}`;
}

export function activeToolNames(tools, { ready, permitted, isRoot, mode, currentContext }) {
  if (!ready) return [];
  const planningRoot = isRoot && mode === "plan";
  return tools.map(tool => tool.name).filter(name => permitted(name)
    && !(planningRoot && (name === "workspace_write" || name === "workspace_edit"))
    && !(name === "ask_user_question" && (currentContext?.mode !== "tui" || !currentContext?.hasUI)));
}

export async function installWorkflow(pi, configPath = join(sdk.getAgentDir(), "workflow.json"), role = "root", runtime = {}) {
  const startBroker = runtime.startBroker ?? createPolicyBroker;
  const requestBroker = runtime.requestBroker ?? callPolicyBroker;
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const isRoot = role === "root";
  const subagentDescription = isRoot ? readFileSync(join(sdk.getAgentDir(), "subagent-tool-description.md"), "utf8").trim() : undefined;
  if (isRoot && !subagentDescription) throw new Error("Managed subagent description is empty");
  let currentContext;
  let userTask = "";
  // This process's recent shell commands (command, sandboxed, exit code; never
  // output), sent with every bash authorization as the classifier's evidence.
  const shellHistory = [];
  let ready = false;
  let shuttingDown = false;
  let installed = false;
  let ceiling;
  let fleet;
  let surfaces;
  let releaseChild;
  let childRevoked = false;
  let broker;
  let env;
  const jiti = createJiti(import.meta.url);
  const { registerSubagentCapabilityCeiling } = await jiti.import("pi-subagents/capability-ceiling");
  const { resolveSubagentLaunchContract } = await jiti.import("pi-subagents/preflight");

  // Children carry the epoch they were launched under; the broker refuses a
  // child arriving after a later epoch, so root must refresh this on every bump.
  const publishEpoch = () => { process.env.PI_WORKFLOW_EPOCH = String(broker.policy.epoch); };
  if (isRoot) {
    broker = await startBroker(config, process.cwd(), request => reviewAction(currentContext, config, userTask, request));
    env = broker.env;
    Object.assign(process.env, env);
    publishEpoch();
  } else {
    env = { PI_WORKFLOW_SOCKET: process.env.PI_WORKFLOW_SOCKET, PI_WORKFLOW_TOKEN: process.env.PI_WORKFLOW_TOKEN, PI_WORKFLOW_EPOCH: process.env.PI_WORKFLOW_EPOCH };
    await requestBroker(env, role, { action: "state" });
  }
  const permittedTools = isRoot ? rootTools : config.agents[role].tools;
  const permitted = name => permittedTools.includes(name) || (permittedTools.includes("mcp") && isDirectMcpTool(name));
  const refreshActiveTools = () => pi.setActiveTools(activeToolNames(pi.getAllTools(), {
    ready, permitted, isRoot, mode: broker?.policy.mode, currentContext,
  }));

  async function authorize(tool, args) {
    if (!ready) throw new Error("Managed workflow is not ready");
    return requestBroker(env, role, { action: "authorize", tool, args, ...(tool === "bash" ? { history: trimHistory(shellHistory) } : {}) });
  }

  const toolFactory = name => sdk[`create${name[0].toUpperCase()}${name.slice(1)}ToolDefinition`];
  // Session env exposure is disabled: exec runs in a worker whose environment
  // is the broker-leased safe set, so session variables would never arrive.
  const bashOptions = { exposeSessionEnvironment: false };
  const workerEnv = { ...env, PI_WORKFLOW_ROLE: role };

  // Background tasks end in a steer message (heard with the next tool result,
  // or as a new turn when idle, as Claude Code's task notification is) and one
  // completion line; the message is not displayed, the line is its record.
  const tasks = createTasks({
    notify: text => pi.sendMessage({ customType: "workflow-task", content: text, display: false }, { deliverAs: "steer", triggerTurn: true }),
    record: entry => appendVisible(pi, "workflow-task", entry),
  });
  pi.registerEntryRenderer("workflow-task", doneEntryRenderer("workflow-task"));
  const background = permittedTools.includes("workspace_task");
  const TASK_GRACE_MS = 10_000;

  function sandboxTool(name) {
    if (!permittedTools.includes(publicToolName(name))) return;
    const template = toolFactory(name)(process.cwd(), name === "bash" ? bashOptions : undefined);
    // Claude Code's bash flags, added to the SDK's own schema: run_in_background
    // where the role has workspace_task, dangerouslyDisableSandbox where the
    // role may write (the policy refuses it for read-only roles regardless).
    const flags = name !== "bash" ? {} : {
      ...(background ? { run_in_background: { type: "boolean", description: "Run the command as a background task for work that outlasts this turn (servers, long builds, full test suites): a command that ends within 10 s is answered here like a foreground call; a longer one returns its task id at once and its output arrives when it ends, or through workspace_task." } } : {}),
      ...(isRoot || !config.agents[role].readonly ? { dangerouslyDisableSandbox: { type: "boolean", description: "Run outside the OS sandbox with the full host environment; every such call is reviewed or prompted. Set it only when the user asks, or when this exact command just failed with a sandbox restriction (operation not permitted, denied path, blocked host or socket), and decide per command: an earlier approval does not carry over." } } : {}),
    };
    const parameters = Object.keys(flags).length ? { ...template.parameters, properties: { ...template.parameters.properties, ...flags } } : template.parameters;
    pi.registerTool({ ...template, parameters, ...toolRenderers(name), name: publicToolName(name), promptGuidelines: GUIDELINES[name], async execute(id, args, signal, onUpdate, ctx) {
      const { ticket } = await authorize(name, args);
      if (name === "bash" && background && args.run_in_background) {
        // No turn signal: the task outlives the call, and only workspace_task or a mode change stops it.
        const client = startToolWorker(name, { cwd: currentContext.cwd, env: workerEnv, ticket });
        const exec = recordingExec(shellHistory, args, (params, options) => client.call("exec", params, options));
        const taskId = tasks.start({
          command: args.command,
          run: (onChunk, taskSignal) => exec({ command: args.command, cwd: currentContext.cwd, timeout: args.timeout }, { signal: taskSignal, onChunk: chunk => onChunk(chunk.toString()) }),
          close: () => client.close(),
        });
        // Answered like a foreground call: a failure throws with the SDK bash
        // tool's trailer, and no taskId in details (the row summary keys
        // "running" on it).
        const settled = await tasks.settle(taskId, TASK_GRACE_MS, signal);
        if (settled !== null) {
          const output = settled.output || "(no output)";
          if (settled.status !== "completed") throw new Error(`${output}\n${settled.exitCode != null ? `Command exited with code ${settled.exitCode}` : `Command ${settled.status}: ${settled.error ?? "killed"}`}`);
          return { content: [{ type: "text", text: output }], details: { settled: taskId } };
        }
        return { content: [{ type: "text", text: `Started background task ${taskId}; its output arrives when it ends. Use workspace_task to read or stop it.` }], details: { taskId } };
      }
      const client = startToolWorker(name, { cwd: currentContext.cwd, env: workerEnv, ticket, signal });
      try {
        if (name === "grep") return await executeSandboxGrep(client, args, signal);
        const operations = workerOperations(client)[name];
        if (name === "bash") operations.exec = recordingExec(shellHistory, args, operations.exec);
        const tool = toolFactory(name)(currentContext.cwd, name === "bash" ? { ...bashOptions, operations } : { operations });
        return await tool.execute(id, args, signal, onUpdate, ctx);
      } finally { await client.close(); }
    } });
  }
  for (const name of ["read", "write", "edit", "bash", "grep", "find", "ls"]) sandboxTool(name);
  if (background) {
    pi.registerTool({ name: "workspace_task", label: "Background task", description: "List background tasks, read their output so far, or stop one.", parameters: Type.Object({ id: Type.Optional(Type.String()), action: Type.Union([Type.Literal("list"), Type.Literal("output"), Type.Literal("stop")]) }), ...taskRenderers, async execute(_id, args) {
      if (args.action === "list") {
        const listed = tasks.list();
        return resultText(listed.length ? listed.map(task => `${task.id} · ${task.status} · ${task.command}`).join("\n") : "No background tasks");
      }
      if (!args.id) throw new Error(`workspace_task ${args.action} requires id`);
      if (args.action === "stop") return resultText(tasks.stop(args.id) ? `Stopping task ${args.id}` : `Task ${args.id} had already ended`);
      return resultText(tasks.output(args.id));
    } });
  }

  pi.on("tool_call", async (event, ctx) => {
    try {
      if (!ready || !permitted(event.toolName)) throw new Error("Tool not available in this managed scope");
      if (event.toolName === "mcp" && event.input.action) throw new Error("MCP authentication/UI actions are user-operated, not model tools");
      if (event.toolName === "subagent") {
        const mode = isRoot ? broker.policy.mode : (await requestBroker(env, role, { action: "state" })).mode;
        await checkChildLaunch(event.input, config, role, ctx, resolveSubagentLaunchContract, mode);
      }
      // The adapter's broker handles resolved MCP operations, not proxy arguments.
    } catch (error) { return { block: true, reason: error.message }; }
  });
  // A `!` command is the user's own: host shell and environment, no sandbox or
  // review (Claude Code's `!`), minus the broker credentials.
  const localShell = sdk.createLocalBashOperations();
  pi.on("user_bash", () => ({ operations: {
    exec: (command, cwd, options) => localShell.exec(command, cwd, { ...options, env: hostEnvironment() }),
  } }));

  pi.events.on("pi-mcp-adapter:tool-approval-request", request => {
    request.claim(async () => {
      if (!ready) return "deny";
      try {
        await requestBroker(env, role, { action: "mcp", server: request.serverName, tool: request.originalToolName, args: request.args });
        return request.signal?.aborted ? "deny" : "allow_once";
      } catch { return "deny"; }
    });
  });

  // herdr's pi extension reports `blocked` only on this bus event; pi's prompt
  // span is the one signal covering plan approval, questions and broker confirms.
  pi.on("ui_prompt_start", event => pi.events.emit("herdr:blocked", { active: true, label: event.title }));
  pi.on("ui_prompt_end", () => pi.events.emit("herdr:blocked", { active: false }));

  // Mode and approval reach the status line as one string so the two can never
  // drift; the footer paints it, where the theme is live.
  const publishStatus = ctx => ctx.ui.setStatus("workflow", `${broker.policy.mode} ${broker.policy.approval}`);

  async function setMode(mode, ctx, { cleanup = true } = {}) {
    if (!broker) throw new Error("Only the parent can change workflow mode");
    ready = false;
    refreshActiveTools();
    if (cleanup) {
      // Stop owners while unavailable, before the broker changes its policy:
      // shells settle normally, then detached plugin runners are stopped.
      await tasks.stopAll();
      if (tasks.live()) throw new Error("Background shell cleanup did not finish; workflow remains unavailable");
      await fleet.stopAll();
    }
    await broker.setMode(mode);
    publishEpoch();
    ceiling?.update({ allowedAgents: allowedChildAgents(config, role, broker.policy.mode), allowedTools: permittedTools });
    ready = true;
    refreshActiveTools();
    pi.setThinkingLevel(mode === "plan" ? config.models.planEffort : config.models.defaultEffort);
    publishStatus(ctx);
  }

  async function shutdown() {
    ready = false;
    refreshActiveTools();
    shuttingDown = true;
    const failures = [];
    const attempt = async (label, action) => {
      try { await action(); }
      catch (error) { failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
    };
    await attempt("background shells", () => tasks.stopAll({ silent: true }));
    if (tasks.live()) failures.push("background shells: cleanup timed out");
    if (isRoot) {
      if (currentContext) await attempt("detached subagents", () => fleet.stopAll());
    } else releaseChild?.();
    await attempt("capability ceiling", () => ceiling?.dispose());
    if (broker) {
      await attempt("broker", () => broker.close());
      delete process.env.PI_WORKFLOW_EPOCH;
      for (const [key, value] of Object.entries(env)) if (process.env[key] === value) delete process.env[key];
    }
    if (failures.length) throw new Error(`Workflow shutdown cleanup failed: ${failures.join("; ")}`);
  }

  pi.on("session_start", async (_event, ctx) => {
    if (!installed) throw new Error("Workflow installation failed; tools remain disabled");
    currentContext = ctx;
    shuttingDown = false;
    const mode = isRoot ? broker.policy.mode : (await requestBroker(env, role, { action: "state" })).mode;
    ceiling?.dispose();
    ceiling = registerSubagentCapabilityCeiling({ sessionId: ctx.sessionManager.getSessionId(), source: "managed-workflow", ceiling: { allowedAgents: allowedChildAgents(config, role, mode), allowedTools: permittedTools } });
    fleet?.attachContext(ctx);
    if (broker) await setMode("plan", ctx, { cleanup: false });
    else {
      releaseChild = await acquireChild(env, role, release => {
        ready = false;
        refreshActiveTools();
        childRevoked = true;
        ctx.abort();
        if (ctx.isIdle()) release();
      });
      ready = !childRevoked;
    }
    if (ctx.hasUI) ctx.ui.setToolsExpanded(false);
    if (isRoot && ctx.hasUI) {
      if (!surfaces) {
        installFolding(pi, ctx);
        surfaces = { footer: installFooter(pi, ctx, { fleet, tasks }) };
      }
      // pi resets every extension surface when a session is invalidated
      // (/new, /resume), so these are applied on each session start.
      installHeader(ctx);
      surfaces.footer.attach(ctx);
      ctx.ui.setEditorComponent((tui, theme, keybindings) => new CaretEditor(tui, theme, keybindings, { fleet, palette: ctx.ui.theme }));
      ctx.ui.addAutocompleteProvider(argumentCompletions);
    }
    refreshActiveTools();
    if (!ctx.modelRegistry.find(config.models.provider, config.models.tiers.frontier)) ctx.ui.notify("Astra is configured as frontier but unavailable in this Pi model catalog; no fallback will be used.", "warning");
  });
  pi.on("input", event => {
    if (isRoot && event.source !== "extension") userTask = `${userTask}\n${event.text}`.slice(-8000);
    return { action: "continue" };
  });
  pi.on("agent_end", () => { if (childRevoked) releaseChild?.(); });
  pi.on("before_agent_start", async (event, ctx) => {
    if (!ready || canonical(ctx.cwd) !== canonical(currentContext.cwd)) throw new Error("Restart the managed workflow after changing workspace");
    const model = ctx.model;
    if (!model || model.provider !== config.models.provider || !Object.values(config.models.tiers).includes(model.id) || !ctx.modelRegistry.isUsingOAuth(model)) throw new Error("Select an available managed OpenAI subscription model; API fallback is disabled");
    const state = await requestBroker(env, role, { action: "state" });
    // A returned systemPrompt forces the whole prompt and rewrites the
    // request's leading instructions on every change;
    // sections and context files are diffed against the transcript and
    // patched in one mid-conversation system message instead.
    const options = event.systemPromptOptions;
    for (const { path, content } of extraDirs.values()) options.contextFiles.push({ path, content });
    options.sections.workflow = workflowPrompt({ mode: state.mode, readonly: state.readonly, isRoot });
  });

  // /add-dir, Claude Code's added working directory: the policy widens the
  // edit scope, and the directory's AGENTS.md (or CLAUDE.md) rides the
  // prompt's project context. Skills under it need a restart with --skill: pi
  // discovers resources at startup and /reload, and /reload would also
  // restart the broker.
  const extraDirs = new Map();

  // Plugin rows take the transcript's shape (docs/pi-design.md); the
  // registrations themselves are the plugins' own.
  const styled = pluginApi(pi, name => pluginRenderers(name, { servers: Object.keys(config.mcp) }), { [CONTROL_NOTICE]: controlNotice }, [SUBAGENT_NOTIFY], narrowSubagentSchema, () => shuttingDown, subagentDescription);
  // Fleet owns detached-run lifecycle for every root, including headless roots;
  // only its footer rendering is conditional on UI. Register our shutdown
  // before pi-subagents installs its hook, which disposes the RPC bridge.
  if (isRoot) fleet = installFleet(pi, null);
  pi.on("session_shutdown", shutdown);
  if (isRoot) {
    pi.registerCommand("plan", { description: "Stop sandbox work and enter read-only planning", handler: (_args, ctx) => setMode("plan", ctx) });
    pi.registerCommand("execute", { description: "Approve the current plan and enable scoped execution", handler: async (_args, ctx) => {
      if (ctx.hasUI && await ctx.ui.confirm("Approve the current plan?", "Enable scoped edits and auto-reviewed actions for this task?")) await setMode("execute", ctx);
    } });
    pi.registerCommand("approvals", { description: "Choose auto-reviewed or individually prompted approvals", handler: async (_args, ctx) => {
      const value = await ctx.ui.select("Approval mode", ["auto", "ask"]);
      if (value) { broker.policy.approval = value; broker.policy.epoch++; publishEpoch(); publishStatus(ctx); }
    } });
    const completions = values => values.map(value => ({ value, label: value }));
    pi.registerCommand("add-dir", { description: "Add a directory to the editable workspace and load its AGENTS.md", getArgumentCompletions: prefix => completions(broker.policy.addableDirs(prefix)), handler: async (args, ctx) => {
      const input = args?.trim();
      if (!input) return ctx.ui.notify("Type a directory after /add-dir", "info");
      let dir;
      let instructions;
      try {
        dir = broker.policy.addRoot(input);
        // Read through the policy; a refusal takes the root back out.
        try { instructions = broker.policy.instructions(dir); } catch (error) { broker.policy.removeRoot(dir); throw error; }
      } catch (error) { ctx.ui.notify(error.message, "error"); return; }
      if (instructions?.content) extraDirs.set(dir, instructions); else extraDirs.delete(dir);
      // A wider scope is a new epoch, as an approval change is; running
      // processes keep their narrower profile until their next lease.
      broker.policy.epoch++;
      publishEpoch();
      appendVisible(pi, "workflow-note", { text: `Added ${dir} to the workspace${instructions?.content ? " with its instructions" : ""}` });
    } });
    pi.registerCommand("remove-dir", { description: "Remove an added directory from the workspace", getArgumentCompletions: prefix => completions([...broker.policy.roots.keys()].filter(root => root.startsWith(prefix))), handler: async (args, ctx) => {
      if (!broker.policy.roots.size) return ctx.ui.notify("No added directories", "info");
      const input = args?.trim();
      if (!input) return ctx.ui.notify("Type a directory after /remove-dir", "info");
      const dir = canonical(expand(input, broker.policy.cwd));
      try { broker.policy.removeRoot(dir); } catch (error) { return ctx.ui.notify(error.message, "error"); }
      extraDirs.delete(dir);
      // Narrowing stops running processes, as a mode change does.
      await setMode(broker.policy.mode, ctx);
      appendVisible(pi, "workflow-note", { text: `Removed ${dir} from the workspace` });
    } });
    pi.registerEntryRenderer("workflow-note", (entry, _options, theme) => new Text(noteLine(entry.data.text, theme), 0, 0));
    // The questionnaire owns its invisible renderers; completed answers feed
    // the classifier's task context and one transcript entry.
    registerQuestionnaire(pi);
    pi.on("tool_execution_end", event => {
      const details = event.result?.details;
      if (event.toolName !== "ask_user_question" || event.isError || event.result?.isError || details?.error || details?.cancelled || !details?.answers?.length) return;
      const answers = details.answers.map(entry => {
        const selected = entry.selected?.map(option => `${option.label}${option.note ? ` — ${option.note}` : ""}`).join("; ") ?? "";
        return { question: entry.question, answer: selected, notes: entry.custom ?? "" };
      }).filter(entry => entry.answer || entry.notes);
      if (!answers.length) return;
      userTask = `${userTask}\n${answers.map(entry => `User decision: ${entry.question} → ${[entry.answer, entry.notes].filter(Boolean).join(" — ")}`).join("\n")}`.slice(-8000);
      appendVisible(pi, "workflow-answers", { answers });
    });
    pi.registerEntryRenderer("workflow-answers", (entry, _options, theme) => new Text(answerLines(entry.data.answers, theme).join("\n"), 0, 0));
    pi.registerMarkdownTransformer(bulletMarkdown);
    // Reasoning leaves the settled message as well as the transcript; the
    // markdown transformer only reaches the render, and pi spaces the message
    // from its raw content (see blankReasoning). The same holds while the
    // message streams (see hideStreamingReasoning).
    pi.on("message_end", event => {
      const isolated = isolatePlanApproval(event.message);
      const message = blankReasoning(isolated ?? event.message);
      return isolated || message ? { message: message ?? isolated } : undefined;
    });
    pi.on("message_update", event => { hideStreamingReasoning(event.message); });
    pi.registerTool({ name: "submit_plan", label: "Plan approval", description: "Present a concise implementation plan—recommended approach, affected files, and verification—for explicit user approval.", parameters: Type.Object({ plan: Type.String() }), executionMode: "sequential", ...planRenderers, async execute(_id, args, signal) {
      const ctx = currentContext;
      // The plan itself is the row above (planRenderers), not the approval UI's body.
      const decision = await requestPlanApproval(ctx, signal);
      return applyPlanDecision(decision, {
        plan: args.plan,
        userTask,
        setUserTask: value => { userTask = value; },
        setMode: () => setMode("execute", ctx),
        abort: () => ctx.abort(),
      });
    } });
    // Registered as documented; model-originated launches are validated (and
    // their args patched) by the blocking tool_call hook, the capability
    // ceiling bounds every launch path, and the broker's child leases enforce
    // capacity and runtime role.
    const subagents = runtime.installSubagents ?? await jiti.import("pi-subagents", { default: true });
    await subagents(styled);
  }

  // Provider-native web search (OpenAI's server-side web_search tool on the
  // same Codex endpoint and token as model calls). Its Gemini-only url_context
  // registers too and stays outside every role's tool list.
  if (permittedTools.includes("web_search")) {
    const webSearch = await jiti.import("pi-web-search", { default: true });
    webSearch(styled);
  }
  if (permittedTools.includes("mcp")) {
    const { createMcpAdapter } = await jiti.import("pi-mcp-adapter");
    await createMcpAdapter({ config: { mcpServers: mcpServerDefinitions(config, role), settings: mcpAdapterSettings } })(styled);
  }
  // Plugin session hooks may refresh their own registrations, so ours runs
  // last and restores the managed exposure after every startup or resume.
  pi.on("session_start", refreshActiveTools);
  installed = true;
}

export default pi => installWorkflow(pi);
