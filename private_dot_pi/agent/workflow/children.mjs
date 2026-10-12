import { canonical } from "./policy.mjs";

const launchKeys = new Set(["agent", "task", "async", "context", "agentScope"]);
const controlKeys = new Set(["action", "id", "message", "options"]);
const controlOptions = new Set(["index", "view", "mode", "lines"]);
const listKeys = new Set(["action", "options"]);
const listOptions = new Set(["capabilities"]);
const managementActions = ["list", "status", "interrupt", "stop", "steer"];
const launchContexts = new Set(["fresh", "fork"]);

// Owned and static, so the model sees only the managed launch/control surface
// whatever pi-subagents' own schema exposes. Option ranges mirror its
// SubagentOptionParams, which it checks again after pi validates against this.
export const SUBAGENT_SCHEMA = {
  type: "object",
  properties: {
    agent: { type: "string", description: "Configured agent name to launch" },
    task: { type: "string", description: "Bounded task for the launched agent" },
    title: { type: "string", description: "3–6 word label for this launch, shown in the transcript and fleet" },
    context: { type: "string", enum: [...launchContexts], description: "fresh starts a clean session; fork inherits this conversation" },
    action: { type: "string", enum: managementActions, description: "Management only; omit to launch" },
    id: { type: "string", description: "Run id or prefix for status/control" },
    message: { type: "string", description: "steer guidance" },
    options: {
      type: "object",
      properties: {
        index: { type: "integer", minimum: 0, description: "Zero-based child/transcript index" },
        view: { type: "string", enum: ["fleet", "transcript"], description: "status view: fleet overview or transcript tail" },
        mode: { type: "string", enum: ["steer", "follow_up"], description: "steer delivery" },
        lines: { type: "integer", minimum: 1, maximum: 500, description: "Transcript tail lines; default 80" },
        capabilities: { type: "boolean", description: "list: compact capability rows" },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export function allowedChildAgents(config, role, mode) {
  return Object.entries(config.agents).filter(([, child]) => child.readonly || (mode !== "plan" && (role === "root" || !config.agents[role].readonly))).map(([name]) => name);
}

export async function checkChildLaunch(args, config, role, ctx, resolveContract, mode) {
  if (!new Set(["plan", "execute"]).has(mode)) throw new Error("An authoritative workflow mode is required");
  // The display-only `title` stops here: pi validates a structuredClone, so the stored call keeps it.
  delete args.title;
  if (args.action) {
    const admits = (keys, options) => Object.keys(args).every(key => keys.has(key)) && Object.keys(args.options ?? {}).every(key => options.has(key));
    if (args.action === "list") {
      if (!admits(listKeys, listOptions)) throw new Error("This child management operation is not enabled");
      args.agentScope = "user";
      return;
    }
    if (!managementActions.includes(args.action) || !admits(controlKeys, controlOptions)
      || (args.options?.view && !["fleet", "transcript"].includes(args.options.view))) throw new Error("This child management operation is not enabled");
    // pi-subagents merges top-level fields with `options`, so the forced ones stay up here.
    args.steeringRecovery = false;
    return;
  }
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
  const modelName = child.model;
  // The frontier tier is the driver's alone: a child on it is the measured
  // quota failure the tier policy exists to stop.
  const { frontier } = config.models.tiers;
  if (frontier && modelName === `${config.models.provider}/${frontier}`) throw new Error("Children never run the frontier tier; it is the driver's tier alone");
  const allowedModels = Object.values(config.models.tiers).map(id => `${config.models.provider}/${id}`);
  if (!allowedModels.includes(modelName)) throw new Error("Child model is outside the OpenAI tier policy");
  const modelId = modelName.slice(config.models.provider.length + 1);
  const model = ctx.modelRegistry.find(config.models.provider, modelId);
  if (!model || !ctx.modelRegistry.isUsingOAuth(model)) throw new Error(`Subscription model unavailable: ${modelName}`);
  // Always background: pi-subagents admits one foreground launch per turn, so
  // foreground children serialize.
  args.async = true;
  const result = await resolveContract({ ...args, cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted(), availableModels: ctx.modelRegistry.getAvailable() });
  if (!result.ok) throw new Error(`Child preflight failed: ${result.message}`);
  const { contract } = result;
  const extensions = contract.tools.configuredExtensions.map(canonical);
  if (canonical(contract.agent.filePath) !== canonical(child.agentPath)
    || !extensions.includes(canonical(child.extensionPath))
    || extensions.some(path => path !== canonical(child.extensionPath))) throw new Error("Child launch does not load the managed policy definition");
  if (contract.tools.effectiveAllowlist.some(tool => !child.tools.includes(tool))) throw new Error("Child tool scope differs from its managed role");
  return contract.digest;
}
