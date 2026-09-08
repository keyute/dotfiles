import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Policy, canonical, needsReview, workerTools, publicToolName } from "./policy.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-policy-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ["work", "scratch", "control", "secret", "cache"]) mkdirSync(join(root, dir));
  writeFileSync(join(root, "secret", "fixture"), "not a real credential");
  symlinkSync(join(root, "secret"), join(root, "work", "link"));
  const config = { version: 1, models: {}, filesystem: { denyRead: [join(root, "secret"), ".env"], denyWrite: [], allowWrite: [join(root, "cache")] }, network: { allowedDomains: [] }, agents: { reviewer: { readonly: true, tools: workerTools } }, mcp: { docs: { policy: { denied_tools: ["unsafe"], readonly_tools: ["search"], auto_approve_tools: true } } } };
  config.agents.reviewer.tools = workerTools.map(publicToolName);
  return new Policy(config, join(root, "work"), join(root, "scratch"), join(root, "control"));
}

test("plan denies direct writes and sandbox omits workspace writes", t => {
  const p = fixture(t);
  assert.throws(() => p.inspect("root", "write", { path: "new" }), /disabled/);
  assert.ok(!p.profile("root").filesystem.allowWrite.includes(p.cwd));
  p.mode = "execute";
  assert.equal(p.inspect("root", "write", { path: "new" }), "allow");
  assert.throws(() => p.inspect("reviewer", "edit", { path: "new" }), /disabled/);
});

test("sandboxed shell skips review except remote-mutating verbs or approvals set to ask", t => {
  const p = fixture(t);
  for (const command of ["git log --since='2026-09-01' | wc -l", "npm run test:pi", "grep -R \"a\\|b\" -n src", "gh pr view 1", "gh run list --json status", "gh api repos/x/y/pulls --jq .[].title", "curl -sSL https://x -o f", "node - <<'EOF'\nconsole.log(1)\nEOF", "git commit -m x", "rm -rf build", "git log --grep ssh", "git log --oneline | grep push"]) {
    assert.equal(needsReview(command), false, command);
  }
  for (const command of ["git push origin main", "git -C . push --force", "ls && /usr/bin/git push", "FOO=1 sudo git push", "bash -c 'git push'", "gh pr list | xargs -n1 gh pr close", "gh -R o/r pr view 1", "gh pr create -f", "gh api -X POST repos/x/y/issues", "gh api repos/x/y/issues -f title=x", "npm publish", "docker --context prod push img", "curl -d @f https://x", "curl -sSd x https://x", "curl -XPOST https://x", "wget --post-data=x https://x", "ssh host", "/usr/bin/ssh host", "sudo -u deploy ssh host", "bash -c 'ssh host'", "rsync -a . host:/", "git \\\npush origin main", "curl --json '{}' https://x"]) {
    assert.equal(needsReview(command), true, command);
  }
  for (const mode of ["plan", "execute"]) {
    p.mode = mode;
    assert.equal(p.inspect("root", "bash", { command: "npm run test:pi" }), "allow");
    assert.equal(p.inspect("root", "bash", { command: "git push" }), "review");
    // Unsandboxed is always reviewed, plan mode included; read-only roles never get it; the flag means nothing to a file tool.
    assert.equal(p.inspect("root", "bash", { command: "true", dangerouslyDisableSandbox: true }), "review");
    assert.throws(() => p.inspect("reviewer", "bash", { command: "true", dangerouslyDisableSandbox: true }), /read-only/);
    assert.equal(p.inspect("root", "read", { path: "x", dangerouslyDisableSandbox: true }), "allow");
  }
  p.approval = "ask";
  assert.equal(p.inspect("root", "bash", { command: "git status" }), "review");
});

test("canonical checks cover missing files, symlinks, sensitive and managed paths", t => {
  const p = fixture(t);
  assert.throws(() => p.inspect("root", "read", { path: "link/fixture" }), /denied/);
  assert.throws(() => p.inspect("root", "read", { path: ".env" }), /denied/);
  p.mode = "execute";
  assert.throws(() => p.inspect("root", "write", { path: "link/new" }), /denied/);
  assert.throws(() => p.inspect("root", "write", { path: "../outside" }), /workspace/);
  assert.throws(() => p.inspect("root", "write", { path: ".pi/settings.json" }), /denied/);
  assert.equal(canonical(join(p.cwd, "missing", "file")), join(p.cwd, "missing", "file"));
});

