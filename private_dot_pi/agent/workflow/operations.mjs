import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readLines, sendLine } from "./lines.mjs";

const runnerPath = fileURLToPath(new URL("./sandbox-runner.mjs", import.meta.url));
// Runaway-worker backstop (a `yes` under workspace_bash streams forever in
// small frames): never an ordinary-file limit, the SDK truncates after reading.
const OUTPUT_LIMIT = 256 * 1024 * 1024;

// One sandboxed worker per tool invocation: the SDK tool runs in-process with
// the real harness context; only its primitive operations cross into SRT.
export function startToolWorker(name, { cwd, env, ticket, signal, spawnProcess }) {
  const child = spawnProcess ? spawnProcess() : spawn(process.execPath, [runnerPath, "tool", name], {
    cwd,
    env: { ...process.env, ...env, ...(ticket ? { PI_WORKFLOW_TICKET: ticket } : {}) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let nextId = 0;
  let received = 0;
  let errorOutput = "";
  let closed = false;
  const kill = () => child.kill("SIGTERM");
  const failAll = message => {
    for (const entry of pending.values()) entry.reject(new Error(message));
    pending.clear();
  };
  signal?.addEventListener("abort", kill, { once: true });
  if (signal?.aborted) kill();
  child.stderr.on("data", chunk => { errorOutput = (errorOutput + chunk).slice(-4096); });
  child.stdin.on("error", () => {});
  child.on("error", error => { closed = true; failAll(error.message); });
  child.on("close", () => {
    closed = true;
    signal?.removeEventListener("abort", kill);
    failAll(`Sandboxed ${name} failed${errorOutput ? `: ${errorOutput}` : ""}`);
  });
  // Worker streams 4 MiB file slices as base64 (~5.6MiB on the wire); the
  // per-line limit must clear that.
  readLines(child.stdout, message => {
    const entry = pending.get(message.id);
    if (!entry) return;
    if (typeof message.chunk === "string") {
      if ((received += message.chunk.length) > OUTPUT_LIMIT) return kill();
      entry.onChunk?.(Buffer.from(message.chunk, "base64"));
    }
    else {
      pending.delete(message.id);
      if (message.ok) entry.resolve(message.value);
      else entry.reject(Object.assign(new Error(message.error?.message || "Sandbox operation failed"), message.error?.code ? { code: message.error.code } : {}));
    }
  }, { limit: 8 * 1024 * 1024, onError: kill });
  return {
    call(op, params, { signal: opSignal, onChunk } = {}) {
      return new Promise((resolve, reject) => {
        if (closed) return reject(new Error(`Sandboxed ${name} unavailable`));
        const id = `op${nextId++}`;
        const abort = () => sendLine(child.stdin, { op: "abort", target: id });
        pending.set(id, {
          onChunk,
          resolve: value => { opSignal?.removeEventListener("abort", abort); resolve(value); },
          reject: error => { opSignal?.removeEventListener("abort", abort); reject(error); },
        });
        opSignal?.addEventListener("abort", abort, { once: true });
        sendLine(child.stdin, { id, op, params });
        if (opSignal?.aborted) abort();
      });
    },
    close() {
      return new Promise(resolve => {
        if (closed) return resolve();
        child.once("close", resolve);
        child.stdin.end();
        setTimeout(kill, 3000).unref();
      });
    },
  };
}

export function workerOperations(client) {
  const readFile = async path => {
    const parts = [];
    await client.call("readFile", { path }, { onChunk: part => parts.push(part) });
    return Buffer.concat(parts);
  };
  const writeFile = (path, content) => client.call("writeFile", { path, data: content });
  const exists = path => client.call("exists", { path });
  return {
    bash: { exec: (command, cwd, { onData, signal, timeout }) => client.call("exec", { command, cwd, timeout }, { signal, onChunk: onData }) },
    read: {
      readFile,
      access: path => client.call("access", { path, mode: "r" }).then(() => {}),
      detectImageMimeType: path => client.call("detectImage", { path }),
    },
    edit: { readFile, writeFile, access: path => client.call("access", { path, mode: "rw" }).then(() => {}) },
    write: { writeFile, mkdir: path => client.call("mkdir", { path }) },
    find: { exists, glob: (pattern, cwd, { ignore, limit }) => client.call("findGlob", { pattern, cwd, ignore, limit }) },
    ls: {
      exists,
      stat: async path => { const value = await client.call("stat", { path }); return { isDirectory: () => value.isDirectory }; },
      readdir: path => client.call("readdir", { path }),
    },
  };
}

// The SDK's GrepOperations seam does not cover its host-side ripgrep spawn, so
// grep search runs entirely inside the worker (same approach as the official
// Gondolin tool-routing example).
export async function executeSandboxGrep(client, params, signal) {
  const { text, details } = await client.call("grep", params, { signal });
  return { content: [{ type: "text", text }], details };
}
