import { stripTerminalSequences, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail } from "@earendil-works/pi-coding-agent";
import { PAD, appendVisible, closeLive, defaultFolds, firstLine, formatDuration, shadedBlock } from "./rows.mjs";
import { outputLog } from "./tasks.mjs";

// The `!`/`!!` round trip pi's native BashExecutionComponent used to own
// (docs/pi-design.md rule 5's shell block, and rule 9's
// background exception): this extension intercepts the composer submit, runs
// the command itself and draws it in the transcript's own shape.

export function parseShellInput(text) {
  if (!text.startsWith("!")) return null;
  const excludeFromContext = text.startsWith("!!");
  const command = (excludeFromContext ? text.slice(2) : text.slice(1)).trim();
  return command ? { command, excludeFromContext } : null;
}

// The hidden model-context text; output past the inline limits is in the log
// file the path names, which the agent can read.
export function contextText(details) {
  let text = `Ran \`${details.command}\`\n`;
  text += details.output ? `\`\`\`\n${details.output}\n\`\`\`` : "(no output)";
  if (details.cancelled) text += "\n\n(command cancelled)";
  else if (details.exitCode !== null && details.exitCode !== undefined && details.exitCode !== 0) text += `\n\nCommand exited with code ${details.exitCode}`;
  if (details.truncated) text += "\n\n[Output truncated]";
  if (details.fullOutputPath) text += `\nFull output: ${details.fullOutputPath}`;
  return text;
}

const SHOWN_LINES = 4;

function headerLines(details, theme, width) {
  const wrapped = wrapTextWithAnsi(details.command, Math.max(1, width - 2)).map(line => theme.fg("userMessageText", line));
  return shadedBlock(theme, wrapped, width, { prompt: "!", promptColour: "error", background: "toolErrorBg", foreground: "userMessageText" });
}

// pi-tui's main-screen renderer throws if a rendered line's visible width
// exceeds the terminal's (tui-main-screen.js, "exceeds terminal width"), so
// every row below the header — arbitrary command output — has to wrap too.
function wrapRow(text, width) {
  return wrapTextWithAnsi(text, Math.max(1, width - PAD.length)).map(line => `${PAD}${line}`);
}

function outputLines(details, expanded, theme, width) {
  if (!details.output) return wrapRow(theme.fg("muted", "no output"), width);
  const lines = details.output.split("\n");
  if (expanded || lines.length <= SHOWN_LINES) return lines.flatMap(line => wrapRow(theme.fg("muted", line), width));
  const failed = details.cancelled || (typeof details.exitCode === "number" && details.exitCode !== 0);
  const head = failed ? lines.slice(0, 2) : [];
  const tail = lines.slice(failed ? -2 : -SHOWN_LINES);
  const hidden = lines.length - head.length - tail.length;
  return [
    ...head.flatMap(line => wrapRow(theme.fg("muted", line), width)),
    ...wrapRow(theme.fg("muted", `… ${hidden} more lines`), width),
    ...tail.flatMap(line => wrapRow(theme.fg("muted", line), width)),
  ];
}

// The header over one dim `↳` line: a run not yet done, or one moved to a
// background task (rule 4's started row, in rule 5's shade).
const noteLines = (details, note, theme, width) => [...headerLines(details, theme, width), "", ...wrapRow(theme.fg("dim", `↳ ${note}`), width)];

// A run's block in pi's pending area, until its result is in the transcript.
export function pendingShellLines(run, theme, width) {
  if (run.details) return shellLines(run.details, {}, theme, width);
  return noteLines(run, run.state === "queued" ? "queued" : "running · ctrl+b to background", theme, width);
}

export function shellLines(details, { expanded = false } = {}, theme, width) {
  if (details.running) return noteLines(details, `task ${details.task} · running`, theme, width);
  const count = details.output ? details.output.split("\n").length : 0;
  const expandable = count > SHOWN_LINES;
  const outcome = details.cancelled ? "warning"
    : typeof details.exitCode === "number" && details.exitCode !== 0 ? "error"
      : details.exitCode === 0 ? "success" : "warning";
  const status = details.cancelled ? "cancelled"
    : typeof details.exitCode === "number" && details.exitCode !== 0 ? `exit ${details.exitCode}`
      : details.exitCode === 0 ? "exit 0" : "exit unknown";
  const summary = `${theme.fg(outcome, expandable ? expanded ? "▾" : "▸" : "•")} Output · ${count} ${count === 1 ? "line" : "lines"} · ${theme.fg(outcome, status)}${details.truncated ? ` · ${theme.fg("warning", "output truncated")}` : ""}${details.task ? ` · task ${details.task} · ${formatDuration(details.durationMs)}` : ""}`;
  return [...headerLines(details, theme, width), "", ...wrapTextWithAnsi(summary, Math.max(1, width)), ...outputLines(details, expanded, theme, width)];
}

