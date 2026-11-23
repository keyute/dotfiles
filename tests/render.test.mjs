import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// a model id: pins live in agents.yaml, so a re-pin is one edit there
const PIN_ID = /\bclaude-[a-z0-9]+-[0-9][a-z0-9-]*|\bgpt-[0-9][a-z0-9.-]*/;
// roles take every documented level; the driver's settings effortLevel excludes `max`, which is session-only
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const CLAUDE_DRIVER_EFFORTS = ["low", "medium", "high", "xhigh"];
const KOPI_EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const KOPI_TOOLS = ["Read", "Glob", "Grep", "LS", "Write", "Edit", "Bash", "WebFetch", "WebSearch", "Skill"];

const readSource = path => readFileSync(join(source, path), "utf8");

const fixture = (t) => {
  const root = mkdtempSync(join(tmpdir(), "chezmoi-render-"));
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

test("renders the Claude projection with isolated state", (t) => {
  const { run, target, data: load } = fixture(t);
  const data = load();
  const claudeInstructions = run("cat", target(".claude/CLAUDE.md"));
  assert.match(claudeInstructions, /^- When you are the session driver/m);
  assert.match(claudeInstructions, /^  - Delegate planning and implementation/m);
  assert.match(claudeInstructions, /^  - Before calling merged\/applied work done, use `spec-reviewer`/m);
  // that rule names the role literally, and its pass must not be able to write
  assert.equal(data.subagents["spec-reviewer"]?.readonly, true);
  const claudeHarness = run("cat", target(".claude/docs/harness.md"));
  assert.ok(claudeHarness.includes(data.subagent_tiers.claude.top));

  const claudeSettings = JSON.parse(run("cat", target(".claude/settings.json")));
  // a relative deny name sits in the writable cwd, so it also gets an Edit() deny
  assert.ok(claudeSettings.permissions.deny.includes("Edit(.env)"));
  for (const p of ["~/.claude/ide", "~/.claude/bridge-spawn"]) assert.ok(claudeSettings.permissions.deny.includes(`Read(${p})`), p);
  // live code run outside the sandbox (node_modules) is write-denied by Edit() rules,
  // which the harness merges into the Bash sandbox
  const liveCode = [`${data.chezmoi.sourceDir}/node_modules`];
  assert.deepEqual(claudeSettings.permissions.deny.filter(rule => /^Edit\([~/]/.test(rule)), liveCode.map(path => `Edit(/${path}/**)`));
  const networkKeys = { allow_local_binding: "allowLocalBinding", allowed_domains: "allowedDomains" };
  for (const [key, value] of Object.entries(data.agent_sandbox.network)) {
    const rendered = networkKeys[key];
    assert.ok(rendered, `agent_sandbox.network.${key}: render it (and map it here)`);
    if (Array.isArray(value)) assert.ok(value.every(item => claudeSettings.sandbox.network[rendered].includes(item)), `${rendered} misses agent_sandbox.network.${key} entries`);
    else assert.equal(claudeSettings.sandbox.network[rendered], value, rendered);
  }
  assert.equal(claudeSettings.model, data.subagent_tiers.claude[data.agents.claude.defaults.tier]);
  assert.equal(claudeSettings.env.CLAUDE_CODE_SUBAGENT_MODEL, data.subagent_tiers.claude.top);
  assert.equal(claudeSettings.env.CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL, data.subagent_tiers.claude.top);
  // auto-approval is per read-only tool, never a whole server
  for (const [server, cfg] of Object.entries(data.agent_mcp_servers).filter(([, cfg]) => cfg.auto_approve_tools)) {
    for (const tool of cfg.readonly_tools ?? []) assert.ok(claudeSettings.permissions.allow.includes(`mcp__${server}__${tool}`), `${server}: ${tool}`);
  }
  assert.ok(!claudeSettings.permissions.allow.some(rule => /^mcp__[^_]+$/.test(rule)), "a server-wide mcp allow");
  const frontierPin = data.subagent_tiers.claude.frontier;
  // the native per-call deny must name the frontier pin's alias
  const frontierAliases = claudeSettings.permissions.deny.flatMap(rule => /^Agent\(model:(\w+)\)$/.exec(rule)?.[1] ?? []);
  assert.ok(frontierAliases.some(alias => frontierPin.startsWith(`claude-${alias}-`)), `no Agent(model:...) deny covers ${frontierPin}`);
});

test("a shared skill renders the same body on both harnesses and stays model-invocable", t => {
  const { run, target } = fixture(t);
  for (const file of readdirSync(join(source, ".chezmoitemplates/skills")).filter(file => file.endsWith(".md"))) {
    const skill = file.slice(0, -".md".length);
    const agents = run("cat", target(`.agents/skills/${skill}/SKILL.md`));
    assert.equal(agents, run("cat", target(`.claude/skills/${skill}/SKILL.md`)), skill);
    assert.doesNotMatch(agents, /^disable-model-invocation:/m, skill);
  }
});

test("each role renders its roster tier and effort on every harness", (t) => {
  const { run, target, data: load } = fixture(t);
  const data = load();

  // the same-named Claude built-ins skip CLAUDE.md; their overrides must too
  for (const role of ["Explore", "Plan"]) assert.equal(data.subagents[role].omit_instructions, true, role);
  for (const [role, meta] of Object.entries(data.subagents)) {
    const effort = meta.effort ?? data.subagent_effort;
    // The frontier runs only the Plan role as a child.
    assert.equal(meta.tier === "frontier", role === "Plan", role);

    const model = data.subagent_tiers.claude[meta.tier];
    if (role !== "Plan") assert.notEqual(model, data.subagent_tiers.claude.frontier, role);
    const claudeAgent = run("cat", target(`.claude/agents/${role}.md`));
    assert.match(claudeAgent, new RegExp(`^name: ${role}$`, "m"));
    assert.ok(claudeAgent.split("\n").includes(`model: ${model}`), `${role}: claude model ${model}`);
    assert.ok(CLAUDE_EFFORTS.includes(effort), `${role}: ${effort} is not a Claude effort level`);
    assert.ok(claudeAgent.split("\n").includes(`effort: ${effort}`), `${role}: claude effort ${effort}`);
    // no tools list inherits every tool, Agent included
    assert.equal(/^tools: /m.test(claudeAgent), meta.tools !== undefined, `${role}: claude tools line`);
    assert.equal(claudeAgent.split("\n").includes("omitClaudeMd: true"), meta.omit_instructions ?? false, `${role}: omitClaudeMd`);

    const kopiRole = role.toLowerCase();
    const agent = run("cat", target(`.kopi/agents/${kopiRole}.md`));
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
    assert.equal(toolsLine !== undefined, meta.tools !== undefined, `${role}: kopi tools line`);
    const toolNames = toolsLine?.slice("tools: [".length, -1).split(",").map(tool => tool.trim());
    if (toolNames) assert.deepEqual(toolNames, meta.tools.split(",").map(tool => tool.trim()), `${role}: kopi tools`);
    for (const tool of toolNames ?? []) {
      assert.ok(KOPI_TOOLS.includes(tool) || tool.startsWith("mcp__"), `${role}: kopi tool ${tool}`);
    }
  }

  const settings = JSON.parse(run("cat", target(".claude/settings.json")));
  // effort is pinned per model for every Claude pin
  const effortLevel = data.agents.claude.defaults.reasoning_effort;
  assert.ok(CLAUDE_DRIVER_EFFORTS.includes(effortLevel), `agents.claude.defaults.reasoning_effort ${effortLevel}`);
  const effortPins = [...new Set(Object.values(data.subagent_tiers.claude))];
  assert.deepEqual(Object.keys(settings.modelSettings).sort(), effortPins.sort());
  for (const pin of effortPins) assert.deepEqual(settings.modelSettings[pin], { effortLevel }, pin);
});

test("every roster role and shared skill has its source stubs, and every stub a source", (t) => {
  const { data: load } = fixture(t);
  const data = load();
  const stubDirs = {
    claude: [["private_dot_claude/exact_agents", ".md.tmpl"]],
    kopi: [["private_dot_kopi/exact_agents", ".md.tmpl"]],
  };
  for (const [harness, dirs] of Object.entries(stubDirs)) {
    const roles = Object.keys(data.subagents);
    for (const [dir, suffix] of dirs) {
      // kopi stubs carry the lowercased roster name
      const stubName = role => harness === "kopi" ? role.toLowerCase() : role;
      for (const role of roles) assert.ok(existsSync(join(source, dir, `${stubName(role)}${suffix}`)), `missing stub ${dir}/${stubName(role)}${suffix}`);
      for (const file of readdirSync(join(source, dir))) {
        assert.ok(file.endsWith(suffix) && roles.map(stubName).includes(file.slice(0, -suffix.length)), `${dir}/${file} names no ${harness} role in the roster`);
      }
    }
  }
  // subagent-{claude,kopi}.md include subagents/<role>.md for each roster role; shared includes sit one level up
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

test("readonly roles grant no write tool and only read-only MCP tools; writers can write or hold every tool", (t) => {
  const { data: load } = fixture(t);
  const data = load();
  for (const [role, meta] of Object.entries(data.subagents)) {
    const tools = meta.tools?.split(",").map(tool => tool.trim()) ?? [];
    const writes = tools.includes("Edit") || tools.includes("Write");
    if (!meta.readonly) {
      assert.ok(writes || meta.tools === undefined, `${role}: not readonly, yet neither writes nor holds every tool`);
      continue;
    }
    assert.notEqual(meta.tools, undefined, `${role}: readonly but holds every tool`);
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
  assert.deepEqual(config.statusline, { right: ["$notice", "$shells", "$mode"] });
  assert.equal(config.sandbox.enabled, true);
  assert.equal(Object.hasOwn(config.sandbox, "network"), false);
  for (const path of config.sandbox.denyRead) {
    assert.ok(!/[*?[]/.test(path), `denyRead ${path} has a glob character`);
    assert.ok(config.permissions.deny.includes(`*(${path})`), `permissions.deny misses *(${path})`);
  }
  const paths = Object.entries(data.agent_sandbox.filesystem.paths);
  for (const [path] of paths.filter(([, mode]) => mode === "none")) assert.ok(config.sandbox.denyRead.includes(path), `denyRead misses ${path}`);
  assert.deepEqual([...config.sandbox.allowWrite].sort(), paths.filter(([, mode]) => mode === "write").map(([path]) => path).sort());
  for (const other of [data.agents.claude.home]) assert.ok(config.sandbox.denyRead.includes(other), `denyRead misses ${other}`);
  assert.ok(claude.permissions.deny.includes("Read(~/.kopi)"));
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
  const instructions = readSource(".chezmoitemplates/agent-instructions.md");
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
    for (const noun of ["CLAUDE.md", "AGENTS.md", "mcp__", "~/.claude", "~/.kopi"]) {
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
    ...walk(join(source, "dot_agents")),
    // this file: the literal role tables it used to carry are what the gate replaces
    fileURLToPath(import.meta.url),
  ].flatMap(file => readFileSync(file, "utf8").split("\n").flatMap((line, index) => {
    const match = PIN_ID.exec(line);
    return match ? [`${relative(source, file)}:${index + 1}: ${match[0]}`] : [];
  }));
  assert.deepEqual(hits, [], "literal model IDs belong in .chezmoidata/agents.yaml");
});

// the whole tree, as CI applies it: every template (shared skill bodies included) and
// modify_ script renders against an isolated destination, so a template error fails here
test("the whole tree applies into an isolated destination", (t) => {
  const { run, target } = fixture(t);
  run("apply", "--no-tty", ["--exclude", "scripts,externals"]);
  const configs = [".claude.json", ".claude/settings.json", ".kopi/config.json"]
    .map(path => JSON.parse(readFileSync(target(path), "utf8")));
  // configs point MCP/statusline commands into the source dir's node_modules/.bin;
  // a missing binary renders fine but breaks at runtime
  const bins = new Set();
  const walk = value => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    for (const s of [value.command, ...(Array.isArray(value.args) ? value.args : [])]) {
      if (typeof s === "string" && s.includes("node_modules/.bin")) bins.add(s);
    }
    Object.values(value).forEach(walk);
  };
  configs.forEach(walk);
  assert.ok(bins.size > 0, "no node_modules/.bin command found in the rendered configs");
  for (const bin of bins) assert.doesNotThrow(() => accessSync(bin, constants.X_OK), `missing binary: ${bin}`);
});
