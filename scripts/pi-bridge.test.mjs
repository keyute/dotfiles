import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";

import {
  assertCompleted,
  assertNoPendingMigration,
  assertOutsideSandboxRoots,
  assertOwnGitDir,
  assertRepoRoot,
  checkCwd,
  composeReviewPrompt,
  diffCommands,
  gatherDiff,
  gitInvocation,
  gitSandboxProfile,
  pathspecExcludes,
  parseEvents,
  piArgs,
  sandboxPolicy,
  thinkingLevel,
  validateBase,
  validateThreadId,
} from "./pi-bridge.mjs";
import guard, { decide } from "./pi-bridge-guard.mjs";

const NAMES = [".env"];

test("piArgs pins the read-only, prompt-free, worker-tier envelope", () => {
  const args = piArgs({ provider: "provider-test", model: "gpt-test", effort: "high", sessionId: "sid-1" });
  const after = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(after("--tools"), "read,grep,find,ls");
  assert.ok(args.includes("--no-approve"));
  assert.ok(args.includes("--no-extensions"));
  assert.ok(args.includes("--no-context-files"));
  assert.match(after("-e"), /pi-bridge-guard\.mjs$/);
  assert.equal(after("--provider"), "provider-test");
  assert.equal(after("--model"), "gpt-test");
  assert.equal(after("--thinking"), "high");
  assert.equal(after("--session-id"), "sid-1");
});

test("parseEvents picks text from the last assistant message_end", () => {
  const lines = [
    JSON.stringify({ type: "session", id: "abc-123" }),
    JSON.stringify({ type: "message_end", message: { role: "user", content: [] } }),
    JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "first" }] },
    }),
    JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "final answer" }] },
    }),
  ].join("\n");

  const result = parseEvents(lines);
  assert.equal(result.threadId, "abc-123");
  assert.equal(result.text, "final answer");
  assert.equal(result.stopReason, undefined);
});

test("parseEvents surfaces stopReason and errorMessage on failure", () => {
  const lines = [
    JSON.stringify({ type: "session", id: "abc-123" }),
    JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [], stopReason: "error", errorMessage: "boom" },
    }),
  ].join("\n");

  const result = parseEvents(lines);
  assert.equal(result.stopReason, "error");
  assert.equal(result.errorMessage, "boom");
});

test("assertCompleted accepts only a stop reason of stop", () => {
  const stopped = { text: "done", stopReason: "stop" };
  assert.doesNotThrow(() => assertCompleted(stopped, 1, ""));
  const truncated = { text: "partial", stopReason: "length" };
  assert.throws(() => assertCompleted(truncated, 0, ""), /pi length/);
  assert.throws(() => assertCompleted({ text: "" }, 0, "boom"), /produced no response/);
});

// catalog models picked by shape, not id, so a pin bump cannot break these
const codexModels = getBuiltinModels("openai-codex");
const withOff = codexModels.find((model) => getSupportedThinkingLevels(model).includes("off"));
const withoutOff = codexModels.find((model) => model.reasoning && !getSupportedThinkingLevels(model).includes("off"));

test("thinkingLevel validates against the model's own catalog thinking levels", () => {
  assert.equal(thinkingLevel("openai-codex", withOff.id, "off"), "off");
  assert.throws(() => thinkingLevel("openai-codex", withOff.id, "extreme"), /Invalid reasoning effort/);
  assert.throws(() => thinkingLevel("openai-codex", withoutOff.id, "off"), /Invalid reasoning effort/);
  assert.throws(() => thinkingLevel("openai-codex", "no-such-model", "high"), /Unknown model/);
});

