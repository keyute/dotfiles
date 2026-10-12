import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MAX_BYTES } from "@earendil-works/pi-coding-agent";
import { createTasks } from "./tasks.mjs";

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
  return { tasks, notices, records, start, settle, tick: ms => { clock += ms; }, expire: () => timers.splice(0).forEach(fn => fn()) };
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
  assert.deepEqual(h.records, [{ id: "t1", command: "npm test", status: "completed", durationMs: 2500 }]);
  assert.equal(h.notices[0], "Background task t1 completed (exit 0): npm test\nline 1\nline 2");
  assert.equal(h.tasks.output(id), "completed (exit 0)\nline 1\nline 2\n");
});

test("a single huge output line reaches the completion notice only up to pi's byte cap", async () => {
  const h = harness();
  const { exec } = h.start("cat bundle.min.json");
  exec.onChunk("x".repeat(200_000));
  exec.resolve({ exitCode: 0 });
  await h.settle();
  assert.ok(Buffer.byteLength(h.notices[0]) <= DEFAULT_MAX_BYTES + 200);
  assert.ok(h.notices[0].endsWith("x"));
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
  assert.ok(output.endsWith("\n3000"));
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
