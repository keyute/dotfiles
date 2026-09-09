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
import { reviewAction } from "./approval.mjs";
import { checkChildLaunch } from "./children.mjs";
import { installFooter } from "./footer.mjs";
import { installHeader } from "./header.mjs";
import { installFleet } from "./fleet.mjs";
import { createTasks } from "./tasks.mjs";
import { PAD, PROMPT, answerLines, blankReasoning, bulletMarkdown, completionLine, installFolding, noteLine, noticeLine, planRenderers, pluginRenderers, taskRenderers, toolRenderers } from "./rows.mjs";

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

// Definitions must be identical across sessions: pi-mcp-adapter keys its
// metadata cache on them, env included, and a cold cache costs a connect and
// describe round trip per server per session. The runner takes the broker
// socket and token from the inherited process environment, never from here.
export const mcpServerDefinitions = (config, role) => Object.fromEntries(Object.entries(config.mcp).map(([name, entry]) => [name, {
  command: process.execPath, args: [runnerPath, "server", name], env: { PI_WORKFLOW_ROLE: role },
  excludeTools: entry.policy.denied_tools, ...(entry.policy.allowed_tools?.length ? { includeTools: entry.policy.allowed_tools } : {}), approveTools: true,
  directTools: entry.policy.direct_tools === true,
}]));
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
export const controlNotice = (message, _options, theme) => {
  const event = message?.details?.event;
  if (!event?.agent || !event.message) return undefined;
  return new Text(noticeLine({ agent: event.agent, failed: event.reason === "completion_guard", message: event.message }, theme), 0, 0);
};

