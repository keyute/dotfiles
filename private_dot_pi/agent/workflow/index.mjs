import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { Type } from "typebox";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import * as sdk from "@earendil-works/pi-coding-agent";
import { startBroker as createPolicyBroker, requestBroker as callPolicyBroker, acquireChild } from "./broker.mjs";
import { startToolWorker, workerOperations, executeSandboxGrep } from "./operations.mjs";
import { rootTools, canonical, publicToolName } from "./policy.mjs";
import { reviewAction } from "./approval.mjs";
import { checkChildLaunch } from "./children.mjs";
import { installFooter } from "./footer.mjs";
import { installHeader } from "./header.mjs";
import { installFleet } from "./fleet.mjs";
import { PAD, answerLines, bulletMarkdown, installFolding, planRenderers, pluginRenderers, toolRenderers } from "./rows.mjs";

const runnerPath = fileURLToPath(new URL("./sandbox-runner.mjs", import.meta.url));
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

// Plugins register their tools through the API they are handed and pi keeps the
// definition object, so a Proxy that decorates every registration gives their
// rows the transcript's shape without touching schema or execution. Only
// `registerTool` is intercepted; everything else (events included) is the
// original, and the raw function is called on the raw API because the adapter
// extracts it.
export function pluginApi(pi, renderersFor) {
  return new Proxy(pi, {
    get(target, key, receiver) {
      if (key !== "registerTool") return Reflect.get(target, key, receiver);
      return tool => target.registerTool({ ...tool, ...renderersFor(tool.name) });
    },
  });
}

const padRow = (text, width) => truncateToWidth(text, width, "", true);

// The composer takes the user box's shape (docs/pi-design.md rule 5): pi's rule
// lines become blank shaded rows, the content rows between them are shaded,
// and "❯ " sits in the padding columns of the first content line. pi's working
// spinner rides the top row (embedWorkingStatus routes it to the editor; its
// standalone row is one column in with a blank line above). Rendered lines
// carry their cursor marker inline, so replacing the padding shifts the cursor
// correctly; if the render shape ever changes, the prompt silently disappears
// instead of corrupting the editor.
export class CaretEditor extends sdk.CustomEditor {
  // The editor factory is handed an EditorTheme (borders and autocomplete only),
  // so the palette for the shade and the caret arrives separately.
  constructor(tui, theme, keybindings, { fleet, palette } = {}) {
    super(tui, theme, keybindings, { paddingX: PROMPT_PADDING, embedWorkingStatus: true });
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
    super.handleInput(data);
  }
  // The host copies the settings editorPaddingX (default 0) onto custom
  // editors right after construction and on settings reloads; the caret
  // needs its padding columns.
  setPaddingX(padding) {
    super.setPaddingX(Math.max(PROMPT_PADDING, padding));
  }
  // The rule lines become shaded rows (the working status on top while a turn
  // runs, a scroll count when clipped, blank otherwise), so the block keeps
  // its line count and pi's mouse and autocomplete row offsets stay valid.
  renderTopBorder(width, hidden) {
    const status = this.workingStatusIndicator?.renderInBorder(width) ?? "";
    return this.shade(padRow(status || (hidden ? `${PAD}↑ ${hidden} more` : ""), width));
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
    if (end > 1 && lines[1].startsWith(" ".repeat(PROMPT_PADDING))) lines[1] = this.palette.fg("accent", "❯ ") + lines[1].slice(PROMPT_PADDING);
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
    return requestBroker(env, role, { action: "authorize", tool, args });
  }

  const toolFactory = name => sdk[`create${name[0].toUpperCase()}${name.slice(1)}ToolDefinition`];
  // Session env exposure is disabled: exec runs in a worker whose environment
  // is the broker-leased safe set, so session variables would never arrive.
  const bashOptions = { exposeSessionEnvironment: false };
  const workerEnv = { ...env, PI_WORKFLOW_ROLE: role };

