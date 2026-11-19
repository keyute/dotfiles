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
// a model id: pins live in agents.yaml, so a re-pin is one edit there
const PIN_ID = /\bclaude-[a-z0-9]+-[0-9][a-z0-9-]*|\bgpt-[0-9][a-z0-9.-]*/;
// roles take every documented level; the driver's settings effortLevel excludes `max`, which is session-only
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const CLAUDE_DRIVER_EFFORTS = ["low", "medium", "high", "xhigh"];
const KOPI_EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const KOPI_TOOLS = ["Read", "Glob", "Grep", "LS", "Write", "Edit", "Bash", "WebFetch", "WebSearch", "Skill"];

const readSource = path => readFileSync(join(source, path), "utf8");

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
  // pi skips the shift+tab mode shortcut while a reserved action holds the key.
  assert.deepEqual(JSON.parse(run("cat", target(".pi/agent/keybindings.json")))["app.thinking.cycle"], []);

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
  const subagentConfig = JSON.parse(run("cat", target(".pi/agent/extensions/subagent/config.json")));
  assert.equal(subagentConfig.toolActivation, "eager");
  // the plugin's scripted workflows run model code in an escapable node:vm; orchestrate replaces them
  assert.ok(subagentConfig.disabledFeatures.includes("workflow-scripts"));
  assert.equal(workflow.orchestrateConcurrency, data.agents.pi.orchestrate_concurrency);
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
  // driver rules reach pi's root through workflow.json only, flat; Claude nests them under its wrapper line
  assert.equal(typeof workflow.driverInstructions, "string");
  assert.match(workflow.driverInstructions, /spec-reviewer/);
  assert.doesNotMatch(piInstructions, /When you are the session driver|spec-reviewer/);
  assert.doesNotMatch(workflow.driverInstructions, /When you are the session driver/);
  assert.match(claudeInstructions, /^- When you are the session driver/m);
  assert.ok(claudeInstructions.includes(`  ${workflow.driverInstructions.split("\n")[0]}`));
  const claudeHarness = run("cat", target(".claude/docs/harness.md"));
  const piHarness = run("cat", target(".pi/agent/docs/harness.md"));
  assert.ok(claudeHarness.includes(data.subagent_tiers.claude.top));

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
  // an MCP server's hosts open for its own process, not for every shell
  for (const [name, entry] of Object.entries(workflow.mcp)) {
    assert.deepEqual(entry.policy.domains, data.agent_mcp_servers[name].domains ?? [], name);
    assert.ok(entry.policy.unsandboxed || entry.policy.domains.length, `pi: ${name} is sandboxed with no hosts of its own`);
    for (const host of entry.policy.domains) assert.ok(!workflow.network.allowedDomains.includes(host), `pi: ${name}'s ${host} is in the shared allowlist`);
  }
  assert.equal(claudeSettings.model, data.subagent_tiers.claude[data.agents.claude.defaults.tier]);
  assert.equal(claudeSettings.workflowSizeGuideline, data.workflow_size);
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

  assert.ok(piHarness.includes(data.subagent_tiers.pi.frontier));
  assert.equal(workflow.filesystem.denyWrite.some(path => path.endsWith("/private_dot_pi")), false);
  assert.equal(workflow.filesystem.denyWrite.some(path => path.endsWith("/node_modules")), true);
});

