import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { hostEnvironment, main, quoteArg, safeEnvironment, terminateProcessGroup, validateLease } from "./sandbox-runner.mjs";

const lease = () => ({
  socket: { destroy() {}, end(callback) { callback?.(); }, write() {}, once() {} },
  state: { terminal: false, child: undefined, groupTermination: undefined, terminationError: undefined },
  response: { profile: {}, cwd: process.cwd(), env: {} },
});

const immediateTimer = (callback) => {
  queueMicrotask(callback);
  return { unref() {} };
};

test("quoteArg safely quotes POSIX shell metacharacters", () => {
  assert.equal(quoteArg("plain"), "'plain'");
  assert.equal(quoteArg("space and $dollar; rm -rf /"), "'space and $dollar; rm -rf /'");
  assert.equal(quoteArg("a'b"), "'a'\"'\"'b'");
  assert.equal(quoteArg(""), "''");
});

test("safeEnvironment keeps only approved inherited values and broker server values", () => {
  const previousPath = process.env.PATH;
  const previousSecret = process.env.OPENAI_API_KEY;
  const previousWorkflow = process.env.PI_WORKFLOW_TOKEN;
  process.env.PATH = "/safe/bin";
  process.env.OPENAI_API_KEY = "must-not-leak";
  process.env.PI_WORKFLOW_TOKEN = "must-not-leak";
  try {
    const environment = safeEnvironment({
      SERVER_TOKEN: "broker-approved",
      PI_WORKFLOW_SOCKET: "/forbidden.sock",
      INVALID: 42,
    });
    assert.equal(environment.PATH, "/safe/bin");
    assert.equal(environment.SERVER_TOKEN, "broker-approved");
    assert.equal(environment.OPENAI_API_KEY, undefined);
    assert.equal(environment.PI_WORKFLOW_TOKEN, undefined);
    assert.equal(environment.PI_WORKFLOW_SOCKET, undefined);
    assert.equal(environment.INVALID, undefined);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousSecret === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousSecret;
    if (previousWorkflow === undefined) delete process.env.PI_WORKFLOW_TOKEN;
    else process.env.PI_WORKFLOW_TOKEN = previousWorkflow;
  }
});

