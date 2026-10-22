import { createConnection } from "node:net";
import { isAbsolute } from "node:path";
import { sendLine } from "./lines.mjs";

// The footer's turn (docs/pi-design.md rule 4) reported to herdr as herdr's
// own pi integration: herdr gives full-lifecycle authority over a pi pane only
// to the `herdr:pi` source (docs/pi-coupling.md, herdr reporter). The wire is
// herdr's bundled pi extension v9's: one JSON line per connection, delivered
// on the first reply byte, retried once.
const source = "herdr:pi";
const read = get => { try { return get(); } catch { return undefined; } };

export function installHerdr(pi, env = process.env) {
  const { HERDR_ENV, HERDR_SOCKET_PATH: socketPath, HERDR_PANE_ID: paneId } = env;
  if (HERDR_ENV !== "1" || !socketPath || !paneId) return undefined;
  // herdr drops a seq not above this source's last; a reloaded extension seeds above its predecessor.
  let seq = Date.now() * 1000;
  let ref = {}, session, pending, sent, idle, draining = false, suspended = false, generation = 0;
  const attempt = (request, timeoutMs, current) => new Promise(resolve => {
    const socket = createConnection(socketPath);
    const finish = delivered => { clearTimeout(timer); socket.destroy(); resolve(delivered); };
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    socket.on("error", () => finish(false));
    socket.on("end", () => finish(false));
    socket.on("data", () => finish(true));
    socket.on("connect", () => current === generation ? sendLine(socket, request) : finish(false));
  });
  const send = async (method, params) => {
    const request = { id: `${source}:${Date.now()}:${Math.random().toString(36).slice(2)}`, method, params: { pane_id: paneId, source, agent: "pi", ...params, ...ref, seq: ++seq } };
    const current = generation;
    if (!(await attempt(request, 500, current)) && current === generation) await attempt(request, 1500, current);
  };
  // One queue, the session ref first (herdr re-anchors the pane on it), each
  // coalesced to its newest; seq is taken at send, so it follows send order.
  const drain = async () => {
    if (draining) return;
    draining = true;
    while (session || pending) {
      if (session) { const next = session; session = undefined; await send("pane.report_agent_session", next); }
      else { const next = pending; pending = undefined; await send("pane.report_agent", next); }
    }
    draining = false;
  };
  const anchor = (ctx, reason) => {
    if (suspended) return;
    const file = read(() => ctx.sessionManager.getSessionFile());
    const id = read(() => ctx.sessionManager.getSessionId());
    ref = typeof file === "string" && isAbsolute(file) ? { agent_session_path: file } : typeof id === "string" && id ? { agent_session_id: id } : {};
    if (!ref.agent_session_path && !ref.agent_session_id) return;
    session = { session_start_source: reason };
    void drain();
  };
  const queue = activity => {
    if (activity.state === sent?.state && activity.message === sent?.message) return;
    sent = pending = activity;
    void drain();
  };
  pi.on("agent_start", (_event, ctx) => anchor(ctx));
  return {
    // Called before workflow cleanup awaits; a later event handler is too late.
    shutdown() {
      suspended = true;
      generation++;
      clearTimeout(idle);
      session = pending = sent = undefined;
    },
    // Before the footer's attach, whose report must follow the re-anchor.
    attach(ctx, reason) {
      suspended = false;
      sent = undefined;
      anchor(ctx, reason);
    },
    // herdr calls any working-to-idle edge done (a toast and a sound), so idle
    // waits out the sub-second gaps between one run and the next: a `!`
    // follow-up, an abort-and-send, a typed close, a pre-prompt compaction.
    report(activity) {
      if (suspended) return;
      clearTimeout(idle);
      if (activity.state !== "idle" || !sent || sent.state === "idle") return queue(activity);
      idle = setTimeout(() => queue(activity), 250);
      idle.unref?.();
    },
  };
}
