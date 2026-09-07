import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

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
  const run = (command, target, extra = []) => {
    const result = spawnSync("chezmoi", [command, ...base, ...extra, target], {
      cwd: source,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    assert.equal(result.status, 0, `${command} ${target}\n${result.stderr}`);
    return result.stdout;
  };
  const target = (relative) => join(destination, relative);
  return { run, target };
};

test("renders Pi, Codex, and Claude projections with isolated state", (t) => {
  const { run, target } = fixture(t);
  const workflow = JSON.parse(run("cat", target(".pi/agent/workflow.json")));
  const piSettings = JSON.parse(run("cat", target(".pi/agent/settings.json")));

  assert.equal(workflow.version, 1);
  assert.equal(workflow.models.default, "gpt-5.6-sol");
  assert.equal(workflow.models.tiers.frontier, "gpt-6-astra");
  assert.equal(Object.keys(workflow.agents).length, 12);
  assert.equal(workflow.agents.implementer.tools.includes("workspace_write"), true);
  assert.equal(workflow.agents.explorer.tools.includes("read"), false);
  // Only general-purpose delegates, as Claude Code's roster implies.
  assert.equal(workflow.agents.explorer.tools.includes("subagent"), false);
  assert.deepEqual([workflow.agents["general-purpose"].model, workflow.agents["general-purpose"].nests], ["inherit", true]);
  assert.ok(["workspace_write", "mcp", "subagent"].every(tool => workflow.agents["general-purpose"].tools.includes(tool)));
  assert.equal(workflow.mcp.exa.policy.direct_tools, true);
  assert.equal(workflow.mcp.playwright.policy.direct_tools, false);
  const description = run("cat", target(".pi/agent/subagent-tool-description.md"));
  assert.match(description, /^- diff-reviewer: Review a changed diff/m);
  assert.match(description, /^- general-purpose: /m);
  assert.doesNotMatch(description, /^- Explore:/m);
  assert.match(run("cat", target(".pi/agent/agents/general-purpose.md")), /^allowNestedSubagents: true$/m);
  assert.match(run("cat", target(".pi/agent/agents/explorer.md")), /^allowNestedSubagents: false$/m);
  assert.equal(piSettings.defaultProvider, "openai-codex");
  assert.equal(piSettings.enabledModels.length, 4);
  assert.equal(piSettings.theme, "catppuccin-latte/catppuccin-mocha");
  assert.match(piSettings.themes[0], /\/node_modules\/catppuccin-pi-theme\/themes$/);

  for (const role of Object.keys(workflow.agents)) {
    const agent = run("cat", target(`.pi/agent/agents/${role}.md`));
    const shim = run("cat", target(`.pi/agent/policy-roles/${role}.ts`));
    assert.match(agent, new RegExp(`^name: ${role}$`, "m"));
    assert.match(agent, new RegExp(`extensions: .*/policy-roles/${role}\\.ts`));
    assert.match(shim, new RegExp(`, ${JSON.stringify(role)}\\);`));
  }

  const piInstructions = run("cat", target(".pi/agent/AGENTS.md"));
  const claudeInstructions = run("cat", target(".claude/CLAUDE.md"));
  const codexInstructions = run("cat", target(".codex/AGENTS.md"));
  assert.match(piInstructions, /Working agreements/);
  assert.match(claudeInstructions, /Working agreements/);
  assert.match(codexInstructions, /Working agreements/);

  const claudeSettings = run("cat", target(".claude/settings.json"));
  const codexConfig = run("cat", target(".codex/config.toml"));
  assert.match(claudeSettings, /context7/);
  assert.match(claudeSettings, /filesystem/);
  assert.match(codexConfig, /gpt-5\.6-sol/);
  assert.match(codexConfig, /context7/);
  assert.match(codexConfig, /filesystem/);

  const frontier = run("execute-template", "{{ .subagent_tiers.codex.frontier }}");
  assert.equal(frontier, "gpt-6-astra");
  assert.match(run("cat", target(".pi/agent/docs/harness.md")), /Astra/);
  assert.match(run("cat", target(".codex/docs/harness.md")), /Astra/);
  assert.match(run("cat", target(".pi/agent/extensions/workflow.ts")), /pi-workflow\/index.mjs/);
  assert.match(run("cat", target(".pi/agent/serena-context.yml")), /single_project: true/);

  const zsh = run("cat", target(".zshrc"));
  const zshPath = target(".zshrc.rendered");
  writeFileSync(zshPath, zsh);
  const syntax = spawnSync("zsh", ["-n", zshPath], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test("diff renders each affected harness target against an isolated destination", (t) => {
  const { run, target } = fixture(t);
  for (const relative of [
    ".pi/agent/workflow.json",
    ".pi/agent/settings.json",
    ".pi/agent/AGENTS.md",
    ".pi/agent/docs/harness.md",
    ".pi/agent/subagent-tool-description.md",
    ".pi/agent/extensions/subagent/config.json",
    ".pi/agent/extensions/workflow.ts",
    ".pi/agent/serena-context.yml",
    ".claude/settings.json",
    ".claude/CLAUDE.md",
    ".codex/config.toml",
    ".codex/AGENTS.md",
    ".codex/docs/harness.md",
  ]) {
    run("diff", target(relative), ["--pager", ""]);
  }
});
