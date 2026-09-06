import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Policy, canonical, workerTools, publicToolName } from "./policy.mjs";

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
  assert.equal(p.inspect("root", "write", { path: "new" }), "review");
  assert.throws(() => p.inspect("reviewer", "edit", { path: "new" }), /disabled/);
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
