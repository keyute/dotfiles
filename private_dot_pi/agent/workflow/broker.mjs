import { createConnection, createServer } from "node:net";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Policy, workerTools, publicToolName } from "./policy.mjs";

const line = value => `${JSON.stringify(value)}\n`;
const equal = (a, b) => typeof a === "string" && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function startBroker(config, cwd, review, transport = {}) {
  const control = mkdtempSync(join(tmpdir(), "pi-control-"));
  const scratch = mkdtempSync(join(tmpdir(), "pi-work-"));
  const socketPath = join(control, "policy.sock");
  const token = randomBytes(32).toString("hex");
  let policy;
  try { policy = new Policy(config, cwd, scratch, control); }
  catch (error) {
    rmSync(control, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
    throw error;
  }
  const leases = new Set();
  const children = new Set();
  const terminated = new Set();
  const connections = new Set();
  let closed = false;
  let reviewQueue = Promise.resolve();

  // A tool authorization mints a single-use lease ticket bound to the current
  // epoch, role, and tool, so a mode transition between authorization and
  // process lease cannot run an already-approved call under a new policy.
  const tickets = new Map();
  function grant(request) {
    if (request.action !== "authorize") return { ok: true };
    const ticket = randomBytes(16).toString("hex");
    if (tickets.size >= 256) tickets.delete(tickets.keys().next().value);
    tickets.set(ticket, { epoch: policy.epoch, role: request.role, tool: request.tool });
    return { ok: true, ticket };
  }

  async function authorize(request) {
    const epoch = policy.epoch;
    const verdict = request.action === "mcp"
      ? policy.inspectMcp(request.role, request.server, request.tool, request.args)
      : policy.inspect(request.role, request.tool, request.args);
    if (verdict === "allow") return grant(request);
    const { role, tool, server, args } = request;
    const pending = reviewQueue.then(() => review({ role, tool, server, args, mode: policy.mode, approval: policy.approval }));
    reviewQueue = pending.catch(() => {});
    const allowed = await pending;
    if (closed || policy.transitioning || epoch !== policy.epoch) throw new Error("Policy changed while approval was pending");
    return allowed === true ? grant(request) : { ok: false, error: "Action not approved" };
  }

  const server = (transport.createServer ?? createServer)(socket => {
    connections.add(socket);
    let data = "";
    let handled = false;
    socket.on("error", () => {});
    socket.on("close", () => {
      connections.delete(socket);
      if (terminated.has(socket)) { leases.delete(socket); children.delete(socket); terminated.delete(socket); }
      else if (leases.has(socket) && !closed) { policy.transitioning = true; policy.epoch++; }
    });
    socket.on("data", chunk => {
      data += chunk;
      if (data.length > 128 * 1024) return socket.destroy();
      if (!data.includes("\n")) return;
      if (handled) {
        try {
          const proof = JSON.parse(data.slice(0, data.indexOf("\n")));
          data = "";
          if (proof.action !== "terminated" || !leases.has(socket)) return socket.destroy();
          terminated.add(socket);
        } catch { socket.destroy(); }
        return;
      }
      handled = true;
      void (async () => {
        const request = JSON.parse(data.slice(0, data.indexOf("\n")));
        data = "";
        if (!equal(request.token, token) || closed) throw new Error("Unavailable policy broker");
        policy.role(request.role);
        if (request.action === "child") {
          // The epoch travels through the launching parent's environment, so a
          // child spawned before a mode/approval change cannot connect after it
          // and inherit the newer, possibly wider policy.
          if (request.role === "root" || children.size >= 20 || policy.transitioning || request.epoch !== policy.epoch) throw new Error("Child capacity unavailable");
          children.add(socket);
          leases.add(socket);
          return socket.write(line({ ok: true }));
        }
        if (request.action === "state") return socket.end(line({ ok: true, mode: policy.mode, readonly: policy.readonly(request.role), epoch: policy.epoch }));
        if (request.action === "authorize" || request.action === "mcp") return socket.end(line(await authorize(request)));
        if (request.action !== "lease" || policy.transitioning) throw new Error("Invalid process lease");
        // NODE_USE_ENV_PROXY: Node's built-in fetch ignores the HTTP(S)_PROXY the
        // sandbox injects unless told to; MCP servers are Node processes.
        const env = { TMPDIR: scratch, PI_CODING_AGENT_DIR: config.agentDir, NODE_USE_ENV_PROXY: "1" };
        let command;
        let args;
        if (request.kind === "tool") {
          const issued = tickets.get(request.ticket);
          if (typeof request.ticket === "string") tickets.delete(request.ticket);
          if (!issued || issued.epoch !== policy.epoch || issued.role !== request.role || issued.tool !== request.name) throw new Error("Tool process denied");
          if (!workerTools.includes(request.name) || !policy.role(request.role).tools.includes(publicToolName(request.name))) throw new Error("Tool process denied");
        } else if (request.kind === "server") {
          if (!policy.role(request.role).tools.includes("mcp")) throw new Error("MCP process denied");
          const connection = config.mcp[request.name]?.connection;
          if (!connection || connection.type !== "stdio") throw new Error("Unconfigured server process");
          command = connection.command;
          args = connection.args;
          Object.assign(env, connection.env);
          if (request.name === "serena") {
            const serenaHome = join(scratch, "serena");
            mkdirSync(serenaHome, { recursive: true });
            writeFileSync(join(serenaHome, "serena_config.yml"), JSON.stringify({
              project_serena_folder_location: join(serenaHome, "projects", "$projectFolderName"),
              fixed_tools: config.mcp.serena.policy.allowed_tools,
              gui_log_window: false, web_dashboard: false,
            }));
            env.SERENA_HOME = serenaHome;
            // uvx materializes tool/python environments under ~/.local/share/uv,
            // which neighbors denied credentials; keep those in session scratch
            // (the shared uv cache stays warm, so this is mostly re-linking).
            env.UV_TOOL_DIR = join(scratch, "uv-tools");
            env.UV_PYTHON_INSTALL_DIR = join(scratch, "uv-python");
          }
        } else throw new Error("Unknown process kind");
        leases.add(socket);
        socket.write(line({ ok: true, profile: policy.profile(request.role), cwd: policy.cwd, env, command, args }));
      // The message is the model's only signal for why a call was refused
      // (plan mode vs. protected path vs. capacity); every thrown text here is
      // authored in this module or policy.mjs.
      })().catch(error => socket.end(line({ ok: false, error: error?.message || "Managed policy denied this request" })));
    });
  });
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
  } catch (error) {
    rmSync(control, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
    throw error;
  }
  chmodSync(socketPath, 0o600);

  async function stopProcesses() {
    const pending = [...leases].map(socket => new Promise((resolve, reject) => {
      if (socket.destroyed) return reject(new Error("Process lost without terminal proof; restart the workflow after checking orphan processes"));
      socket.once("close", () => {
        if (leases.has(socket)) reject(new Error("Process lost without terminal proof"));
        else resolve();
      });
      socket.write(line({ action: "stop" }));
    }));
    let timer;
    try {
      await Promise.race([Promise.all(pending), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Sandbox processes have not stopped; workflow remains blocked")), 10_000);
      })]);
    } finally { clearTimeout(timer); }
  }

  return {
    policy,
    env: { PI_WORKFLOW_SOCKET: socketPath, PI_WORKFLOW_TOKEN: token },
    async setMode(mode) {
      if (!["plan", "execute"].includes(mode)) throw new Error("Unknown workflow mode");
      policy.transitioning = true;
      policy.epoch++;
      await stopProcesses();
      policy.mode = mode;
      policy.transitioning = false;
    },
    async close() {
      closed = true;
      policy.transitioning = true;
      let stopped = false;
      try { await stopProcesses(); stopped = true; }
      finally {
        for (const socket of connections) socket.destroy();
        await new Promise(resolve => server.close(resolve));
        rmSync(control, { recursive: true, force: true });
        // Retain scratch if a process disappeared without proving termination.
        if (stopped) rmSync(scratch, { recursive: true, force: true });
      }
    },
  };
}