const startBridge = (args) => spawnSync(process.execPath, [fileURLToPath(new URL("./pi-bridge.mjs", import.meta.url)), ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

test("the bridge refuses to start without a pinned provider or reasoning effort", () => {
  const noProvider = startBridge(["--model", withOff.id, "--reasoning-effort", "high"]);
  assert.notEqual(noProvider.status, 0);
  assert.match(noProvider.stderr, /--provider <id> is required/);
  const noEffort = startBridge(["--provider", "openai-codex", "--model", withOff.id]);
  assert.notEqual(noEffort.status, 0);
  assert.match(noEffort.stderr, /--reasoning-effort <level> is required/);
});

test("the bridge refuses to start on an effort its model does not support", () => {
  const result = startBridge(["--provider", "openai-codex", "--model", withoutOff.id, "--reasoning-effort", "off"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid reasoning effort/);
});

test("validateBase rejects a leading dash and unsafe characters", () => {
  assert.doesNotThrow(() => validateBase("main"));
  assert.doesNotThrow(() => validateBase(undefined));
  assert.throws(() => validateBase("-x"));
  assert.throws(() => validateBase("main; rm -rf /"));
});

test("validateThreadId requires a strict UUID v4", () => {
  assert.doesNotThrow(() => validateThreadId("0199a0cb-5bf3-4774-b36f-22248f52a611"));
  assert.throws(() => validateThreadId("--last"));
  assert.throws(() => validateThreadId("not-a-uuid"));
});

test("composeReviewPrompt states the scope and includes the diff", () => {
  const prompt = composeReviewPrompt({ diffText: "diff --git a/x b/x" });
  assert.match(prompt, /Review the uncommitted changes/);
  assert.match(prompt, /diff --git a\/x b\/x/);
});

test("composeReviewPrompt truncates an oversized diff", () => {
  const prompt = composeReviewPrompt({ base: "main", diffText: "x".repeat(400_000) });
  assert.match(prompt, /Review this branch's changes against base main/);
  assert.match(prompt, /\[diff truncated — read the changed files directly]/);
});

test("diffCommands uses merge-base scope for a base and lists untracked files otherwise", () => {
  const ex = pathspecExcludes([".env"]);
  assert.deepEqual(ex, ["--", ".", ":(exclude,glob)**/.env"]);
  const [stat, diff] = diffCommands("main", ex).map(([, args]) => args);
  assert.deepEqual(stat, ["--no-pager", "diff", "--no-color", "--no-ext-diff", "--no-textconv", "--stat", "main...HEAD", ...ex]);
  assert.deepEqual(diff, ["--no-pager", "diff", "--no-color", "--no-ext-diff", "--no-textconv", "main...HEAD", ...ex]);
  const uncommitted = diffCommands(undefined, ex).map(([, args]) => args);
  assert.deepEqual(uncommitted[0], ["status", "--porcelain", ...ex]);
  assert.deepEqual(uncommitted[1], ["--no-pager", "diff", "--no-color", "--no-ext-diff", "--no-textconv", "HEAD", ...ex]);
  assert.deepEqual(uncommitted[2], ["ls-files", "--others", "--exclude-standard", ...ex]);
});

test("assertNoPendingMigration refuses a repo pi would rewrite at startup", () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-bridge-migrate-"));
  assert.doesNotThrow(() => assertNoPendingMigration(cwd));
  mkdirSync(join(cwd, ".pi", "commands"), { recursive: true });
  assert.throws(() => assertNoPendingMigration(cwd), /\.pi\/commands/);
  mkdirSync(join(cwd, ".pi", "prompts"));
  assert.doesNotThrow(() => assertNoPendingMigration(cwd));
});

test("guard blocks escapes, denied names, and disallowed tools", () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-bridge-guard-"));
  // these exist, so the deny-name check is what blocks, not the missing-path one
  for (const f of ["a.ts", ".env", "sub/.env", "sub/.env.local", "src/a.ts"]) {
    mkdirSync(join(cwd, f, ".."), { recursive: true });
    writeFileSync(join(cwd, f), "");
  }

  assert.ok(decide("read", { path: "../x" }, cwd, NAMES));
  assert.ok(decide("read", { path: "/etc/passwd" }, cwd, NAMES));
  // a missing outside path reports the escape, not whether it exists
  assert.match(decide("read", { path: "/nonexistent/zz" }, cwd, NAMES), /escapes/);
  assert.ok(decide("read", { path: "~/.pi/agent/auth.json" }, cwd, NAMES));
  assert.ok(decide("read", { path: ".env" }, cwd, NAMES));
  assert.ok(decide("read", { path: "sub/.env" }, cwd, NAMES));
  assert.ok(decide("bash", { command: "ls" }, cwd, NAMES));
  assert.ok(decide("read", { path: ["a.ts"] }, cwd, NAMES));

  assert.equal(decide("read", { path: "src/a.ts" }, cwd, NAMES), null);
  assert.equal(decide("read", { path: "sub/.env.local" }, cwd, NAMES), null);
  assert.equal(decide("ls", { path: "." }, cwd, NAMES), null);
});

test("guard owns grep's glob so a directory search skips denied names at any depth", (t) => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "pi-bridge-grep-")));
  mkdirSync(join(cwd, "sub"));
  writeFileSync(join(cwd, "sub", ".env"), "SECRET=1\n");
  writeFileSync(join(cwd, "a.txt"), "SECRET=0\n");
  // a caller glob could re-include what the exclusion drops
  assert.ok(decide("grep", { pattern: "SECRET", glob: "**/.env" }, cwd, NAMES));
  assert.ok(decide("grep", { pattern: "SECRET", glob: "" }, cwd, NAMES));
  const input = { pattern: "SECRET" };
  assert.equal(decide("grep", input, cwd, NAMES), null);
  assert.equal(input.glob, "!{.env}");
  const multi = { pattern: "SECRET", path: "." };
  assert.equal(decide("grep", multi, cwd, [".env", "id_rsa"]), null);
  assert.equal(multi.glob, "!{.env,id_rsa}");
  // pi's grep runs `rg --hidden --glob <glob> -- <pattern> <path>`
  const rg = spawnSync("rg", ["--json", "--line-number", "--color=never", "--hidden", "--glob", input.glob, "--", "SECRET", cwd], { encoding: "utf8" });
  if (rg.error) {
    // CI's live run installs rg, so a missing one there fails instead of skipping
    assert.notEqual(process.env.PI_WORKFLOW_LIVE_TESTS, "1", `rg is required under PI_WORKFLOW_LIVE_TESTS=1: ${rg.error.message}`);
    t.skip("rg not installed");
  } else {
    assert.match(rg.stdout, /SECRET=0/);
    assert.doesNotMatch(rg.stdout, /SECRET=1|\.env/);
  }
  rmSync(cwd, { recursive: true, force: true });
});