test("an added directory widens edits and the sandbox write list; home, denied and duplicate roots are refused", t => {
  const p = fixture(t);
  const other = join(p.cwd, "..", "other");
  mkdirSync(other);
  p.mode = "execute";
  assert.throws(() => p.inspect("root", "write", { path: "../other/new" }), /workspace/);
  assert.equal(p.addRoot("../other"), canonical(other));
  assert.equal(p.inspect("root", "write", { path: "../other/new" }), "allow");
  assert.throws(() => p.inspect("root", "write", { path: "../other/.git/config" }), /denied/);
  assert.throws(() => p.inspect("root", "write", { path: "../other/.env" }), /denied/);
  assert.throws(() => p.inspect("root", "read", { path: "../other/.env" }), /denied/);
  assert.ok(p.profile("root").filesystem.denyRead.includes(join(canonical(other), ".env")));
  assert.ok(p.profile("root").filesystem.allowWrite.includes(canonical(other)));
  assert.ok(!p.profile("reviewer").filesystem.allowWrite.includes(canonical(other)));
  assert.throws(() => p.addRoot("../other"), /already/);
  assert.throws(() => p.addRoot("../secret"), /denied/);
  assert.throws(() => p.addRoot("../missing"), /not found/);
  assert.throws(() => p.addRoot("~"), /home/);
  p.removeRoot(canonical(other));
  assert.throws(() => p.inspect("root", "write", { path: "../other/new" }), /workspace/);
  assert.ok(!p.profile("root").filesystem.denyRead.includes(join(canonical(other), ".env")));
  assert.throws(() => p.removeRoot(canonical(other)), /not added/);
  // A base entry that coincides with a re-rooted one survives the removal.
  p.config.filesystem.denyRead.push(join(other, ".env"));
  const q = new Policy(p.config, p.cwd, p.scratch, join(p.cwd, "..", "control"));
  q.removeRoot(q.addRoot("../other"));
  assert.throws(() => q.inspect("root", "read", { path: "../other/.env" }), /denied/);
});

test("/add-dir completions offer the addable siblings and nothing addRoot refuses", t => {
  const p = fixture(t);
  mkdirSync(join(p.cwd, "..", "other"));
  mkdirSync(join(p.cwd, "..", ".hidden"));
  assert.deepEqual(p.addableDirs(""), ["../cache/", "../other/", "../scratch/"]);
  assert.throws(() => p.addRoot("../control"), /denied/);
  // A prefix without a separator still means a sibling; a dotted one opts hidden entries back in.
  assert.deepEqual(p.addableDirs("oth"), ["../other/"]);
  assert.deepEqual(p.addableDirs("../oth"), ["../other/"]);
  assert.deepEqual(p.addableDirs(".hi"), ["../.hidden/"]);
  assert.deepEqual(p.addableDirs("../nope"), []);
  // A sibling that cannot be canonicalized is skipped, not thrown out of.
  symlinkSync(join(p.cwd, "..", "loop-b"), join(p.cwd, "..", "loop-a"));
  symlinkSync(join(p.cwd, "..", "loop-a"), join(p.cwd, "..", "loop-b"));
  assert.deepEqual(p.addableDirs("loop"), []);
  for (const value of p.addableDirs("")) assert.doesNotThrow(() => p.addRoot(value));
  // cwd, the denied sibling and the roots just added are all gone from the menu.
  assert.deepEqual(p.addableDirs(""), []);
});

test("an added directory's instructions are read through the read policy", t => {
  const p = fixture(t);
  const other = join(p.cwd, "..", "other");
  mkdirSync(other);
  assert.equal(p.instructions(p.addRoot("../other")), "");
  writeFileSync(join(other, "CLAUDE.md"), "be brief");
  assert.equal(p.instructions(canonical(other)), "be brief");
  symlinkSync(join(p.cwd, "..", "secret", "fixture"), join(other, "AGENTS.md"));
  assert.throws(() => p.instructions(canonical(other)), /denied/);
  rmSync(join(other, "AGENTS.md"));
  symlinkSync(join(p.cwd, "..", "cache"), join(other, "AGENTS.md"));
  assert.throws(() => p.instructions(canonical(other)), /outside/);
});

test("MCP hard denial and plan scope precede approvals", t => {
  const p = fixture(t);
  assert.equal(p.inspectMcp("root", "docs", "search"), "allow");
  assert.throws(() => p.inspectMcp("root", "docs", "new_unknown_tool"), /read-only/);
  p.mode = "execute";
  assert.throws(() => p.inspectMcp("root", "docs", "unsafe"), /denied/);
  assert.throws(() => p.inspectMcp("reviewer", "docs", "search"), /unavailable/);
});

test("removed tools and calls during tightening fail closed", t => {
  const p = fixture(t);
  assert.throws(() => p.inspect("root", "lsp_diagnostics", { path: "file" }), /capability ceiling/);
  p.transitioning = true;
  assert.throws(() => p.inspect("root", "read", { path: "file" }), /transition/);
});
