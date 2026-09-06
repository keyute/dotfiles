import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { main, quoteArg, safeEnvironment, terminateProcessGroup } from "./sandbox-runner.mjs";

const lease = () => ({
  socket: { destroy() {}, end(callback) { callback?.(); }, write() {} },
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
