import { canonical } from "./policy.mjs";

const launchKeys = new Set(["agent", "task", "async", "model", "context", "agentScope"]);
const scriptKeys = new Set(["workflowScript", "workflowScriptPath", "tasks", "chain"]);
const controlKeys = new Set(["action", "id", "runId", "index", "message", "mode", "view", "lines", "steeringRecovery"]);
const listKeys = new Set(["action", "agentScope", "capabilities"]);
const managementActions = new Set(["list", "status", "interrupt", "stop", "steer"]);
const launchContexts = new Set(["fresh", "fork"]);
const agentScopes = new Set(["user"]);
const subagentKeys = new Set([...launchKeys, ...controlKeys, ...listKeys]);

export function narrowSubagentSchema(schema) {
  const properties = Object.fromEntries([...subagentKeys].map(key => [key, schema.properties[key]]));
  return {
    ...schema,
    properties: {
      ...properties,
      action: { ...properties.action, enum: [...managementActions] },
      context: { ...properties.context, enum: [...launchContexts] },
      agentScope: { ...properties.agentScope, enum: [...agentScopes] },
    },
    additionalProperties: false,
  };
}

export function allowedChildAgents(config, role, mode) {
  return Object.entries(config.agents).filter(([, child]) => child.readonly || (mode !== "plan" && (role === "root" || !config.agents[role].readonly))).map(([name]) => name);
}

export async function checkChildLaunch(args, config, role, ctx, resolveContract, mode) {
  if (!new Set(["plan", "execute"]).has(mode)) throw new Error("An authoritative workflow mode is required");
  if (args.action) {
    if (args.action === "list") {
      if (Object.keys(args).some(key => !listKeys.has(key))) throw new Error("This child management operation is not enabled");
      args.agentScope = "user";
      return;
    }
    if (!managementActions.has(args.action) || args.action === "list"
      || Object.keys(args).some(key => !controlKeys.has(key))
      || (args.view && !["fleet", "transcript"].includes(args.view))) throw new Error("This child management operation is not enabled");
    args.steeringRecovery = false;
    return;
  }
  if (Object.keys(args).some(key => scriptKeys.has(key))) throw new Error("Use a named child launch with agent and task; workflow scripts, task lists and chains are not enabled");
  // Launch-only extras stay silently dropped; the execution contract admits only launchKeys.
  for (const key of Object.keys(args)) if (!launchKeys.has(key)) delete args[key];
  const child = config.agents[args.agent];
  if (!child || typeof args.task !== "string" || !args.task.trim()) throw new Error("A configured agent and bounded task are required");
  if (!allowedChildAgents(config, role, mode).includes(args.agent)) {
    if (mode === "plan") throw new Error("Plan mode only permits read-only child agents");
    throw new Error("Read-only children cannot delegate to writers");
  }
  args.agentScope = "user";
  if (args.context !== undefined && !launchContexts.has(args.context)) delete args.context;
  let selected = args.model ?? child.model;
  // `inherit` is pi-subagents' own frontmatter value; resolving it here keeps
  // the launch contract check on a concrete tier-policy model.
  if (selected === "inherit") selected = `${ctx.model.provider}/${ctx.model.id}`;
  const [modelName, effort] = selected.split(":");
  // The frontier tier is the driver's alone: a child on it, requested or
  // inherited, is the measured quota failure the tier policy exists to stop.
  const { frontier } = config.models.tiers;
  if (frontier && modelName === `${config.models.provider}/${frontier}`) throw new Error("Children never run the frontier tier; it is the driver's tier alone");
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
