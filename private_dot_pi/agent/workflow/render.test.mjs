import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

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
  const override = (data) => {
    const file = join(root, `override-${Math.random()}.json`);
    writeFileSync(file, JSON.stringify(data));
    return ["--override-data-file", file];
  };
  const target = (relative) => join(destination, relative);
  return { run, invoke, override, target };
};

test("renders Pi and Claude projections with isolated state", (t) => {
  const { run, target } = fixture(t);
  const workflow = JSON.parse(run("cat", target(".pi/agent/workflow.json")));
  const piSettings = JSON.parse(run("cat", target(".pi/agent/settings.json")));

  assert.equal(workflow.version, 1);
  // bash 3.2 here-documents on macOS; see private_workflow.json.tmpl
  assert.ok(workflow.filesystem.allowWrite.includes("/var/tmp"));
  assert.equal(workflow.models.default, "gpt-6-astra");
  assert.equal(workflow.models.tiers.frontier, "gpt-6-astra");
  assert.equal(Object.keys(workflow.agents).length, 14);
  assert.equal(workflow.agents.implementer.tools.includes("workspace_write"), true);
  assert.equal(workflow.agents.explorer.tools.includes("read"), false);
  // Only general-purpose delegates, as Claude Code's roster implies.
  assert.equal(workflow.agents.explorer.tools.includes("subagent"), false);
  // The frontier driver never hands its own tier to a child: the nesting
  // catch-all and the reviewer are both pinned to the top worker tier.
  const top = `openai-codex/${workflow.models.tiers.top}`;
  assert.notEqual(workflow.models.tiers.top, workflow.models.tiers.frontier);
  assert.deepEqual([workflow.agents["general-purpose"].model, workflow.agents["general-purpose"].nests], [top, true]);
  assert.deepEqual([workflow.agents["spec-reviewer"].model, workflow.agents["spec-reviewer"].readonly], [top, true]);
  assert.ok(["workspace_write", "mcp", "subagent", "bg_wait"].every(tool => workflow.agents["general-purpose"].tools.includes(tool)));
  for (const role of Object.values(workflow.agents)) assert.equal(role.tools.includes("bg_wait"), role.nests);
  assert.equal(workflow.mcp.context7.policy.direct_tools, true);
  assert.equal(workflow.mcp.exa.policy.direct_tools, false);
  assert.equal(workflow.mcp.playwright.policy.direct_tools, false);
  assert.ok(Object.entries(workflow.mcp).every(([name, server]) => server.policy.unsandboxed === (name === "playwright")));
  assert.equal(Object.hasOwn(workflow.mcp, "serena"), false);
  const description = run("cat", target(".pi/agent/subagent-tool-description.md"));
  assert.match(description, /^- diff-reviewer: Review a changed diff/m);
  assert.match(description, /^- general-purpose: /m);
  assert.doesNotMatch(description, /^- Explore:/m);
  assert.match(description, /only when authorized by the current user request or applicable user\/project instructions/);
  assert.match(description, /Children always run in the background/);
  assert.match(description, /Plan mode may launch read-only agents only/);
  assert.match(description, /Writers and nested agents require execute mode/);
  assert.match(description, /native notification/);
  assert.match(description, /Discover capabilities once/);
  assert.match(description, /launch preflight remains authoritative/);
  assert.match(description, /One writer owns each write scope/);
  assert.match(description, /Children start with fresh context/);
  assert.match(description, /capture its partial diff before retrying/);
  assert.match(description, /Do not silently substitute another agent, model, protocol or execution mode/);
  assert.doesNotMatch(description, /workflowScript|runs\.|guide|resume|CLI/);
  assert.match(run("cat", target(".pi/agent/agents/general-purpose.md")), /^allowNestedSubagents: true$/m);
  assert.match(run("cat", target(".pi/agent/agents/explorer.md")), /^allowNestedSubagents: false$/m);
  assert.equal(piSettings.defaultProvider, "openai-codex");
  // one entry per distinct tier model: mid and top may share a pin
  assert.equal(piSettings.enabledModels.length, new Set(Object.values(workflow.models.tiers)).size);
  assert.equal(piSettings.theme, "catppuccin-latte/catppuccin-mocha");
  assert.equal(piSettings.quietStartup, true);
  assert.equal(piSettings.hideThinkingBlock, false);
  assert.equal(piSettings.outputPad, 0);
  assert.equal(piSettings.terminal.showImages, false);
  const subagents = JSON.parse(run("cat", target(".pi/agent/extensions/subagent/config.json")));
  assert.equal(subagents.timeoutMs, 7_200_000);
  assert.equal(subagents.checkpointBeforeDeadlineMs, 300_000);
  assert.match(piSettings.themes[0], /\/node_modules\/catppuccin-pi-theme\/themes$/);

  for (const role of Object.keys(workflow.agents)) {
    const agent = run("cat", target(`.pi/agent/agents/${role}.md`));
    const shim = run("cat", target(`.pi/agent/policy-roles/${role}.ts`));
    assert.match(agent, new RegExp(`^name: ${role}$`, "m"));
    assert.equal(/^tools: .*\bbg_wait\b/m.test(agent), workflow.agents[role].nests);
    assert.match(agent, new RegExp(`extensions: .*/policy-roles/${role}\\.ts`));
    assert.match(shim, new RegExp(`, ${JSON.stringify(role)}\\);`));
  }

  const piInstructions = run("cat", target(".pi/agent/AGENTS.md"));
  const questionnaire = run("cat", target(".pi/agent/workflow/questionnaire.mjs"));
  const rows = run("cat", target(".pi/agent/workflow/rows.mjs"));
  const claudeInstructions = run("cat", target(".claude/CLAUDE.md"));
  const claudeHarness = run("cat", target(".claude/docs/harness.md"));
  assert.match(piInstructions, /Working agreements/);
  assert.match(claudeInstructions, /Working agreements/);
  assert.match(claudeInstructions, /cross-model-review/);
  assert.match(questionnaire, /registerQuestionnaire/);
  assert.match(rows, /export/);
  assert.match(claudeHarness, /claude-fable-5-1/);

  const claudeSettings = JSON.parse(run("cat", target(".claude/settings.json")));
  assert.equal(claudeSettings.model, "claude-fable-5-1[1m]");
  assert.equal(claudeSettings.env.CLAUDE_CODE_SUBAGENT_MODEL, "claude-opus-5-5");
  assert.match(JSON.stringify(claudeSettings), /context7/);
  assert.match(JSON.stringify(claudeSettings), /filesystem/);
  assert.doesNotMatch(JSON.stringify(claudeSettings), /serena/i);
  // the cross-model bridge stays prompt-free in plan mode only via this rule
  assert.equal(claudeSettings.permissions.allow.includes("mcp__pi"), true);
  assert.doesNotMatch(JSON.stringify(claudeSettings), /codex/);
  const denyFrontierChild = run("cat", target(".claude/hooks/deny-frontier-child.mjs"));
  assert.match(denyFrontierChild, /const PIN = "claude-fable-5-1"/);
  const hookPath = target(".claude/hooks/deny-frontier-child.mjs");
  mkdirSync(dirname(hookPath), { recursive: true });
  writeFileSync(hookPath, denyFrontierChild);
  const invokeHook = model => spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify({ tool_input: { model } }), encoding: "utf8",
  });
  for (const model of ["claude-fable-5-1", "claude-fable-5-1[1m]"]) {
    const result = invokeHook(model);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "deny");
  }
  const allowed = invokeHook("claude-opus-5");
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.equal(allowed.stdout, "");

  const frontier = run("execute-template", "{{ .subagent_tiers.pi.frontier }}");
  assert.equal(frontier, "gpt-6-astra");
  assert.match(run("cat", target(".pi/agent/docs/harness.md")), /Astra/);
  assert.match(run("cat", target(".pi/agent/docs/sandbox.md")), /SRT profile/);
  assert.match(run("cat", target(".claude/skills/cross-model-review/SKILL.md")), /mcp__pi__review/);
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

