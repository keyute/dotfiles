import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, matchesGlob, resolve } from "node:path";
import { createInterface } from "node:readline";
import { detectSupportedImageMimeTypeFromFile, truncateHead, truncateLine } from "@earendil-works/pi-coding-agent";
import { workerTools } from "./policy.mjs";
import { terminateProcessGroup } from "./sandbox-runner.mjs";

// This entire process runs inside SRT; it executes primitive operations for
// exactly one host-side tool invocation and exits when stdin closes. Only the
// leased tool's operations are served — a "read" lease cannot exec.
const TOOL_OPS = {
  bash: ["exec"],
  read: ["access", "readFile", "detectImage"],
  write: ["writeFile", "mkdir"],
  edit: ["access", "readFile", "writeFile"],
  grep: ["grep"],
  find: ["exists", "findGlob"],
  ls: ["exists", "stat", "readdir"],
};
const GREP_DEFAULT_LIMIT = 100;

const name = process.argv[2];
if (!workerTools.includes(name) || !TOOL_OPS[name]) throw new Error("Unregistered sandbox tool");
const allowedOps = TOOL_OPS[name];
const cwd = process.cwd();
const active = new Map();
const children = new Set();

const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const errorPayload = error => ({ message: error?.message || String(error), ...(error?.code ? { code: error.code } : {}) });

const killGroup = child => void terminateProcessGroup(child).catch(() => {});

function exec({ command, cwd: dir, timeout }, { signal, onChunk }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("bash", ["-c", command], { cwd: dir || cwd, env: process.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    children.add(child);
    let timedOut = false;
    // One termination per child: abort starts it, close awaits the same run.
    let termination;
    const terminate = () => (termination ??= terminateProcessGroup(child));
    const abort = () => void terminate().catch(() => {});
    const timer = timeout > 0 ? setTimeout(() => { timedOut = true; abort(); }, timeout * 1000) : undefined;
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("error", rejectPromise);
    child.on("close", async (code, killSignal) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      // Work the command backgrounded with its stdio redirected outlives the
      // shell in its group; the lease's terminal proof must not cover it
      // (run_in_background is the supported way to keep a process). A group
      // the worker cannot signal (another user's process) is reported, not
      // hidden: the proof still cannot reach it.
      // Tracked until the group is gone, not until the shell is: a SIGTERM
      // arriving during this wait must still find the descendants.
      try { await terminate(); } catch (error) {
        return rejectPromise(new Error(`command ended but its background processes could not be terminated: ${error.message}`));
      } finally { children.delete(child); }
      // Match the official tool-routing example's failure contract.
      if (signal.aborted && !timedOut) return rejectPromise(new Error("aborted"));
      if (timedOut) return rejectPromise(new Error(`timeout:${timeout}`));
      resolvePromise({ exitCode: killSignal ? null : code });
    });
  });
}

function ripgrepMissing(error) {
  return error?.code === "ENOENT" ? new Error("ripgrep is required in the sandbox") : error;
}

function listFiles(root, extraIgnores, signal) {
  return new Promise((resolvePromise, rejectPromise) => {
    // --hidden matches the SDK grep's own rg invocation; .git needs an
    // explicit exclusion once hidden entries are included.
    const args = ["--files", "--hidden", "--glob", "!.git", ...extraIgnores.flatMap(pattern => ["--glob", `!${pattern}`])];
    const child = spawn("rg", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const abort = () => killGroup(child);
    signal.addEventListener("abort", abort, { once: true });
    let output = "";
    let stderr = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => rejectPromise(ripgrepMissing(error)));
    child.on("close", code => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) return rejectPromise(new Error("aborted"));
      // rg exits 1 with no output when nothing matched; treat as empty.
      if (code === 1 && output === "") return resolvePromise([]);
      if (code !== 0) return rejectPromise(new Error(stderr.trim() || `ripgrep exited with code ${code}`));
      resolvePromise(output.split("\n").filter(Boolean));
    });
  });
}

function matchesToolGlob(relativePath, pattern) {
  if (pattern.includes("/")) return matchesGlob(relativePath, pattern) || matchesGlob(relativePath, `**/${pattern}`);
  return matchesGlob(basename(relativePath), pattern);
}

