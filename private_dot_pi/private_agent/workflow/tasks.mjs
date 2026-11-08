import { createWriteStream, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail } from "@earendil-works/pi-coding-agent";

// Background shell tasks (Claude Code's run_in_background): the leased worker
// outlives the tool call, output is kept in memory (tail-capped) and logged
// in full once past the inline limits (outputLog), and the end
// of a task reaches the model through pi.sendMessage — with its next tool
// result, or as a new turn when idle — while the transcript gets one
// completion line. A task holds a process lease, so a narrowing mode change
// stops it like any other sandbox process; the worker then reports the exec as
// aborted. A user task (a backgrounded `!`) runs on the host under no lease,
// so only shutdown stops it; a hidden one (`!!`) is the user's alone.
const OUTPUT_KEEP = 256 * 1024;
const TAIL_LINES = 20;

// What reaches the model, held to the foreground bash tool's limits.
function shown(output) {
  const truncation = truncateTail(output, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
  return truncation.truncated ? `[Earlier output dropped; showing the last ${truncation.outputLines} lines]\n${truncation.content}` : output;
}

// One directory per process, made on first use, in the host temp dir beside
// pi's own full-output files: the sandbox profile leaves it readable (of its
// entries only the broker's control dir is denied). Kept after shutdown, so a
// resumed session can still read a path it was given.
let logDir;
let logCount = 0;

// A command's output as the model gets it: a tail held in memory, and every
// raw chunk in a log file once output passes the inline limits, as pi's own
// bash tool keeps (its OutputAccumulator). `path` is set from then on.
// `file: false` keeps only the tail: a hidden (`!!`) run's output must not
// sit where the agent's sandbox can read it.
export function outputLog({ file = true } = {}) {
  const decoder = new TextDecoder();
  let early = [];
  let bytes = 0;
  let newlines = 0;
  let stream;
  const log = {
    tail: "",
    dropped: false,
    path: null,
    append(chunk) {
      const raw = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      log.dropped ||= log.tail.length + text.length > OUTPUT_KEEP;
      log.tail = (log.tail + text).slice(-OUTPUT_KEEP);
      bytes += raw.length;
      // A lone \r counts too, as the `!` block's cleaning turns it into a
      // newline; a \r\n split across chunks counting twice only opens the log sooner.
      newlines += text.match(/\r\n|\r|\n/g)?.length ?? 0;
      // Lines as truncateTail counts them: a trailing newline ends the last one.
      const lines = newlines + (log.tail && !/[\r\n]$/.test(log.tail) ? 1 : 0);
      if (!file) return;
      if (!stream && (bytes > DEFAULT_MAX_BYTES || lines > DEFAULT_MAX_LINES)) {
        logDir ??= mkdtempSync(join(tmpdir(), "pi-output-"));
        log.path = join(logDir, `output-${++logCount}.log`);
        stream = createWriteStream(log.path, { mode: 0o600, flags: "wx" });
        // An unheard stream error would crash pi; a short log is the lesser loss.
        stream.on("error", () => {});
        for (const part of early) stream.write(part);
        early = null;
      }
      if (stream) stream.write(raw);
      else early.push(raw);
    },
    close: () => {
      const text = decoder.decode();
      log.dropped ||= log.tail.length + text.length > OUTPUT_KEEP;
      log.tail = (log.tail + text).slice(-OUTPUT_KEEP);
      return new Promise(resolve => (stream ? stream.end(resolve) : resolve()));
    },
  };
  return log;
}

export function createTasks({ notify, record, now = Date.now, setTimer = setTimeout }) {
  const tasks = new Map();
  const listeners = new Set();
  let next = 1;
  // leased: only the tasks a narrowing mode change must stop.
  const running = ({ leased = false } = {}) => [...tasks.values()].filter(task => task.status === "running" && !(leased && task.user));
  // What the model may name: a hidden task reads as unknown.
  const find = id => {
    const task = tasks.get(id);
    if (!task || task.hidden) throw new Error("Unknown background task");
    return task;
  };
  // exitCode is null when a signal ended the command (ops-worker reports no code).
  const reason = task => (task.status === "running" ? null : task.exitCode != null ? `exit ${task.exitCode}` : task.error ?? "killed");
  const fullOutput = task => (task.log.path ? `\nFull output: ${task.log.path}` : "");
  const summary = task => `${task.status}${reason(task) ? ` (${reason(task)})` : ""}\n${shown(task.log.tail) || "(no output)"}${fullOutput(task)}`;
  return {
    // log: an outputLog that already holds the command's output so far, when a
    // running foreground command is handed over; the task keeps filling it.
    start({ command, run, close, user = false, hidden = false, log = outputLog(), startedAt = now() }) {
      const id = `t${next++}`;
      const controller = new AbortController();
      const task = { id, command, startedAt, status: "running", log, exitCode: null, error: null, controller, claimed: false, silent: false, user, hidden };
      tasks.set(id, task);
      task.done = (async () => {
        let status;
        try {
          const { exitCode } = await run(chunk => log.append(chunk), controller.signal);
          task.exitCode = exitCode;
          status = exitCode === 0 ? "completed" : "failed";
        } catch (error) {
          status = controller.signal.aborted || /aborted/.test(error.message) ? "stopped" : "failed";
          task.error = error.message;
        }
        // Live until the worker has closed: the turn line and session shutdown both wait on live tasks.
        try { await log.close(); await close?.(); } catch {}
        task.status = status;
        // A silent stop is shutdown's: the listeners belong to the outgoing session.
        if (!task.silent) for (const listener of listeners) listener();
        // A caller still holding the tool call open takes the result as that call's
        // reply; the message and the line exist to reach a model that has moved on.
        if (task.claimed || task.silent) return;
        // A session replaced while the task ran leaves a stale pi API that throws; the line is lost, not the process.
        try {
          const entry = { id, command, status, exitCode: task.exitCode, durationMs: now() - task.startedAt, ...(user && { user }), ...(hidden && { hidden }) };
          record(entry);
          if (hidden) return;
          const tail = truncateTail(log.tail.split("\n").filter(line => line.trim()).join("\n"), { maxLines: TAIL_LINES, maxBytes: DEFAULT_MAX_BYTES }).content;
          // The entry rides as the message's details: its line lands where the model reads this.
          notify(`Background task ${id} ${status} (${reason(task)}): ${command}\n${tail || "(no output)"}${fullOutput(task)}`, { details: entry });
        } catch {}
      })();
      return id;
    },
    // Holds the tool call open for up to graceMs: a task that ends inside it is
    // answered inline (status, exit code or error, output) and never notifies, so a two-second check backgrounded
    // by habit does not cost the model a full-context wake-up turn later.
    // An aborted turn (Esc) ends the wait, not the task, as for any other call.
    settle(id, graceMs, signal) {
      const task = find(id);
      task.claimed = true;
      let timer;
      return Promise.race([
        task.done,
        new Promise(resolve => { timer = setTimer(resolve, graceMs); timer.unref?.(); }),
        new Promise(resolve => { if (signal?.aborted) resolve(); else signal?.addEventListener("abort", resolve, { once: true }); }),
      ]).then(() => {
        clearTimeout(timer);
        // Status is set before the claim is read, so a task that ended as the
        // grace ran out is still answered here rather than notified nowhere.
        if (task.status !== "running") return { status: task.status, exitCode: task.exitCode, error: task.error, output: shown(task.log.tail) + fullOutput(task) };
        task.claimed = false;
        return null;
      });
    },
    list: () => [...tasks.values()].filter(task => !task.hidden).map(({ id, status, command }) => ({ id, status, command })),
    output: id => summary(find(id)),
    stop(id) {
      const task = find(id);
      if (task.status !== "running") return false;
      task.controller.abort();
      return true;
    },
    live: options => running(options).length,
    // Fires whenever live() may have dropped.
    onChange: listener => { listeners.add(listener); },
    // Bounded: session shutdown awaits this, and a worker that never answers
    // the abort must not hold it; the broker's lease teardown kills it after.
    stopAll({ timeoutMs = 5_000, silent = false, leased = false } = {}) {
      const live = running({ leased });
      // Shutdown silence is marked before abort: a synchronous rejection from
      // the worker must not race its settlement notification past teardown.
      if (silent) for (const task of live) task.silent = true;
      for (const task of live) task.controller.abort();
      return Promise.race([Promise.all(live.map(task => task.done)), new Promise(resolve => setTimeout(resolve, timeoutMs).unref())]);
    },
  };
}
