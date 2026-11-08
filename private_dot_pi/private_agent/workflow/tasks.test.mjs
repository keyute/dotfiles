import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_MAX_BYTES } from "@earendil-works/pi-coding-agent";
import { createTasks, outputLog } from "./tasks.mjs";

// A task whose exec is a promise the test settles; `close` records the worker shutdown.
function harness() {
  const notices = [];
  const records = [];
  let clock = 1000;
  const timers = [];
  const tasks = createTasks({ notify: text => notices.push(text), record: entry => records.push(entry), now: () => clock, setTimer: fn => { timers.push(fn); return { unref() {} }; } });
  const start = command => {
    const exec = {};
    exec.promise = new Promise((resolve, reject) => Object.assign(exec, { resolve, reject }));
    let closed = false;
    const id = tasks.start({ command, run: (onChunk, signal) => { exec.onChunk = onChunk; signal.addEventListener("abort", () => exec.reject(new Error("aborted"))); return exec.promise; }, close: () => { closed = true; } });
    return { id, exec, closed: () => closed };
  };
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  // Past the log file's close, which a timer tick does not outlast.
  const ended = () => new Promise(resolve => tasks.onChange(resolve));
  return { tasks, notices, records, start, settle, ended, tick: ms => { clock += ms; }, expire: () => timers.splice(0).forEach(fn => fn()) };
}

test("a task that ends inside the grace is answered inline and neither records nor notifies", async () => {
  const h = harness();
  const { id, exec } = h.start("npm test -- one.test.ts");
  const settled = h.tasks.settle(id, 10_000);
  exec.onChunk("1 passed\n");
  exec.resolve({ exitCode: 0 });
  assert.deepEqual(await settled, { status: "completed", exitCode: 0, error: null, output: "1 passed\n" });
  await h.settle();
  assert.deepEqual(h.records, []);
  assert.deepEqual(h.notices, []);
  assert.equal(h.tasks.live(), 0);
});

test("a task that fails or is aborted inside the grace reports its reason inline", async () => {
  const h = harness();
  const failing = h.start("false");
  const settledFailing = h.tasks.settle(failing.id, 10_000);
  failing.exec.resolve({ exitCode: 1 });
  assert.deepEqual(await settledFailing, { status: "failed", exitCode: 1, error: null, output: "" });
  const aborted = h.start("sleep 60");
  const settledAborted = h.tasks.settle(aborted.id, 10_000);
  aborted.exec.reject(new Error("worker aborted"));
  assert.deepEqual(await settledAborted, { status: "stopped", exitCode: null, error: "worker aborted", output: "" });
  const killed = h.start("kill -9 $$");
  const settledKilled = h.tasks.settle(killed.id, 10_000);
  killed.exec.resolve({ exitCode: null });
  assert.deepEqual(await settledKilled, { status: "failed", exitCode: null, error: null, output: "" });
  assert.deepEqual(h.notices, []);
  assert.equal(h.tasks.output(aborted.id), "stopped (worker aborted)\n(no output)");
});

test("an aborted turn ends the grace wait and leaves the task running", async () => {
  const h = harness();
  const { id, exec } = h.start("npm run dev");
  const controller = new AbortController();
  controller.abort(); // already aborted when the wait starts: no event will replay
  const settled = h.tasks.settle(id, 10_000, controller.signal);
  assert.equal(await settled, null);
  assert.equal(h.tasks.live(), 1);
  exec.resolve({ exitCode: 0 });
  await h.settle();
  assert.equal(h.notices.length, 1);
});

test("a task that outlives the grace returns null and later notifies as before", async () => {
  const h = harness();
  const { id, exec } = h.start("npm run dev");
  const settled = h.tasks.settle(id, 10_000);
  h.expire();
  assert.equal(await settled, null);
  assert.equal(h.tasks.live(), 1);
  exec.resolve({ exitCode: 0 });
  await h.settle();
  assert.equal(h.records.length, 1);
  assert.match(h.notices[0], /^Background task t1 completed/);
});