// CustomEntryComponent rebuilds its child on theme changes and Ctrl+O; the
// entry's state lives outside that disposable child.
export function shellComponent(details, options, theme, state, repaint = () => {}) {
  if (state) {
    if (state.wasExpanded && !options.expanded) state.open = false;
    state.wasExpanded = options.expanded;
  }
  const expanded = () => options.expanded || state?.open;
  let headerHeight = 0;
  return {
    render(width) {
      headerHeight = headerLines(details, theme, width).length + 1;
      return shellLines(details, { expanded: expanded() }, theme, width);
    },
    invalidate() {},
    handleMouse(event) {
      if (!state || options.expanded || !details.output || details.output.split("\n").length <= SHOWN_LINES) return undefined;
      if (event.type !== "click" || event.button !== "left" || event.y !== headerHeight) return undefined;
      state.open = !state.open;
      repaint();
      return { handled: true };
    },
  };
}

// Terminal control sequences a shell may emit (colour, cursor moves) have no
// meaning once the run is over; \r\n and lone \r both become plain newlines.
// pi-tui's stripper knows only the CSI/OSC family, so what it leaves — a bare
// ESC (`\x1bc` resets a terminal), BEL, backspace — is dropped too, as pi's
// own executor sanitises before display; tabs and newlines stay.
const stripped = output => stripTerminalSequences(output).replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");

