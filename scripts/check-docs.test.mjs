import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { runChecks } from "./check-docs.mjs";

const script = new URL("./check-docs.mjs", import.meta.url);

const fixture = (files) => {
  const root = mkdtempSync(join(tmpdir(), "check-docs-"));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  return root;
};

const checks = (files) => runChecks(fixture(files)).map(({ check }) => check);

const daysAgo = (days) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

const baseline = (body) => ({ "docs/agents-baseline.md": body });

// Long enough to form a shingle at the duplicate check's window size.
const sentence =
  "the driver owns decomposition decisions adjudication integration and every final verification pass in this session";

test("why-length accepts a short principle and flags an oversized span", () => {
  assert.deepEqual(
    checks(baseline("- **Fan-out**: spawn independent strands together.\n  *Why: serial spawning wastes wall-clock.*\n")),
    [],
  );

  const long = `- **Fan-out**: spawn independent strands together.\n  *Why: ${"padding line\n  ".repeat(9)}end.*\n`;
  assert.deepEqual(checks(baseline(long)), ["why-length"]);

  const wide = `- **Fan-out**: ${"more intent\n  ".repeat(9)}done.\n  *Why: short.*\n`;
  assert.deepEqual(checks(baseline(wide)), ["why-length"]);
});

test("why-evidence flags citations that belong in the audit log", () => {
  assert.deepEqual(
    checks(baseline("- **Tier**: pick the lowest tier.\n  *Why: measured 2026-01-02.*\n")),
    [],
  );
  assert.deepEqual(
    checks(baseline("- **Tier**: pick the lowest tier.\n  *Why: arXiv 2607.21656 says so.*\n")),
    ["why-evidence"],
  );
  assert.deepEqual(
    checks(baseline("- **Tier**: pick the lowest tier.\n  *Why: 40% faster.*\n")),
    ["why-evidence"],
  );
  assert.deepEqual(
    checks(baseline("- **Tier**: pick the lowest tier.\n  *Why: see #84667.*\n")),
    ["why-evidence"],
  );
  assert.deepEqual(
    checks(baseline("- **Tier**: pick the lowest tier.\n  *Why: 2026-01-02 and 2026-02-03.*\n")),
    ["why-evidence"],
  );
});

test("duplicate flags a shingle shared by two files but not one file's own repeats", () => {
  assert.deepEqual(
    checks({
      "docs/a.md": `${sentence}\n`,
      "docs/b.md": "a wholly different clause about rendering templates and verifying each harness target\n",
    }),
    [],
  );
  assert.deepEqual(checks({ "docs/a.md": `${sentence}\n${sentence}\n` }), []);

  const findings = runChecks(
    fixture({ "docs/a.md": `${sentence}\n`, "docs/b.md": `intro line\n${sentence}\n` }),
  );
  assert.deepEqual(
    findings.map(({ check, file, line }) => ({ check, file, line })),
    [{ check: "duplicate", file: "docs/b.md", line: 2 }],
  );
  assert.match(findings[0].message, /repeats docs\/a\.md:1/);
});

test("duplicate ignores fenced code, template expressions and generated sandbox docs", () => {
  assert.deepEqual(
    checks({
      "docs/a.md": `\`\`\`\n${sentence}\n\`\`\`\n`,
      "docs/b.md": `${sentence}\n`,
    }),
    [],
  );
  assert.deepEqual(
    checks({
      "private_dot_claude/docs/sandbox.md.tmpl": `${sentence}\n`,
      "private_dot_pi/agent/docs/sandbox.md.tmpl": `${sentence}\n`,
    }),
    [],
  );
  assert.deepEqual(
    checks({
      "docs/a.md": `{{ .agents.claude.defaults.model }} ${sentence}\n`,
      "docs/b.md": `${sentence}\n`,
    }),
    ["duplicate"],
  );
});

test("harness-doc accepts a dated, bounded doc and flags each way it decays", () => {
  const fresh = `# Claude Code workflow reference\n\n## Models (last verified ${daysAgo(3)})\n\n- Global model is pinned in settings.\n  Continuation line.\n`;
  assert.deepEqual(checks({ "private_dot_claude/docs/harness.md.tmpl": fresh }), []);

  const stale = `## Models (last verified ${daysAgo(120)})\n\n- Pinned.\n`;
  assert.deepEqual(checks({ "private_dot_codex/docs/harness.md.tmpl": stale }), ["harness-doc"]);

  const undated = "## Models\n\n- Pinned.\n";
  assert.deepEqual(checks({ "private_dot_codex/docs/harness.md.tmpl": undated }), ["harness-doc"]);

  const fatBullet = `## Models (decision ${daysAgo(3)})\n\n- Pinned.\n${"  continuation\n".repeat(8)}`;
  assert.deepEqual(checks({ "private_dot_codex/docs/harness.md.tmpl": fatBullet }), ["harness-doc"]);

  const fired = `## Models (decision ${daysAgo(3)})\n\n- Pinned; expiry fired 2026-09-08.\n`;
  assert.deepEqual(checks({ "private_dot_pi/agent/docs/harness.md.tmpl": fired }), ["harness-doc"]);

  const tooLong = `## Models (decision ${daysAgo(3)})\n${"filler\n".repeat(120)}`;
  assert.deepEqual(checks({ "private_dot_pi/agent/docs/harness.md.tmpl": tooLong }), ["harness-doc"]);

  const bogus = "## Models (last verified 2026-99-99)\n\n- Pinned.\n";
  assert.deepEqual(checks({ "private_dot_pi/agent/docs/harness.md.tmpl": bogus }), ["harness-doc"]);
});

