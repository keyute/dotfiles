import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readLines, sendLine } from "./lines.mjs";

const RESPONSE_LIMIT = 1024 * 1024;
const RESPONSE_TIMEOUT_MS = 10_000;
const SAFE_ENVIRONMENT = [
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TERM",
  "USER",
  "LOGNAME",
  "SHELL",
  "TZ",
];

export const quoteArg = (value) => `'${String(value).replaceAll("'", "'\"'\"'")}'`;

export const safeEnvironment = (approved = {}) => {
  const environment = {};
  for (const key of SAFE_ENVIRONMENT) {
    if (typeof process.env[key] === "string") environment[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(approved)) {
    if (!key.startsWith("PI_WORKFLOW_") && typeof value === "string") {
      environment[key] = value;
    }
  }
  return environment;
};

// An unsandboxed lease and the footer's subprocesses run with the host's own
// environment; the broker socket, token, epoch and ticket the root workflow
// exported into process.env must not reach them.
export const hostEnvironment = (environment = process.env) =>
  Object.fromEntries(Object.entries(environment).filter(([key]) => !key.startsWith("PI_WORKFLOW_")));

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const fail = (exitCode = 1) => Object.assign(new Error("sandbox runner failed"), { exitCode });

const isProcessGone = (error) => error && error.code === "ESRCH";

export const terminateProcessGroup = async (
  child,
  { killProcess = process.kill, setTimer = setTimeout, clearTimer = clearTimeout } = {},
) => {
  if (!child?.pid) return;
  try {
    killProcess(-child.pid, "SIGTERM");
  } catch (error) {
    if (isProcessGone(error)) return;
    throw error;
  }
  let timer;
  try {
    await new Promise((resolve) => {
      timer = setTimer(resolve, 1_000);
      timer?.unref?.();
    });
  } finally {
    if (timer !== undefined) clearTimer(timer);
  }
  try {
    killProcess(-child.pid, "SIGKILL");
  } catch (error) {
    if (!isProcessGone(error)) throw error;
  }
};

const beginTermination = (state, terminationDependencies) => {
  if (state.child && !state.groupTermination) {
    state.groupTermination = terminateProcessGroup(state.child, terminationDependencies).catch((error) => {
      state.terminationError = error;
    });
  }
};

const parseInvocation = (argv) => {
  const [kind, name] = argv;
  if (!(["tool", "server"].includes(kind) && typeof name === "string" && name.length > 0)) {
    throw fail();
  }
  return { kind, name };
};

export const validateLease = (value, kind) => {
  if (
    !isRecord(value) ||
    value.ok !== true ||
    !(isRecord(value.profile) || (kind === "tool" && value.profile === null)) ||
    !isAbsolute(value.cwd) ||
    !isRecord(value.env) ||
    !Object.values(value.env).every((envValue) => typeof envValue === "string")
  ) {
    throw fail();
  }
  if (kind === "server") {
    if (
      typeof value.command !== "string" ||
      value.command.length === 0 ||
      !Array.isArray(value.args) ||
      !value.args.every((arg) => typeof arg === "string")
    ) {
      throw fail();
    }
  }
  return value;
};

const requestLease = (
  { socketPath, token, role, kind, name, ticket },
  terminationDependencies,
) =>
  new Promise((resolve, reject) => {
    let settled = false;
    let receivedLease = false;
    const socket = createConnection(socketPath);
    const state = {
      terminal: false,
      child: undefined,
      groupTermination: undefined,
      terminationError: undefined,
    };

    const rejectOnce = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(fail());
      }
    };
    const timeout = setTimeout(() => {
      socket.destroy();
      rejectOnce();
    }, RESPONSE_TIMEOUT_MS);
    const resolveOnce = (response) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve({ socket, state, response });
      }
    };
    const markTerminal = () => {
      state.terminal = true;
      beginTermination(state, terminationDependencies);
    };

    socket.once("connect", () => {
      sendLine(socket, { action: "lease", token, role, kind, name, ticket });
    });
    readLines(socket, (message) => {
      if (!receivedLease) {
        receivedLease = true;
        try {
          resolveOnce(validateLease(message, kind));
        } catch {
          socket.destroy();
          rejectOnce();
        }
      } else if (isRecord(message) && message.action === "stop") {
        markTerminal();
      } else {
        socket.destroy();
        markTerminal();
      }
    }, { limit: RESPONSE_LIMIT, onError: () => { socket.destroy(); rejectOnce(); } });
    socket.on("error", rejectOnce);
    socket.on("close", () => {
      markTerminal();
      if (!receivedLease) rejectOnce();
    });
  });