test("a task reports its tail and duration when it ends, and counts as live until then", async () => {
  const h = harness();
  const { id, exec, closed } = h.start("npm test");
  assert.equal(id, "t1");
  assert.equal(h.tasks.live(), 1);
  exec.onChunk("line 1\n");
  exec.onChunk("line 2\n");
  assert.equal(h.tasks.output(id), "running\nline 1\nline 2\n");
  h.tick(2500);
  exec.resolve({ exitCode: 0 });
  await h.settle();
  assert.equal(h.tasks.live(), 0);
  assert.ok(closed());
  assert.deepEqual(h.records, [{ id: "t1", command: "npm test", status: "completed", exitCode: 0, durationMs: 2500 }]);
  assert.equal(h.notices[0], "Background task t1 completed (exit 0): npm test\nline 1\nline 2");
  assert.equal(h.tasks.output(id), "completed (exit 0)\nline 1\nline 2\n");
});

test("an adopted task's completion duration includes its foreground execution", async () => {
  const records = [];
  let clock = 1000;
  let finish;
  const running = new Promise(resolve => { finish = resolve; });
  const tasks = createTasks({ notify() {}, record: entry => records.push(entry), now: () => clock });
  const startedAt = clock;
  clock += 4000;
  tasks.start({ command: "adopted", startedAt, run: () => running });
  clock += 2500;
  const ended = new Promise(resolve => tasks.onChange(resolve));
  finish({ exitCode: 0 });
  await ended;
  assert.equal(records[0].durationMs, 6500);
});

test("a single huge output line reaches the completion notice only up to pi's byte cap", async () => {
  const h = harness();
  const { exec } = h.start("cat bundle.min.json");
  exec.onChunk("x".repeat(200_000));
  exec.resolve({ exitCode: 0 });
  await h.ended();
  const [notice] = h.notices[0].split("\nFull output: ");
  assert.ok(Buffer.byteLength(notice) <= DEFAULT_MAX_BYTES + 200);
  assert.ok(notice.endsWith("x"));
});

test("output past the bash tool's line cap reaches the model as its tail behind a one-line note", async () => {
  const h = harness();
  const { id, exec } = h.start("seq 3000");
  const lines = Array.from({ length: 3000 }, (_, i) => `${i + 1}`).join("\n");
  exec.onChunk(lines);
  const shown = "[Earlier output dropped; showing the last 2000 lines]\n1001\n";
  assert.ok(h.tasks.output(id).startsWith(`running\n${shown}`));
  const settled = h.tasks.settle(id, 10_000);
  exec.resolve({ exitCode: 0 });
  const { output } = await settled;
  assert.ok(output.startsWith(shown));
  assert.match(output, /\n3000\nFull output: \S+$/, "an inline answer names the full log too");
});

test("the completion notice keeps only the last 20 output lines", async () => {
  const h = harness();
  const { exec } = h.start("seq 30");
  exec.onChunk(Array.from({ length: 30 }, (_, i) => `${i + 1}`).join("\n"));
  exec.resolve({ exitCode: 0 });
  await h.settle();
  assert.deepEqual(h.notices[0].split("\n").slice(1), Array.from({ length: 20 }, (_, i) => `${i + 11}`));
});

test("a non-zero exit fails; a stop or a worker abort reads as stopped; unknown ids throw", async () => {
  const h = harness();
  const failing = h.start("false");
  failing.exec.resolve({ exitCode: 1 });
  const stopped = h.start("sleep 60");
  assert.equal(h.tasks.stop(stopped.id), true);
  const aborted = h.start("sleep 60");
  aborted.exec.reject(new Error("aborted"));
  await h.settle();
  assert.deepEqual(h.records.map(entry => [entry.id, entry.status]), [["t1", "failed"], ["t2", "stopped"], ["t3", "stopped"]]);
  assert.match(h.notices[0], /^Background task t1 failed \(exit 1\): false\n\(no output\)$/);
  assert.equal(h.tasks.stop(stopped.id), false);
  assert.throws(() => h.tasks.output("t9"), /Unknown/);
});

