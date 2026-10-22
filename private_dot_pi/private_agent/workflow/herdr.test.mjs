import test from "node:test";
import assert from "node:assert/strict";
import net, { createServer } from "node:net";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as flush, setTimeout as sleep } from "node:timers/promises";
import { installHerdr } from "./herdr.mjs";
import { readLines, sendLine } from "./lines.mjs";

// Unix sockets are unavailable in some sandboxes (EPERM on listen); probe once
// up front so every test in this file can share one skip reason.
const socketsDenied = await new Promise(resolve => {
  const dir = mkdtempSync(join(tmpdir(), "pi-probe-"));
  const probe = createServer();
  probe.once("error", () => { rmSync(dir, { recursive: true, force: true }); resolve(true); });
  probe.listen(join(dir, "p.sock"), () => probe.close(() => { rmSync(dir, { recursive: true, force: true }); resolve(false); }));
});
// the live flag (CI) must run these, so there a denied socket fails instead of skipping
const skip = socketsDenied && process.env.PI_WORKFLOW_LIVE_TESTS !== "1" && "Unix sockets are not permitted here";

// herdr's socket as its pi extension meets it: one request line per
// connection, answered with one line. `hold` keeps replies until `release`;
// `drop` ends that many connections unanswered.
async function fakeHerdr(t) {
  const dir = mkdtempSync(join(tmpdir(), "herdr-"));
  const path = join(dir, "h.sock");
  const held = [];
  const herdr = { frames: [], hold: false, drop: 0, release: () => held.splice(0).forEach(reply => reply()), env: { HERDR_ENV: "1", HERDR_SOCKET_PATH: path, HERDR_PANE_ID: "p1" } };
  const server = createServer(socket => {
    socket.on("error", () => {});
    readLines(socket, frame => {
      herdr.frames.push(frame);
      if (herdr.drop > 0) { herdr.drop--; return socket.end(); }
      const reply = () => sendLine(socket, { id: frame.id, result: {} });
      if (herdr.hold) held.push(reply); else reply();
    });
  });
  await new Promise(resolve => server.listen(path, resolve));
  t.after(() => new Promise(resolve => server.close(() => { rmSync(dir, { recursive: true, force: true }); resolve(); })));
  return herdr;
}
const fakePi = () => {
  const handlers = {};
  return { handlers, on: (name, fn) => { handlers[name] = fn; } };
};
const ctx = { sessionManager: { getSessionFile: () => "/abs/s.jsonl", getSessionId: () => "s1" } };
const until = async check => {
  for (let i = 0; i < 200 && !check(); i++) await sleep(5);
  assert.ok(check());
};

test("the reporter runs only inside a herdr pane", () => {
  const env = { HERDR_ENV: "1", HERDR_SOCKET_PATH: "/tmp/h.sock", HERDR_PANE_ID: "p1" };
  assert.equal(installHerdr(fakePi(), {}), undefined);
  assert.equal(installHerdr(fakePi(), { ...env, HERDR_ENV: "0" }), undefined);
  assert.equal(installHerdr(fakePi(), { ...env, HERDR_PANE_ID: "" }), undefined);
  assert.ok(installHerdr(fakePi(), env));
});

test("the session ref goes first, then each new state as herdr's pi source, and attach re-sends", { skip }, async t => {
  const herdr = await fakeHerdr(t);
  const before = Date.now();
  const reporter = installHerdr(fakePi(), herdr.env);
  reporter.attach(ctx, "new");
  reporter.report({ state: "working" });
  await until(() => herdr.frames.length === 2);
  reporter.report({ state: "blocked", message: "Approve" });
  await until(() => herdr.frames.length === 3);
  reporter.report({ state: "idle" });
  await until(() => herdr.frames.length === 4);
  const [session, ...states] = herdr.frames;
  assert.equal(session.method, "pane.report_agent_session");
  assert.deepEqual({ ...session.params, seq: 0 }, { pane_id: "p1", source: "herdr:pi", agent: "pi", session_start_source: "new", agent_session_path: "/abs/s.jsonl", seq: 0 });
  assert.deepEqual(states.map(frame => [frame.method, frame.params.state, frame.params.message]), [["pane.report_agent", "working", undefined], ["pane.report_agent", "blocked", "Approve"], ["pane.report_agent", "idle", undefined]]);
  for (const { params } of states) assert.deepEqual([params.pane_id, params.source, params.agent, params.agent_session_path], ["p1", "herdr:pi", "pi", "/abs/s.jsonl"]);
  const seqs = herdr.frames.map(frame => frame.params.seq);
  assert.ok(seqs.every((seq, i) => i === 0 || seq > seqs[i - 1]), String(seqs));
  assert.ok(seqs[0] >= before * 1000, "seq seeds above a reloaded predecessor's");

  reporter.report({ state: "idle" });
  await sleep(300);
  assert.equal(herdr.frames.length, 4, "a repeat is dropped");
  reporter.attach(ctx, "resume");
  reporter.report({ state: "idle" });
  await until(() => herdr.frames.length === 6);
  assert.deepEqual(herdr.frames.slice(4).map(frame => [frame.method, frame.params.session_start_source ?? frame.params.state]), [["pane.report_agent_session", "resume"], ["pane.report_agent", "idle"]]);
});

test("each agent_start re-sends the session ref, falling back to the session id", { skip }, async t => {
  const herdr = await fakeHerdr(t);
  const pi = fakePi();
  installHerdr(pi, herdr.env);
  pi.handlers.agent_start({}, { sessionManager: { getSessionFile() { throw new Error("stale"); }, getSessionId: () => "s2" } });
  await until(() => herdr.frames.length === 1);
  assert.equal(herdr.frames[0].method, "pane.report_agent_session");
  assert.equal(herdr.frames[0].params.agent_session_id, "s2");
});