test("guard blocks every call when the bridge's deny names are absent or malformed", () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-bridge-guard-"));
  let handler;
  guard({ on: (_, fn) => (handler = fn) });
  const saved = process.env.PI_BRIDGE_DENY_NAMES;
  try {
    // glob metacharacters or a separator would change grep's exclusion glob
    for (const raw of [undefined, "", '".env"', "[1]", '[""]', '["secret[1]"]', '["a,b"]', '["!x"]', '["dir/.env"]', String.raw`["a\\b"]`]) {
      if (raw === undefined) delete process.env.PI_BRIDGE_DENY_NAMES;
      else process.env.PI_BRIDGE_DENY_NAMES = raw;
      assert.deepEqual(handler({ toolName: "ls", input: {} }, { cwd }), { block: true, reason: "guard error (fail-safe)" }, raw);
    }
    process.env.PI_BRIDGE_DENY_NAMES = JSON.stringify(NAMES);
    assert.equal(handler({ toolName: "ls", input: {} }, { cwd }), undefined);
    assert.ok(handler({ toolName: "read", input: { path: ".env" } }, { cwd }).block);
  } finally {
    if (saved === undefined) delete process.env.PI_BRIDGE_DENY_NAMES;
    else process.env.PI_BRIDGE_DENY_NAMES = saved;
  }
});

test("guard hands pi the vetted absolute path so its own normalization cannot escape", () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "pi-bridge-guard-")));
  writeFileSync(join(cwd, "a.ts"), "");
  // pi strips a leading "@" and converts file:// before resolving; after the
  // guard both land inside cwd as literal names
  for (const raw of ["@/etc/passwd", "@~/.pi/agent/auth.json", "file:///etc/passwd", "a.ts"]) {
    mkdirSync(join(cwd, raw, ".."), { recursive: true });
    writeFileSync(join(cwd, raw), "");
    const input = { path: raw };
    assert.equal(decide("read", input, cwd, NAMES), null, raw);
    assert.equal(input.path === cwd || input.path.startsWith(`${cwd}/`), true, raw);
  }
  const unset = {};
  assert.equal(decide("ls", unset, cwd, NAMES), null);
  assert.equal("path" in unset, false);
  // pi folds unicode spaces after the rewrite, so such paths are refused
  writeFileSync(join(cwd, "a b.ts"), "");
  assert.ok(decide("read", { path: "a b.ts" }, cwd, NAMES));
});