// Plugins register their tools and their custom message renderers through the
// API they are handed and pi keeps what they pass, so a Proxy that decorates
// every registration gives their rows the transcript's shape without touching
// schema, execution or message content. A message renderer we own is composed
// over the plugin's, which stays as the fallback: ours answers undefined for a
// payload it does not recognise, so a plugin that changes its details shape
// renders its own way again rather than losing its notice. Everything else
// (events included) is the original, and the raw function is called on the raw
// API because the adapter extracts it.
export function pluginApi(pi, renderersFor, messageRenderers = {}) {
  return new Proxy(pi, {
    get(target, key, receiver) {
      if (key === "registerTool") return tool => target.registerTool({ ...tool, ...renderersFor(tool.name) });
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
  // The editor's fake cursor ends in a full SGR reset, which also drops the
  // background; re-open it after every reset so the shade spans the line. The
  // palette is pi's live theme (a theme switch invalidates this editor rather
  // than rebuilding it), so the sequence is read per render, never cached.
  shade(line) {
    const open = this.palette.bg("userMessageBg", "").replace(/\x1b\[49m$/, "");
    return this.palette.bg("userMessageBg", line.replaceAll("\x1b[0m", `\x1b[0m${open}`));
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
    // Accepting an item with Tab closes the menu and nothing re-opens it, so the
    // command's arguments show nothing until a character is typed (and `~` and
    // `/`, where an added directory starts, are not pi's natural triggers). An
    // accept that left the cursor on the command's space or on a directory
    // separator has a next level to show, so that level is asked for — as the
    // request a typed character makes, not as another Tab: pi applies a lone
    // candidate outright on an explicit Tab, so a level holding one entry would
    // be walked into as well, descending twice on the one keypress.
    if (this.keybindings.matches(data, "tui.input.tab") && this.isShowingAutocomplete()) {
      super.handleInput(data);
      const { line, col } = this.getCursor();
      if (!this.isShowingAutocomplete() && /^\/\S+ (.*[ /])?$/.test((this.getLines()[line] ?? "").slice(0, col))) this.tryTriggerAutocomplete();
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
    const text = this.getLines()[line] ?? "";
    if (line !== at.line || col !== at.col + 1 || text.length !== was + 1 || this.isShowingAutocomplete()) return;
    if (SEPARATORS.includes(text[col - 1]) && commandArgument(this.getLines(), line, col)) this.tryTriggerAutocomplete();
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
    if (end > 1 && lines[1].startsWith(" ".repeat(PROMPT_PADDING))) lines[1] = this.palette.fg("accent", `${PROMPT} `) + lines[1].slice(PROMPT_PADDING);
    for (let i = 1; i < end; i++) lines[i] = this.shade(lines[i]);
    return lines;
  }
}

export async function installWorkflow(pi, configPath = join(sdk.getAgentDir(), "workflow.json"), role = "root", runtime = {}) {
  const startBroker = runtime.startBroker ?? createPolicyBroker;
  const requestBroker = runtime.requestBroker ?? callPolicyBroker;
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const isRoot = role === "root";
  let currentContext;
  let userTask = "";
  // This process's recent shell commands (command, sandboxed, exit code; never
  // output), sent with every bash authorization as the classifier's evidence.
  const shellHistory = [];
  let ready = false;
  let installed = false;
  let ceiling;
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
    record: entry => pi.appendEntry("workflow-task", entry),
  });
  pi.registerEntryRenderer("workflow-task", (entry, _options, theme) => new Text(completionLine({ agent: `task ${entry.data.id}`, task: entry.data.command, status: entry.data.status, durationMs: entry.data.durationMs }, theme), 0, 0));
  const background = permittedTools.includes("workspace_task");

  function sandboxTool(name) {
    if (!permittedTools.includes(publicToolName(name))) return;
    const template = toolFactory(name)(process.cwd(), name === "bash" ? bashOptions : undefined);
    // Claude Code's bash flags, added to the SDK's own schema: run_in_background
    // where the role has workspace_task, dangerouslyDisableSandbox where the
    // role may write (the policy refuses it for read-only roles regardless).
    const flags = name !== "bash" ? {} : {
      ...(background ? { run_in_background: { type: "boolean", description: "Start the command as a background task and return at once; its output arrives when it ends, or through workspace_task." } } : {}),
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
    pi.registerTool({ name: "workspace_task", label: "Background task", description: "Read the output so far of a background task started by workspace_bash with run_in_background, or stop it.", parameters: Type.Object({ id: Type.String(), action: Type.Union([Type.Literal("output"), Type.Literal("stop")]) }), ...taskRenderers, async execute(_id, args) {
      if (args.action === "stop") return resultText(tasks.stop(args.id) ? `Stopping task ${args.id}` : `Task ${args.id} had already ended`);
      return resultText(tasks.output(args.id));
    } });
  }

  pi.on("tool_call", async (event, ctx) => {
    try {
      if (!ready || !permitted(event.toolName)) throw new Error("Tool not available in this managed scope");
      if (event.toolName === "mcp" && event.input.action) throw new Error("MCP authentication/UI actions are user-operated, not model tools");
      if (event.toolName === "subagent") await checkChildLaunch(event.input, config, role, ctx, resolveSubagentLaunchContract);
      // The adapter's broker handles resolved MCP operations, not proxy arguments.
    } catch (error) { return { block: true, reason: error.message }; }
  });
  pi.on("user_bash", async event => {
    let client;
    try {
      const { ticket } = await authorize("bash", { command: event.command });
      client = startToolWorker("bash", { cwd: currentContext.cwd, env: workerEnv, ticket });
      let output = "";
      // Recorded like a model command: a `!` run that fails sandboxed is evidence too.
      const exec = recordingExec(shellHistory, { command: event.command }, (params, options) => client.call("exec", params, options));
      const { exitCode } = await exec({ command: event.command, cwd: currentContext.cwd }, { onChunk: chunk => { output += chunk; } });
      return { result: { output, exitCode: exitCode ?? 1, cancelled: false, truncated: false } };
    } catch (error) {
      return { result: { output: error.message, exitCode: 1, cancelled: false, truncated: false } };
    } finally { await client?.close(); }
  });

  pi.events.on("pi-mcp-adapter:tool-approval-request", request => {
    request.claim(async () => {
      if (!ready) return "deny";
      try {
        await requestBroker(env, role, { action: "mcp", server: request.serverName, tool: request.originalToolName, args: request.args });
        return request.signal?.aborted ? "deny" : "allow_once";
      } catch { return "deny"; }
    });
  });

  async function setMode(mode, ctx) {
    if (!broker) throw new Error("Only the parent can change workflow mode");
    ready = false;
    // Stopped here, before the broker revokes their leases, so a task ends as
    // "stopped" rather than as a lost worker.
    tasks.stopAll();
    await broker.setMode(mode);
    publishEpoch();
    ready = true;
    pi.setThinkingLevel(mode === "plan" ? config.models.planEffort : config.models.defaultEffort);
    ctx.ui.setStatus("workflow", mode);
  }

  pi.on("session_start", async (_event, ctx) => {
    if (!installed) throw new Error("Workflow installation failed; tools remain disabled");
    currentContext = ctx;
    const allowedAgents = Object.entries(config.agents).filter(([, child]) => isRoot || !config.agents[role].readonly || child.readonly).map(([name]) => name);
    ceiling?.dispose();
    ceiling = registerSubagentCapabilityCeiling({ sessionId: ctx.sessionManager.getSessionId(), source: "managed-workflow", ceiling: { allowedAgents, allowedTools: permittedTools } });
    if (broker) await setMode("plan", ctx);
    else {
      releaseChild = await acquireChild(env, role, release => {
        ready = false;
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
        const fleet = installFleet(pi, ctx);
        surfaces = { fleet, footer: installFooter(pi, ctx, { fleet, tasks }) };
      }
      // pi resets every extension surface when a session is invalidated
      // (/new, /resume), so these are applied on each session start.
      installHeader(ctx);
      surfaces.footer.attach(ctx);
      ctx.ui.setEditorComponent((tui, theme, keybindings) => new CaretEditor(tui, theme, keybindings, { fleet: surfaces.fleet, palette: ctx.ui.theme }));
      ctx.ui.addAutocompleteProvider(argumentCompletions);
    }
    pi.setActiveTools(pi.getAllTools().map(tool => tool.name).filter(permitted));
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
    const added = [...extraDirs].filter(([, text]) => text).map(([dir, text]) => `\n\n# Instructions for ${dir}\n\n${text}`).join("");
    return { systemPrompt: `${event.systemPrompt}${added}\n\nWorkflow mode: ${state.mode}. ${state.readonly ? "Investigate only; source edits and external mutations are disabled. Submit the plan for explicit approval before implementation." : "Execute only the user-approved task."}` };
  });

  // /add-dir, Claude Code's added working directory: the policy widens the
  // edit scope and the directory's AGENTS.md (or CLAUDE.md) rides the system
  // prompt. Skills under it need a restart with --skill: pi discovers
  // resources at startup and /reload, and /reload would also restart the broker.
  const extraDirs = new Map();

  // Plugin rows take the transcript's shape (docs/pi-design.md); the
  // registrations themselves are the plugins' own.
  const styled = pluginApi(pi, name => pluginRenderers(name, { servers: Object.keys(config.mcp) }), { [CONTROL_NOTICE]: controlNotice });
  if (isRoot) {
    pi.registerCommand("plan", { description: "Stop sandbox work and enter read-only planning", handler: (_args, ctx) => setMode("plan", ctx) });
    pi.registerCommand("execute", { description: "Approve the current plan and enable scoped execution", handler: async (_args, ctx) => {
      if (ctx.hasUI && await ctx.ui.confirm("Approve the current plan?", "Enable scoped edits and auto-reviewed actions for this task?")) await setMode("execute", ctx);
    } });
    pi.registerCommand("approvals", { description: "Choose auto-reviewed or individually prompted approvals", handler: async (_args, ctx) => {
      const value = await ctx.ui.select("Approval mode", ["auto", "ask"]);
      if (value) { broker.policy.approval = value; broker.policy.epoch++; publishEpoch(); ctx.ui.setStatus("workflow", broker.policy.mode); }
    } });
    const completions = values => values.map(value => ({ value, label: value }));
    pi.registerCommand("add-dir", { description: "Add a directory to the editable workspace and load its AGENTS.md", getArgumentCompletions: prefix => completions(broker.policy.addableDirs(prefix)), handler: async (args, ctx) => {
      const input = args?.trim();
      if (!input) return ctx.ui.notify("Type a directory after /add-dir", "info");
      let dir;
      let text;
      try {
        dir = broker.policy.addRoot(input);
        // Read through the policy; a refusal takes the root back out.
        try { text = broker.policy.instructions(dir); } catch (error) { broker.policy.removeRoot(dir); throw error; }
      } catch (error) { ctx.ui.notify(error.message, "error"); return; }
      extraDirs.set(dir, text);
      // A wider scope is a new epoch, as an approval change is; running
      // processes keep their narrower profile until their next lease.
      broker.policy.epoch++;
      publishEpoch();
      pi.appendEntry("workflow-note", { text: `Added ${dir} to the workspace${extraDirs.get(dir) ? " with its instructions" : ""}` });
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
      pi.appendEntry("workflow-note", { text: `Removed ${dir} from the workspace` });
    } });
    pi.registerEntryRenderer("workflow-note", (entry, _options, theme) => new Text(noteLine(entry.data.text, theme), 0, 0));
    // The questionnaire dialog is the pinned plugin's; the answers feed the
    // classifier's task context and the transcript line from its result.
    const askUserQuestion = await jiti.import("@juicesharp/rpiv-ask-user-question", { default: true });
    askUserQuestion(styled);
    pi.on("tool_execution_end", event => {
      // A cancelled questionnaire keeps its partial answers in details; they
      // are not decisions.
      if (event.toolName !== "ask_user_question" || event.result?.details?.cancelled) return;
      // A multi-select answers in `selected` with a null `answer`, and either
      // kind can carry notes instead of a choice — the whole decision, when the
      // user writes rather than picks.
      const answers = (event.result?.details?.answers ?? []).map(entry => ({ question: entry.question, answer: entry.answer ?? entry.selected?.join(", ") ?? "", notes: entry.notes ?? "" })).filter(entry => entry.answer || entry.notes);
      const globalNote = event.result?.details?.globalNote;
      if (!answers.length && !globalNote) return;
      const decisions = answers.map(entry => `User decision: ${entry.question} → ${[entry.answer, entry.notes].filter(Boolean).join(" — ")}`);
      if (globalNote) decisions.push(`User note: ${globalNote}`);
      userTask = `${userTask}\n${decisions.join("\n")}`.slice(-8000);
      pi.appendEntry("workflow-answers", { answers, ...(globalNote ? { globalNote } : {}) });
    });
    pi.registerEntryRenderer("workflow-answers", (entry, _options, theme) => new Text(answerLines(entry.data.answers, theme, entry.data.globalNote).join("\n"), 0, 0));
    pi.registerMarkdownTransformer(bulletMarkdown);
    // Reasoning leaves the settled message as well as the transcript; the
    // markdown transformer only reaches the render, and pi spaces the message
    // from its raw content (see blankReasoning).
    pi.on("message_end", event => {
      const message = blankReasoning(event.message);
      return message ? { message } : undefined;
    });
    pi.registerTool({ name: "submit_plan", label: "Plan approval", description: "Present the implementation plan for explicit user approval.", parameters: Type.Object({ plan: Type.String() }), ...planRenderers, async execute(_id, args) {
      const ctx = currentContext;
      if (!ctx.hasUI || !await ctx.ui.confirm("Approve this implementation plan?", args.plan)) return resultText("Plan not approved. Remain in planning mode.");
      userTask = `${userTask}\nApproved plan: ${args.plan}`.slice(-8000);
      await setMode("execute", ctx);
      return resultText("Plan approved; scoped execution enabled.");
    } });
    // Registered as documented; model-originated launches are validated (and
    // their args patched) by the blocking tool_call hook, the capability
    // ceiling bounds every launch path, and the broker's child leases enforce
    // capacity and runtime role.
    const subagents = await jiti.import("pi-subagents", { default: true });
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
    await createMcpAdapter({ config: { mcpServers: mcpServerDefinitions(config, role), settings: { hostConfigDiscovery: "off", directTools: false, toolPrefix: "mcp", scriptMode: false, approveTools: true, autoAuth: false, sampling: false, elicitation: false } } })(styled);
  }
  pi.on("session_shutdown", async () => {
    ready = false;
    await tasks.stopAll();
    releaseChild?.();
    ceiling?.dispose();
    if (broker) {
      await broker.close();
      delete process.env.PI_WORKFLOW_EPOCH;
      for (const [key, value] of Object.entries(env)) if (process.env[key] === value) delete process.env[key];
    }
  });
  installed = true;
}

export default pi => installWorkflow(pi);