export function acquireChild(env, role, onStop, connect = createConnection) {
  return new Promise((resolve, reject) => {
    const socket = connect(env.PI_WORKFLOW_SOCKET);
    let buffer = "";
    let accepted = false;
    let released = false;
    const timer = setTimeout(() => { reject(new Error("Child policy handshake timed out")); socket.destroy(); }, 10_000);
    const release = () => { if (released) return; released = true; clearTimeout(timer); socket.end(line({ action: "terminated" })); };
    socket.on("error", error => { clearTimeout(timer); if (!accepted) reject(error); });
    socket.on("close", () => {
      clearTimeout(timer);
      if (!accepted) reject(new Error("Child policy disconnected"));
      if (!released) onStop(release);
    });
    socket.on("connect", () => socket.write(line({ action: "child", role, token: env.PI_WORKFLOW_TOKEN, epoch: Number(env.PI_WORKFLOW_EPOCH) })));
    socket.on("data", chunk => {
      buffer += chunk;
      if (buffer.length > 8192) return socket.destroy();
      while (buffer.includes("\n")) {
        const end = buffer.indexOf("\n");
        const raw = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          const message = JSON.parse(raw);
          if (!accepted) {
            if (!message.ok) { reject(new Error("Child policy/capacity denied")); socket.destroy(); return; }
            accepted = true;
            clearTimeout(timer);
            resolve(release);
          } else if (message.action === "stop") onStop(release);
          else socket.destroy();
        } catch { socket.destroy(); }
      }
    });
  });
}

export function requestBroker(env, role, request, connect = createConnection) {
  return new Promise((resolve, reject) => {
    if (!env.PI_WORKFLOW_SOCKET || !env.PI_WORKFLOW_TOKEN) return reject(new Error("Parent policy unavailable"));
    const socket = connect(env.PI_WORKFLOW_SOCKET);
    let buffer = "";
    let settled = false;
    // Approvals may wait on a human; everything else is answered by the broker itself.
    const approval = ["authorize", "mcp"].includes(request.action);
    const timer = setTimeout(() => socket.destroy(new Error(approval ? "Approval timed out waiting for the user" : "Policy request timed out")), approval ? 600_000 : 120_000);
    const fail = error => { clearTimeout(timer); if (!settled) { settled = true; reject(error); } };
    socket.on("error", fail);
    socket.on("close", () => fail(new Error("Parent policy disconnected")));
    socket.on("connect", () => socket.write(line({ ...request, role, token: env.PI_WORKFLOW_TOKEN })));
    socket.on("data", chunk => {
      buffer += chunk;
      if (buffer.length > 128 * 1024) return socket.destroy(new Error("Oversized policy response"));
      if (!buffer.includes("\n")) return;
      try {
        const result = JSON.parse(buffer.slice(0, buffer.indexOf("\n")));
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (result.ok) resolve(result);
        else reject(new Error(result.error || "Policy denied"));
      } catch (error) { fail(error); socket.destroy(); }
    });
  });
}
