import { stripTerminalSequences, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail } from "@earendil-works/pi-coding-agent";
import { PAD, appendVisible, closeFolds, defaultFolds, pad, shade } from "./rows.mjs";

// The `!`/`!!` round trip pi's native BashExecutionComponent used to own
// (docs/pi-design.md rule 5, 2026-09-24 shell-block note, and rule 9's
// background exception): this extension intercepts the composer submit, runs
// the command itself and draws it in the transcript's own shape. Mirrors pi's
// own parsing (interactive-mode.js ~2588-2591) and its bashExecutionToText
// (messages.js) for the hidden model-context message.

export function parseShellInput(text) {
  if (!text.startsWith("!")) return null;
  const excludeFromContext = text.startsWith("!!");
  const command = (excludeFromContext ? text.slice(2) : text.slice(1)).trim();
  return command ? { command, excludeFromContext } : null;
}

// Mirrors bashExecutionToText (core/messages.js): the same literal shape, but
// without the fullOutputPath truncation line — we have no saved-file path, so
// a truncated run says so plainly instead.
export function contextText(details) {
  let text = `Ran \`${details.command}\`\n`;
  text += details.output ? `\`\`\`\n${details.output}\n\`\`\`` : "(no output)";
  if (details.cancelled) text += "\n\n(command cancelled)";
  else if (details.exitCode !== null && details.exitCode !== undefined && details.exitCode !== 0) text += `\n\nCommand exited with code ${details.exitCode}`;
  if (details.truncated) text += "\n\n[Output truncated]";
  return text;
}

const SHOWN_LINES = 4;