test("list retains every task id, status, and command after completion", async () => {
  const h = harness();
  const first = h.start("npm test");
  h.start("npm run dev");
  first.exec.resolve({ exitCode: 0 });
  await h.settle();
  assert.deepEqual(h.tasks.list(), [
    { id: "t1", status: "completed", command: "npm test" },
    { id: "t2", status: "running", command: "npm run dev" },
  ]);
  await h.tasks.stopAll({ silent: true });
});

test("stopAll normally records and notifies, while shutdown-silent stops retain status without either or a change", async () => {
  const normal = harness();
  normal.start("a");
  normal.start("b");
  await normal.tasks.stopAll();
  assert.equal(normal.tasks.live(), 0);
  assert.deepEqual(normal.records.map(entry => entry.status), ["stopped", "stopped"]);
  assert.equal(normal.notices.length, 2);

  const shutdown = harness();
  let changes = 0;
  shutdown.tasks.onChange(() => changes++);
  shutdown.start("c");
  shutdown.start("d");
  await shutdown.tasks.stopAll({ silent: true });
  assert.equal(shutdown.tasks.live(), 0);
  assert.deepEqual(shutdown.records, []);
  assert.deepEqual(shutdown.notices, []);
  assert.equal(changes, 0, "the outgoing session's listeners hear nothing");
  assert.deepEqual(shutdown.tasks.list(), [
    { id: "t1", status: "stopped", command: "c" },
    { id: "t2", status: "stopped", command: "d" },
  ]);
});

test("a task stays live until its worker has closed, and a stale session's throw is not an unhandled rejection", async () => {
  const rejections = [];
  const onRejection = error => rejections.push(error);
  process.on("unhandledRejection", onRejection);
  try {
    let closeWorker;
    const tasks = createTasks({ notify: () => {}, record: () => { throw new Error("This extension ctx is stale"); } });
    const id = tasks.start({ command: "npm test", run: () => Promise.resolve({ exitCode: 0 }), close: () => new Promise(resolve => { closeWorker = resolve; }) });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(tasks.live(), 1);
    closeWorker();
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(tasks.live(), 0);
    assert.match(tasks.output(id), /^completed/);
    assert.deepEqual(rejections, []);
  } finally { process.off("unhandledRejection", onRejection); }
});

test("stopAll gives up on a task whose worker never answers the abort", async () => {
  const tasks = createTasks({ notify: () => {}, record: () => {} });
  tasks.start({ command: "wedged", run: () => new Promise(() => {}) });
  await tasks.stopAll({ timeoutMs: 5 });
  assert.equal(tasks.live(), 1);
});

test("onChange fires once each task ends, answered inline or notified", async () => {
  const h = harness();
  let changes = 0;
  h.tasks.onChange(() => { changes++; assert.equal(h.tasks.live(), 2 - changes); });
  const inline = h.start("true");
  const later = h.start("npm run dev");
  const settled = h.tasks.settle(inline.id, 10_000);
  inline.exec.resolve({ exitCode: 0 });
  await settled;
  assert.equal(changes, 1);
  later.exec.resolve({ exitCode: 0 });
  await h.settle();
  assert.equal(changes, 2);
  assert.equal(h.notices.length, 1);
});

test("a hidden task is unknown to the model and never notifies it, but still records its line", async () => {
  const h = harness();
  const id = h.tasks.start({ command: "ls", hidden: true, user: true, run: () => Promise.resolve({ exitCode: 0 }) });
  assert.deepEqual(h.tasks.list(), []);
  assert.throws(() => h.tasks.output(id), /Unknown/);
  assert.throws(() => h.tasks.stop(id), /Unknown/);
  await h.ended();
  assert.deepEqual(h.notices, []);
  assert.deepEqual(h.records, [{ id, command: "ls", status: "completed", exitCode: 0, durationMs: 0, user: true, hidden: true }]);
});

