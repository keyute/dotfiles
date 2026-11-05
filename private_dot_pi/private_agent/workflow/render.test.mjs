import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
// byte budgets (single owner):
// harness projections, on-demand docs, Claude's generated sandbox doc, repo AGENTS.md, pi's subagent and orchestrate tool descriptions
const PROJECTION_MAX_BYTES = 5300;
const ON_DEMAND_DOC_MAX_BYTES = 6000;
const REPO_AGENTS_MAX_BYTES = 4900;
const SUBAGENT_TOOL_DESCRIPTION_MAX_BYTES = 4000;
// decisions.md is read on trigger reviews only, never per turn: a per-row cap bounds verbosity, and the file grows one row per decision
const DECISION_ROW_MAX_BYTES = 360;
// a model id: pins live in agents.yaml, and a decisions row names its tier so a re-pin leaves it true
const PIN_ID = /\bclaude-[a-z0-9]+-[0-9][a-z0-9-]*|\bgpt-[0-9][a-z0-9.-]*/;
// roles take every documented level; the driver's settings effortLevel excludes `max`, which is session-only
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const CLAUDE_DRIVER_EFFORTS = ["low", "medium", "high", "xhigh"];

const readSource = path => readFileSync(join(source, path), "utf8");
// the text of each YAML comment: a `#` at line start or after whitespace, outside quotes
const yamlComments = text => text.split("\n").flatMap(line => {
  // walk to the first `#` outside quotes; a quote stripper would also eat text between two apostrophes inside a comment
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return [line.slice(i + 1)];
  }
  return [];
});
// variant suffixes after the version (a -pro id), not families: they collide with ordinary words like "Pro allowance"
const NON_FAMILY_SEGMENTS = ["pro", "mini", "nano", "codex"];
// capitalised model-family names of the current pins (claude-<family>-..., gpt-<n>-<family>); a bare gpt-<n> has none
const familyNouns = data => [...new Set(Object.values(data.subagent_tiers).flatMap(Object.values).flatMap(pin => {
  const parts = pin.split("-");
  const family = pin.startsWith("claude-") ? parts[1] : parts[2];
  if (!/^[a-z]+$/i.test(family ?? "") || NON_FAMILY_SEGMENTS.includes(family.toLowerCase())) return [];
  return [family[0].toUpperCase() + family.slice(1)];
}))];