function headerLines(details, theme, width) {
  const wrapped = wrapTextWithAnsi(details.command, Math.max(1, width - 2));
  const content = wrapped.map((line, i) => (i === 0
    ? `${theme.fg("error", "! ")}${theme.fg("userMessageText", line)}`
    : `${PAD}${theme.fg("userMessageText", line)}`));
  return ["", ...content, ""].map(line => shade(theme, pad(line, width), "toolErrorBg", "userMessageText"));
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

export function shellLines(details, { expanded = false } = {}, theme, width) {
  const count = details.output ? details.output.split("\n").length : 0;
  const expandable = count > SHOWN_LINES;
  const outcome = details.cancelled ? "warning"
    : typeof details.exitCode === "number" && details.exitCode !== 0 ? "error"
      : details.exitCode === 0 ? "success" : "warning";
  const status = details.cancelled ? "cancelled"
    : typeof details.exitCode === "number" && details.exitCode !== 0 ? `exit ${details.exitCode}`
      : details.exitCode === 0 ? "exit 0" : "exit unknown";
  const summary = `${theme.fg(outcome, expandable ? expanded ? "▾" : "▸" : "•")} Output · ${count} ${count === 1 ? "line" : "lines"} · ${theme.fg(outcome, status)}${details.truncated ? ` · ${theme.fg("warning", "output truncated")}` : ""}`;
  return [...headerLines(details, theme, width), ...wrapTextWithAnsi(summary, Math.max(1, width)), ...outputLines(details, expanded, theme, width)];
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
      headerHeight = headerLines(details, theme, width).length;
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

// The same rolling-buffer bound pi's own executor keeps while a command is
// still running (core/bash-executor.js, "Keep rolling buffer") — without it a
// noisy command holds its entire output in memory for the run's whole life.
const BUFFER_BYTES = DEFAULT_MAX_BYTES * 2;

// exec/env are injected (createLocalBashOperations().exec and hostEnvironment,
// both already owned by index.mjs) so this stays testable without spawning a
// shell. `now` likewise, for deterministic elapsed times. `idle` reports
// whether the agent is idle (ExtensionContext.isIdle), which gates when Esc
// may reach this runner instead of pi's own agent-abort.
export function createShellRunner({ pi, cwd, notify, exec, env, folds = defaultFolds, working, now = Date.now, idle = () => true, prefix = () => undefined }) {
  let controller = null;
  // Exposed for tests to await the in-flight command; submit() itself must
  // return synchronously so the composer knows at once whether to keep its text.
  let pending = Promise.resolve();

  async function run(command, excludeFromContext, signal) {
    // A single streaming decoder spans every chunk, so a multi-byte character
    // split across two chunks still decodes whole; the rolling buffer drops
    // from the front once it grows past the bound, same as pi's own executor.
    const decoder = new TextDecoder();
    const chunks = [];
    let bytes = 0;
    let dropped = false;
    const onData = chunk => {
      const text = decoder.decode(chunk, { stream: true });
      chunks.push(text);
      bytes += text.length;
      while (bytes > BUFFER_BYTES && chunks.length > 1) {
        bytes -= chunks.shift().length;
        dropped = true;
      }
    };
    let result;
    // pi's own bash tool composes the same way (core/tools/bash.js); the
    // prefix runs but never appears in details.command or the drawn block.
    const shellCommandPrefix = prefix();
    const resolvedCommand = shellCommandPrefix ? `${shellCommandPrefix}\n${command}` : command;
    try {
      result = await exec(resolvedCommand, cwd(), { onData, signal, env: env() });
    } catch (error) {
      if (!signal.aborted) {
        notify(`Shell command failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        return;
      }
      // Our own abort() killed the command; that is cancellation, not failure.
      result = undefined;
    }
    chunks.push(decoder.decode());
    // A run that ends mid-line still counts its trailing newlines as content;
    // stripped without this, four newline-terminated lines split into five
    // elements and the last real line hides behind a false "… 1 more lines".
    const cleaned = stripped(chunks.join("")).replace(/\n+$/, "");
    const truncation = truncateTail(cleaned, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
    const details = {
      command,
      output: truncation.content,
      exitCode: signal.aborted ? undefined : (result?.exitCode ?? null),
      cancelled: signal.aborted,
      truncated: truncation.truncated || dropped,
    };
    appendVisible(pi, "workflow-shell", details, folds);
    if (!excludeFromContext) pi.sendMessage({ customType: "workflow-shell", content: contextText(details), display: false, details }, { triggerTurn: false });
  }

  function submit(text) {
    const parsed = parseShellInput(text);
    if (!parsed) return false;
    if (controller) {
      notify("A shell command is already running. Press Esc to cancel it first.", "warning");
      return "busy";
    }
    const { command, excludeFromContext } = parsed;
    closeFolds(folds);
    working({ command, startedAt: now() });
    controller = new AbortController();
    const signal = controller.signal;
    // A session replaced under a running command (/new, /resume, /reload)
    // makes pi.sendMessage/appendEntry throw (assertActive); that rejection
    // has no handler once submit() has returned, so it must not escape.
    pending = run(command, excludeFromContext, signal).finally(() => {
      controller = null;
      working(null);
    }).catch(() => {});
    return true;
  }

  return {
    submit,
    abort() { controller?.abort(); },
    // False once our own abort() has fired: a second Esc during the brief
    // window before the command actually settles must fall through to pi
    // rather than aborting an already-aborted run again.
    running: () => controller !== null && !controller.signal.aborted,
    // The single check the composer's Esc handling needs: a live, not yet
    // aborted command, and the agent free to hand this editor the keystroke.
    abortable: () => controller !== null && !controller.signal.aborted && idle(),
    get pending() { return pending; },
  };
}

// Registered once at startup (index.mjs, next to installFolding/installFooter);
// the entry renderer draws new runs; the message renderer retains historical messages. pi
// invalidates the extension ctx on /new and /resume without re-running the
// extension factory, so `context` is a getter for the current session's
// ExtensionContext rather than a captured one.
export function installShell(pi, context, { folds = defaultFolds, working, exec, env, prefix } = {}) {
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
  const runner = createShellRunner({ pi, folds, working, exec, env, prefix, cwd: () => context().cwd, notify: (...args) => context().ui.notify(...args), idle: () => context().isIdle() });
  // A session tear-down otherwise leaves a spawned command running with
  // nothing left to record its result; the footer already listens to the
  // same event to stand its own row down.
  pi.on("session_shutdown", () => runner.abort());
  return runner;
}