async function grep(params, { signal }) {
  const root = resolve(cwd, params.path ?? ".");
  const rootIsDirectory = (await stat(root)).isDirectory();
  const contextLines = params.context > 0 ? params.context : 0;
  const limit = Math.max(1, params.limit ?? GREP_DEFAULT_LIMIT);
  const args = ["--json", "--hidden", "--glob", "!.git"];
  if (params.ignoreCase) args.push("-i");
  if (params.literal) args.push("-F");
  if (contextLines > 0) args.push("-C", String(contextLines));
  if (params.glob) {
    // Mirror matchesToolGlob: a glob without "/" matches the basename anywhere
    // (rg's default for slash-free globs); one with "/" is anchored to root,
    // so also match it at any depth to keep the "**/" fallback semantic.
    args.push("--glob", params.glob);
    if (params.glob.includes("/")) args.push("--glob", `**/${params.glob}`);
  }
  const target = rootIsDirectory ? "." : basename(root);
  const searchCwd = rootIsDirectory ? root : resolve(root, "..");
  args.push("--", params.pattern, target);

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("rg", args, { cwd: searchCwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const rl = createInterface({ input: child.stdout });
    let stderr = "";
    let matchCount = 0;
    let linesTruncated = false;
    let limitReached = false;
    let pastLimit = false;
    let lastMatch = null;
    const outputLines = [];
    const abort = () => killGroup(child);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.stderr.on("data", chunk => { stderr += chunk; });
    rl.on("line", line => {
      if (!line.trim() || pastLimit) return;
      let event;
      try { event = JSON.parse(line); } catch { return; }
      // Past the limit only the accepted match's trailing window (same file,
      // within `context` lines) is kept, a further match inside it rendering
      // as context; the first event beyond the window stops rg.
      if (event.type === "end" && limitReached) { pastLimit = true; killGroup(child); return; }
      if (event.type !== "match" && event.type !== "context") return;
      const rawPath = event.data.path.text;
      const relativePath = rawPath.startsWith("./") ? rawPath.slice(2) : rawPath;
      const lineNumber = event.data.line_number;
      if (limitReached && (relativePath !== lastMatch.path || lineNumber > lastMatch.line + contextLines)) { pastLimit = true; killGroup(child); return; }
      const isMatch = event.type === "match" && !limitReached;
      const rawText = event.data.lines.text.replace(/\r\n/g, "\n").replace(/\n$/, "").replace(/\r/g, "");
      const { text, wasTruncated } = truncateLine(rawText);
      if (wasTruncated) linesTruncated = true;
      const separator = isMatch ? ":" : "-";
      outputLines.push(`${relativePath}${separator}${lineNumber}${separator} ${text}`);
      if (isMatch) {
        matchCount++;
        lastMatch = { path: relativePath, line: lineNumber };
        if (matchCount >= limit) limitReached = true;
      }
    });
    child.on("error", error => {
      rl.close();
      signal.removeEventListener("abort", abort);
      rejectPromise(ripgrepMissing(error));
    });
    child.on("close", code => {
      rl.close();
      signal.removeEventListener("abort", abort);
      if (signal.aborted) return rejectPromise(new Error("aborted"));
      // Exit 1 is "no matches". Exit 2 also covers partial failures (a
      // denied path inside the sandbox) alongside real matches, so it is an
      // error only when nothing matched — then stderr carries the reason
      // (a bad regex, a missing root).
      if (code !== 0 && code !== 1 && !limitReached && matchCount === 0) return rejectPromise(new Error(stderr.trim() || `ripgrep exited with code ${code}`));
      if (matchCount === 0) return resolvePromise({ text: "No matches found" });
      const truncation = truncateHead(outputLines.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
      const notices = [];
      let output = truncation.content;
      const details = {};
      if (limitReached) { details.matchLimitReached = limit; notices.push(`${limit} matches limit reached`); }
      if (linesTruncated) { details.linesTruncated = true; notices.push("long lines truncated"); }
      if (truncation.truncated) { details.truncation = truncation; notices.push("output size limit reached"); }
      if (notices.length) output += `\n\n[${notices.join(". ")}]`;
      resolvePromise({ text: output, details: Object.keys(details).length ? details : undefined });
    });
  });
}

async function findGlob({ pattern, cwd: dir, ignore, limit }, { signal }) {
  const root = resolve(cwd, dir ?? ".");
  const results = [];
  for (const relativePath of await listFiles(root, ignore ?? [], signal)) {
    if (results.length >= limit) break;
    if (matchesToolGlob(relativePath, pattern)) results.push(join(root, relativePath));
  }
  return results;
}

const handlers = {
  exec: (params, context) => exec(params, context),
  grep: (params, context) => grep(params, context),
  findGlob: (params, context) => findGlob(params, context),
  access: ({ path, mode }) => access(path, mode === "rw" ? constants.R_OK | constants.W_OK : constants.R_OK),
  // Streamed in slices: one giant base64 JSON line would spike parse memory
  // on the host and large files would otherwise hit the response cap whole.
  readFile: async ({ path }, { onChunk }) => {
    const data = await readFile(path);
    for (let offset = 0; offset < data.length; offset += 4 * 1024 * 1024) onChunk(data.subarray(offset, offset + 4 * 1024 * 1024));
    return null;
  },
  writeFile: ({ path, data }) => writeFile(path, data),
  mkdir: ({ path }) => mkdir(path, { recursive: true }),
  exists: async ({ path }) => { try { await access(path); return true; } catch { return false; } },
  stat: async ({ path }) => ({ isDirectory: (await stat(path)).isDirectory() }),
  readdir: ({ path }) => readdir(path),
  detectImage: async ({ path }) => (await detectSupportedImageMimeTypeFromFile(path)) ?? null,
};

process.on("SIGTERM", () => {
  for (const controller of active.values()) controller.abort();
  // The runner SIGKILLs this worker's group one second after its SIGTERM,
  // before the abort's own TERM→KILL on the command's separate group can
  // finish; a command that ignores TERM would outlive the lease the runner
  // then proves terminated (a free host process on the unsandboxed path).
  for (const child of children) try { process.kill(-child.pid, "SIGKILL"); } catch {}
  setTimeout(() => process.exit(1), 1500).unref();
});

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const inFlight = new Set();
lines.on("line", line => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.op === "abort") return active.get(request.target)?.abort();
  const { id, op, params = {} } = request;
  if (typeof id !== "string" || !allowedOps.includes(op)) return send({ id, ok: false, error: { message: "Operation not permitted for this tool lease" } });
  const controller = new AbortController();
  active.set(id, controller);
  const pending = (async () => {
    try {
      const value = await handlers[op](params, { signal: controller.signal, onChunk: chunk => send({ id, chunk: chunk.toString("base64") }) });
      send({ id, ok: true, value });
    } catch (error) {
      send({ id, ok: false, error: errorPayload(error) });
    } finally { active.delete(id); }
  })();
  inFlight.add(pending);
  pending.finally(() => inFlight.delete(pending));
});
lines.on("close", async () => {
  for (const controller of active.values()) controller.abort();
  await Promise.allSettled([...inFlight]);
  // Exit naturally so queued stdout responses flush; exit() would truncate them.
  process.exitCode = 0;
  process.stdin.destroy();
});
