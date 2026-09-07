import { canonical } from "./policy.mjs";

const launchKeys = new Set(["agent", "task", "async", "model", "context", "agentScope"]);
const scriptKeys = new Set(["workflowScript", "workflowScriptPath", "tasks", "chain"]);
const controlKeys = new Set(["action", "id", "runId", "index", "message", "mode", "view", "lines", "steeringRecovery"]);
const listKeys = new Set(["action", "agentScope", "capabilities"]);

export async function checkChildLaunch(args, config, role, ctx, resolveContract) {
  if (args.action) {
    if (args.action === "list") {
      if (Object.keys(args).some(key => !listKeys.has(key))) throw new Error("This child management operation is not enabled");
      args.agentScope = "user";
      return;
    }
    if (!["status", "interrupt", "stop", "steer"].includes(args.action)
      || Object.keys(args).some(key => !controlKeys.has(key))
      || (args.view && !["fleet", "transcript"].includes(args.view))) throw new Error("This child management operation is not enabled");
    args.steeringRecovery = false;
    return;
  }
  if (Object.keys(args).some(key => scriptKeys.has(key))) throw new Error("Use a named child launch with agent and task; workflow scripts, task lists and chains are not enabled");
  // pi-subagents' schema still advertises cwd, toolBudget, acceptance and the
  // like; every observed run passed some of them on its first launch, so they
  // are dropped rather than refused (a refusal costs a turn per launch batch).
  for (const key of Object.keys(args)) if (!launchKeys.has(key)) delete args[key];
  const child = config.agents[args.agent];
  if (!child || typeof args.task !== "string" || !args.task.trim()) throw new Error("A configured agent and bounded task are required");
  if (role !== "root" && config.agents[role].readonly && !child.readonly) throw new Error("Read-only children cannot delegate to writers");
  args.agentScope = "user";
  if (args.context !== undefined && !["fresh", "fork"].includes(args.context)) delete args.context;
  let selected = args.model ?? child.model;
  // `inherit` is pi-subagents' own frontmatter value; resolving it here keeps
  // the launch contract check on a concrete tier-policy model.
  if (selected === "inherit") selected = `${ctx.model.provider}/${ctx.model.id}`;
  const [modelName, effort] = selected.split(":");
  const allowedModels = Object.values(config.models.tiers).map(id => `${config.models.provider}/${id}`);
  if (!allowedModels.includes(modelName) || (effort && !["low", "medium", "high", "xhigh", "max"].includes(effort))) throw new Error("Child model is outside the OpenAI tier policy");
  const modelId = modelName.slice(config.models.provider.length + 1);
  const model = ctx.modelRegistry.find(config.models.provider, modelId);
  if (!model || !ctx.modelRegistry.isUsingOAuth(model)) throw new Error(`Subscription model unavailable: ${modelName}`);
  if (child.model === "inherit") args.model = selected;
  // Always background: pi-subagents admits one foreground launch per turn, so
  // foreground children serialize; MCP provider extensions also require a
  // background child here.
  args.async = true;
  const result = await resolveContract({ ...args, cwd: ctx.cwd, availableModels: ctx.modelRegistry.getAvailable() });
  if (!result.ok) throw new Error(`Child preflight failed: ${result.message}`);
  const { contract } = result;
  const extensions = contract.tools.configuredExtensions.map(canonical);
  if (canonical(contract.agent.filePath) !== canonical(child.agentPath)
    || !extensions.includes(canonical(child.extensionPath))
    || extensions.some(path => path !== canonical(child.extensionPath))) throw new Error("Child launch does not load the managed policy definition");
  if (contract.tools.effectiveAllowlist.some(tool => !child.tools.includes(tool))) throw new Error("Child tool scope differs from its managed role");
  return contract.digest;
}