const fixture = (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-workflow-render-"));
  const destination = join(root, "destination");
  const bin = join(root, "bin");
  const config = join(root, "chezmoi.toml");
  const state = join(root, "state.boltdb");
  const cache = join(root, "cache");
  mkdirSync(destination);
  mkdirSync(bin);
  writeFileSync(config, `sourceDir = ${JSON.stringify(source)}\ndestinationDir = ${JSON.stringify(destination)}\n`);
  const op = join(bin, "op");
  writeFileSync(op, "#!/bin/sh\nprintf '%s' 'CHEZMOI_RENDER_TEST_SECRET'\n");
  chmodSync(op, 0o700);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const base = [
    "--source",
    source,
    "--destination",
    destination,
    "--config",
    config,
    "--persistent-state",
    state,
    "--cache",
    cache,
    "--refresh-externals=never",
  ];
  const invoke = (command, target, extra = []) => spawnSync("chezmoi", [command, ...base, ...extra, target], {
    cwd: source,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  const run = (command, target, extra = []) => {
    const result = invoke(command, target, extra);
    assert.equal(result.status, 0, `${command} ${target}\n${result.stderr}`);
    return result.stdout;
  };
  const target = (relative) => join(destination, relative);
  const data = () => JSON.parse(run("data", "--format=json"));
  return { run, invoke, target, data };
};

// Roles a harness renders: a role's `harnesses` scopes it, otherwise every harness.
const rolesFor = (data, harness) => Object.entries(data.subagents)
  .filter(([, meta]) => (meta.harnesses ?? Object.keys(data.agents)).includes(harness))
  .map(([role]) => role);

test("renders Pi and Claude projections with isolated state", (t) => {
  const { run, target, data: load } = fixture(t);
  const data = load();
  const workflow = JSON.parse(run("cat", target(".pi/agent/workflow.json")));
  const piSettings = JSON.parse(run("cat", target(".pi/agent/settings.json")));

  // bash 3.2 here-documents on macOS; see private_workflow.json.tmpl
  assert.ok(workflow.filesystem.allowWrite.includes("/var/tmp"));
  assert.equal(piSettings.defaultModel, data.subagent_tiers.pi[data.agents.pi.defaults.tier]);
  assert.equal(workflow.models.tiers.frontier, data.subagent_tiers.pi.frontier);
  assert.equal(workflow.agents.implementer.tools.includes("workspace_write"), true);
  assert.equal(workflow.agents.Explore.tools.includes("read"), false);
  // Only general-purpose delegates, as Claude Code's roster implies.
  assert.equal(workflow.agents.Explore.tools.includes("subagent"), false);
  assert.notEqual(workflow.models.tiers.top, workflow.models.tiers.frontier);
  assert.equal(workflow.childLimit, data.agents.pi.child_limit);
  assert.equal(workflow.agents["general-purpose"].nests, true);
  assert.equal(workflow.agents["spec-reviewer"].readonly, true);
  assert.ok(["workspace_write", "mcp__exa__web_fetch_exa", "subagent", "bg_wait"].every(tool => workflow.agents["general-purpose"].tools.includes(tool)));
  for (const role of Object.values(workflow.agents)) assert.equal(role.tools.includes("bg_wait"), role.nests);
  const description = run("cat", target(".pi/agent/subagent-tool-description.md"));
  assert.doesNotMatch(description, /workflowScript|runs\.|guide|resume|CLI/);
  assert.match(description, /consume native completion notifications/);
  assert.doesNotMatch(description, /bg_wait/);
  const subagentConfig = JSON.parse(run("cat", target(".pi/agent/extensions/subagent/config.json")));
  assert.equal(subagentConfig.toolActivation, "eager");
  // the plugin's scripted workflows run model code in an escapable node:vm; orchestrate replaces them
  assert.ok(subagentConfig.disabledFeatures.includes("workflow-scripts"));
  assert.equal(workflow.orchestrateConcurrency, data.agents.pi.orchestrate_concurrency);
  const orchestrateDescription = run("cat", target(".pi/agent/orchestrate-tool-description.md"));
  assert.match(orchestrateDescription, /ultracode/);
  assert.match(orchestrateDescription, /background workflow id immediately/);
  for (const action of ["status", "result", "stop"]) assert.match(orchestrateDescription, new RegExp(`action: "${action}"`));
  assert.match(orchestrateDescription, /management still works/);
  assert.match(orchestrateDescription, /Only one workflow may be active/);
  assert.match(orchestrateDescription, /Keep trivial work inline and isolated bounded delegations on subagent/);
  assert.match(orchestrateDescription, /with ultracode on, use workflows for substantive multi-part work, including initially independent investigations needing reconciliation/);
  assert.doesNotMatch(orchestrateDescription, /parallel subagent launches for flat independent work/);
  assert.match(orchestrateDescription, /dependent work or research needing validation/);
  assert.match(orchestrateDescription, /await dependencies and pass intermediate evidence to downstream children/);
  assert.match(orchestrateDescription, /return only their cited synthesis, coverage gaps and unresolved disagreement, not raw reports or logs/);
  assert.match(orchestrateDescription, /not a dependency; use await/);
  assert.doesNotMatch(orchestrateDescription, /```|const evidence|Gather|Crosscheck|Distill|gather2|fixed phase count/);
  assert.match(orchestrateDescription, /Root steering does not rewrite/);
  assert.match(orchestrateDescription, /not the workflow/);
  assert.doesNotMatch(orchestrateDescription, /every substantive task|call blocks until|typed steers reach you only after/);
  for (const tier of Object.keys(data.subagent_tiers.pi).filter(tier => tier !== "frontier")) assert.match(orchestrateDescription, new RegExp(`\\b${tier}\\b`), `orchestrate description misses tier ${tier}`);
  // one entry per distinct tier model: tiers may share a pin
  assert.equal(piSettings.enabledModels.length, new Set(Object.values(workflow.models.tiers)).size);
  const models = JSON.parse(run("cat", target(".pi/agent/models.json")));
  const overrides = models.providers[data.agents.pi.defaults.provider].modelOverrides;
  const windows = data.agents.pi.defaults.context_window;
  for (const [tier, value] of Object.entries(windows)) assert.equal(overrides[data.subagent_tiers.pi[tier]].contextWindow, value, `${tier} contextWindow`);

  for (const role of Object.keys(workflow.agents)) {
    const agent = run("cat", target(`.pi/agent/agents/${role}.md`));
    const shim = run("cat", target(`.pi/agent/policy-roles/${role}.ts`));
    assert.equal(/^tools: .*\bbg_wait\b/m.test(agent), workflow.agents[role].nests);
    assert.match(agent, new RegExp(`extensions: .*/policy-roles/${role}\\.ts`));
    assert.match(shim, new RegExp(`, ${JSON.stringify(role)}, \\{ AgentSession \\}\\);`));
  }

  const piInstructions = run("cat", target(".pi/agent/AGENTS.md"));
  const claudeInstructions = run("cat", target(".claude/CLAUDE.md"));
  assert.equal(typeof workflow.driverInstructions, "string");
  assert.doesNotMatch(piInstructions, /When you are the session driver|spec-reviewer/);
  assert.match(workflow.driverInstructions, /When you are the session driver/);
  assert.ok(claudeInstructions.includes(workflow.driverInstructions.split("\n")[0]));
  for (const instructions of [workflow.driverInstructions, claudeInstructions]) {
    assert.match(instructions, /The lowest capable pinned worker owns\s+implementation\/test\/repair/);
    assert.match(instructions, /Unblock handoffs and return the slice; take over\s+only when the worker cannot complete or repair it/);
    assert.doesNotMatch(instructions, /Finish a failed worker's piece yourself rather than promoting it/);
  }
  const claudeHarness = run("cat", target(".claude/docs/harness.md"));
  const piHarness = run("cat", target(".pi/agent/docs/harness.md"));
  const claudeSandboxDoc = run("cat", target(".claude/docs/sandbox.md"));
  const piSandboxDoc = run("cat", target(".pi/agent/docs/sandbox.md"));
  assert.match(piHarness, /keep trivial work inline, isolated bounded tasks on `subagent`/);
  assert.match(piHarness, /With ultracode on, use `orchestrate` for substantive multi-part work, even initially independent\s+investigations to reconcile/);
  assert.doesNotMatch(piHarness, /parallel launches for flat independent work/);
  assert.match(piHarness, /background workflow id immediately/);
  for (const action of ["status", "result", "stop"]) assert.match(piHarness, new RegExp(`action: "${action}"`));
  assert.match(piHarness, /Management works even with ultracode off/);
  assert.match(piHarness, /not the workflow/);
  assert.match(piSandboxDoc, /Preserve inherited `TMPDIR`/);
  assert.match(piSandboxDoc, /--configLoader runner/);
  assert.match(piSandboxDoc, /`cacheDir` or `TMPDIR` alone does not relocate that bundle/);
  assert.doesNotMatch(readSource("AGENTS.md"), /TMPDIR=\/tmp\/claude\/x/);
  for (const [name, text, max] of [
    [".pi/agent/AGENTS.md + driver", piInstructions + workflow.driverInstructions, PROJECTION_MAX_BYTES],
    [".claude/CLAUDE.md", claudeInstructions, PROJECTION_MAX_BYTES],
    [".pi/agent/docs/harness.md", piHarness, 5607],
    [".claude/docs/harness.md", claudeHarness, ON_DEMAND_DOC_MAX_BYTES],
    [".pi/agent/docs/sandbox.md", piSandboxDoc, ON_DEMAND_DOC_MAX_BYTES],
    [".claude/docs/sandbox.md", claudeSandboxDoc, ON_DEMAND_DOC_MAX_BYTES],
    [".pi/agent/subagent-tool-description.md", description, SUBAGENT_TOOL_DESCRIPTION_MAX_BYTES],
    [".pi/agent/orchestrate-tool-description.md", orchestrateDescription, 2330],
    // chezmoi-ignored, so read from source: it loads in every session in this repo
    ["AGENTS.md", readSource("AGENTS.md"), REPO_AGENTS_MAX_BYTES],
  ]) {
    const bytes = Buffer.byteLength(text);
    assert.ok(bytes <= max, `${name} is ${bytes} bytes (max ${max}): cut, do not raise the budget`);
  }
  // Owned static first-prompt components only, not vendor prompt/tool schemas.
  // Baseline: 5044 global + 3886 repo + 2980 subagent + 2318 orchestrate.
  const ownedPiBytes = [piInstructions, workflow.driverInstructions, readSource("AGENTS.md"), description, orchestrateDescription]
    .reduce((sum, text) => sum + Buffer.byteLength(text), 0);
  assert.ok(Buffer.byteLength(piInstructions + workflow.driverInstructions) < 5044, "moving driver text is not a reduction");
  assert.ok(ownedPiBytes < 14228, `owned Pi aggregate ${ownedPiBytes} must shrink from 14228`);
  assert.ok(claudeHarness.includes(data.subagent_tiers.claude.top));
  // family names age with the pins; the pin id (or its tier) is the one spelling
  const nouns = familyNouns(data);
  for (const [name, text, flags] of [
    [".claude/CLAUDE.md", claudeInstructions, ""],
    [".pi/agent/AGENTS.md", piInstructions, ""],
    [".claude/docs/harness.md", claudeHarness, ""],
    [".pi/agent/docs/harness.md", piHarness, ""],
    [".claude/docs/sandbox.md", claudeSandboxDoc, ""],
    [".pi/agent/docs/sandbox.md", piSandboxDoc, ""],
    [".pi/agent/orchestrate-tool-description.md", orchestrateDescription, ""],
    // comments carry no pin ids, so a lowercase family name is caught too
    [".chezmoidata/agents.yaml comments", yamlComments(readSource(".chezmoidata/agents.yaml")).join("\n"), "i"],
  ]) {
    for (const noun of nouns) assert.doesNotMatch(text, new RegExp(`\\b${noun}\\b`, flags), `${name} names the model family ${noun}: name the tier or the pin id`);
  }

  const claudeSettings = JSON.parse(run("cat", target(".claude/settings.json")));
  // a relative deny name sits in the writable cwd, so it also gets an Edit() deny
  assert.ok(claudeSettings.permissions.deny.includes("Edit(.env)"));
  for (const p of ["~/.claude/ide", "~/.claude/bridge-spawn"]) assert.ok(claudeSettings.permissions.deny.includes(`Read(${p})`), p);
  // live code run outside the sandbox (node_modules) is write-denied by Edit() rules,
  // which the harness merges into the Bash sandbox
  const liveCode = [`${data.chezmoi.sourceDir}/node_modules`];
  assert.deepEqual(claudeSettings.permissions.deny.filter(rule => /^Edit\([~/]/.test(rule)), liveCode.map(path => `Edit(/${path}/**)`));
  // shared network policy reaches both harnesses
  const networkKeys = { allow_local_binding: "allowLocalBinding", allowed_domains: "allowedDomains" };
  for (const [key, value] of Object.entries(data.agent_sandbox.network)) {
    const rendered = networkKeys[key];
    assert.ok(rendered, `agent_sandbox.network.${key}: render it for both harnesses (and map it here) or scope it to one harness`);
    for (const [name, network] of [["claude", claudeSettings.sandbox.network], ["pi", workflow.network]]) {
      if (Array.isArray(value)) assert.ok(value.every(item => network[rendered].includes(item)), `${name}: ${rendered} misses agent_sandbox.network.${key} entries`);
      else assert.equal(network[rendered], value, `${name}: ${rendered}`);
    }
  }
  assert.equal(claudeSettings.model, data.subagent_tiers.claude[data.agents.claude.defaults.tier]);
  assert.equal(claudeSettings.workflowSizeGuideline, data.workflow_size === "unrestricted" ? undefined : data.workflow_size);
  assert.equal(claudeSettings.env.CLAUDE_CODE_SUBAGENT_MODEL, data.subagent_tiers.claude.top);
  assert.equal(claudeSettings.env.CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL, data.subagent_tiers.claude.top);
  // auto-approval is per read-only tool on both harnesses, never a whole server
  for (const [server, cfg] of Object.entries(data.agent_mcp_servers).filter(([, cfg]) => cfg.auto_approve_tools)) {
    for (const tool of cfg.readonly_tools ?? []) assert.ok(claudeSettings.permissions.allow.includes(`mcp__${server}__${tool}`), `${server}: ${tool}`);
  }
  assert.ok(!claudeSettings.permissions.allow.some(rule => /^mcp__[^_]+$/.test(rule)), "a server-wide mcp allow");
  // pi's workflow.json write-denies the same live code
  for (const path of liveCode) assert.ok(workflow.filesystem.denyWrite.includes(path), `pi denyWrite misses ${path}`);
  // the search plugin's config resolves its tier or fails the render
  const webSearch = JSON.parse(run("cat", target(".pi/agent/web-search.json")));
  assert.deepEqual(webSearch, { provider: data.agents.pi.defaults.provider, model: data.subagent_tiers.pi[data.agents.pi.search_tier] });
  // web_fetch answers on the same search tier
  assert.equal(workflow.models.search, webSearch.model);
  const frontierPin = data.subagent_tiers.claude.frontier;
  // the native per-call deny must name the frontier pin's alias
  const frontierAliases = claudeSettings.permissions.deny.flatMap(rule => /^Agent\(model:(\w+)\)$/.exec(rule)?.[1] ?? []);
  assert.ok(frontierAliases.some(alias => frontierPin.startsWith(`claude-${alias}-`)), `no Agent(model:...) deny covers ${frontierPin}`);
  // the hand-listed denies are aliases with no tier: one naming a small/top pin's family would deny a rostered child's own tier
  for (const rule of data.agents.claude.denied_tools.filter(rule => rule.startsWith("Agent(model:"))) {
    const alias = /^Agent\(model:(\w+)\)$/.exec(rule)[1];
    for (const [tier, pin] of Object.entries(data.subagent_tiers.claude)) assert.ok(!pin.includes(`-${alias}-`), `${rule} names the ${tier} pin's family; drop it (the frontier alias renders from its pin)`);
  }

  assert.ok(piHarness.includes(data.subagent_tiers.pi.frontier));
  assert.equal(workflow.filesystem.denyWrite.some(path => path.endsWith("/private_dot_pi")), false);
  assert.equal(workflow.filesystem.denyWrite.some(path => path.endsWith("/node_modules")), true);
});

test("ship-check shares a selection-aware native approval flow across harnesses", t => {
  const { run, target } = fixture(t);
  const claude = run("cat", target(".claude/skills/ship-check/SKILL.md"));
  const pi = run("cat", target(".agents/skills/ship-check/SKILL.md"));
  assert.equal(pi, claude);
  const description = JSON.parse(pi.match(/^description: (.+)$/m)[1]);
  assert.match(description, /only on explicit invocation or an explicit user request for ship-check/);
  assert.match(description, /not automatic implementation completion, generic review or routine verification/);
  assert.match(description, /full-branch pre-ship review and approved fixes/);
  assert.doesNotMatch(pi, /^disable-model-invocation:/m);
  assert.match(pi, /every input ID has exactly one disposition/);
  assert.match(pi, /kept, merged-to ID, refuted/);
  assert.match(pi, /Before synthesis, whether using workflow\s+scripts or direct reviewer dispatch, mechanically assert that every input ID has exactly one disposition/);
  assert.match(pi, /refuted with evidence, or deferred with reason; validate\s+merge targets/);
  assert.match(pi, /existing workflow maps\/arrays or a bounded scratch check for\s+direct reviewer dispatch, not a new persistent tool/);
  assert.match(pi, /Subsequent review covers fixes and affected dependencies/);
  assert.match(pi, /Reuse completed maps/);
  assert.match(pi, /no survivors[^]*stop without a plan/);
  assert.match(pi, /explicit review-only request[^]*without seeking execution approval/);
  assert.match(pi, /in plan\s+mode, proactively submit[^]*native plan approval flow/);
  assert.match(pi, /do not wait for a separate/);
  assert.match(pi, /select findings by ID and revise the same artifact/);
  assert.match(pi, /only the selected findings in the\s+approved revision/);
});

// every pi (pin, effort) pair must be a level the pinned pi-ai catalog offers that model; levels are
// per model: a model may drop one (e.g. no "off") that another on the same provider supports
const assertPiEffort = (provider, pin, effort, owner) => {
  const model = getBuiltinModel(provider, pin);
  assert.ok(model, `${owner}: ${provider}/${pin} is not in the pi-ai catalog`);
  assert.ok(getSupportedThinkingLevels(model).includes(effort), `${owner}: ${provider}/${pin} does not support effort ${effort}`);
};

test("each role renders its roster tier and effort on every harness it targets", (t) => {
  const { run, invoke, target, data: load } = fixture(t);
  const data = load();
  const provider = data.agents.pi.defaults.provider;
  const workflow = JSON.parse(run("cat", target(".pi/agent/workflow.json")));
  assert.deepEqual(Object.keys(workflow.agents).sort(), rolesFor(data, "pi").sort());

  // the same-named Claude built-ins skip CLAUDE.md; their overrides must too
  for (const role of ["Explore", "Plan"]) assert.equal(data.subagents[role].omit_instructions, true, role);
  for (const [role, meta] of Object.entries(data.subagents)) {
    const harnesses = meta.harnesses ?? Object.keys(data.agents);
    // No child runs the frontier tier.
    assert.notEqual(meta.tier, "frontier", role);

    const claudePath = target(`.claude/agents/${role}.md`);
    if (harnesses.includes("claude")) {
      const model = data.subagent_tiers.claude[meta.tier];
      assert.notEqual(model, data.subagent_tiers.claude.frontier, role);
      const agent = run("cat", claudePath);
      assert.match(agent, new RegExp(`^name: ${role}$`, "m"));
      assert.ok(agent.split("\n").includes(`model: ${model}`), `${role}: claude model ${model}`);
      assert.ok(CLAUDE_EFFORTS.includes(meta.effort), `${role}: ${meta.effort} is not a Claude effort level`);
      assert.ok(agent.split("\n").includes(`effort: ${meta.effort}`), `${role}: claude effort ${meta.effort}`);
      // a nesting role inherits every tool, Agent included
      assert.equal(/^tools: /m.test(agent), !meta.nests, `${role}: claude tools line`);
      assert.equal(agent.split("\n").includes("omitClaudeMd: true"), meta.omit_instructions ?? false, `${role}: omitClaudeMd`);
    } else {
      assert.notEqual(invoke("cat", claudePath).status, 0, `${role} must not render for claude`);
    }

    if (harnesses.includes("pi")) {
      const model = `${provider}/${data.subagent_tiers.pi[meta.tier]}`;
      assert.notEqual(data.subagent_tiers.pi[meta.tier], data.subagent_tiers.pi.frontier, role);
      assertPiEffort(provider, data.subagent_tiers.pi[meta.tier], meta.effort, role);
      const contract = workflow.agents[role];
      assert.deepEqual(
        [contract.model, contract.thinking, contract.readonly, contract.nests],
        [model, meta.effort, meta.readonly, meta.nests ?? false],
        role,
      );
      if (!meta.readonly) assert.ok(contract.mutationTools.length > 0, role);
      else assert.deepEqual(contract.mutationTools, [], role);
      // pi's MCP reach is the Claude tools list: each mcp__<server>__<tool> by name (pi's tool names
      // map every character outside [A-Za-z0-9_] to "_"), and mcp__* as every tool the pi roster
      // names (policy.inspectMcp refuses the rest); WebFetch is the owned web_fetch
      const claudeTools = meta.tools.split(",").map(tool => tool.trim());
      const named = rolesFor(data, "pi").flatMap(name => data.subagents[name].tools.split(",").map(tool => tool.trim()).filter(tool => tool.startsWith("mcp__") && tool !== "mcp__*"));
      const expectedMcp = claudeTools.flatMap(tool => tool === "mcp__*" ? named : tool.startsWith("mcp__") ? [tool] : []);
      assert.deepEqual(contract.tools.filter(tool => tool.startsWith("mcp__")).sort(), [...new Set(expectedMcp.map(tool => tool.replace(/[^A-Za-z0-9_]/g, "_")))].sort(), `${role}: MCP tools`);
      assert.equal(contract.tools.includes("web_fetch"), claudeTools.includes("WebFetch"), `${role}: web_fetch`);
      const agent = run("cat", target(`.pi/agent/agents/${role}.md`));
      assert.ok(agent.split("\n").includes(`model: ${model}`), `${role}: pi model ${model}`);
      assert.ok(agent.split("\n").includes(`thinking: ${meta.effort}`), `${role}: pi thinking ${meta.effort}`);
      for (const key of ["inheritProjectContext", "inheritGlobalContext"]) {
        assert.ok(agent.split("\n").includes(`${key}: ${!(meta.omit_instructions ?? false)}`), `${role}: pi ${key}`);
      }
    }
  }

  const settings = JSON.parse(run("cat", target(".claude/settings.json")));
  // effort is pinned per model for every Claude pin
  const effortLevel = data.agents.claude.defaults.reasoning_effort;
  assert.ok(CLAUDE_DRIVER_EFFORTS.includes(effortLevel), `agents.claude.defaults.reasoning_effort ${effortLevel}`);
  const effortPins = [...new Set(Object.values(data.subagent_tiers.claude))];
  assert.deepEqual(Object.keys(settings.modelSettings).sort(), effortPins.sort());
  for (const pin of effortPins) assert.deepEqual(settings.modelSettings[pin], { effortLevel }, pin);

  const pi = data.agents.pi.defaults;
  assertPiEffort(provider, data.subagent_tiers.pi[pi.tier], pi.reasoning_effort, "pi driver");
  // one model for the whole approval gate (docs/decisions.md, agents.pi.defaults.classifier)
  const classifierPin = data.subagent_tiers.pi[pi.classifier.tier];
  assert.ok(classifierPin, `agents.pi.defaults.classifier.tier ${pi.classifier.tier} is not a pi tier`);
  assertPiEffort(provider, classifierPin, pi.classifier.filter_effort, "classifier filter");
  assertPiEffort(provider, classifierPin, pi.classifier.judge_effort, "classifier judge");
  assert.deepEqual(
    [workflow.models.classifierFilter, workflow.models.classifierJudge],
    [{ model: classifierPin, reasoningEffort: pi.classifier.filter_effort }, { model: classifierPin, reasoningEffort: pi.classifier.judge_effort }],
  );
});

test("every roster role and shared skill has its source stubs, and every stub a source", (t) => {
  const { data: load } = fixture(t);
  const data = load();
  const stubDirs = {
    claude: [["private_dot_claude/exact_agents", ".md.tmpl"]],
    pi: [["private_dot_pi/private_agent/exact_agents", ".md.tmpl"], ["private_dot_pi/private_agent/exact_policy-roles", ".ts.tmpl"]],
  };
  for (const [harness, dirs] of Object.entries(stubDirs)) {
    const roles = rolesFor(data, harness);
    for (const [dir, suffix] of dirs) {
      for (const role of roles) assert.ok(existsSync(join(source, dir, `${role}${suffix}`)), `missing stub ${dir}/${role}${suffix}`);
      for (const file of readdirSync(join(source, dir))) {
        assert.ok(file.endsWith(suffix) && roles.includes(file.slice(0, -suffix.length)), `${dir}/${file} names no ${harness} role in the roster`);
      }
    }
  }
  // subagent-{claude,pi}.md include subagents/<role>.md for each roster role; shared includes sit one level up
  const roleBodies = readdirSync(join(source, ".chezmoitemplates/subagents")).filter(file => file.endsWith(".md"));
  for (const file of roleBodies) {
    assert.ok(Object.hasOwn(data.subagents, file.slice(0, -".md".length)), `.chezmoitemplates/subagents/${file} names no role in the roster`);
  }

  const skills = readdirSync(join(source, ".chezmoitemplates/skills"))
    .filter(file => file.endsWith(".md"))
    .map(file => file.slice(0, -".md".length));
  for (const dir of ["private_dot_claude/exact_skills", "dot_agents/exact_skills"]) {
    for (const skill of skills) {
      const stub = join(source, dir, skill, "SKILL.md.tmpl");
      assert.ok(existsSync(stub), `missing stub ${dir}/${skill}/SKILL.md.tmpl`);
      // a stub is the one-line include and nothing else: a hand-kept body here is the drift the gate exists to catch
      assert.match(readFileSync(stub, "utf8").trim(), new RegExp(`^\\{\\{- includeTemplate "skills/${skill}\\.md" [^\\n]+ -\\}\\}$`), `${dir}/${skill}/SKILL.md.tmpl is not the one-line stub`);
    }
    for (const skill of readdirSync(join(source, dir))) {
      if (!existsSync(join(source, dir, skill, "SKILL.md.tmpl"))) continue;
      assert.ok(skills.includes(skill), `${dir}/${skill}/SKILL.md.tmpl has no .chezmoitemplates/skills/${skill}.md`);
    }
  }
  // skills, role bodies and descriptions name roles; a rename or removal in the roster would otherwise break them silently
  const namers = [
    ...skills.map(skill => [`.chezmoitemplates/skills/${skill}.md`, readSource(`.chezmoitemplates/skills/${skill}.md`)]),
    ...roleBodies.map(file => [`.chezmoitemplates/subagents/${file}`, readSource(`.chezmoitemplates/subagents/${file}`)]),
    ...Object.entries(data.subagents).map(([name, role]) => [`subagents.${name}.description`, role.description]),
  ];
  for (const [where, text] of namers) {
    for (const [, role] of text.matchAll(/\b([a-z]+(?:-[a-z]+)*-(?:reviewer|researcher))\b/g)) {
      assert.ok(Object.hasOwn(data.subagents, role), `${where} names ${role}, not a roster role`);
    }
  }
});

test("readonly roles grant no write tool and only read-only MCP tools; writers can write or nest", (t) => {
  const { data: load } = fixture(t);
  const data = load();
  for (const [role, meta] of Object.entries(data.subagents)) {
    const tools = meta.tools.split(",").map(tool => tool.trim());
    const writes = tools.includes("Edit") || tools.includes("Write");
    if (!meta.readonly) {
      assert.ok(writes || meta.nests, `${role}: not readonly, yet neither writes nor nests`);
      continue;
    }
    assert.ok(!writes, `${role}: readonly but grants Edit or Write`);
    for (const tool of tools.filter(tool => tool.startsWith("mcp__"))) {
      const [, server, name] = tool.split("__");
      assert.ok(data.agent_mcp_servers[server]?.readonly_tools?.includes(name), `${role}: readonly but grants ${tool}, not a readonly_tools entry`);
    }
  }
});

test("docs/decisions.md has a row for every tier pin, driver, classifier and search slot", (t) => {
  const { data: load } = fixture(t);
  const data = load();
  const nouns = familyNouns(data);
  const cells = line => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
  const [header, , ...body] = readSource("docs/decisions.md").split("\n").filter(line => line.trim().startsWith("|")).map(cells);
  assert.deepEqual(header, ["key", "why", "revisit when"]);
  // a stray `|` in a cell shifts the columns and fails later asserts with a misleading message
  for (const row of body) assert.equal(row.length, 3, `docs/decisions.md ${row[0]}: ${row.length} cells, not 3`);
  const rows = new Map(body.map(([key, ...rest]) => [key.replace(/^`(.*)`$/, "$1"), rest]));
  assert.equal(rows.size, body.length, "docs/decisions.md has a duplicate key");
  const slots = [
    ...Object.keys(data.subagent_tiers.claude).map(tier => `subagent_tiers.claude.${tier}`),
    ...Object.keys(data.subagent_tiers).map(h => `agents.${h}.defaults.tier`),
    "agents.pi.defaults.classifier",
    "agents.pi.defaults.context_window",
    "agents.pi.search_tier",
    "measure.role_matrix",
  ];
  for (const key of slots) assert.ok(rows.has(key), `docs/decisions.md has no ${key} row`);
  // a key is a namespace label or a live agents.yaml path; a list-valued path may carry one sub-label
  for (const key of rows.keys()) {
    if (/^(parity|setting|measure|instruction)\./.test(key)) continue;
    let node = data;
    const segments = key.split(".");
    for (const [i, segment] of segments.entries()) {
      if (Array.isArray(node) && i === segments.length - 1) break;
      assert.ok(node && typeof node === "object" && !Array.isArray(node) && segment in node, `docs/decisions.md ${key}: neither a namespace label nor an agents.yaml path`);
      node = node[segment];
    }
  }
  for (const line of readSource("docs/decisions.md").split("\n").filter(line => line.trim().startsWith("|"))) {
    assert.ok(Buffer.byteLength(line) <= DECISION_ROW_MAX_BYTES, `docs/decisions.md row over ${DECISION_ROW_MAX_BYTES} bytes: ${line.slice(0, 60)}`);
  }
  for (const [key, [why, trigger]] of rows) {
    assert.match(why, /^(measured|vendor|benchmark|preference|forced):/, `docs/decisions.md ${key}: evidence kind`);
    // a trigger is an event: never empty, never a calendar date
    assert.ok(trigger && trigger.length > 0, `docs/decisions.md ${key}: empty trigger`);
    assert.doesNotMatch(trigger, /\d{4}-\d{2}-\d{2}/, `docs/decisions.md ${key}: dated trigger`);
    // every cell names the tier, never the pin, so a re-pin leaves the record true and is one agents.yaml edit
    for (const cell of [why, trigger]) {
      assert.doesNotMatch(cell, PIN_ID, `docs/decisions.md ${key}: names a pin id, name the tier`);
      for (const noun of nouns) assert.doesNotMatch(cell, new RegExp(`\\b${noun}\\b`), `docs/decisions.md ${key}: names the model family ${noun}`);
    }
  }
});

test("every native_coverage key gates a line of the shared projection", (t) => {
  const { data: load } = fixture(t);
  const data = load();
  const instructions = readSource(".chezmoitemplates/agent-instructions.md") + readSource(".chezmoitemplates/driver-instructions.md");
  for (const [h, agent] of Object.entries(data.agents)) {
    for (const key of agent.native_coverage ?? []) {
      assert.ok(instructions.includes(`has "${key}" $native`), `agents.${h}.native_coverage ${key}: no shared projection line checks it`);
    }
  }
});

test("agents.yaml comments carry no dates or reversal notes: those live in docs/decisions.md", () => {
  for (const comment of yamlComments(readSource(".chezmoidata/agents.yaml"))) {
    assert.doesNotMatch(comment, /\d{4}-\d{2}-\d{2}|Reversal|Revisit/, `agents.yaml comment: ${comment.trim()}`);
  }
});

test("shared subagent and skill bodies name no harness-specific file, tool prefix or home", () => {
  const files = [
    ...readdirSync(join(source, ".chezmoitemplates/subagents")).filter(file => file.endsWith(".md")).map(file => `.chezmoitemplates/subagents/${file}`),
    ...readdirSync(join(source, ".chezmoitemplates/skills")).filter(file => file.endsWith(".md")).map(file => `.chezmoitemplates/skills/${file}`),
    ".chezmoitemplates/reviewer-common.md",
    ".chezmoitemplates/explore-common.md",
  ];
  for (const file of files) {
    // a harness-specific noun belongs in a template action, which renders it per harness
    const prose = readSource(file).replace(/\{\{[\s\S]*?\}\}/g, "");
    for (const noun of ["CLAUDE.md", "AGENTS.md", "workspace_", "mcp__", "~/.claude", "~/.pi"]) {
      assert.ok(!prose.includes(noun), `${file} names ${noun} outside a template action`);
    }
  }
});

test("model pins live only in agents.yaml", () => {
  // dot-named entries are tool caches; chezmoi ignores them too
  const walk = dir => readdirSync(dir, { withFileTypes: true }).filter(entry => !entry.name.startsWith(".")).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
  });
  const files = (dir, keep) => readdirSync(join(source, dir), { withFileTypes: true })
    .filter(entry => entry.isFile() && keep(entry.name))
    .map(entry => join(source, dir, entry.name));
  const hits = [
    ...walk(join(source, ".chezmoitemplates")),
    ...walk(join(source, "private_dot_claude")),
    ...walk(join(source, "private_dot_pi")).filter(file => !file.endsWith(".test.mjs")),
    ...walk(join(source, "dot_agents")),
    ...files("scripts", name => name.endsWith(".mjs") && !name.endsWith(".test.mjs")),
    // this file: the literal role tables it used to carry are what the gate replaces
    fileURLToPath(import.meta.url),
  ].flatMap(file => readFileSync(file, "utf8").split("\n").flatMap((line, index) => {
    const match = PIN_ID.exec(line);
    return match ? [`${relative(source, file)}:${index + 1}: ${match[0]}`] : [];
  }));
  assert.deepEqual(hits, [], "literal model IDs belong in .chezmoidata/agents.yaml");
});

test("models.json keeps user entries and the managed contextWindow wins", (t) => {
  const { run, target, data: load } = fixture(t);
  const data = load();
  const provider = data.agents.pi.defaults.provider;
  const frontier = data.subagent_tiers.pi.frontier;
  mkdirSync(target(".pi/agent"), { recursive: true });
  writeFileSync(target(".pi/agent/models.json"), JSON.stringify({
    providers: {
      "user-provider": { baseUrl: "http://localhost:1234" },
      [provider]: { modelOverrides: { [frontier]: { contextWindow: 1 } } },
    },
  }));
  const models = JSON.parse(run("cat", target(".pi/agent/models.json")));
  assert.deepEqual(models.providers["user-provider"], { baseUrl: "http://localhost:1234" });
  assert.equal(models.providers[provider].modelOverrides[frontier].contextWindow, data.agents.pi.defaults.context_window.frontier);
});

test("settings.json keeps user entries and drops per-model thinking overrides", (t) => {
  const { run, target, data: load } = fixture(t);
  const data = load();
  mkdirSync(target(".pi/agent"), { recursive: true });
  writeFileSync(target(".pi/agent/settings.json"), JSON.stringify({
    lastChangelogVersion: "1.0.0",
    modelThinkingLevels: { "some-model": "low" },
    defaultThinkingLevel: "off",
  }));
  const settings = JSON.parse(run("cat", target(".pi/agent/settings.json")));
  assert.equal(settings.lastChangelogVersion, "1.0.0");
  assert.equal(settings.modelThinkingLevels, undefined);
  assert.equal(settings.defaultThinkingLevel, data.agents.pi.defaults.reasoning_effort);
});

// the whole tree, as CI applies it: every template (shared skill bodies included) and
// modify_ script renders against an isolated destination, so a template error fails here
test("the whole tree applies into an isolated destination", (t) => {
  const { run, target } = fixture(t);
  run("apply", "--no-tty", ["--exclude", "scripts,externals"]);
  const configs = [".claude.json", ".claude/settings.json", ".pi/agent/settings.json", ".pi/agent/workflow.json"]
    .map(path => JSON.parse(readFileSync(target(path), "utf8")));
  // configs point MCP/statusline commands into the source dir's node_modules/.bin;
  // a missing binary renders fine but breaks at runtime
  const bins = new Set([join(source, "node_modules/.bin/pi")]); // the pi launcher (zshrc) is in no config
  const walk = value => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    for (const s of [value.command, ...(Array.isArray(value.args) ? value.args : [])]) {
      if (typeof s === "string" && s.includes("node_modules/.bin")) bins.add(s);
    }
    Object.values(value).forEach(walk);
  };
  configs.forEach(walk);
  assert.ok(bins.size > 1, "no node_modules/.bin command found in the rendered configs");
  for (const bin of bins) assert.doesNotThrow(() => accessSync(bin, constants.X_OK), `missing binary: ${bin}`);
});

test("TuiOS config is minimal and retired Herdr integrations have no source owner", t => {
  const { run, target } = fixture(t);
  const config = run("cat", target(".config/tuios/config.toml"));
  assert.deepEqual(config.split("\n").map(line => line.trim()).filter(line => line && !line.startsWith("#")), [
    "[appearance]", 'theme = "catppuccin_mocha"', 'theme_light = "catppuccin_latte"', 'click_to_type = "single"',
    "[appearance.sidebar]", 'position = "left"',
    "[startup]", "daemon = true", "tiled = true", "open_default_window = true", "start_in_terminal_mode = true",
    "[workspaces]", "new_window_when_empty = true",
    "[notifications.agent]", "sound = true", "suppress_focused = false",
    "[keybindings]", 'preset = "tmux"',
    "[keybindings.prefix_mode]",
    'resize_pane_left_5 = ["ctrl+left", "shift+left"]',
    'resize_pane_right_5 = ["ctrl+right", "shift+right"]',
    'resize_pane_up_5 = ["ctrl+up", "shift+up"]',
    'resize_pane_down_5 = ["ctrl+down", "shift+down"]',
    "[keybindings.terminal_mode]", "terminal_focus_left = []", "terminal_focus_right = []",
    "terminal_focus_up = []", "terminal_focus_down = []", 'terminal_prev_window = ["opt+shift+tab"]',
    "[keybindings.global]", "command_palette = []",
    "[agents.checkpoints]", "enabled = false",
  ]);
  const claude = JSON.parse(run("cat", target(".claude/settings.json")));
  assert.equal(Object.hasOwn(claude, "hooks"), false);
  assert.equal(claude.statusLine.command, join(source, "node_modules/.bin/ccstatusline"));
  for (const path of [
    "dot_config/herdr/config.toml", "dot_local/bin/executable_herdr-equalize",
    "run_onchange_after_zz-herdr-integrations.sh.tmpl",
  ]) assert.equal(existsSync(join(source, path)), false, path);
  const brewfile = run("cat", target(".Brewfile"));
  assert.match(brewfile, /^brew "tuios"$/m);
  assert.doesNotMatch(brewfile, /^brew "herdr"$/m);
  const zshrc = run("cat", target(".zshrc"));
  assert.doesNotMatch(zshrc, /_herdr_report_org|HERDR_/);
});

test("native TuiOS inspection leaves application keys free in terminal mode", t => {
  const { run, target } = fixture(t);
  const path = target(".config/tuios/config.toml");
  mkdirSync(dirname(path), { recursive: true });
  const config = run("cat", path);
  writeFileSync(path, config);
  const inspect = (...args) => {
    const result = spawnSync("tuios", ["keybinds", ...args, "--json"], {
      encoding: "utf8", env: { ...process.env, HOME: target(""), XDG_CONFIG_HOME: target(".config") },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    return JSON.parse(result.stdout);
  };
  // A scratch-only sentinel proves the inspector loads this config, not the applied one.
  writeFileSync(path, config.replace("command_palette = []", 'command_palette = ["ctrl+alt+f12"]'));
  assert.equal(inspect("explain", "ctrl+alt+f12").swallowed_in_terminal, true);
  writeFileSync(path, config);
  for (const key of ["alt+up", "alt+down", "alt+left", "alt+right", "alt+p", "ctrl+p", "alt+enter", "ctrl+enter", "alt+b", "alt+f", "opt+up", "opt+down", "opt+left", "opt+right", "opt+p", "opt+enter", "opt+b", "opt+f"]) {
    const report = inspect("explain", key);
    assert.equal(report.swallowed_in_terminal, false, key);
    assert.ok(!(report.acts ?? []).some(act => ["terminal", "global"].includes(act.scope)), key);
  }
  const rows = inspect("list");
  assert.deepEqual(rows.find(row => row.action === "terminal_prev_window" && row.scope === "terminal").keys, ["opt+shift+tab"]);
  for (const direction of ["left", "right", "up", "down"]) {
    assert.deepEqual(rows.find(row => row.action === `resize_pane_${direction}_5` && row.scope === "prefix").keys, [
      `ctrl+b ctrl+${direction}`, `ctrl+b shift+${direction}`,
    ]);
  }
  assert.equal(inspect("explain", "ctrl+b").swallowed_in_terminal, true);
  assert.equal(rows.find(row => row.action === "send_prefix").unbound, true);
  assert.equal(readFileSync(path, "utf8"), config);
});

test("TuiOS prompt title is interactive, TTY-only and treats directory names as data", t => {
  const { run, target } = fixture(t);
  const zshrc = run("cat", target(".zshrc"));
  const hook = zshrc.match(/^_tuios_directory_title\(\) \{\n[^]*?^\}\nadd-zsh-hook precmd _tuios_directory_title$/m)?.[0];
  assert.ok(hook, "rendered title hook missing");
  const script = target("title.zsh");
  writeFileSync(script, `autoload -Uz add-zsh-hook\n${hook}\nfor hook in $precmd_functions; do "$hook"; done\n`);
  const malicious = `工作流\u001b\u0007\n%$(touch executed)`;
  const cwd = target(malicious);
  mkdirSync(cwd);
  const invoke = (interactive, tty, tuios, directory = cwd) => {
    const args = ["-df", ...(interactive ? ["-i"] : []), script];
    const ptyArgs = process.platform === "darwin"
      ? ["-q", "/dev/null", "zsh", ...args]
      : ["-q", "-e", "-c", `zsh ${args.map(arg => `'${arg.replaceAll("'", "'\\''")}'`).join(" ")}`, "/dev/null"];
    const result = spawnSync(tty ? "script" : "zsh", tty ? ptyArgs : args, {
      cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HOME: resolve(target("")), ZDOTDIR: target(""), TUIOS_ENV: tuios },
    });
    assert.equal(result.status, 0, result.stderr);
    // BSD script echoes its injected EOF when stdin is /dev/null.
    return tty && process.platform === "darwin" ? result.stdout.replace(/^\^D\x08\x08/, "") : result.stdout;
  };
  assert.equal(invoke(true, true, "1"), "\u001b]2;工作流%$(touch executed)/\u0007");
  assert.equal(existsSync(join(cwd, "executed")), false);
  assert.equal(invoke(true, true, "1", target("")), "\u001b]2;~/\u0007");
  assert.equal(invoke(true, true, "1", "/"), "\u001b]2;/\u0007");
  assert.equal(invoke(false, true, "1"), "");
  assert.equal(invoke(true, false, "1"), "");
  for (const value of ["", "0", "true"]) assert.equal(invoke(true, true, value), "");
});

test("managed Pi launch overrides native status only inside TuiOS and only for the call", t => {
  const { run, target, data: load } = fixture(t);
  const extension = join(load().chezmoi.homeDir, ".pi/agent/extensions/workflow.ts");
  const zshrc = run("cat", target(".zshrc"));
  const launcher = zshrc.match(/^pi\(\) \{\n[^]*?^\}/m)?.[0];
  assert.ok(launcher, "rendered Pi function missing");
  const cli = join(source, "node_modules/.bin/pi");
  assert.ok(launcher.includes(`"${cli}" --no-builtin-tools --no-extensions -e "${extension}" "$@"`));
  const stub = target("pi-stub");
  writeFileSync(stub, '#!/bin/sh\nprintf "%s\\n" "${PI_PROGRAM_STATUS-unset}" "$PI_OFFLINE" "$@"\n');
  chmodSync(stub, 0o700);
  const script = target("launcher.zsh");
  writeFileSync(script, `${launcher.replace(JSON.stringify(cli), JSON.stringify(stub))}\npi 'argument with spaces'\nprintf '%s\\n' "parent:\${PI_PROGRAM_STATUS-unset}"\n`);
  for (const tuios of [undefined, "", "0", "1", "true"]) {
    for (const status of [undefined, "user-value"]) {
      const env = { ...process.env };
      delete env.TUIOS_ENV;
      delete env.PI_PROGRAM_STATUS;
      if (tuios !== undefined) env.TUIOS_ENV = tuios;
      if (status !== undefined) env.PI_PROGRAM_STATUS = status;
      const result = spawnSync("zsh", ["-f", script], { encoding: "utf8", env });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(result.stdout.trimEnd().split("\n"), [
        tuios === "1" ? "0" : status ?? "unset", "1",
        "--no-builtin-tools", "--no-extensions", "-e", extension,
        "argument with spaces", `parent:${status ?? "unset"}`,
      ]);
    }
  }
});

// Trimmed rendered bodies: baseline fixture bytes, not frontmatter or inherited context.
const ROLE_BODY_MAX_BYTES = {
  Explore: 770, Plan: 695, "dep-researcher": 1182, "diff-reviewer": 2259,
  "explore-deep": 907, "general-purpose": 371, implementer: 858,
  "infra-reviewer": 2315, researcher: 1368, "spec-reviewer": 2615,
};
test("rendered role bodies and owned skill advertisements stay within baseline budgets", t => {
  const { run, target, data: load } = fixture(t);
  const data = load();
  for (const harness of ["pi", "claude"]) {
    for (const role of rolesFor(data, harness)) {
      const prefix = harness === "pi" ? ".pi/agent" : ".claude";
      const text = run("cat", target(`${prefix}/agents/${role}.md`));
      const body = text.split(/\n---\n/).slice(1).join("\n---\n").trim();
      const bytes = Buffer.byteLength(body);
      assert.ok(bytes <= ROLE_BODY_MAX_BYTES[role], `${harness}/${role}: ${bytes} body bytes exceeds baseline`);
    }
  }
  let advertisementBytes = 0;
  for (const file of readdirSync(join(source, ".chezmoitemplates/skills")).filter(file => file.endsWith(".md"))) {
    const name = file.slice(0, -3);
    const text = run("cat", target(`.agents/skills/${name}/SKILL.md`));
    const description = JSON.parse(text.match(/^description: (.+)$/m)[1]);
    advertisementBytes += Buffer.byteLength(`${name}\n${description}\n`);
  }
  // Owned name/description fields only; native advertisement framing is not measured here.
  assert.ok(advertisementBytes <= 600, `skill advertisements: ${advertisementBytes} exceeds baseline 600`);
});