test("role routing and effort render independently per harness", (t) => {
  const { run, invoke, target, override } = fixture(t);
  const pi = {
    explorer: ["gpt-6-luna", "low"],
    "log-triager": ["gpt-6-luna", "medium"],
    "dep-researcher": ["gpt-6-luna", "medium"],
    "explore-deep": ["gpt-6-sol", "medium"],
    researcher: ["gpt-6-sol", "medium"],
    implementer: ["gpt-6-sol", "medium"],
    "go-reviewer": ["gpt-6-sol", "high"],
    "python-reviewer": ["gpt-6-sol", "high"],
    "ts-reviewer": ["gpt-6-sol", "high"],
    "shell-reviewer": ["gpt-6-sol", "high"],
    "infra-reviewer": ["gpt-6-sol", "high"],
    "diff-reviewer": ["gpt-6-sol", "high"],
    "spec-reviewer": ["gpt-6-sol", "high"],
    "general-purpose": ["gpt-6-sol", "high"],
  };
  const claude = {
    Explore: ["claude-haiku-4-5", null],
    "log-triager": ["claude-haiku-4-5", null],
    "dep-researcher": ["claude-opus-5-5", "medium"],
    "explore-deep": ["claude-opus-5-5", "medium"],
    researcher: ["claude-opus-5-5", "medium"],
    implementer: ["claude-opus-5-5", "medium"],
    "go-reviewer": ["claude-opus-5-5", "medium"],
    "python-reviewer": ["claude-opus-5-5", "medium"],
    "ts-reviewer": ["claude-opus-5-5", "medium"],
    "shell-reviewer": ["claude-opus-5-5", "medium"],
    "infra-reviewer": ["claude-opus-5-5", "medium"],
    "diff-reviewer": ["claude-opus-5-5", "medium"],
    "spec-reviewer": ["claude-opus-5-5", "high"],
  };
  const workflow = JSON.parse(run("cat", target(".pi/agent/workflow.json")));
  assert.deepEqual(Object.keys(workflow.agents).sort(), Object.keys(pi).sort());
  for (const [role, [model, effort]] of Object.entries(pi)) {
    assert.deepEqual([workflow.agents[role].model, workflow.agents[role].thinking], [`openai-codex/${model}`, effort]);
    const agent = run("cat", target(`.pi/agent/agents/${role}.md`));
    assert.match(agent, new RegExp(`^model: openai-codex/${model}$`, "m"));
    assert.match(agent, new RegExp(`^thinking: ${effort}$`, "m"));
  }
  for (const [role, [model, effort]] of Object.entries(claude)) {
    const agent = run("cat", target(`.claude/agents/${role}.md`));
    assert.match(agent, new RegExp(`^model: ${model}$`, "m"));
    if (effort) assert.match(agent, new RegExp(`^effort: ${effort}$`, "m"));
    else assert.doesNotMatch(agent, /^effort:/m);
  }
  assert.doesNotMatch(run("cat", target(".claude/agents/Explore.md")), /name: explorer/);
  assert.notEqual(invoke("cat", target(".claude/agents/general-purpose.md")).status, 0);
  const settings = JSON.parse(run("cat", target(".claude/settings.json")));
  assert.equal(settings.effortLevel, "high");
  assert.equal(settings.model, "claude-fable-5-1[1m]");
  assert.equal(Object.hasOwn(settings.env, "CLAUDE_CODE_EFFORT_LEVEL"), false);
  assert.equal(settings.env.CLAUDE_CODE_SUBAGENT_MODEL, "claude-opus-5-5");
  assert.equal(workflow.models.default, "gpt-6-astra");
  const routingPins = JSON.parse(run("execute-template", '{{ dict "filter" .agents.pi.defaults.classifier_filter "judge" .agents.pi.defaults.classifier_judge "bridge" .agent_mcp_servers.pi.args | toJson }}'));
  assert.deepEqual(routingPins, {
    filter: { model: "gpt-5.6-terra", reasoning_effort: "none" },
    judge: { model: "gpt-5.6-terra", reasoning_effort: "medium" },
    bridge: ["--reasoning-effort", "high", "--model", "gpt-6-sol"],
  });
  const piOverride = override({ subagents: { explorer: { pi: { tier: "mid", reasoning_effort: "high" } } } });
  const changedPi = JSON.parse(run("execute-template", '{{ includeTemplate "pi-roles" (dict "root" .) }}', piOverride));
  assert.deepEqual([changedPi.explorer.model, changedPi.explorer.thinking], ["openai-codex/gpt-6-sol", "high"]);
  assert.equal(
    run("execute-template", '{{ includeTemplate "subagent-claude.md" (dict "root" . "name" "Explore") }}', piOverride).trim(),
    run("cat", target(".claude/agents/Explore.md")).trim(),
  );
  const claudeOverride = override({ subagents: { Explore: { claude: { tier: "mid", reasoning_effort: "high" } } } });
  const changedClaude = run("execute-template", '{{ includeTemplate "subagent-claude.md" (dict "root" . "name" "Explore") }}', claudeOverride);
  assert.match(changedClaude, /^model: claude-opus-5-5$/m);
  assert.match(changedClaude, /^effort: high$/m);
  assert.deepEqual(JSON.parse(run("execute-template", '{{ includeTemplate "pi-roles" (dict "root" .) }}', claudeOverride)).explorer, workflow.agents.explorer);
});

