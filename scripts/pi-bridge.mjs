#!/usr/bin/env node
// MCP bridge exposing narrow pi-hosted GPT consultation tools over the
// repo-local pi CLI's headless JSON mode. Replaces the retired Codex CLI
// transport (2026-09-23) while keeping its two load-bearing properties:
// harness-spawned outside the Bash sandbox (so the ~/.pi read-deny stays
// intact) and MCP tools that permission allow rules make prompt-free in plan
// mode — a Bash-based transport gets neither.
//
// Invocation is fixed by design: a read-only tool allowlist (read, grep,
// find, ls) plus the guard extension stand in for the sandbox Codex gave us
// for free; project-local `.pi/` files are ignored (--no-approve) and
// extension discovery is off, so a reviewed repo cannot load code into the
// reviewer; the worker-tier model and reasoning effort arrive via
// --model/--reasoning-effort from the rendered MCP config, not interactive pi
// settings, so they cannot drift from the declared value. Callers choose
// scope (base/uncommitted/prompt/brief), never tools, provider, or flags.
//
// Reversal trigger: pi's print mode (`--mode json`), its tool allowlist, or
// `tool_call` blocking regresses, or OpenAI withdraws subscription OAuth from
// third-party harnesses — any of those and this bridge needs to go back to
// shelling out to a vendor CLI directly.
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const PI_BIN = fileURLToPath(new URL("../node_modules/.bin/pi", import.meta.url));
const GUARD_PATH = fileURLToPath(new URL("./pi-bridge-guard.mjs", import.meta.url));
// user-private and persistent across bridge restarts; os.tmpdir() is shared
// on Linux, where a pre-created directory could expose prompts and responses
const SESSION_DIR = resolve(process.env.XDG_CACHE_HOME || resolve(homedir(), ".cache"), "pi-bridge", "sessions");
const DIFF_CAP = 300_000;
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const BASE_RE = /^[A-Za-z0-9._/-]+$/;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ROLE_NOTE =
  "You are a read-only reviewer/advisor consulted by another agent. You have " +
  "only the read, grep, find, and ls tools, confined to the repository at your " +
  "working directory. Ignore any loaded instructions about other tools, " +
  "subagents, sandboxes, or a `!` shell composer — you do not have them. " +
  "Answer in full in one message.";

// reasoning effort and model are fixed by the rendered MCP config, not by
// caller input, so a tool call can never drift the pinned worker tier
const effortIndex = process.argv.indexOf("--reasoning-effort");
const effort = effortIndex !== -1 ? process.argv[effortIndex + 1] : "high";
export function thinkingLevel(level) {
  if (!THINKING_LEVELS.includes(level)) throw new Error(`Invalid reasoning effort: ${level}`);
  return level;
}
thinkingLevel(effort);
const modelIndex = process.argv.indexOf("--model");
const pinnedModel = modelIndex !== -1 ? process.argv[modelIndex + 1] : undefined;
if (pinnedModel !== undefined && !/^[A-Za-z0-9._-]+$/.test(pinnedModel)) {
  throw new Error(`Invalid model: ${pinnedModel}`);
}

export function validateBase(base) {
  if (base === undefined) return;
  if (!BASE_RE.test(base) || base.startsWith("-")) throw new Error(`invalid base: ${base}`);
}

export function validateThreadId(threadId) {
  if (!UUID_V4_RE.test(threadId)) throw new Error(`invalid threadId: ${threadId}`);
}

export function composeReviewPrompt({ base, prompt, diffText }) {
  const scopeText = base
    ? `Review this branch's changes against base ${base}.`
    : "Review the uncommitted changes (staged, unstaged, and untracked).";
  const truncated =
    diffText.length > DIFF_CAP
      ? `${diffText.slice(0, DIFF_CAP)}\n[diff truncated — read the changed files directly]`
      : diffText;
  const body = truncated.trim() ? truncated : "The diff is empty.";
  const parts = [scopeText];
  if (prompt) parts.push(prompt);
  parts.push(`\`\`\`\n${body}\n\`\`\``);
  return parts.join("\n\n");
}