test("guard blocks a missing path pi's read would retry as an existing unicode variant", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-bridge-variant-")));
  const cwd = join(root, "repo");
  mkdirSync(cwd);
  writeFileSync(join(root, "canary"), "");
  writeFileSync(join(cwd, "a.ts"), "");
  // pi falls back from l'ink to the existing l’ink, a symlink out of the repo
  symlinkSync(join(root, "canary"), join(cwd, "l’ink"));
  assert.match(decide("read", { path: "l'ink" }, cwd, NAMES), /does not exist/);
  assert.match(decide("read", { path: "missing.ts" }, cwd, NAMES), /does not exist/);
  assert.equal(decide("read", { path: "a.ts" }, cwd, NAMES), null);
  rmSync(root, { recursive: true, force: true });
});

test("guard blocks a canary outside cwd directly and through symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bridge-guard-"));
  const cwd = join(root, "repo");
  const outside = join(root, "outside");
  const canary = join(outside, "auth.json");
  mkdirSync(cwd);
  mkdirSync(outside);
  writeFileSync(canary, "shh");
  symlinkSync(canary, join(cwd, "link"));
  symlinkSync(outside, join(cwd, "linkdir"));

  for (const raw of [canary, "link", "linkdir", "linkdir/auth.json", "./linkdir/../link"]) {
    for (const tool of ["read", "grep", "find", "ls"]) assert.ok(decide(tool, { path: raw }, cwd, NAMES), `${tool} ${raw}`);
  }
});

const COMMIT = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"];
const SETTINGS = { sandbox: { filesystem: { allowWrite: [] } }, permissions: { deny: ["Read(.env)", "Read(~/.ssh)"] } };
const git = (cwd, args, env = process.env) => {
  const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
};

test("the bridge refuses a sandbox-writable cwd and its git invocation defuses a hostile repo config", async () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "pi-bridge-hostile-")));
  const roots = sandboxPolicy(JSON.stringify(SETTINGS)).writableRoots;
  assert.throws(() => assertOutsideSandboxRoots(cwd, roots), /sandbox-writable/);
  assert.doesNotThrow(() => assertOutsideSandboxRoots(realpathSync(fileURLToPath(new URL(".", import.meta.url))), roots));

  git(cwd, ["init", "-q", "-b", "base"]);
  writeFileSync(join(cwd, "a.txt"), "one\n");
  git(cwd, ["add", "a.txt"]);
  git(cwd, [...COMMIT, "commit", "-qm", "init"]);
  git(cwd, ["checkout", "-qb", "topic"]);
  writeFileSync(join(cwd, "a.txt"), "two\n");
  git(cwd, [...COMMIT, "commit", "-qam", "change"]);
  writeFileSync(join(cwd, "a.txt"), "three\n");

  const marker = join(cwd, "..", `${cwd.split("/").pop()}-pwned`);
  const payload = join(cwd, ".git", "payload.sh");
  writeFileSync(payload, `#!/bin/sh\ntouch '${marker}'\n`);
  chmodSync(payload, 0o755);
  mkdirSync(join(cwd, ".git", "evil-hooks"));
  for (const hook of ["post-index-change", "pre-commit"]) symlinkSync(payload, join(cwd, ".git", "evil-hooks", hook));
  writeFileSync(join(cwd, ".gitattributes"), "*.txt diff=evil\n");
  git(cwd, ["config", "core.fsmonitor", payload]);
  git(cwd, ["config", "core.hooksPath", join(cwd, ".git", "evil-hooks")]);
  git(cwd, ["config", "diff.evil.command", payload]);
  git(cwd, ["config", "diff.evil.textconv", payload]);
  git(cwd, ["config", "diff.external", payload]);

  // control: the fixture really is hostile to plain git
  spawnSync("git", ["diff", "HEAD"], { cwd });
  assert.ok(existsSync(marker));
  rmSync(marker);
  // the tool handlers' entry check refuses it before any git runs
  await assert.rejects(checkCwd(cwd, sandboxPolicy(JSON.stringify(SETTINGS))), /sandbox-writable/);

  const env = { ...process.env, GIT_DIR: "/nonexistent", GIT_EXTERNAL_DIFF: payload };
  const diffs = [...diffCommands("base"), ...diffCommands(undefined)].map(([, args]) => args);
  for (const args of [["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"], ...diffs]) {
    const invocation = gitInvocation(args, env);
    assert.equal(Object.keys(invocation.env).some((key) => key.startsWith("GIT_")), false);
    git(cwd, invocation.args, invocation.env);
    assert.equal(existsSync(marker), false, args.join(" "));
  }
});