test("states reported while a send is in flight coalesce to the newest", { skip }, async t => {
  const herdr = await fakeHerdr(t);
  const reporter = installHerdr(fakePi(), herdr.env);
  herdr.hold = true;
  reporter.attach(ctx, "startup");
  reporter.report({ state: "working" });
  reporter.report({ state: "blocked", message: "Approve" });
  await until(() => herdr.frames.length === 1);
  herdr.hold = false;
  herdr.release();
  await until(() => herdr.frames.length === 2);
  await sleep(50);
  assert.deepEqual(herdr.frames.map(frame => frame.params.state), [undefined, "blocked"]);
});

test("an unanswered request is retried once on a new connection", { skip }, async t => {
  const herdr = await fakeHerdr(t);
  const reporter = installHerdr(fakePi(), herdr.env);
  herdr.drop = 1;
  reporter.report({ state: "working" });
  await until(() => herdr.frames.length === 2);
  assert.deepEqual(herdr.frames[1], herdr.frames[0]);
});

// A socket that connects but never replies on its own, for mocked timers: real
// socket I/O would not advance with them.
const mockSockets = t => {
  const frames = [], sockets = [];
  t.mock.method(net, "createConnection", () => {
    const socket = new EventEmitter();
    socket.destroy = () => {};
    socket.write = line => frames.push(JSON.parse(line));
    sockets.push(socket);
    queueMicrotask(() => socket.emit("connect"));
    return socket;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  return { frames, sockets };
};

test("a silent herdr times out, is retried once, and the queue moves on", async t => {
  const { frames } = mockSockets(t);
  const reporter = installHerdr(fakePi(), { HERDR_ENV: "1", HERDR_SOCKET_PATH: "/tmp/h.sock", HERDR_PANE_ID: "p1" });
  reporter.report({ state: "working" });
  await flush();
  assert.equal(frames.length, 1);
  t.mock.timers.tick(500);
  await flush();
  assert.equal(frames.length, 2, "retried after 500 ms");
  assert.deepEqual(frames[1], frames[0]);
  t.mock.timers.tick(1500);
  await flush();
  reporter.report({ state: "blocked", message: "Approve" });
  await flush();
  assert.deepEqual([frames.length, frames.at(-1).params.state], [3, "blocked"]);
});

test("shutdown discards delayed idle and queued reports until attach re-anchors", async t => {
  const { frames, sockets } = mockSockets(t);
  const pi = fakePi();
  const reporter = installHerdr(pi, { HERDR_ENV: "1", HERDR_SOCKET_PATH: "/tmp/h.sock", HERDR_PANE_ID: "p1" });
  const acknowledge = async () => { sockets.at(-1).emit("data", "{}\n"); await flush(); };
  reporter.attach(ctx, "startup");
  reporter.report({ state: "working" });
  await flush();
  await acknowledge();
  await acknowledge();
  assert.deepEqual(frames.map(frame => frame.params.state), [undefined, "working"]);

  reporter.report({ state: "idle" });
  t.mock.timers.tick(100);
  reporter.shutdown();
  reporter.report({ state: "blocked", message: "stale" });
  pi.handlers.agent_start({}, ctx);
  t.mock.timers.tick(300);
  await flush();
  assert.equal(frames.length, 2, "no old-session reports after shutdown");

  reporter.attach(ctx, "resume");
  reporter.report({ state: "working" });
  await flush();
  assert.equal(frames.at(-1).method, "pane.report_agent_session");
  assert.equal(frames.at(-1).params.session_start_source, "resume");
  await acknowledge();
  assert.equal(frames.at(-1).params.state, "working");
  await acknowledge();
  reporter.report({ state: "idle" });
  t.mock.timers.tick(100);
  reporter.report({ state: "working" });
  t.mock.timers.tick(300);
  await flush();
  assert.equal(frames.length, 4, "a short idle gap still reports no done");
  reporter.report({ state: "idle" });
  t.mock.timers.tick(249);
  await flush();
  assert.equal(frames.length, 4, "resumed idle is still debounced");
  t.mock.timers.tick(1);
  await flush();
  assert.equal(frames.at(-1).params.state, "idle");

  reporter.report({ state: "blocked", message: "queued" });
  pi.handlers.agent_start({}, ctx);
  reporter.shutdown();
  sockets.at(-1).emit("end");
  await flush();
  t.mock.timers.tick(2000);
  await flush();
  assert.equal(frames.length, 5, "queued state, session anchor and retry are discarded");
  reporter.attach(ctx, "new");
  reporter.report({ state: "idle" });
  await flush();
  await acknowledge();
  await acknowledge();
  assert.deepEqual(frames.slice(5).map(frame => [frame.method, frame.params.session_start_source ?? frame.params.state]), [["pane.report_agent_session", "new"], ["pane.report_agent", "idle"]]);
});

test("idle waits out a gap before the next run, so herdr sees no done", { skip }, async t => {
  const herdr = await fakeHerdr(t);
  const reporter = installHerdr(fakePi(), herdr.env);
  reporter.report({ state: "working" });
  await until(() => herdr.frames.length === 1);
  reporter.report({ state: "idle" });
  reporter.report({ state: "working" });
  await sleep(300);
  assert.equal(herdr.frames.length, 1);
  reporter.report({ state: "idle" });
  await sleep(100);
  assert.equal(herdr.frames.length, 1, "idle is held");
  await until(() => herdr.frames.length === 2);
  assert.equal(herdr.frames[1].params.state, "idle");
});
