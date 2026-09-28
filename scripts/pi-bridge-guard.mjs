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
// pi folds these to ASCII space after the rewrite, which could turn a vetted
// path into a sibling outside cwd; any such path is refused instead
const UNICODE_SPACE_RE = /[  -   　]/;

// the bridge hands over the bare deny names it derives from Claude's settings;
// absent or malformed, every call throws and the handler blocks it
function envDenyNames(raw = process.env.PI_BRIDGE_DENY_NAMES) {
  const names = JSON.parse(raw);
  if (!Array.isArray(names) || !names.every((name) => typeof name === "string" && name)) {
    throw new Error("PI_BRIDGE_DENY_NAMES is not a list of names");
  }
  // names go into grep's rg exclusion glob verbatim; a metacharacter or
  // separator would change what it excludes
  if (names.some((name) => /[*?[\]{}!,\\/]/.test(name))) {
    throw new Error("PI_BRIDGE_DENY_NAMES has a glob metacharacter or separator");
  }
  return names;
}

// Returns a block reason, or null after rewriting input.path to the vetted path
// (and, for grep, setting input.glob to exclude the deny names).
export function decide(toolName, input, cwd, denyNames = envDenyNames()) {
  if (!READ_ONLY_TOOLS.has(toolName)) return `tool not allowed: ${toolName}`;
  const canonicalCwd = existsSync(cwd) ? realpathSync(cwd) : cwd;
  const raw = input?.path;
  if (raw !== undefined && typeof raw !== "string") return "path must be a string";
  const expanded = raw === undefined ? canonicalCwd : raw.startsWith("~") ? resolve(homedir(), raw.slice(1)) : raw;
  const resolved = isAbsolute(expanded) ? expanded : resolve(canonicalCwd, expanded);
  // lexical check first, so the reason for a missing outside path does not say
  // whether it exists on the host; the realpath check below catches symlinks
  if (resolved !== canonicalCwd && !resolved.startsWith(canonicalCwd + sep)) {
    return `path escapes repository: ${raw ?? "(cwd)"}`;
  }
  // pi's read retries a missing path under unicode variants (curly quote, NFD,
  // AM/PM space) and follows whichever exists, unvetted; no tool needs a
  // missing path
  if (!existsSync(resolved)) return `path does not exist: ${raw}`;
  const real = realpathSync(resolved);
  if (real !== canonicalCwd && !real.startsWith(canonicalCwd + sep)) {
    return `path escapes repository: ${raw ?? "(cwd)"}`;
  }
  if (real.split(sep).some((segment) => denyNames.includes(segment))) {
    return `blocked path: ${raw}`;
  }
  if (UNICODE_SPACE_RE.test(real)) return `path contains a unicode space: ${raw ?? "(cwd)"}`;
  // grep over a directory runs `rg --hidden`, so the segment check above never
  // sees a nested .env; pi forwards glob as one `--glob`, which the guard owns
  if (toolName === "grep") {
    if (input.glob !== undefined) return "grep glob not allowed; narrow with path";
    if (denyNames.length) input.glob = `!{${denyNames.join(",")}}`;
  }
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
