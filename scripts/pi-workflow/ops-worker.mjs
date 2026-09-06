import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, matchesGlob, resolve } from "node:path";
import { createInterface } from "node:readline";
import { detectSupportedImageMimeTypeFromFile, truncateHead, truncateLine } from "@earendil-works/pi-coding-agent";
import { workerTools } from "./policy.mjs";

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

const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const errorPayload = error => ({ message: error?.message || String(error), ...(error?.code ? { code: error.code } : {}) });

function killGroup(child) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch {}
  setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 1000).unref();
}

function exec({ command, cwd: dir, timeout }, { signal, onChunk }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("bash", ["-c", command], { cwd: dir || cwd, env: process.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let timedOut = false;
    const abort = () => killGroup(child);
    const timer = timeout > 0 ? setTimeout(() => { timedOut = true; abort(); }, timeout * 1000) : undefined;
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("error", rejectPromise);
    child.on("close", (code, killSignal) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      // Match the official tool-routing example's failure contract.
      if (signal.aborted && !timedOut) return rejectPromise(new Error("aborted"));
      if (timedOut) return rejectPromise(new Error(`timeout:${timeout}`));
      resolvePromise({ exitCode: killSignal ? null : code });
    });
  });
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
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.resume();
    child.on("error", () => resolvePromise(undefined));
    child.on("close", code => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) return rejectPromise(new Error("aborted"));
      // rg exits 1 with no output when nothing matched; treat as empty.
      if (code !== 0 && output === "") return resolvePromise(code === 1 ? [] : undefined);
      resolvePromise(output.split("\n").filter(Boolean));
    });
  });
}

// Fallback enumeration when ripgrep is unavailable; mirrors the official
// example's walk (skips .git and node_modules, nothing gitignore-aware).
async function* walk(root, relativeDir, signal) {
  for (const entry of await readdir(root)) {
    if (signal.aborted) throw new Error("aborted");
    if (entry === ".git" || entry === "node_modules") continue;
    const path = join(root, entry);
    const relativePath = relativeDir ? join(relativeDir, entry) : entry;
    let entryStat;
    try { entryStat = await stat(path); } catch { continue; }
    if (entryStat.isDirectory()) yield* walk(path, relativePath, signal);
    else yield relativePath;
  }
}

async function candidateFiles(root, extraIgnores, signal) {
  const listed = await listFiles(root, extraIgnores, signal);
  if (listed) return listed;
  const matchesIgnore = relativePath => extraIgnores.some(pattern => matchesToolGlob(relativePath, pattern));
  const collected = [];
  for await (const relativePath of walk(root, "", signal)) {
    if (!matchesIgnore(relativePath)) collected.push(relativePath);
  }
  return collected;
}

function matchesToolGlob(relativePath, pattern) {
  if (pattern.includes("/")) return matchesGlob(relativePath, pattern) || matchesGlob(relativePath, `**/${pattern}`);
  return matchesGlob(basename(relativePath), pattern);
}

function lineMatcher({ pattern, literal, ignoreCase }) {
  if (literal) {
    const needle = ignoreCase ? pattern.toLowerCase() : pattern;
    return line => (ignoreCase ? line.toLowerCase() : line).includes(needle);
  }
  const regex = new RegExp(pattern, ignoreCase ? "i" : undefined);
  return line => regex.test(line);
}

async function grep(params, { signal }) {
  const root = resolve(cwd, params.path ?? ".");
  const rootIsDirectory = (await stat(root)).isDirectory();
  const matcher = lineMatcher(params);
  const contextLines = params.context > 0 ? params.context : 0;
  const limit = Math.max(1, params.limit ?? GREP_DEFAULT_LIMIT);
  const outputLines = [];
  const details = {};
  let matchCount = 0;
  let linesTruncated = false;
  const files = rootIsDirectory ? await candidateFiles(root, [], signal) : [basename(root)];
  const fileRoot = rootIsDirectory ? root : resolve(root, "..");
  for (const relativePath of files) {
    if (matchCount >= limit) break;
    if (params.glob && !matchesToolGlob(relativePath, params.glob)) continue;
    let content;
    try { content = await readFile(join(fileRoot, relativePath), "utf8"); } catch { continue; }
    if (content.includes("\0")) continue;
    const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    for (let index = 0; index < lines.length && matchCount < limit; index++) {
      if (signal.aborted) throw new Error("aborted");
      if (!matcher(lines[index] ?? "")) continue;
      matchCount++;
      const start = Math.max(0, index - contextLines);
      const end = Math.min(lines.length - 1, index + contextLines);
      for (let at = start; at <= end; at++) {
        const { text, wasTruncated } = truncateLine((lines[at] ?? "").replace(/\r/g, ""));
        if (wasTruncated) linesTruncated = true;
        const separator = at === index ? ":" : "-";
        outputLines.push(`${relativePath}${separator}${at + 1}${separator} ${text}`);
      }
    }
  }
  if (matchCount === 0) return { text: "No matches found" };
  const truncation = truncateHead(outputLines.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
  const notices = [];
  let output = truncation.content;
  if (matchCount >= limit) { details.matchLimitReached = limit; notices.push(`${limit} matches limit reached`); }
  if (linesTruncated) { details.linesTruncated = true; notices.push("long lines truncated"); }
  if (truncation.truncated) { details.truncation = truncation; notices.push("output size limit reached"); }
  if (notices.length) output += `\n\n[${notices.join(". ")}]`;
  return { text: output, details: Object.keys(details).length ? details : undefined };
}

async function findGlob({ pattern, cwd: dir, ignore, limit }, { signal }) {
  const root = resolve(cwd, dir ?? ".");
  const results = [];
  for (const relativePath of await candidateFiles(root, ignore ?? [], signal)) {
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