test("a shared skill renders the same body on both harnesses and stays model-invocable", t => {
  const { run, target } = fixture(t);
  for (const file of readdirSync(join(source, ".chezmoitemplates/skills")).filter(file => file.endsWith(".md"))) {
    const skill = file.slice(0, -".md".length);
    const pi = run("cat", target(`.agents/skills/${skill}/SKILL.md`));
    assert.equal(pi, run("cat", target(`.claude/skills/${skill}/SKILL.md`)), skill);
    assert.doesNotMatch(pi, /^disable-model-invocation:/m, skill);
  }
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
    const effort = meta.effort ?? data.subagent_effort;
    // The frontier runs only the Plan role as a child.
    assert.equal(meta.tier === "frontier", role === "Plan", role);

    const claudePath = target(`.claude/agents/${role}.md`);
    if (harnesses.includes("claude")) {
      const model = data.subagent_tiers.claude[meta.tier];
      if (role !== "Plan") assert.notEqual(model, data.subagent_tiers.claude.frontier, role);
      const agent = run("cat", claudePath);
      assert.match(agent, new RegExp(`^name: ${role}$`, "m"));
      assert.ok(agent.split("\n").includes(`model: ${model}`), `${role}: claude model ${model}`);
      assert.ok(CLAUDE_EFFORTS.includes(effort), `${role}: ${effort} is not a Claude effort level`);
      assert.ok(agent.split("\n").includes(`effort: ${effort}`), `${role}: claude effort ${effort}`);
      // a nesting role inherits every tool, Agent included
      assert.equal(/^tools: /m.test(agent), !meta.nests, `${role}: claude tools line`);
      assert.equal(agent.split("\n").includes("omitClaudeMd: true"), meta.omit_instructions ?? false, `${role}: omitClaudeMd`);
    } else {
      assert.notEqual(invoke("cat", claudePath).status, 0, `${role} must not render for claude`);
    }

    const kopiRole = role.toLowerCase();
    const kopiPath = target(`.kopi/agents/${kopiRole}.md`);
    if (harnesses.includes("kopi")) {
      const agent = run("cat", kopiPath);
      const lines = agent.split("\n");
      const front = lines.slice(1, lines.indexOf("---", 1));
      const keys = front.map(line => line.split(":")[0]);
      assert.ok(keys.every(key => ["name", "description", "model", "effort", "tools", "mode", "instructions"].includes(key)), `${role}: kopi frontmatter keys ${keys}`);
      assert.ok(front.includes(`name: ${kopiRole}`), `${role}: kopi name`);
      assert.ok(front.includes(`model: ${data.agents.kopi.defaults.provider}/${data.subagent_tiers.kopi[meta.tier]}`), `${role}: kopi model`);
      assert.ok(KOPI_EFFORTS.includes(effort), `${role}: ${effort} is not a kopi effort level`);
      assert.ok(front.includes(`effort: ${effort}`), `${role}: kopi effort ${effort}`);
      assert.equal(front.includes("mode: plan"), meta.readonly ?? false, `${role}: kopi mode`);
      assert.equal(front.includes("instructions: false"), meta.omit_instructions ?? false, `${role}: kopi instructions`);
      const toolsLine = front.find(line => line.startsWith("tools: "));
      assert.equal(toolsLine !== undefined, !meta.tools.includes("mcp__*"), `${role}: kopi tools line`);
      const toolNames = toolsLine?.slice("tools: [".length, -1).split(",").map(tool => tool.trim());
      if (toolNames) assert.deepEqual(toolNames, meta.tools.split(",").map(tool => tool.trim()), `${role}: kopi tools`);
      for (const tool of toolNames ?? []) {
        assert.ok(KOPI_TOOLS.includes(tool) || tool.startsWith("mcp__"), `${role}: kopi tool ${tool}`);
      }
    } else {
      assert.notEqual(invoke("cat", kopiPath).status, 0, `${role} must not render for kopi`);
    }

    if (harnesses.includes("pi")) {
      const model = `${provider}/${data.subagent_tiers.pi[meta.tier]}`;
      // pi refuses frontier children, so the frontier Plan role must not target pi
      assert.notEqual(data.subagent_tiers.pi[meta.tier], data.subagent_tiers.pi.frontier, role);
      assertPiEffort(provider, data.subagent_tiers.pi[meta.tier], effort, role);
      const contract = workflow.agents[role];
      assert.deepEqual(
        [contract.model, contract.thinking, contract.readonly, contract.nests],
        [model, effort, meta.readonly, meta.nests ?? false],
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
      assert.ok(agent.split("\n").includes(`thinking: ${effort}`), `${role}: pi thinking ${effort}`);
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
  // one model for the whole approval gate (agents.pi.defaults.classifier)
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
    kopi: [["private_dot_kopi/exact_agents", ".md.tmpl"]],
  };
  for (const [harness, dirs] of Object.entries(stubDirs)) {
    const roles = rolesFor(data, harness);
    for (const [dir, suffix] of dirs) {
      // kopi stubs carry the lowercased roster name
      const stubName = role => harness === "kopi" ? role.toLowerCase() : role;
      for (const role of roles) assert.ok(existsSync(join(source, dir, `${stubName(role)}${suffix}`)), `missing stub ${dir}/${stubName(role)}${suffix}`);
      for (const file of readdirSync(join(source, dir))) {
        assert.ok(file.endsWith(suffix) && roles.map(stubName).includes(file.slice(0, -suffix.length)), `${dir}/${file} names no ${harness} role in the roster`);
      }
    }
  }
  // subagent-{claude,pi,kopi}.md include subagents/<role>.md for each roster role; shared includes sit one level up
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
    ...["private_dot_claude/exact_skills", "dot_agents/exact_skills"].flatMap(dir => readdirSync(join(source, dir))
      .filter(skill => existsSync(join(source, dir, skill, "SKILL.md")))
      .map(skill => [`${dir}/${skill}/SKILL.md`, readSource(`${dir}/${skill}/SKILL.md`)])),
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

test("renders the kopi config from the shared policy", (t) => {
  const { run, target, data: load } = fixture(t);
  const data = load();
  const provider = data.agents.kopi.defaults.provider;
  const config = JSON.parse(run("cat", target(".kopi/config.json")));
  const claude = JSON.parse(run("cat", target(".claude/settings.json")));
  // kopi rejects unknown keys, and nothing may restate a default
  assert.deepEqual(Object.keys(config).sort(), ["classifier", "mcpServers", "model", "permissions", "sandbox", "smallModel", "statusline", "version"]);
  assert.equal(config.model, `${provider}/${data.subagent_tiers.kopi[data.agents.kopi.defaults.tier]}`);
  assert.equal(config.smallModel, `${provider}/${data.subagent_tiers.kopi.small}`);
  assert.deepEqual(config.classifier, { enabled: true });
  assert.deepEqual(config.statusline, { right: ["notice", "tasks", "mode"] });
  assert.equal(config.sandbox.enabled, true);
  assert.equal(Object.hasOwn(config.sandbox, "network"), false);
  for (const path of config.sandbox.denyRead) {
    assert.ok(!/[*?[]/.test(path), `denyRead ${path} has a glob character`);
    assert.ok(config.permissions.deny.includes(`*(${path})`), `permissions.deny misses *(${path})`);
  }
  const paths = Object.entries(data.agent_sandbox.filesystem.paths);
  for (const [path] of paths.filter(([, mode]) => mode === "none")) assert.ok(config.sandbox.denyRead.includes(path), `denyRead misses ${path}`);
  assert.deepEqual([...config.sandbox.allowWrite].sort(), paths.filter(([, mode]) => mode === "write").map(([path]) => path).sort());
  for (const other of [data.agents.claude.home, data.agents.pi.home]) assert.ok(config.sandbox.denyRead.includes(other), `denyRead misses ${other}`);
  assert.ok(claude.permissions.deny.includes("Read(~/.kopi)"));
  assert.ok(JSON.parse(run("cat", target(".pi/agent/workflow.json"))).filesystem.denyRead.includes("~/.kopi"));
  for (const tool of ["Edit", "Write"]) {
    assert.ok(config.permissions.deny.includes(`${tool}(${data.chezmoi.sourceDir}/node_modules)`), `${tool} node_modules deny`);
  }
  const mcp = rules => rules.filter(rule => rule.startsWith("mcp__"));
  assert.deepEqual(mcp(config.permissions.allow), mcp(claude.permissions.allow));
  assert.deepEqual(mcp(config.permissions.deny), mcp(claude.permissions.deny));
  assert.deepEqual(config.permissions.allow.filter(rule => !rule.startsWith("mcp__")), ["WebFetch", "WebSearch"]);
  for (const [name, server] of Object.entries(config.mcpServers)) assert.deepEqual(Object.keys(server).sort(), ["args", "command", "env", "type"], name);
  const instructions = run("cat", target(".kopi/AGENTS.md"));
  assert.match(instructions, /^- When you are the session driver/m);
  assert.doesNotMatch(instructions, /sandbox\.md/);
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
    for (const noun of ["CLAUDE.md", "AGENTS.md", "workspace_", "mcp__", "~/.claude", "~/.pi", "~/.kopi"]) {
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
  const hits = [
    ...walk(join(source, ".chezmoitemplates")),
    ...walk(join(source, "private_dot_claude")),
    ...walk(join(source, "private_dot_kopi")),
    ...walk(join(source, "private_dot_pi")).filter(file => !file.endsWith(".test.mjs")),
    ...walk(join(source, "dot_agents")),
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
    terminal: { showTerminalProgress: true, clearOnShrink: true },
  }));
  const settings = JSON.parse(run("cat", target(".pi/agent/settings.json")));
  assert.equal(settings.lastChangelogVersion, "1.0.0");
  assert.equal(settings.modelThinkingLevels, undefined);
  assert.equal(Object.hasOwn(settings.terminal, "showTerminalProgress"), false);
  assert.equal(settings.terminal.clearOnShrink, true);
  assert.equal(settings.defaultThinkingLevel, data.agents.pi.defaults.reasoning_effort);
});

// the whole tree, as CI applies it: every template (shared skill bodies included) and
// modify_ script renders against an isolated destination, so a template error fails here
test("the whole tree applies into an isolated destination", (t) => {
  const { run, target } = fixture(t);
  run("apply", "--no-tty", ["--exclude", "scripts,externals"]);
  const configs = [".claude.json", ".claude/settings.json", ".pi/agent/settings.json", ".pi/agent/workflow.json", ".kopi/config.json"]
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

test("managed Pi launch sets PI_PROGRAM_STATUS=0 only for the call", t => {
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
  writeFileSync(script, `${launcher.replace(JSON.stringify(cli), JSON.stringify(stub))}\npi 'argument with spaces'\nprintf '%s\\n' "parent:\${PI_PROGRAM_STATUS-unset}" "offline:\${PI_OFFLINE-unset}"\n`);
  for (const status of [undefined, "user-value"]) {
    const env = { ...process.env };
    delete env.PI_PROGRAM_STATUS;
    env.PI_OFFLINE = "parent-offline";
    if (status !== undefined) env.PI_PROGRAM_STATUS = status;
    const result = spawnSync("zsh", ["-f", script], { encoding: "utf8", env });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trimEnd().split("\n"), [
      "0", "1",
      "--no-builtin-tools", "--no-extensions", "-e", extension,
      "argument with spaces", `parent:${status ?? "unset"}`, "offline:parent-offline",
    ]);
  }
});

