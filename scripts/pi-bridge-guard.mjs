// pi's built-in tools run in-process with no filesystem boundary of their
// own; the bridge's --tools allowlist keeps the model to read/grep/find/ls,
// but nothing stops one of those from pointing at a path outside the repo
// (~/.ssh, ~/.pi/agent/auth.json, /etc/passwd). This extension is the
// substitute for the sandbox a subprocess-per-call transport would give us
// for free.
//
// pi re-normalizes tool paths after this hook runs (resolveToCwd: strips a
// leading "@", converts file:// URLs, folds unicode spaces), so checking the
// raw string is not enough — "@/etc/passwd" reads /etc/passwd. The guard
// therefore replaces event.input.path with the canonical absolute path it
// vetted; an absolute path is a fixed point of that normalization.
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve, sep } from "node:path";

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const DOTENV_RE = /^\.env(\..*)?$/;
// pi folds these to ASCII space after the rewrite, which could turn a vetted
// path into a sibling outside cwd; any such path is refused instead
const UNICODE_SPACE_RE = /[  -   　]/;

// Returns a block reason, or null after rewriting input.path to the vetted path.
export function decide(toolName, input, cwd) {
  if (!READ_ONLY_TOOLS.has(toolName)) return `tool not allowed: ${toolName}`;
  const canonicalCwd = existsSync(cwd) ? realpathSync(cwd) : cwd;
  const raw = input?.path;
  if (raw !== undefined && typeof raw !== "string") return "path must be a string";
  const expanded = raw === undefined ? canonicalCwd : raw.startsWith("~") ? resolve(homedir(), raw.slice(1)) : raw;
  const resolved = isAbsolute(expanded) ? expanded : resolve(canonicalCwd, expanded);
  const real = existsSync(resolved) ? realpathSync(resolved) : resolved;
  if (real !== canonicalCwd && !real.startsWith(canonicalCwd + sep)) {
    return `path escapes repository: ${raw ?? "(cwd)"}`;
  }
  if (real.split(sep).some((segment) => DOTENV_RE.test(segment))) {
    return `blocked path: ${raw}`;
  }
  if (UNICODE_SPACE_RE.test(real)) return `path contains a unicode space: ${raw ?? "(cwd)"}`;
  if (raw !== undefined) input.path = real;
  return null;
}

export default function (pi) {
  pi.on("tool_call", (event, ctx) => {
    try {
      const reason = decide(event.toolName, event.input, ctx.cwd);
      if (reason) return { block: true, reason };
    } catch {
      return { block: true, reason: "guard error (fail-safe)" };
    }
  });
}