  function sandboxTool(name) {
    if (!permittedTools.includes(publicToolName(name))) return;
    const template = toolFactory(name)(process.cwd(), name === "bash" ? bashOptions : undefined);
    pi.registerTool({ ...template, ...toolRenderers(name), name: publicToolName(name), promptGuidelines: GUIDELINES[name], async execute(id, args, signal, onUpdate, ctx) {
      const { ticket } = await authorize(name, args);
      const client = startToolWorker(name, { cwd: currentContext.cwd, env: workerEnv, ticket, signal });
      try {
        if (name === "grep") return await executeSandboxGrep(client, args, signal);
        const operations = workerOperations(client)[name];
        const tool = toolFactory(name)(currentContext.cwd, name === "bash" ? { ...bashOptions, operations } : { operations });
        return await tool.execute(id, args, signal, onUpdate, ctx);
      } finally { await client.close(); }
    } });
  }
  for (const name of ["read", "write", "edit", "bash", "grep", "find", "ls"]) sandboxTool(name);

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
      const { exitCode } = await client.call("exec", { command: event.command, cwd: currentContext.cwd }, { onChunk: chunk => { output += chunk; } });
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
        surfaces = { fleet, footer: installFooter(pi, ctx, { fleet }) };
      }
      // pi resets every extension surface when a session is invalidated
      // (/new, /resume), so these are applied on each session start.
      installHeader(ctx);
      surfaces.footer.attach(ctx);
      ctx.ui.setEditorComponent((tui, theme, keybindings) => new CaretEditor(tui, theme, keybindings, { fleet: surfaces.fleet, palette: ctx.ui.theme }));
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
    return { systemPrompt: `${event.systemPrompt}\n\nWorkflow mode: ${state.mode}. ${state.readonly ? "Investigate only; source edits and external mutations are disabled. Submit the plan for explicit approval before implementation." : "Execute only the user-approved task."}` };
  });

  // Plugin rows take the transcript's shape (docs/pi-design.md); the
  // registrations themselves are the plugins' own.
  const styled = pluginApi(pi, name => pluginRenderers(name, { servers: Object.keys(config.mcp) }));
  if (isRoot) {
    pi.registerCommand("plan", { description: "Stop sandbox work and enter read-only planning", handler: (_args, ctx) => setMode("plan", ctx) });
    pi.registerCommand("execute", { description: "Approve the current plan and enable scoped execution", handler: async (_args, ctx) => {
      if (ctx.hasUI && await ctx.ui.confirm("Approve the current plan?", "Enable scoped edits and auto-reviewed actions for this task?")) await setMode("execute", ctx);
    } });
    pi.registerCommand("approvals", { description: "Choose auto-reviewed or individually prompted approvals", handler: async (_args, ctx) => {
      const value = await ctx.ui.select("Approval mode", ["auto", "ask"]);
      if (value) { broker.policy.approval = value; broker.policy.epoch++; publishEpoch(); ctx.ui.setStatus("workflow", broker.policy.mode); }
    } });
    // The questionnaire dialog is the pinned plugin's; the answers feed the
    // classifier's task context and the transcript line from its result.
    const askUserQuestion = await jiti.import("@juicesharp/rpiv-ask-user-question", { default: true });
    askUserQuestion(styled);
    pi.on("tool_execution_end", event => {
      // A cancelled questionnaire keeps its partial answers in details; they
      // are not decisions.
      if (event.toolName !== "ask_user_question" || event.result?.details?.cancelled) return;
      const answers = (event.result?.details?.answers ?? []).map(entry => ({ question: entry.question, answer: entry.answer ?? entry.selected?.join(", ") ?? "" })).filter(entry => entry.answer);
      if (!answers.length) return;
      userTask = `${userTask}\n${answers.map(entry => `User decision: ${entry.question} → ${entry.answer}`).join("\n")}`.slice(-8000);
      pi.appendEntry("workflow-answers", { answers });
    });
    pi.registerEntryRenderer("workflow-answers", (entry, _options, theme) => new Text(answerLines(entry.data.answers, theme).join("\n"), 0, 0));
    pi.registerMarkdownTransformer(bulletMarkdown);
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

  if (permittedTools.includes("mcp")) {
    const { createMcpAdapter } = await jiti.import("pi-mcp-adapter");
    await createMcpAdapter({ config: { mcpServers: mcpServerDefinitions(config, role), settings: { hostConfigDiscovery: "off", directTools: false, toolPrefix: "mcp", scriptMode: false, approveTools: true, autoAuth: false, sampling: false, elicitation: false } } })(styled);
  }
  pi.on("session_shutdown", async () => {
    ready = false;
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
