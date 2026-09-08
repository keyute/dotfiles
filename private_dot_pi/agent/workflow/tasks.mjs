// Background shell tasks (Claude Code's run_in_background): the leased worker
// outlives the tool call, output is kept in memory (tail-capped), and the end
// of a task reaches the model through pi.sendMessage — with its next tool
// result, or as a new turn when idle — while the transcript gets one
// completion line. A task holds a process lease, so a mode change stops it
// like any other sandbox process; the worker then reports the exec as aborted.
const OUTPUT_KEEP = 256 * 1024;
const TAIL_LINES = 20;

export function createTasks({ notify, record, now = Date.now }) {
  const tasks = new Map();
  let next = 1;
  const running = () => [...tasks.values()].filter(task => task.status === "running");
  const find = id => {
    const task = tasks.get(id);
    if (!task) throw new Error("Unknown background task");
    return task;
  };
  return {
    start({ command, run, close }) {
      const id = `t${next++}`;
      const controller = new AbortController();
      const task = { id, command, startedAt: now(), status: "running", output: "", exitCode: null, error: null, controller };
      tasks.set(id, task);
      task.done = (async () => {
        let status;
        try {
          const { exitCode } = await run(chunk => { task.output = (task.output + chunk).slice(-OUTPUT_KEEP); }, controller.signal);
          task.exitCode = exitCode;
          status = exitCode === 0 ? "completed" : "failed";
        } catch (error) {
          status = controller.signal.aborted || /aborted/.test(error.message) ? "stopped" : "failed";
          task.error = error.message;
        }
        // Live until the worker has closed: the turn line and session shutdown both wait on live tasks.
        try { await close?.(); } catch {}
        task.status = status;
        // A session replaced while the task ran leaves a stale pi API that throws; the line is lost, not the process.
        try {
          record({ id, command, status, durationMs: now() - task.startedAt });
          const reason = task.exitCode != null ? `exit ${task.exitCode}` : task.error ?? status;
          const tail = task.output.split("\n").filter(line => line.trim()).slice(-TAIL_LINES).join("\n");
          notify(`Background task ${id} ${status} (${reason}): ${command}\n${tail || "(no output)"}`);
        } catch {}
      })();
      return id;
    },
    output(id) {
      const task = find(id);
      return `${task.status}${task.exitCode != null ? ` (exit ${task.exitCode})` : ""}\n${task.output || "(no output)"}`;
    },
    stop(id) {
      const task = find(id);
      if (task.status !== "running") return false;
      task.controller.abort();
      return true;
    },
    live: () => running().length,
    // Bounded: session shutdown awaits this, and a worker that never answers
    // the abort must not hold it; the broker's lease teardown kills it after.
    stopAll({ timeoutMs = 5_000 } = {}) {
      const live = running();
      for (const task of live) task.controller.abort();
      return Promise.race([Promise.all(live.map(task => task.done)), new Promise(resolve => setTimeout(resolve, timeoutMs).unref())]);
    },
  };
}
