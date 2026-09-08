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
      run(chunk => { task.output = (task.output + chunk).slice(-OUTPUT_KEEP); }, controller.signal)
        .then(
          ({ exitCode }) => { task.exitCode = exitCode; task.status = exitCode === 0 ? "completed" : "failed"; },
          error => { task.status = controller.signal.aborted || /aborted/.test(error.message) ? "stopped" : "failed"; task.error = error.message; },
        )
        .then(() => close?.())
        .then(() => {
          record({ id, command, status: task.status, durationMs: now() - task.startedAt });
          const reason = task.exitCode != null ? `exit ${task.exitCode}` : task.error ?? task.status;
          const tail = task.output.split("\n").filter(line => line.trim()).slice(-TAIL_LINES).join("\n");
          notify(`Background task ${id} ${task.status} (${reason}): ${command}\n${tail || "(no output)"}`);
        });
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
    stopAll() { for (const task of running()) task.controller.abort(); },
  };
}