test("assertOwnGitDir refuses a .git file or a .git/commondir pointing elsewhere", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-bridge-gitdir-")));
  const own = join(root, "own");
  const linked = join(root, "linked");
  const common = join(root, "common");
  git(root, ["init", "-q", own]);
  git(root, ["init", "-q", `--separate-git-dir=${join(root, "elsewhere")}`, linked]);
  git(root, ["init", "-q", common]);
  const dirs = (cwd) => git(cwd, gitInvocation(["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"]).args).trim().split("\n");
  assert.doesNotThrow(() => assertOwnGitDir(own, ...dirs(own)));
  assert.throws(() => assertOwnGitDir(linked, ...dirs(linked)), /git dir/);
  assert.throws(() => assertOwnGitDir(own, undefined), /git dir/);
  writeFileSync(join(common, ".git", "commondir"), join(root, "own", ".git"));
  assert.throws(() => assertOwnGitDir(common, ...dirs(common)), /git dir/);
});

test("pinned git ignores a .git/commondir planted after the root check", () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "pi-bridge-pinned-")));
  git(cwd, ["init", "-q"]);
  git(cwd, ["config", "user.name", "own"]);
  const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "pi-bridge-elsewhere-")));
  git(elsewhere, ["init", "-q"]);
  git(elsewhere, ["config", "user.name", "planted"]);
  writeFileSync(join(cwd, ".git", "commondir"), join(elsewhere, ".git"));
  const name = (root) => {
    const { args, env } = gitInvocation(["config", "user.name"], process.env, root);
    return git(cwd, args, env).trim();
  };
  assert.equal(name(undefined), "planted"); // control: the planted file redirects plain git
  assert.equal(name(cwd), "own");
});

test("sandboxPolicy takes Claude's Read() denies and allowWrite, and fails closed without either", () => {
  const settings = JSON.stringify({
    sandbox: { filesystem: { allowWrite: ["~/.npm/_cacache", "/opt/gocache"] } },
    permissions: { deny: ["Read(.env)", "Read(~/.ssh)", "Read(~/.pi)", "Bash(git push:*)"] },
  });
  const { writableRoots, denyRead, denyNames } = sandboxPolicy(settings, "/home/u");
  assert.deepEqual(denyRead, ["/home/u/.ssh", "/home/u/.pi"]);
  assert.deepEqual(denyNames, [".env"]);
  assert.ok(writableRoots.includes("/home/u/.npm/_cacache") && writableRoots.includes("/opt/gocache"));
  assert.throws(() => assertOutsideSandboxRoots("/opt/gocache/evil", writableRoots), /sandbox-writable/);
  const noReads = { ...SETTINGS, permissions: { deny: ["Bash(git push:*)"] } };
  assert.throws(() => sandboxPolicy(JSON.stringify(noReads)), /no Read\(\) deny rules/);
  assert.throws(() => sandboxPolicy(JSON.stringify({ permissions: SETTINGS.permissions })), /allowWrite/);
});

