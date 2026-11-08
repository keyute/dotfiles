import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { closeSync, openSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installProgramStatus } from "./program-status.mjs";

const QUERY = "\x1b]7501;?\x1b\\";
const b64 = text => Buffer.from(text).toString("base64");
const wire = (state, { id, kind, title, msg } = {}) => `\x1b]7501;${[`state=${state}`, "app=pi", id && `id=${id}`, kind && `kind=${kind}`, title && `title=${b64(title)}`, msg && `msg=${b64(msg)}`].filter(Boolean).join(":")}\x1b\\`;
const activity = (root, children = []) => ({ root, children });

function harness(t, { answer = true, timers = true } = {}) {
  if (timers) t.mock.timers.enable({ apis: ["setTimeout"] });
  const frames = [];
  const stdin = new EventEmitter();
  const proc = new EventEmitter();
  const reporter = installProgramStatus({ stdout: { isTTY: true, write: data => frames.push(...data.match(/\x1b\][^\x1b]*\x1b\\/g)) }, stdin, proc });
  const reply = () => stdin.emit("data", Buffer.from(QUERY));
  if (answer) { reply(); frames.length = 0; }
  return { frames, stdin, proc, reporter, reply, report: (...args) => reporter.report(activity(...args)), tick: ms => t.mock.timers.tick(ms) };
}

test("only a TTY is queried, and nothing is reported until the terminal answers, split or among other input", t => {
  for (const isTTY of [false, undefined]) assert.equal(installProgramStatus({ stdout: { isTTY, write: () => assert.fail("non-TTY write") }, stdin: new EventEmitter(), proc: new EventEmitter() }), undefined);
  const h = harness(t, { answer: false });
  assert.deepEqual(h.frames, [QUERY]);
  h.report({ state: "working" });
  h.stdin.emit("data", "abc\x1b]75");
  h.stdin.emit("data", Buffer.from("01;?"));
  assert.deepEqual(h.frames, [QUERY], "silent before the reply");
  h.stdin.emit("data", "\x1b\\typed");
  assert.deepEqual(h.frames, [QUERY, wire("working")], "the reply flushes the current records");
  assert.equal(h.stdin.listenerCount("data"), 0, "stdin is read only until the reply");
  h.reporter.shutdown();
  const bel = harness(t, { answer: false, timers: false });
  bel.report({ state: "working" });
  bel.stdin.emit("data", "\x1b]7501;?\x07");
  assert.deepEqual(bel.frames, [QUERY, wire("working")], "a BEL-terminated reply counts too");
  bel.reporter.shutdown();
  const silent = harness(t, { answer: false, timers: false });
  silent.report({ state: "working" });
  silent.stdin.emit("data", "\x1b]7502;?\x1b\\");
  silent.reporter.shutdown();
  assert.deepEqual(silent.frames, [QUERY], "no reply, no records and no clears");
});

test("reinstall after shutdown returns listeners to baseline before and after support", () => {
  const stdin = new EventEmitter();
  const proc = new EventEmitter();
  stdin.on("data", () => {});
  proc.on("exit", () => {});
  proc.on("SIGCONT", () => {});
  const counts = () => [stdin.listenerCount("data"), proc.listenerCount("exit"), proc.listenerCount("SIGCONT")];
  const baseline = counts();
  for (const answer of [false, true]) {
    for (let cycle = 0; cycle < 3; cycle++) {
      const reporter = installProgramStatus({ stdout: { isTTY: true, write() {} }, stdin, proc });
      assert.deepEqual(counts(), [2, 1, 1]);
      if (answer) {
        stdin.emit("data", QUERY);
        assert.deepEqual(counts(), [1, 2, 1]);
        reporter.report(activity({ state: "working" }));
      }
      reporter.suspend();
      reporter.suspend();
      assert.equal(proc.listenerCount("SIGCONT"), 2);
      reporter.shutdown();
      reporter.shutdown();
      assert.deepEqual(counts(), baseline);
      stdin.emit("data", QUERY);
      proc.emit("exit");
      proc.emit("SIGCONT");
      assert.deepEqual(counts(), baseline, "a stopped reporter cannot rearm itself");
    }
  }
});