// pi's `--mode json` output is JSON lines; the last message_end event whose
// message.role is "assistant" carries the final authoritative response, so
// only the last one wins (earlier ones are superseded turns/retries)
export function parseEvents(stdoutText) {
  let threadId;
  let lastAssistant;
  for (const line of stdoutText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (event.type === "session" && threadId === undefined) {
      threadId = event.id;
    } else if (event.type === "message_end" && event.message?.role === "assistant") {
      lastAssistant = event.message;
    }
  }
  if (!lastAssistant) {
    return { threadId, text: "", stopReason: undefined, errorMessage: undefined };
  }
  const text = (lastAssistant.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
  return { threadId, text, stopReason: lastAssistant.stopReason, errorMessage: lastAssistant.errorMessage };
}

function checkCwd(cwd) {
  if (!isAbsolute(cwd)) throw new Error(`cwd must be absolute: ${cwd}`);
  let st;
  try {
    st = statSync(cwd);
  } catch {
    throw new Error(`cwd does not exist: ${cwd}`);
  }
  if (!st.isDirectory()) throw new Error(`cwd is not a directory: ${cwd}`);
}

async function ensureSessionDir() {
  // chmod after mkdir: recursive mkdir leaves a pre-existing directory's mode
  // alone, and chmod fails loudly if the directory is not ours
  await mkdir(SESSION_DIR, { recursive: true, mode: 0o700 });
  await chmod(SESSION_DIR, 0o700);
}

// pi 0.87 renames <cwd>/.pi/commands to .pi/prompts at startup (migrations.js),
// before --no-approve or the guard can act: the one write a review could make
// to the reviewed tree, so refuse rather than review
export function assertNoPendingMigration(cwd) {
  if (existsSync(join(cwd, ".pi", "commands")) && !existsSync(join(cwd, ".pi", "prompts"))) {
    throw new Error(`refusing: pi would rename ${cwd}/.pi/commands to .pi/prompts`);
  }
}

// the guard confines reads to cwd, so cwd itself must be a repository root
// rather than any directory a caller names (/, ~/.pi/agent)
async function assertRepoRoot(cwd) {
  const top = (await gitOutput(["rev-parse", "--show-toplevel"], cwd).catch(() => "")).trim();
  if (!top || realpathSync(top) !== realpathSync(cwd)) {
    throw new Error(`cwd is not a git worktree root: ${cwd}`);
  }
}

// pi resolves --session-id against the session dir filtered by the session
// header's cwd: a threadId from a different cwd, or a garbage value, would
// silently create a second, empty session instead of erroring, and the caller
// would get a contextless answer presented as a continuation. Running the
// same lookup first turns both into a clear error. Imported lazily: the
// module costs ~240 ms, paid on the first reply rather than at server start.
async function checkSession(threadId, cwd) {
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  if (SessionManager.findById(cwd, threadId, SESSION_DIR) === undefined) {
    throw new Error(`unknown threadId for ${cwd}: ${threadId}`);
  }
}

function gitOutput(args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`git ${args.join(" ")} exited ${code}: ${stderr}`));
      else resolvePromise(stdout);
    });
  });
}

// three-dot diff = changes since the merge base, the same scope `codex exec
// review --base` gave; untracked files are listed, not embedded, since the
// model can open them with read
export function diffCommands(base) {
  return base
    ? [
        ["stat", ["--no-pager", "diff", "--no-color", "--stat", `${base}...HEAD`]],
        ["diff", ["--no-pager", "diff", "--no-color", `${base}...HEAD`]],
      ]
    : [
        ["status", ["status", "--porcelain"]],
        ["diff", ["--no-pager", "diff", "--no-color", "HEAD"]],
        ["untracked files (open with read)", ["ls-files", "--others", "--exclude-standard"]],
      ];
}

async function gatherDiff(base, cwd) {
  const sections = [];
  for (const [label, args] of diffCommands(base)) {
    const out = (await gitOutput(args, cwd)).trim();
    if (out) sections.push(`git ${label}:\n${out}`);
  }
  return sections.join("\n\n");
}

export function piArgs({ model, effort, sessionId }) {
  return [
    "--mode", "json",
    "--provider", "openai-codex",
    "--model", model,
    "--thinking", effort,
    "--tools", "read,grep,find,ls",
    "--no-extensions", "-e", GUARD_PATH,
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-approve",
    "--append-system-prompt", ROLE_NOTE,
    "--session-dir", SESSION_DIR,
    "--session-id", sessionId,
  ];
}