test("a mode change's leased stop leaves user tasks running; shutdown stops them too", async () => {
  const h = harness();
  h.start("npm run dev");
  const user = h.tasks.start({ command: "tail -f log", user: true, run: (_onChunk, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))) });
  await h.tasks.stopAll({ leased: true });
  assert.equal(h.tasks.live({ leased: true }), 0);
  assert.equal(h.tasks.live(), 1);
  await h.tasks.stopAll({ silent: true });
  assert.equal(h.tasks.live(), 0);
  assert.equal(h.tasks.list().find(task => task.id === user).status, "stopped");
});

test("an output log keeps only a bounded tail in memory and every byte in its file", async t => {
  const OUTPUT_KEEP = 256 * 1024;
  const log = outputLog();
  const chunk = Buffer.from("x".repeat(1023) + "\n");
  for (let i = 0; i < 300; i++) log.append(chunk);
  assert.ok(log.tail.length <= OUTPUT_KEEP);
  await log.close();
  // Only the file: a later test removes the shared log directory.
  t.after(() => rmSync(log.path, { force: true }));
  assert.equal(readFileSync(log.path).length, chunk.length * 300);
});

test("an output log remembers eviction even after appending and closing an empty tail", async () => {
  const log = outputLog({ file: false });
  log.append("meaningful output\n");
  log.append("\n".repeat(256 * 1024 + 1));
  assert.equal(log.tail, "\n".repeat(256 * 1024));
  assert.equal(log.dropped, true);
  log.append("");
  await log.close();
  assert.equal(log.dropped, true);
  assert.equal(log.path, null);
});

test("an output log marks eviction caused by final decoder flushing, but not an exactly full tail", async () => {
  const log = outputLog({ file: false });
  log.append("x".repeat(256 * 1024));
  log.append(Buffer.from([0xc3]));
  assert.equal(log.dropped, false);
  await log.close();
  assert.equal(log.dropped, true);
  assert.equal(log.tail.length, 256 * 1024);
  assert.ok(log.tail.endsWith("\ufffd"));
});

test("an output log keeps normal output without marking it dropped", async () => {
  const log = outputLog();
  log.append("hi\n");
  await log.close();
  assert.equal(log.tail, "hi\n");
  assert.equal(log.dropped, false);
  assert.equal(log.path, null);
});

test("output past the inline limits is logged in full, and only then named in the summary and notice", async () => {
  const h = harness();
  const small = h.start("echo hi");
  small.exec.onChunk("hi\n");
  small.exec.resolve({ exitCode: 0 });
  await h.ended();
  assert.doesNotMatch(h.notices[0], /Full output/);
  assert.doesNotMatch(h.tasks.output(small.id), /Full output/);
  const big = h.start("seq 3000");
  const lines = Array.from({ length: 3000 }, (_, i) => `${i + 1}\n`);
  // Split across the threshold, so the log must also hold what came before it.
  big.exec.onChunk(Buffer.from(lines.slice(0, 1500).join("")));
  big.exec.onChunk(Buffer.from(lines.slice(1500).join("")));
  big.exec.resolve({ exitCode: 0 });
  await h.ended();
  const path = h.notices[1].match(/\nFull output: (.+)$/)[1];
  // The process's one log directory, shared by every test in this file.
  after(() => rmSync(dirname(path), { recursive: true, force: true }));
  assert.equal(readFileSync(path, "utf8"), lines.join(""));
  assert.ok(h.tasks.output(big.id).endsWith(`\nFull output: ${path}`));
});

test("the completion notice carries the recorded entry itself as its details", async () => {
  const records = [];
  const notices = [];
  const tasks = createTasks({ notify: (text, options) => notices.push(options), record: entry => records.push(entry) });
  tasks.start({ command: "true", run: () => Promise.resolve({ exitCode: 0 }) });
  await new Promise(resolve => tasks.onChange(resolve));
  assert.equal(notices[0].details, records[0]);
});