test("attach rearms pending support once and a late reply flushes only the new session", t => {
  const h = harness(t, { answer: false });
  h.report({ state: "working", message: "old" });
  h.stdin.emit("data", "\x1b]7501;?");
  h.reporter.shutdown();
  assert.equal(h.stdin.listenerCount("data"), 0);
  h.reply();
  assert.equal(h.proc.listenerCount("exit"), 0);
  h.reporter.attach();
  h.reporter.attach();
  assert.equal(h.stdin.listenerCount("data"), 1);
  h.report({ state: "idle", message: "new" });
  h.stdin.emit("data", "\x1b\\");
  assert.deepEqual(h.frames, [QUERY], "shutdown discards the old partial reply");
  h.stdin.emit("data", "\x1b]7501;?");
  h.stdin.emit("data", "\x1b\\");
  assert.deepEqual(h.frames, [QUERY, wire("idle", { msg: "new" })]);
  assert.equal(h.stdin.listenerCount("data"), 0);
  assert.equal(h.proc.listenerCount("exit"), 1);
  h.reporter.shutdown();
  h.reporter.attach();
  h.reporter.attach();
  assert.equal(h.stdin.listenerCount("data"), 0, "known support needs no new reply");
  assert.equal(h.proc.listenerCount("exit"), 1);
  h.report({ state: "working" });
  assert.equal(h.frames.at(-1), wire("working"));
  h.reporter.shutdown();
  assert.equal(h.proc.listenerCount("exit"), 0);
});

test("attach preserves suspension and rearms one continuation listener", t => {
  const h = harness(t, { answer: false });
  h.reporter.suspend();
  h.reply();
  h.report({ state: "working" });
  assert.deepEqual(h.frames, [QUERY], "support while suspended stays silent");
  h.reporter.shutdown();
  assert.equal(h.proc.listenerCount("SIGCONT"), 0);
  h.reporter.attach();
  h.reporter.attach();
  assert.equal(h.proc.listenerCount("SIGCONT"), 1);
  h.report({ state: "idle" });
  assert.deepEqual(h.frames, [QUERY]);
  h.proc.emit("SIGCONT");
  assert.deepEqual(h.frames, [QUERY, wire("idle")]);
  assert.equal(h.proc.listenerCount("SIGCONT"), 0);
  h.reporter.shutdown();
});

test("records carry kind only when blocked, base64 text without controls, byte limits, and sanitized, sorted, capped ids", t => {
  const h = harness(t);
  h.report({ state: "working", kind: "question", message: "my session" });
  h.report({ state: "blocked", kind: "permission", message: "approve\x1b]52;c;x\x07\nbash" });
  assert.deepEqual(h.frames, [wire("working", { msg: "my session" }), wire("blocked", { kind: "permission", msg: "approve ]52;c;x bash" })]);
  h.frames.length = 0;
  h.report({ state: "done", message: "é".repeat(1100) }, [{ id: "z/9", state: "working", title: "界".repeat(70) }, { id: "a".repeat(40), state: "working", title: "Audit" }]);
  h.tick(250);
  assert.deepEqual(h.frames, [
    wire("working", { id: "a".repeat(32), title: "Audit" }),
    wire("working", { id: "z-9", title: "界".repeat(64) }),
    wire("done", { msg: "é".repeat(1024) }),
  ], "children sort before the root; a title stops at 192 bytes and a message at 2048, on a character");
  h.frames.length = 0;
  h.report({ state: "done" }, Array.from({ length: 40 }, (_, index) => ({ id: `c${String(index).padStart(2, "0")}`, state: "working" })));
  assert.equal(h.frames.length, 35, "two clears, at most 32 records, then the root");
  assert.deepEqual(h.frames.slice(2, -1).map(frame => frame.match(/id=([^:\x1b]+)/)[1]), Array.from({ length: 32 }, (_, index) => `c${String(index).padStart(2, "0")}`));
  h.reporter.shutdown();
});