test("a null profile skips the sandbox and strips workflow variables from the host environment", async () => {
  assert.deepEqual(hostEnvironment({ PATH: "/bin", PI_WORKFLOW_TOKEN: "secret", PI_WORKFLOW_TICKET: "t" }), { PATH: "/bin" });
  // Only a tool lease may run unsandboxed; an MCP server lease with no profile is malformed.
  const unsandboxedLease = { ok: true, profile: null, cwd: process.cwd(), env: {} };
  assert.equal(validateLease(unsandboxedLease, "tool"), unsandboxedLease);
  assert.throws(() => validateLease(unsandboxedLease, "server"));
  const activeLease = lease();
  activeLease.response.profile = null;
  let spawnOptions;
  let spawnArgs;
  await main(["tool", "bash"], {
    environment: { PI_WORKFLOW_SOCKET: "/broker.sock", PI_WORKFLOW_TOKEN: "test-token", PATH: "/fixture/bin" },
    requestLease: async () => activeLease,
    sandboxManager: { async initialize() { throw new Error("sandbox must not start"); } },
    spawnChild(command, args, options) {
      spawnArgs = [command, ...args];
      spawnOptions = options;
      return { pid: 45 };
    },
    waitForClose: async () => ({ code: 0, signal: null }),
    killProcess() {},
    setTimer: immediateTimer,
    clearTimer() {},
    signals: new EventEmitter(),
  });
  assert.equal(spawnArgs[0], "bash");
  assert.match(spawnArgs[2], /ops-worker\.mjs' 'bash'$/);
  assert.equal(spawnOptions.detached, true);
  assert.equal(spawnOptions.env.PI_WORKFLOW_TOKEN, undefined);
  assert.equal(spawnOptions.env.PATH, "/fixture/bin");
});

test("a stop during sandbox initialization prevents spawning", async () => {
  const activeLease = lease();
  let spawned = false;
  let reset = false;
  await assert.rejects(
    main(["tool", "read"], {
      environment: { PI_WORKFLOW_SOCKET: "/broker.sock", PI_WORKFLOW_TOKEN: "test-token" },
      requestLease: async () => activeLease,
      sandboxManager: {
        async initialize() {
          activeLease.state.terminal = true;
        },
        async reset() {
          reset = true;
        },
      },
      spawnChild() {
        spawned = true;
      },
      signals: new EventEmitter(),
    }),
  );
  assert.equal(spawned, false);
  assert.equal(reset, true);
});

test("a rejected lease never reaches the sandbox or child process", async () => {
  let spawned = false;
  await assert.rejects(
    main(["tool", "read"], {
      environment: { PI_WORKFLOW_SOCKET: "/broker.sock", PI_WORKFLOW_TOKEN: "test-token" },
      requestLease: async () => {
        throw new Error("rejected");
      },
      spawnChild() {
        spawned = true;
      },
    }),
  );
  assert.equal(spawned, false);
});

test("an ignored SIGTERM escalates to SIGKILL for the whole process group", async () => {
  const signals = [];
  await terminateProcessGroup(
    { pid: 42 },
    {
      killProcess: (...args) => signals.push(args),
      setTimer: immediateTimer,
      clearTimer() {},
    },
  );
  assert.deepEqual(signals, [
    [-42, "SIGTERM"],
    [-42, "SIGKILL"],
  ]);
});

test("only an already-gone process group is accepted as a kill failure", async () => {
  await assert.doesNotReject(
    terminateProcessGroup(
      { pid: 42 },
      {
        killProcess: () => {
          throw Object.assign(new Error("gone"), { code: "ESRCH" });
        },
      },
    ),
  );
  await assert.rejects(
    terminateProcessGroup(
      { pid: 42 },
      {
        killProcess: () => {
          throw Object.assign(new Error("not permitted"), { code: "EPERM" });
        },
      },
    ),
  );
});

test("a signal keeps the lease open until child closure and group termination", async () => {
  const activeLease = lease();
  const socketCalls = [];
  activeLease.socket = {
    destroy() {
      socketCalls.push("destroy");
    },
    end(callback) {
      socketCalls.push("end");
      callback?.();
    },
    write() {
      socketCalls.push("write");
    },
    once() {},
  };
  const signals = new EventEmitter();
  const child = { pid: 44 };
  let spawned;
  const didSpawn = new Promise((resolve) => {
    spawned = resolve;
  });
  let resolveClose;
  const close = new Promise((resolve) => {
    resolveClose = resolve;
  });
  const run = main(["tool", "read"], {
    environment: { PI_WORKFLOW_SOCKET: "/broker.sock", PI_WORKFLOW_TOKEN: "test-token" },
    requestLease: async () => activeLease,
    sandboxManager: {
      async initialize() {},
      async wrapWithSandbox() {
        return "ignored";
      },
      async reset() {},
    },
    spawnChild() {
      spawned();
      return child;
    },
    waitForClose: async () => close,
    killProcess() {},
    setTimer: immediateTimer,
    clearTimer() {},
    signals,
  });
  await didSpawn;
  signals.emit("SIGTERM");
  assert.deepEqual(socketCalls, []);
  resolveClose({ code: null, signal: "SIGTERM" });
  await assert.rejects(run);
  assert.deepEqual(socketCalls, ["write", "end"]);
});

test("a nonzero child exit status becomes the runner exit status", async () => {
  const activeLease = lease();
  const child = { pid: 43 };
  await assert.rejects(
    main(["tool", "read"], {
      environment: { PI_WORKFLOW_SOCKET: "/broker.sock", PI_WORKFLOW_TOKEN: "test-token" },
      requestLease: async () => activeLease,
      sandboxManager: {
        async initialize() {},
        async wrapWithSandbox() {
          return "ignored";
        },
        async reset() {},
      },
      spawnChild() {
        return child;
      },
      waitForClose: async () => ({ code: 7, signal: null }),
      killProcess() {},
      setTimer: immediateTimer,
      clearTimer() {},
      signals: new EventEmitter(),
    }),
    (error) => error.exitCode === 7,
  );
});

const runWorkerOps = (tool, requests) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("./ops-worker.mjs", import.meta.url)), tool], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    // Closing stdin aborts in-flight operations, so hold the pipe open until
    // every request has produced its terminal frame.
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const terminal = output.split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((frame) => "ok" in frame);
      if (terminal.length >= requests.length) child.stdin.end();
    });
    child.stderr.resume();
    child.on("close", (code) => resolve({ code, frames: output.split("\n").filter(Boolean).map((line) => JSON.parse(line)) }));
    child.stdin.write(requests.map((request) => `${JSON.stringify(request)}\n`).join(""));
  });