const waitForClose = (child) =>
  new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });

const acknowledgeTermination = (socket) =>
  new Promise((resolve, reject) => {
    // end()'s callback never carries the error; a failed proof must reject,
    // or the runner reports success while the broker saw a lease close unproven.
    socket.once("error", reject);
    try {
      sendLine(socket, { action: "terminated" });
      socket.end(() => resolve());
    } catch (error) {
      reject(error);
    }
  });

const commandForLease = (lease, kind, name) => {
  if (kind === "server") {
    return `${quoteArg(lease.command)} ${lease.args.map(quoteArg).join(" ")}`;
  }
  const worker = join(dirname(fileURLToPath(import.meta.url)), "ops-worker.mjs");
  return `${quoteArg(process.execPath)} ${quoteArg(worker)} ${quoteArg(name)}`;
};

export const main = async (argv = process.argv.slice(2), dependencies = {}) => {
  const { kind, name } = parseInvocation(argv);
  const environment = dependencies.environment || process.env;
  const socketPath = environment.PI_WORKFLOW_SOCKET;
  const token = environment.PI_WORKFLOW_TOKEN;
  if (!(socketPath && token)) throw fail();

  const terminationDependencies = {
    killProcess: dependencies.killProcess,
    setTimer: dependencies.setTimer,
    clearTimer: dependencies.clearTimer,
  };
  const leaseRequest = dependencies.requestLease || requestLease;
  const { socket, state, response } = await leaseRequest({
    socketPath,
    token,
    role: environment.PI_WORKFLOW_ROLE || "root",
    kind,
    name,
    ticket: environment.PI_WORKFLOW_TICKET,
  }, terminationDependencies);
  let sandboxManager;
  let child;
  const signals = dependencies.signals || process;
  const signalHandler = () => {
    state.terminal = true;
    beginTermination(state, terminationDependencies);
  };
  signals.once("SIGINT", signalHandler);
  signals.once("SIGTERM", signalHandler);
  try {
    const sandboxed = response.profile !== null;
    let command = commandForLease(response, kind, name);
    if (sandboxed) {
      try {
        if (dependencies.sandboxManager) sandboxManager = dependencies.sandboxManager;
        else ({ SandboxManager: sandboxManager } = await import("@anthropic-ai/sandbox-runtime"));
        await sandboxManager.initialize(response.profile);
      } catch (error) {
        throw Object.assign(error, { exitCode: 1 });
      }
      if (state.terminal) throw fail();

      try {
        command = await sandboxManager.wrapWithSandbox(command, "bash");
      } catch (error) {
        throw Object.assign(error, { exitCode: 1 });
      }
    }
    if (state.terminal) throw fail();

    const spawnChild = dependencies.spawnChild || spawn;
    child = spawnChild("bash", ["-c", command], {
      cwd: response.cwd,
      detached: true,
      env: sandboxed ? safeEnvironment(response.env) : hostEnvironment(),
      stdio: "inherit",
    });
    state.child = child;
    const close = await (dependencies.waitForClose || waitForClose)(child);
    if (state.terminal || close.code !== 0) throw fail(close.code ?? 1);
  } finally {
    signals.removeListener("SIGINT", signalHandler);
    signals.removeListener("SIGTERM", signalHandler);
    beginTermination(state, terminationDependencies);
    if (state.groupTermination) await state.groupTermination;
    if (state.terminationError) {
      socket.destroy();
      throw fail();
    }
    try {
      if (sandboxManager) await sandboxManager.reset();
      await acknowledgeTermination(socket);
    } catch (error) {
      socket.destroy();
      throw Object.assign(error, { exitCode: 1 });
    }
  }
};

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = Number.isInteger(error.exitCode) && error.exitCode > 0 ? error.exitCode : 1;
  });
}