test("a denied bare name never reaches the embedded diff, at any depth", () => {
  const names = sandboxPolicy(JSON.stringify(SETTINGS)).denyNames;
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "pi-bridge-dotenv-")));
  git(cwd, ["init", "-q", "-b", "base"]);
  for (const f of [".env", "sub/.env", "a.txt"]) {
    mkdirSync(join(cwd, f, ".."), { recursive: true });
    writeFileSync(join(cwd, f), "old\n");
  }
  git(cwd, ["add", "-A"]);
  git(cwd, [...COMMIT, "commit", "-q", "-m", "init"]);
  for (const f of [".env", "sub/.env", "a.txt"]) writeFileSync(join(cwd, f), "SECRET=1\n");
  mkdirSync(join(cwd, "new"));
  writeFileSync(join(cwd, "new", ".env"), "SECRET=2\n"); // untracked
  const out = diffCommands(undefined, pathspecExcludes(names)).map(([, args]) => git(cwd, gitInvocation(args).args)).join("\n");
  assert.match(out, /a\.txt/);
  assert.doesNotMatch(out, /\.env/);
  assert.equal(out.match(/SECRET/g)?.length, 1); // a.txt only
  rmSync(cwd, { recursive: true, force: true });
});

test("the git sandbox denies the repo's bare-name denies on top of Claude's list", () => {
  const { denyRead, allowWrite } = gitSandboxProfile(sandboxPolicy(JSON.stringify(SETTINGS)), "/r").filesystem;
  assert.deepEqual(allowWrite, []);
  assert.ok(denyRead.includes("/r/**/.env") && !denyRead.some((p) => p.includes(".env.")));
  assert.ok(denyRead.some((p) => p.endsWith("/.ssh")));
});

test("sandboxed git runs a hostile clean filter without writes or denied reads", { skip: process.env.PI_WORKFLOW_LIVE_TESTS !== "1" && "Set PI_WORKFLOW_LIVE_TESTS=1 on a host that permits Unix sockets and SRT" }, async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-bridge-filter-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, "repo");
  const secret = join(root, "secret");
  mkdirSync(secret);
  writeFileSync(join(secret, "canary"), "CANARY-OUTSIDE\n");
  git(root, ["init", "-q", "-b", "base", cwd]);
  writeFileSync(join(cwd, "a.txt"), "one\n");
  git(cwd, ["add", "a.txt"]);
  git(cwd, [...COMMIT, "commit", "-qm", "init"]);
  writeFileSync(join(cwd, ".env"), "CANARY-DOTENV\n");
  writeFileSync(join(cwd, "a.txt"), "two\n");
  writeFileSync(join(cwd, ".gitattributes"), "* filter=evil\n");
  // the clean filter's stdout becomes the diffed content, so a canary it
  // reads surfaces in the diff text that reaches the model
  const filter = (marker) => `touch '${marker}'; cat '${join(secret, "canary")}' '${join(cwd, ".env")}'; cat`;
  // one filter in the repo's own config (only srt stops it), one reached
  // through a planted commondir (the pinned GIT_COMMON_DIR stops it)
  const common = join(root, "common");
  git(root, ["clone", "-q", "--bare", cwd, common]);
  git(cwd, ["config", "filter.evil.clean", filter(join(root, "marker-own"))]);
  git(common, ["config", "filter.evil.clean", filter(join(root, "marker-common"))]);
  writeFileSync(join(cwd, ".git", "commondir"), common);

  // control: plain git runs the commondir filter and leaks both canaries
  const plain = spawnSync("git", ["diff", "HEAD"], { cwd, encoding: "utf8" });
  assert.ok(existsSync(join(root, "marker-common")));
  assert.match(plain.stdout, /CANARY-OUTSIDE/);
  rmSync(join(root, "marker-common"));

  const policy = { writableRoots: [], denyRead: [secret], denyNames: [".env"] };
  await assert.rejects(assertRepoRoot(cwd, policy), /git dir/);
  let seen = "";
  for (const base of ["base", undefined]) {
    try {
      seen += await gatherDiff(base, cwd, policy);
    } catch (error) {
      seen += error.message;
    }
  }
  assert.match(seen, /a\.txt/);
  assert.doesNotMatch(seen, /CANARY/);
  assert.equal(existsSync(join(root, "marker-own")), false);
  assert.equal(existsSync(join(root, "marker-common")), false);
});