test("ops worker streams bash execution and reports the exit code", async () => {
  const { code, frames } = await runWorkerOps("bash", [{ id: "op0", op: "exec", params: { command: "printf worker-bash-ok; exit 3" } }]);
  assert.equal(code, 0);
  const streamed = frames.filter((frame) => frame.chunk).map((frame) => Buffer.from(frame.chunk, "base64").toString()).join("");
  assert.ok(streamed.includes("worker-bash-ok"));
  assert.deepEqual(frames.at(-1), { id: "op0", ok: true, value: { exitCode: 3 } });
});

test("ops worker ends a command's backgrounded descendants before reporting it done", async () => {
  const { frames } = await runWorkerOps("bash", [{ id: "op0", op: "exec", params: { command: "sleep 30 </dev/null >/dev/null 2>&1 & printf %s $!" } }]);
  assert.deepEqual(frames.at(-1), { id: "op0", ok: true, value: { exitCode: 0 } });
  const pid = Number(frames.filter((frame) => frame.chunk).map((frame) => Buffer.from(frame.chunk, "base64").toString()).join(""));
  assert.ok(pid > 0);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("ops worker kills a TERM-ignoring descendant at once when it is itself terminated, even after the shell exited", async () => {
  const worker = spawn(process.execPath, [fileURLToPath(new URL("./ops-worker.mjs", import.meta.url)), "bash"], { stdio: ["pipe", "pipe", "pipe"] });
  worker.stderr.resume();
  const closed = new Promise((resolve) => worker.on("close", resolve));
  const pid = await new Promise((resolve) => {
    worker.stdout.once("data", (chunk) => resolve(Number(Buffer.from(JSON.parse(chunk.toString().split("\n")[0]).chunk, "base64").toString())));
    worker.stdin.write(`${JSON.stringify({ id: "op0", op: "exec", params: { command: "trap '' TERM; (while :; do sleep 1; done) </dev/null >/dev/null 2>&1 & printf %s $!" } })}\n`);
  });
  assert.ok(pid > 0);
  // Let the shell exit first: the worker is now inside its group-termination wait.
  await new Promise((resolve) => setTimeout(resolve, 150));
  worker.kill("SIGTERM");
  // The abort's own TERM→KILL takes a full second; the runner would have killed the worker by then.
  const deadline = Date.now() + 500;
  let gone = false;
  while (!gone && Date.now() < deadline) {
    try { process.kill(pid, 0); await new Promise((resolve) => setTimeout(resolve, 20)); } catch (error) { gone = error.code === "ESRCH"; }
  }
  worker.stdin.end();
  await closed;
  assert.ok(gone);
});

test("ops worker refuses operations outside the leased tool's set", async () => {
  const { frames } = await runWorkerOps("read", [{ id: "op0", op: "exec", params: { command: "true" } }]);
  assert.equal(frames.at(-1).ok, false);
  assert.match(frames.at(-1).error.message, /not permitted/);
});
