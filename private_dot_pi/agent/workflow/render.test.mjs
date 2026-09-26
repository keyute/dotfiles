import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { thinkingLevel } from "../../../scripts/pi-bridge.mjs";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
// line budgets (single owner; AGENTS.md's instruction-sources bullet points here)
const PROJECTION_MAX_LINES = 100;
const HARNESS_DOC_MAX_LINES = 120;
const REPO_AGENTS_MAX_LINES = 70;
const lineCount = text => text.replace(/\n$/, "").split("\n").length;

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

  assert.equal(workflow.version, 1);
  // bash 3.2 here-documents on macOS; see private_workflow.json.tmpl
  assert.ok(workflow.filesystem.allowWrite.includes("/var/tmp"));
  assert.equal(piSettings.defaultModel, data.subagent_tiers.pi[data.agents.pi.defaults.tier]);
  assert.equal(workflow.models.tiers.frontier, data.subagent_tiers.pi.frontier);
  assert.equal(workflow.agents.implementer.tools.includes("workspace_write"), true);
  assert.equal(workflow.agents.Explore.tools.includes("read"), false);
  // Only general-purpose delegates, as Claude Code's roster implies.
  assert.equal(workflow.agents.Explore.tools.includes("subagent"), false);
  // The frontier driver never hands its own tier to a child: the nesting
  // catch-all and the reviewer are both pinned to the top worker tier.
  const top = `${data.agents.pi.defaults.provider}/${workflow.models.tiers.top}`;
  assert.notEqual(workflow.models.tiers.top, workflow.models.tiers.frontier);
  assert.deepEqual([workflow.agents["general-purpose"].model, workflow.agents["general-purpose"].nests], [top, true]);
  assert.deepEqual([workflow.agents["spec-reviewer"].model, workflow.agents["spec-reviewer"].readonly], [top, true]);
  assert.ok(["workspace_write", "mcp", "subagent", "bg_wait"].every(tool => workflow.agents["general-purpose"].tools.includes(tool)));
  for (const role of Object.values(workflow.agents)) assert.equal(role.tools.includes("bg_wait"), role.nests);
  for (const [name, server] of Object.entries(workflow.mcp)) {
    assert.equal(server.policy.direct_tools, data.agent_mcp_servers[name].direct_tools === true, `${name} direct_tools`);
    assert.equal(server.policy.unsandboxed, name === "playwright", `${name} unsandboxed`);
  }
  const description = run("cat", target(".pi/agent/subagent-tool-description.md"));
  for (const role of Object.keys(data.subagents)) {
    assert.equal(description.includes(`\n- ${role}: `), rolesFor(data, "pi").includes(role), `${role} in the pi tool description`);
  }
  assert.doesNotMatch(description, /workflowScript|runs\.|guide|resume|CLI/);
  assert.equal(piSettings.defaultProvider, data.agents.pi.defaults.provider);
  // one entry per distinct tier model: tiers may share a pin
  assert.equal(piSettings.enabledModels.length, new Set(Object.values(workflow.models.tiers)).size);
  assert.match(piSettings.themes[0], /\/node_modules\/catppuccin-pi-theme\/themes$/);

  for (const role of Object.keys(workflow.agents)) {
    const agent = run("cat", target(`.pi/agent/agents/${role}.md`));
    const shim = run("cat", target(`.pi/agent/policy-roles/${role}.ts`));
    assert.match(agent, new RegExp(`^name: ${role}$`, "m"));
    assert.equal(/^tools: .*\bbg_wait\b/m.test(agent), workflow.agents[role].nests);
    assert.match(agent, new RegExp(`^allowNestedSubagents: ${workflow.agents[role].nests}$`, "m"));
    assert.match(agent, new RegExp(`extensions: .*/policy-roles/${role}\\.ts`));
    assert.match(shim, new RegExp(`, ${JSON.stringify(role)}\\);`));
  }

  const piInstructions = run("cat", target(".pi/agent/AGENTS.md"));
  const claudeInstructions = run("cat", target(".claude/CLAUDE.md"));
  const claudeHarness = run("cat", target(".claude/docs/harness.md"));
  const piHarness = run("cat", target(".pi/agent/docs/harness.md"));
  // pi's escalation rule names the pin no child may take (children.mjs rejects it)
  assert.ok(description.includes(`\`${data.subagent_tiers.pi.frontier}\``));
  for (const [name, text, max] of [
    [".pi/agent/AGENTS.md", piInstructions, PROJECTION_MAX_LINES],
    [".claude/CLAUDE.md", claudeInstructions, PROJECTION_MAX_LINES],
    [".pi/agent/docs/harness.md", piHarness, HARNESS_DOC_MAX_LINES],
    [".claude/docs/harness.md", claudeHarness, HARNESS_DOC_MAX_LINES],
    // chezmoi-ignored, so read from source: it loads in every session in this repo
    ["AGENTS.md", readFileSync(join(source, "AGENTS.md"), "utf8"), REPO_AGENTS_MAX_LINES],
  ]) {
    const lines = lineCount(text);
    assert.ok(lines <= max, `${name} is ${lines} lines (max ${max})`);
  }
  assert.ok(claudeHarness.includes(data.subagent_tiers.claude.top));

  const claudeSettings = JSON.parse(run("cat", target(".claude/settings.json")));
  assert.equal(claudeSettings.model, data.subagent_tiers.claude[data.agents.claude.defaults.tier]);
  assert.equal(claudeSettings.env.CLAUDE_CODE_SUBAGENT_MODEL, data.subagent_tiers.claude.top);
  // the cross-model bridge stays prompt-free in plan mode only via this rule
  assert.equal(claudeSettings.permissions.allow.includes("mcp__pi"), true);
  const frontierPin = data.subagent_tiers.claude.frontier;
  // the native per-call deny must name the frontier pin's alias
  const frontierAliases = claudeSettings.permissions.deny.flatMap(rule => /^Agent\(model:(\w+)\)$/.exec(rule)?.[1] ?? []);
  assert.ok(frontierAliases.some(alias => frontierPin.includes(alias)), `no Agent(model:...) deny covers ${frontierPin}`);
  const denyFrontierChild = run("cat", target(".claude/hooks/deny-frontier-child.mjs"));
  const hookPath = target(".claude/hooks/deny-frontier-child.mjs");
  mkdirSync(dirname(hookPath), { recursive: true });
  writeFileSync(hookPath, denyFrontierChild);
  const invokeHook = model => spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify({ tool_input: { model } }), encoding: "utf8",
  });
  for (const model of [frontierPin, `${frontierPin}[1m]`]) {
    const result = invokeHook(model);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "deny");
  }
  const allowed = invokeHook(data.subagent_tiers.claude.top);
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.equal(allowed.stdout, "");

  assert.ok(piHarness.includes(data.subagent_tiers.pi.frontier));
  assert.match(run("cat", target(".pi/agent/extensions/workflow.ts")), /\/\.pi\/agent\/workflow\/index\.mjs/);
  assert.match(run("cat", target(".pi/agent/node_modules")), /\/node_modules\s*$/);
  assert.equal(workflow.filesystem.denyWrite.some(path => path.endsWith("/private_dot_pi")), false);
  assert.equal(workflow.filesystem.denyWrite.some(path => path.endsWith("/node_modules")), true);

  const zsh = run("cat", target(".zshrc"));
  const zshPath = target(".zshrc.rendered");
  writeFileSync(zshPath, zsh);
  const syntax = spawnSync("zsh", ["-n", zshPath], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test("each role renders its roster tier and effort on every harness it targets", (t) => {
  const { run, invoke, target, data: load } = fixture(t);
  const data = load();
  const provider = data.agents.pi.defaults.provider;
  const noEffort = data.agents.claude.no_effort_models ?? [];
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
      if (noEffort.includes(model)) assert.doesNotMatch(agent, /^effort:/m, role);
      else assert.ok(agent.split("\n").includes(`effort: ${meta.effort}`), `${role}: claude effort ${meta.effort}`);
      // a nesting role inherits every tool, Agent included
      assert.equal(/^tools: /m.test(agent), !meta.nests, `${role}: claude tools line`);
      assert.equal(agent.split("\n").includes("omitClaudeMd: true"), meta.omit_instructions ?? false, `${role}: omitClaudeMd`);
    } else {
      assert.notEqual(invoke("cat", claudePath).status, 0, `${role} must not render for claude`);
    }

    if (harnesses.includes("pi")) {
      const model = `${provider}/${data.subagent_tiers.pi[meta.tier]}`;
      assert.notEqual(data.subagent_tiers.pi[meta.tier], data.subagent_tiers.pi.frontier, role);
      const contract = workflow.agents[role];
      assert.deepEqual(
        [contract.model, contract.thinking, contract.readonly, contract.nests],
        [model, meta.effort, meta.readonly, meta.nests ?? false],
        role,
      );
      if (!meta.readonly) assert.ok(contract.mutationTools.length > 0, role);
      else assert.deepEqual(contract.mutationTools, [], role);
      const agent = run("cat", target(`.pi/agent/agents/${role}.md`));
      assert.ok(agent.split("\n").includes(`model: ${model}`), `${role}: pi model ${model}`);
      assert.ok(agent.split("\n").includes(`thinking: ${meta.effort}`), `${role}: pi thinking ${meta.effort}`);
    }
  }

  const settings = JSON.parse(run("cat", target(".claude/settings.json")));
  // effort is pinned per model for exactly the top and frontier pins
  const effortLevel = data.agents.claude.defaults.reasoning_effort;
  assert.deepEqual(settings.modelSettings, Object.fromEntries(
    [data.subagent_tiers.claude.top, data.subagent_tiers.claude.frontier].map(model => [model, { effortLevel }]),
  ));
  const routingPins = JSON.parse(run("execute-template", '{{ dict "filter" .agents.pi.defaults.classifier_filter "judge" .agents.pi.defaults.classifier_judge "bridge" .agent_mcp_servers.pi.args | toJson }}'));
  // one model for the whole approval gate (docs/pi-implementation.md)
  assert.equal(routingPins.filter.model, routingPins.judge.model);
  // the bridge is a worker: top tier, never the frontier, at its own effort
  const [effortFlag, bridgeEffort, ...bridgeModel] = routingPins.bridge;
  assert.equal(effortFlag, "--reasoning-effort");
  assert.doesNotThrow(() => thinkingLevel(bridgeEffort), `bridge effort ${bridgeEffort}`);
  assert.deepEqual(bridgeModel, ["--model", data.subagent_tiers.pi.top]);
});

