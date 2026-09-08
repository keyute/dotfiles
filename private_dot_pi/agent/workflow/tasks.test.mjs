import test from "node:test";
import assert from "node:assert/strict";
import { createTasks } from "./tasks.mjs";

// A task whose exec is a promise the test settles; `close` records the worker shutdown.
function harness() {
  const notices = [];
  const records = [];
  let clock = 1000;
  const tasks = createTasks({ notify: text => notices.push(text), record: entry => records.push(entry), now: () => clock });
  const start = command => {
    const exec = {};
    exec.promise = new Promise((resolve, reject) => Object.assign(exec, { resolve, reject }));
    let closed = false;
    const id = tasks.start({ command, run: (onChunk, signal) => { exec.onChunk = onChunk; signal.addEventListener("abort", () => exec.reject(new Error("aborted"))); return exec.promise; }, close: () => { closed = true; } });
    return { id, exec, closed: () => closed };
  };
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  return { tasks, notices, records, start, settle, tick: ms => { clock += ms; } };
}

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

test("stopAll aborts every running task and resolves once each has recorded", async () => {
  const h = harness();
  h.start("a");
  h.start("b");
  await h.tasks.stopAll();
  assert.equal(h.tasks.live(), 0);
  assert.deepEqual(h.records.map(entry => entry.status), ["stopped", "stopped"]);
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
