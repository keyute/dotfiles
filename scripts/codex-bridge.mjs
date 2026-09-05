#!/usr/bin/env node
// MCP bridge exposing narrow Codex consultation tools over the stable
// `codex exec` CLI. Replaces the deprecated `codex mcp-server` transport
// (deprecated codex-cli v0.149.1, removal announced) while keeping its two
// load-bearing properties: harness-spawned outside the Bash sandbox (so the
// ~/.codex read-deny stays intact) and MCP tools that permission allow rules
// make prompt-free in plan mode — a Bash-based transport gets neither.
//
// Invocation is fixed by design: read-only sandbox, approvals never, high
// reasoning. Callers choose scope (base/uncommitted/prompt), never sandbox or
// approval flags. Model comes from ~/.codex/config.toml.
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const FIXED_ARGS = [
  "--json",
  "-c", 'sandbox_mode="read-only"',
  "-c", 'approval_policy="never"',
  "-c", 'model_reasoning_effort="high"',
];

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

// positionals go after `--` so caller-supplied text can never be parsed as
// flags (a prompt starting with "--dangerously-…" would otherwise defeat the
// fixed sandbox config)
async function runCodex(flagArgs, positionals, cwd, signal) {
  checkCwd(cwd);
  if (signal?.aborted) throw new Error("cancelled before launch");
  const dir = await mkdtemp(join(tmpdir(), "codex-bridge-"));
  const outFile = join(dir, "last-message.txt");
  try {
    // re-check after the await: an abort during setup would otherwise be
    // silently missed (listeners on an already-aborted signal never fire)
    if (signal?.aborted) throw new Error("cancelled before launch");
    const child = spawn(
      "codex",
      [...flagArgs, "-o", outFile, "--", ...positionals],
      {
        cwd,
        env: process.env,
        // stdout must stay off the MCP stdio channel: collect, never inherit
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const onAbort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", onAbort, { once: true });
    let events = "";
    let stderr = "";
    child.stdout.on("data", (d) => (events += d));
    child.stderr.on("data", (d) => (stderr += d));
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    }).finally(() => signal?.removeEventListener("abort", onAbort));
    if (signal?.aborted) throw new Error("cancelled; codex process terminated");
    let threadId = null;
    for (const line of events.split("\n")) {
      try {
        const ev = JSON.parse(line);
        threadId = ev.thread_id ?? ev.session_id ?? ev.threadId ?? threadId;
        if (threadId) break;
      } catch {
        // non-JSON noise on stdout; ignore
      }
    }
    const message = await readFile(outFile, "utf8").catch(() => "");
    if (code !== 0 && !message.trim()) {
      throw new Error(`codex exited ${code}: ${stderr.slice(-2000)}`);
    }
    return {
      content: [
        {
          type: "text",
          text: `threadId: ${threadId ?? "unknown"}\n\n${message.trim()}`,
        },
      ],
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const server = new McpServer({ name: "codex-bridge", version: "1.0.0" });
const readOnly = { readOnlyHint: true };

server.registerTool(
  "review",
  {
    description:
      "Run Codex's native code review against the repository at cwd " +
      "(read-only). Reviews the working tree by default, or a branch's " +
      "changes when `base` is given. Returns the review plus a threadId " +
      "for one follow-up via `reply`.",
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
    if (base && base.startsWith("-")) throw new Error(`invalid base: ${base}`);
    const scope = base ? ["--base", base] : ["--uncommitted"];
    return runCodex(
      ["exec", "review", ...FIXED_ARGS, ...scope],
      prompt ? [prompt] : [],
      cwd,
      extra?.signal,
    );
  },
);

server.registerTool(
  "advise",
  {
    description:
      "Ask Codex for an independent read on a brief (architecture decision, " +
      "trade-off, stuck bug). Codex reads the repository at cwd read-only. " +
      "Returns the response plus a threadId for follow-ups via `reply`.",
    inputSchema: {
      cwd: z.string().describe("Absolute path to the repository root"),
      brief: z.string().describe("The full self-contained brief"),
      model: z
        .string()
        .regex(/^[A-Za-z0-9._-]+$/)
        .optional()
        .describe(
          "Model ID override (pin probing only); defaults to ~/.codex/config.toml",
        ),
    },
    annotations: readOnly,
  },
  async ({ cwd, brief, model }, extra) =>
    runCodex(
      ["exec", ...FIXED_ARGS, ...(model ? ["-c", `model="${model}"`] : [])],
      [brief],
      cwd,
      extra?.signal,
    ),
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
    // only ids the bridge itself emitted: blocks flag-shaped values like
    // `--last`, which would resume an unrelated private session
    if (!/^[0-9a-fA-F][0-9a-fA-F-]*$/.test(threadId)) {
      throw new Error(`invalid threadId: ${threadId}`);
    }
    return runCodex(
      ["exec", "resume", ...FIXED_ARGS],
      [threadId, prompt],
      cwd,
      extra?.signal,
    );
  },
);

await server.connect(new StdioServerTransport());