test("each harness keeps the three tier slots, and its driver and no-effort models resolve through them", (t) => {
  const { data: load } = fixture(t);
  const data = load();
  for (const [h, agent] of Object.entries(data.agents)) {
    const tiers = data.subagent_tiers[h];
    assert.deepEqual(Object.keys(tiers).sort(), ["frontier", "small", "top"], h);
    assert.ok(Object.hasOwn(tiers, agent.defaults.tier), `${h}: driver tier ${agent.defaults.tier}`);
    for (const model of agent.no_effort_models ?? []) {
      assert.ok(Object.values(tiers).includes(model), `${h}: no_effort_models entry ${model} is not a current pin`);
    }
  }
});

test("missing or unknown role tier and effort fail rendering rather than inheriting", (t) => {
  const { invoke } = fixture(t);
  for (const render of [
    '{{ includeTemplate "subagent-claude.md" (dict "root" . "name" "implementer") }}',
    '{{ includeTemplate "pi-roles" (dict "root" .) }}',
  ]) {
    for (const edit of ['unset $role "tier"', 'unset $role "effort"', 'set $role "tier" "mid"']) {
      const result = invoke("execute-template", `{{ $role := index .subagents "implementer" }}{{ $_ := ${edit} }}${render}`);
      assert.notEqual(result.status, 0, `${edit} should fail ${render}`);
    }
  }
});