// What a run's output gives the block and the model: the log's in-memory
// tail, cleaned and cut to the inline limits, and the full log once kept.
function outputDetails(command, log) {
  // A run that ends mid-line still counts its trailing newlines as content;
  // stripped without this, four newline-terminated lines split into five
  // elements and the last real line hides behind a false "… 1 more lines".
  const cleaned = stripped(log.tail).replace(/\n+$/, "");
  const truncation = truncateTail(cleaned, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
  return { command, output: truncation.content, truncated: truncation.truncated || log.dropped, ...(log.path && { fullOutputPath: log.path }) };
}

// exec/env are injected (createLocalBashOperations().exec and hostEnvironment,
// both already owned by index.mjs) so this stays testable without spawning a
// shell. `now` likewise, for deterministic elapsed times. `idle` reports
// whether the agent is idle (ExtensionContext.isIdle), which gates when Esc
// may reach this runner instead of pi's own agent-abort. `land` writes a
// result where the agent reads it (rows.mjs deliveryLanding); `changed` redraws
// pi's pending area, which shows every run not yet in the transcript.
//
// Runs go one at a time in submit order (Claude Code's `!`): a dependent
// command waits for the one before it. Ctrl+B moves the running one to a
// background task and starts the next.
export function createShellRunner({ pi, cwd, notify, exec, env, land, tasks, changed = () => {}, folds = defaultFolds, working, now = Date.now, idle = () => true, prefix = () => undefined }) {
  // Submit order; a run leaves once its result is written or it moves to a task.
  let runs = [];
  const backgrounded = new Map();
  // Exposed for tests to await the queue draining; submit() itself must
  // return synchronously so the composer knows at once to clear its text.
  let pending = Promise.resolve();
  let drained = null;
  const drain = () => {
    drained?.();
    drained = null;
  };
  const head = () => runs.find(run => run.state === "running");
  const drop = run => {
    runs = runs.filter(other => other !== run);
    changed();
  };

  function start(run) {
    run.state = "running";
    run.startedAt = now();
    run.controller = new AbortController();
    run.log = outputLog({ file: !run.excludeFromContext });
    working({ command: run.command, startedAt: run.startedAt });
    changed();
    // zsh -c parses its whole string before running any of it, so aliases the
    // prefix defines (`source ~/.zshrc`) would miss a newline-joined command;
    // eval makes the command a later parse. The prefix never appears in
    // details.command or the drawn block.
    const shellPrefix = prefix();
    const resolvedCommand = shellPrefix ? `${shellPrefix}\neval '${run.command.replaceAll("'", "'\\''")}'` : run.command;
    run.execution = exec(resolvedCommand, cwd(), { onData: chunk => run.log.append(chunk), signal: run.controller.signal, env: env() });
    run.execution.then(result => finish(run, result), error => finish(run, undefined, error));
  }

  function pump() {
    if (head()) return;
    const next = runs.find(run => run.state === "queued");
    if (next) return start(next);
    working(null);
    drain();
  }

  async function finish(run, result, error) {
    // A run moved to a task is the task's now; a discarded one belongs to a departed session.
    if (run.state !== "running") return;
    run.state = "done";
    const signal = run.controller.signal;
    try {
      await run.log.close();
      if (run.discarded) return;
      if (error && !signal.aborted) {
        notify(`Shell command failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        drop(run);
        return;
      }
      // Our own abort() killed the command; that is cancellation, not failure.
      const details = { ...outputDetails(run.command, run.log), exitCode: signal.aborted ? undefined : (result?.exitCode ?? null), cancelled: signal.aborted };
      run.details = details;
      changed();
      const read = !run.excludeFromContext && !details.cancelled;
      land("workflow-shell", details, { details: read ? details : undefined, landed: () => drop(run) });
      if (!run.excludeFromContext) pi.sendMessage({ customType: "workflow-shell", content: contextText(details), display: false, details }, details.cancelled ? { triggerTurn: false } : { triggerTurn: true, deliverAs: "steer" });
    } catch {
      // A session replaced under a running command (/new, /resume, /reload)
      // makes pi.sendMessage/appendEntry throw (assertActive); the result is lost.
    } finally {
      if (!run.discarded) pump();
    }
  }

  function submit(text) {
    const parsed = parseShellInput(text);
    if (!parsed) return false;
    closeLive(folds);
    if (!drained) pending = new Promise(resolve => { drained = resolve; });
    runs.push({ ...parsed, state: "queued" });
    changed();
    pump();
    return true;
  }

  return {
    submit,
    // Esc: the running command is cancelled (its result still lands) and the
    // queue behind it dropped, so a dependent command never runs on a cancelled one.
    abort() {
      const dropped = runs.filter(run => run.state === "queued");
      if (dropped.length) {
        runs = runs.filter(run => !dropped.includes(run));
        changed();
        notify(`Dropped ${dropped.length === 1 ? "a queued shell command" : `${dropped.length} queued shell commands`}: ${dropped.map(run => `${run.excludeFromContext ? "!!" : "!"}${firstLine(run.command)}`).join(", ")}`, "info");
      }
      head()?.controller.abort();
    },
    // Ctrl+B: the running command carries on as a user task (no sandbox
    // lease, so a mode change leaves it running), reporting when it ends.
    // A task stop aborts the same exec, which kills its process group; a
    // normal end leaves nothing behind, as a foreground `!` does.
    background() {
      const run = head();
      if (!run || run.controller.signal.aborted) return;
      run.state = "background";
      drop(run);
      const id = tasks.start({
        command: run.command,
        user: true,
        hidden: run.excludeFromContext,
        log: run.log,
        run: (_onChunk, signal) => {
          signal.addEventListener("abort", () => run.controller.abort(), { once: true });
          return run.execution.then(({ exitCode }) => ({ exitCode }));
        },
      });
      backgrounded.set(id, run);
      try { appendVisible(pi, "workflow-shell", { command: run.command, task: id, running: true }, folds); } catch {}
      pump();
    },
    // A backgrounded run's end (index.mjs routes its task record here): its
    // output block, where the model reads the task's own completion message.
    taskEnded(entry) {
      const run = backgrounded.get(entry.id);
      if (!run) return;
      backgrounded.delete(entry.id);
      const stopped = entry.status === "stopped";
      const details = { ...outputDetails(run.command, run.log), exitCode: stopped ? undefined : (entry.exitCode ?? null), cancelled: stopped, task: entry.id, durationMs: now() - run.startedAt };
      land("workflow-shell", details, { details: entry.hidden ? undefined : entry });
    },
    // Session departure (index.mjs shutdown, before its first await): a
    // spawned command would otherwise run on, and finish into, a session
    // that is going; nothing queued starts and nothing of these runs lands.
    stop() {
      const live = head();
      for (const run of runs) run.discarded = true;
      runs = [];
      changed();
      backgrounded.clear();
      live?.controller.abort();
      working(null);
      drain();
    },
    runs: () => runs,
    // False once our own abort() has fired: a second Esc during the brief
    // window before the command actually settles must fall through to pi
    // rather than aborting an already-aborted run again.
    running: () => Boolean(head() && !head().controller.signal.aborted),
    // The single check the composer's Esc handling needs: a live, not yet
    // aborted command, and the agent free to hand this editor the keystroke.
    abortable: () => Boolean(head() && !head().controller.signal.aborted && idle()),
    get pending() { return pending; },
  };
}

// Registered once at startup (index.mjs, next to installFolding/installFooter);
// the entry renderer draws new runs; the message renderer retains historical messages. pi
// invalidates the extension ctx on /new and /resume without re-running the
// extension factory, so `context` is a getter for the current session's
// ExtensionContext rather than a captured one.
export function installShell(pi, context, { folds = defaultFolds, working, exec, env, prefix, land, tasks, changed } = {}) {
  const views = new WeakMap();
  const view = (object, details, options, theme) => {
    let state = views.get(object);
    if (!state) {
      state = { open: false, wasExpanded: false };
      views.set(object, state);
    }
    return shellComponent(details, options, theme, state, folds.repaint);
  };
  pi.registerMessageRenderer("workflow-shell", (message, options, theme) => view(message, message.details, options, theme));
  pi.registerEntryRenderer("workflow-shell", (entry, options, theme) => view(entry, entry.data, options, theme));
  return createShellRunner({ pi, folds, working, exec, env, prefix, land, tasks, changed, cwd: () => context().cwd, notify: (...args) => context().ui.notify(...args), idle: () => context().isIdle() });
}