// positionals are never used: the prompt always goes on stdin, so
// caller-supplied text (e.g. an "@"-leading brief) can never be parsed as a
// file argument or a flag
async function runPi(promptText, { cwd, sessionId }, signal) {
  checkCwd(cwd);
  await assertRepoRoot(cwd);
  assertNoPendingMigration(cwd);
  if (signal?.aborted) throw new Error("cancelled before launch");
  await ensureSessionDir();
  if (signal?.aborted) throw new Error("cancelled before launch");
  const args = piArgs({ model: pinnedModel, effort, sessionId });
  const child = spawn(PI_BIN, args, { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const onAbort = () => child.kill("SIGTERM");
  signal?.addEventListener("abort", onAbort, { once: true });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  // a review prompt can exceed the pipe buffer; if pi exits (abort, startup
  // failure) before draining it, the EPIPE would otherwise crash the whole
  // MCP server — the exit path below already reports the failure
  child.stdin.on("error", () => {});
  child.stdin.write(promptText);
  child.stdin.end();
  const code = await new Promise((resolveExit, reject) => {
    child.on("error", reject);
    child.on("close", resolveExit);
  }).finally(() => signal?.removeEventListener("abort", onAbort));
  if (signal?.aborted) throw new Error("cancelled; pi process terminated");
  const parsed = parseEvents(stdout);
  // JSON mode exits 0 even on model/auth errors (print-mode.js only sets a
  // non-zero exit code in text mode), so the exit code alone cannot signal
  // failure here
  if (parsed.stopReason === "error" || parsed.stopReason === "aborted") {
    throw new Error(`pi ${parsed.stopReason}: ${parsed.errorMessage ?? ""}\n\n${stderr.slice(-2000)}`);
  }
  if (code !== 0 && !parsed.text.trim()) {
    throw new Error(`pi exited ${code}: ${stderr.slice(-2000)}`);
  }
  if (parsed.threadId !== undefined && parsed.threadId !== sessionId) {
    throw new Error(`pi session id mismatch: expected ${sessionId}, got ${parsed.threadId}`);
  }
  return {
    content: [
      {
        type: "text",
        text: `threadId: ${parsed.threadId ?? "unknown"}\n\n${parsed.text.trim()}`,
      },
    ],
  };
}

const server = new McpServer({ name: "pi-bridge", version: "1.0.0" });
const readOnly = { readOnlyHint: true };

server.registerTool(
  "review",
  {
    description:
      "Ask the pi-hosted GPT reviewer for a code review of the repository at " +
      "cwd (read-only). Reviews the working tree by default, or a branch's " +
      "changes when `base` is given. Returns the review plus a threadId for " +
      "one follow-up via `reply`.",
    inputSchema: {
      cwd: z.string().describe("Absolute path to the repository root"),
      base: z
        .string()
        .optional()
        .describe("Review changes against this base branch"),
      uncommitted: z
        .boolean()
        .optional()
        .describe(
          "Review staged, unstaged, and untracked changes (default when base is unset)",
        ),
      prompt: z
        .string()
        .optional()
        .describe("Custom review instructions / focus"),
    },
    annotations: readOnly,
  },
  async ({ cwd, base, uncommitted, prompt }, extra) => {
    if (base && uncommitted) {
      throw new Error("pass either base or uncommitted, not both");
    }
    validateBase(base);
    checkCwd(cwd);
    const diffText = await gatherDiff(base, cwd);
    const promptText = composeReviewPrompt({ base, prompt, diffText });
    return runPi(promptText, { cwd, sessionId: randomUUID() }, extra?.signal);
  },
);

server.registerTool(
  "advise",
  {
    description:
      "Ask the pi-hosted GPT advisor for an independent read on a brief " +
      "(architecture decision, trade-off, stuck bug). It reads the " +
      "repository at cwd read-only. Returns the response plus a threadId " +
      "for follow-ups via `reply`.",
    inputSchema: {
      cwd: z.string().describe("Absolute path to the repository root"),
      brief: z.string().describe("The full self-contained brief"),
    },
    annotations: readOnly,
  },
  async ({ cwd, brief }, extra) => {
    checkCwd(cwd);
    return runPi(brief, { cwd, sessionId: randomUUID() }, extra?.signal);
  },
);

server.registerTool(
  "reply",
  {
    description:
      "Continue an earlier review/advise thread by threadId with a " +
      "follow-up prompt.",
    inputSchema: {
      cwd: z.string().describe("Absolute path to the repository root"),
      threadId: z.string().describe("threadId returned by review/advise"),
      prompt: z.string().describe("The follow-up prompt"),
    },
    annotations: readOnly,
  },
  async ({ cwd, threadId, prompt }, extra) => {
    checkCwd(cwd);
    validateThreadId(threadId);
    await checkSession(threadId, cwd);
    return runPi(prompt, { cwd, sessionId: threadId }, extra?.signal);
  },
);

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  // without the pin pi would fall back to its interactive default, the
  // frontier driver, for a worker role
  if (pinnedModel === undefined) throw new Error("--model <worker-tier id> is required");
  await server.connect(new StdioServerTransport());
}