test("only changed records are written, and a vanished child is cleared", t => {
  const h = harness(t);
  const child = { id: "run1", state: "working", title: "Fix" };
  h.report({ state: "working" }, [child]);
  h.report({ state: "working" }, [child]);
  h.report({ state: "working" }, [child, { id: "wf_1", state: "working", title: "Audit" }]);
  h.report({ state: "working" }, [{ id: "wf_1", state: "working", title: "Audit" }]);
  assert.deepEqual(h.frames, [wire("working", { id: "run1", title: "Fix" }), wire("working"), wire("working", { id: "wf_1", title: "Audit" }), wire("clear", { id: "run1" })]);
  h.reporter.shutdown();
});

test("only the root leaving work for rest waits 250 ms, and the hold sends what is current when it ends", t => {
  const h = harness(t);
  h.report({ state: "working" });
  h.report({ state: "done" });
  h.tick(100);
  h.report({ state: "working" });
  h.tick(300);
  assert.deepEqual(h.frames, [wire("working")], "a short gap never reaches the terminal");
  h.report({ state: "done" });
  h.tick(200);
  h.report({ state: "done", message: "Waiting on 1 agent" }, [{ id: "r", state: "working", title: "t" }]);
  h.tick(49);
  assert.equal(h.frames.length, 1, "a later report does not restart the hold");
  h.tick(1);
  assert.deepEqual(h.frames.slice(1), [wire("working", { id: "r", title: "t" }), wire("done", { msg: "Waiting on 1 agent" })]);
  h.report({ state: "done" });
  h.report({ state: "blocked", kind: "question", message: "Which?" });
  h.report({ state: "idle" });
  h.tick(250);
  h.report({ state: "error", message: "boom" });
  assert.deepEqual(h.frames.slice(3), [wire("clear", { id: "r" }), wire("done"), wire("blocked", { kind: "question", msg: "Which?" }), wire("idle"), wire("error", { msg: "boom" })], "rest to rest goes at once");
  h.reporter.shutdown();
});

test("shutdown and suspend clear children then the root; SIGCONT resends, and exit clears synchronously", t => {
  const h = harness(t);
  h.report({ state: "working" }, [{ id: "r", state: "working", title: "t" }]);
  h.frames.length = 0;
  h.reporter.suspend();
  h.report({ state: "blocked", message: "Approve" }, [{ id: "r", state: "working", title: "t" }]);
  assert.deepEqual(h.frames, [wire("clear", { id: "r" }), wire("clear")], "nothing is written while suspended");
  h.proc.emit("SIGCONT");
  assert.deepEqual(h.frames.slice(2), [wire("working", { id: "r", title: "t" }), wire("blocked", { msg: "Approve" })]);
  h.frames.length = 0;
  h.report({ state: "done" });
  h.reporter.shutdown();
  h.reporter.shutdown();
  h.report({ state: "working" });
  h.tick(1000);
  assert.deepEqual(h.frames, [wire("clear", { id: "r" }), wire("clear")], "the pending hold is dropped and a stopped reporter writes nothing");

  const file = join(mkdtempSync(join(tmpdir(), "osc-")), "out");
  const fd = openSync(file, "w");
  t.after(() => closeSync(fd));
  const stdin = new EventEmitter();
  const proc = new EventEmitter();
  const reporter = installProgramStatus({ stdout: { isTTY: true, fd, write() {} }, stdin, proc });
  stdin.emit("data", QUERY);
  reporter.shutdown();
  reporter.attach();
  reporter.attach();
  assert.equal(proc.listenerCount("exit"), 1);
  reporter.report(activity({ state: "working" }, [{ id: "r", state: "working" }]));
  proc.emit("exit");
  assert.equal(readFileSync(file, "utf8"), wire("clear", { id: "r" }) + wire("clear"));
});

test("attach takes the new session's report without replaying the old one", t => {
  const h = harness(t);
  h.report({ state: "working" });
  h.report({ state: "done" });
  h.tick(100);
  h.reporter.shutdown();
  h.reporter.attach();
  h.tick(1000);
  assert.deepEqual(h.frames, [wire("working"), wire("clear")], "attach cancels the old session's hold and resends nothing");
  h.report({ state: "idle" });
  assert.deepEqual(h.frames.at(-1), wire("idle"));
  h.reporter.shutdown();
});