test("missing per-harness role settings fail rendering rather than inheriting", (t) => {
  const { invoke } = fixture(t);
  for (const [harness, value] of [
    ["claude", {}], ["claude", { reasoning_effort: "medium" }], ["claude", { tier: "mid" }],
    ["pi", {}], ["pi", { reasoning_effort: "medium" }], ["pi", { tier: "mid" }],
  ]) {
    const render = harness === "claude"
      ? '{{ includeTemplate "subagent-claude.md" (dict "root" . "name" "implementer") }}'
      : '{{ includeTemplate "pi-roles" (dict "root" .) }}';
    const template = `{{ $_ := set (index .subagents "implementer") "${harness}" (dict${Object.entries(value).map(([key, entry]) => ` ${JSON.stringify(key)} ${JSON.stringify(entry)}`).join("")}) }}${render}`;
    const result = invoke("execute-template", template);
    assert.notEqual(result.status, 0, `${harness} ${JSON.stringify(value)} should fail`);
  }
});

test("diff renders each affected harness target against an isolated destination", (t) => {
  const { run, target } = fixture(t);
  const workflow = JSON.parse(run("cat", target(".pi/agent/workflow.json")));
  for (const relative of [
    ...Object.keys(workflow.agents).flatMap(role => [
      `.pi/agent/agents/${role}.md`,
      ...(role === "general-purpose" ? [] : [`.claude/agents/${role === "explorer" ? "Explore" : role}.md`]),
    ]),
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