test("every roster role and shared skill has its source stubs, and every stub a source", (t) => {
  const { data: load } = fixture(t);
  const data = load();
  const stubDirs = {
    claude: [["private_dot_claude/agents", ".md.tmpl"]],
    pi: [["private_dot_pi/agent/agents", ".md.tmpl"], ["private_dot_pi/agent/policy-roles", ".ts.tmpl"]],
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
  for (const file of readdirSync(join(source, ".chezmoitemplates/subagents")).filter(file => file.endsWith(".md"))) {
    assert.ok(Object.hasOwn(data.subagents, file.slice(0, -".md".length)), `.chezmoitemplates/subagents/${file} names no role in the roster`);
  }

  const skills = readdirSync(join(source, ".chezmoitemplates/skills"))
    .filter(file => file.endsWith(".md"))
    .map(file => file.slice(0, -".md".length));
  for (const dir of ["private_dot_claude/skills", "dot_agents/skills"]) {
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
});

test("model pins live only in agents.yaml", () => {
  const pin = /\bclaude-[a-z0-9]+-[0-9][a-z0-9-]*|\bgpt-[0-9][a-z0-9.-]*/;
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
    ...files("private_dot_pi/agent", name => name.endsWith(".tmpl")),
    ...walk(join(source, "private_dot_pi/agent/docs")),
    ...files("scripts", name => name.endsWith(".mjs") && !name.endsWith(".test.mjs")),
    // this file: the literal role tables it used to carry are what the gate replaces
    fileURLToPath(import.meta.url),
  ].flatMap(file => readFileSync(file, "utf8").split("\n").flatMap((line, index) => {
    const match = pin.exec(line);
    return match ? [`${relative(source, file)}:${index + 1}: ${match[0]}`] : [];
  }));
  assert.deepEqual(hits, [], "literal model IDs belong in .chezmoidata/agents.yaml");
});

// `cat` above is the template-error gate; this exercises the diff path itself
// (modify_ scripts against a destination) and the plain files no `cat` reaches.
test("diff exits clean for each affected harness target against an isolated destination", (t) => {
  const { run, target, data: load } = fixture(t);
  const data = load();
  for (const relative of [
    ...rolesFor(data, "pi").flatMap(role => [`.pi/agent/agents/${role}.md`, `.pi/agent/policy-roles/${role}.ts`]),
    ...rolesFor(data, "claude").map(role => `.claude/agents/${role}.md`),
    ".pi/agent/workflow.json",
    ".pi/agent/settings.json",
    ".pi/agent/AGENTS.md",
    ".pi/agent/docs/harness.md",
    ".pi/agent/docs/sandbox.md",
    ".pi/agent/subagent-tool-description.md",
    ".pi/agent/extensions/subagent/config.json",
    ".pi/agent/extensions/workflow.ts",
    ".pi/agent/workflow/index.mjs",
    ".pi/agent/workflow/footer.mjs",
    ".pi/agent/workflow/questionnaire.mjs",
    ".pi/agent/workflow/rows.mjs",
    ".pi/agent/node_modules",
    ".claude/settings.json",
    ".claude/hooks/deny-frontier-child.mjs",
    ".claude/CLAUDE.md",
    ".claude/docs/harness.md",
    ".claude/skills/cross-model-review/SKILL.md",
  ]) {
    run("diff", target(relative), ["--pager", ""]);
  }
});