test("audit-log requires **Open** only on entries past the stale threshold", () => {
  const recent = `## ${daysAgo(5)}\n\n### Probe\n\nNo open thread.\n`;
  assert.deepEqual(checks({ "docs/agents-audit-log.md": recent }), []);

  const closed = `## ${daysAgo(90)}\n\n### Probe\n\nMeasured. **Open**: next sweep.\n`;
  assert.deepEqual(checks({ "docs/agents-audit-log.md": closed }), []);

  const stale = `## ${daysAgo(90)}\n\n### Probe\n\nMeasured, nothing outstanding.\n`;
  assert.deepEqual(checks({ "docs/agents-audit-log.md": stale }), ["audit-log"]);

  const stalePreamble = `## ${daysAgo(90)}\n\nA note with no sub-entries.\n`;
  assert.deepEqual(checks({ "docs/agents-audit-log.md": stalePreamble }), ["audit-log"]);
});

test("projection checks the rendered output and skips when chezmoi is absent", () => {
  // Stub chezmoi with a script that echoes the template it is handed, so the
  // fixture's template content is also its render.
  const stub = (body) => {
    const root = fixture({
      "private_dot_claude/CLAUDE.md.tmpl": body,
      "bin/chezmoi": '#!/bin/sh\nfor arg in "$@"; do last=$arg; done\ncat "$last"\n',
    });
    return root;
  };
  const withPath = (root, path, run) => {
    const saved = process.env.PATH;
    process.env.PATH = path;
    try {
      return run();
    } finally {
      process.env.PATH = saved;
    }
  };

  const clean = stub("- Keep implementations simple.\n");
  spawnSync("chmod", ["755", join(clean, "bin/chezmoi")]);
  assert.deepEqual(
    withPath(clean, `${join(clean, "bin")}:${process.env.PATH}`, () => runChecks(clean)),
    [],
  );

  const cited = stub("- Self-review pays off (arXiv 2607.21656).\n");
  spawnSync("chmod", ["755", join(cited, "bin/chezmoi")]);
  assert.deepEqual(
    withPath(cited, `${join(cited, "bin")}:${process.env.PATH}`, () =>
      runChecks(cited).map(({ check }) => check),
    ),
    ["projection"],
  );

  const long = stub(`${"- rule\n".repeat(101)}`);
  spawnSync("chmod", ["755", join(long, "bin/chezmoi")]);
  assert.deepEqual(
    withPath(long, `${join(long, "bin")}:${process.env.PATH}`, () =>
      runChecks(long).map(({ check }) => check),
    ),
    ["projection"],
  );

  assert.deepEqual(withPath(cited, "", () => runChecks(cited)), []);
});

test("yaml-comment flags a comment block longer than the run limit", () => {
  const ok = `${"# note\n".repeat(5)}agents:\n  claude: {}\n`;
  assert.deepEqual(checks({ ".chezmoidata/agents.yaml": ok }), []);

  const wall = `${"# note\n".repeat(6)}agents:\n  claude: {}\n`;
  assert.deepEqual(checks({ ".chezmoidata/agents.yaml": wall }), ["yaml-comment"]);
});

test("budget flags a file over its line budget", () => {
  assert.deepEqual(checks({ "AGENTS.md": "line\n".repeat(120) }), []);
  assert.deepEqual(checks({ "AGENTS.md": "line\n".repeat(121) }), ["budget"]);
});

test("the CLI prints one line per finding and exits non-zero", () => {
  const clean = spawnSync(process.execPath, [script.pathname, fixture({ "AGENTS.md": "ok\n" })], {
    encoding: "utf8",
  });
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(clean.stdout, "docs: ok\n");

  const dirty = spawnSync(
    process.execPath,
    [script.pathname, fixture({ "AGENTS.md": "line\n".repeat(121) })],
    { encoding: "utf8" },
  );
  assert.equal(dirty.status, 1);
  assert.match(dirty.stdout, /^AGENTS\.md:1 {2}budget {2}121 lines \(max 120\)\n$/);
});
