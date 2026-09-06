import { canonical } from "./policy.mjs";

const launchKeys = new Set(["agent", "task", "async", "model", "context", "agentScope"]);
const controlKeys = new Set(["action", "id", "runId", "index", "message", "mode", "view", "steeringRecovery"]);

export async function checkChildLaunch(args, config, role, ctx, resolveContract) {
  if (args.action) {
    if (!["status", "interrupt", "stop", "steer"].includes(args.action)
      || Object.keys(args).some(key => !controlKeys.has(key))
      || (args.view && args.view !== "fleet")) throw new Error("This child management operation is not enabled");
    args.steeringRecovery = false;
    return;
  }
  if (Object.keys(args).some(key => !launchKeys.has(key))) throw new Error("Use a named child launch; arbitrary workflow scripts and launch overrides are not enabled");
  const child = config.agents[args.agent];
  if (!child || typeof args.task !== "string" || !args.task.trim()) throw new Error("A configured agent and bounded task are required");
  if (role !== "root" && config.agents[role].readonly && !child.readonly) throw new Error("Read-only children cannot delegate to writers");
  args.agentScope = "user";
  args.context = "fresh";
  const selected = args.model ?? child.model;
  const [modelName, effort] = selected.split(":");
  const allowedModels = Object.values(config.models.tiers).map(id => `${config.models.provider}/${id}`);
  if (!allowedModels.includes(modelName) || (effort && !["low", "medium", "high", "xhigh", "max"].includes(effort))) throw new Error("Child model is outside the OpenAI tier policy");
  const modelId = modelName.slice(config.models.provider.length + 1);
  const model = ctx.modelRegistry.find(config.models.provider, modelId);
  if (!model || !ctx.modelRegistry.isUsingOAuth(model)) throw new Error(`Subscription model unavailable: ${modelName}`);
  // MCP provider extensions require a background child in this package version.
  if (child.tools.includes("mcp")) args.async = true;
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
