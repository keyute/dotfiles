import { spawn } from "node:child_process";
import { Loader, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { readLines, sendLine } from "./lines.mjs";
import { PAD, closeFolds, createTurnClock, defaultFolds, formatTurn, paintCounts } from "./rows.mjs";
import { hostEnvironment } from "./sandbox-runner.mjs";

// Usage comes from codex's own app-server (JSONL JSON-RPC, `jsonrpc` header
// omitted on the wire) rather than the ChatGPT backend directly: codex owns
// auth refresh and any endpoint rename, and the read is account-scoped and
// read-only. excludeResetCreditDetails skips a second backend lookup; the
// luna-reserve capability is deliberately never declared — it is an opt-in
// for clients that can apply Reserve, not for passive usage readers.
export function readRateLimits({ timeoutMs = 10_000, spawnImpl = spawn } = {}) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawnImpl("codex", ["-s", "read-only", "-a", "never", "app-server"], {
        env: hostEnvironment(),
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch {
      return resolve(null);
    }
    const done = value => {
      clearTimeout(timer);
      child.kill("SIGTERM");
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    child.on("error", () => done(null));
    child.on("close", () => done(null));
    child.stdin.on("error", () => {});
    const send = message => sendLine(child.stdin, message);
    readLines(child.stdout, message => {
      if (message.id === 1) {
        send({ method: "initialized" });
        // no params: codex-cli 0.153.4 declares them as unit and rejects a
        // map; the newer optional params object is nullable anyway
        send({ id: 2, method: "account/rateLimits/read" });
      } else if (message.id === 2) {
        done(message.error ? null : parseRateLimits(message.result));
      }
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "pi-workflow-footer", title: "Pi workflow footer", version: "1.0.0" } } });
  });
}

// Keys only on the long-stable fields; everything else in the response is
// additive churn (credits, spend controls, upsells) and ignored on purpose.
// Which windows exist varies by plan (observed: prolite reports the weekly
// window as `primary` and no 5h window), so windows are labeled by duration,
// as codex's own TUI does — never by primary/secondary position.
export function parseRateLimits(result) {
  const windows = [result?.rateLimits?.primary, result?.rateLimits?.secondary]
    .filter(w => w && typeof w.usedPercent === "number")
    .map(w => ({ usedPercent: w.usedPercent, resetsAt: w.resetsAt ?? null, windowMins: w.windowDurationMins ?? null }));
  return windows.length ? windows : null;
}

export function windowLabel(windowMins) {
  if (windowMins == null) return "usage";
  if (windowMins <= 300) return "ses";
  if (windowMins >= 10_080) return "wk";
  return `${Math.round(windowMins / 60)}h`;
}

export function formatReset(resetsAt, { weekday = false } = {}) {
  if (!resetsAt) return "";
  const date = new Date(resetsAt * 1000);
  const time = date.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
  return weekday ? `${date.toLocaleDateString("en-US", { weekday: "short" })} ${time}` : time;
}

// Segment order mirrors the Claude Code ccstatusline config:
// model · ctx% · ses <used%> <reset> · wk <used%> <reset> · branch changes
export function buildSegments({ modelId, thinkingLevel, contextPercent, limits, branch, changes }) {
  const segments = [];
  if (modelId) segments.push({ text: thinkingLevel ? `${modelId} ${thinkingLevel}` : modelId, color: "accent" });
  if (contextPercent != null) segments.push({ text: `${contextPercent.toFixed(1)}%` });
  for (const window of limits ?? []) {
    const weekday = window.windowMins != null && window.windowMins >= 1440;
    const reset = formatReset(window.resetsAt, { weekday });
    segments.push({ text: `${windowLabel(window.windowMins)} ${window.usedPercent}%${reset ? ` ${reset}` : ""}`, color: "dim" });
  }
  // The counts ride the branch segment rather than joining its text: they take
  // the success/error pair the transcript's own diff counts take.
  if (branch) segments.push({ text: branch, color: "accent", changes });
  return segments;
}

export const paintSegment = (segment, theme) => {
  const text = segment.color ? theme.fg(segment.color, segment.text) : segment.text;
  return segment.changes ? `${text} ${paintCounts(segment.changes, theme)}` : text;
};

// The mode takes the pair the plan row already gives approved and not approved:
// scoped execution is success, a plan awaiting approval is warning. The word
// carries the meaning, so nothing rests on the colour. The approval setting
// rides beside it dim — /approvals changes what the broker prompts for and had
// no visible trace anywhere.
export function paintMode(status, theme) {
  if (!status) return "";
  const [mode, approval] = status.split(" ");
  const painted = theme.fg(mode === "execute" ? "success" : "warning", mode);
  return approval ? `${painted}${theme.fg("dim", ` · ${approval}`)}` : painted;
}

export function parseGitChanges(shortstat) {
  const insertions = shortstat.match(/(\d+) insertion/)?.[1];
  const deletions = shortstat.match(/(\d+) deletion/)?.[1];
  if (!insertions && !deletions) return null;
  return [insertions && `+${insertions}`, deletions && `-${deletions}`].filter(Boolean).join(" ");
}

function readGitChanges(cwd) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn("git", ["diff", "HEAD", "--shortstat"], {
        cwd,
        env: hostEnvironment(),
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      return resolve(null);
    }
    let output = "";
    child.stdout.on("data", chunk => (output += chunk));
    child.on("error", () => resolve(null));
    child.on("close", code => resolve(code === 0 ? parseGitChanges(output) : null));
  });
}

// The working row is ours, not pi's (docs/pi-design.md rules 3 and 8): pi's own
// standalone Loader row hardcodes a leading blank line and a one-column indent,
// and setWidget's string form wraps its lines in that same indent, so the glyph
// could never reach column 0. As a widget it sits directly above the composer —
// pi docks widgetsAbove between the status container and the editor.
class WorkingRow extends Loader {
  constructor(tui, theme) {
    super(tui, text => theme.fg("accent", text), text => theme.fg("muted", text), "");
    this.paddingX = 0;
    this.stop();
  }
  // Loader prefixes a blank line of its own; the row takes a trailing one
  // instead, so it stands off the composer. Between turns the row is nothing,
  // so no gap opens where the spinner is not running.
  render(width) {
    return this.message ? [...super.render(width).slice(1), ""] : [];
  }
  dispose() {
    this.stop();
  }
}

const USAGE_MIN_INTERVAL_MS = 60_000;
const GIT_MIN_INTERVAL_MS = 5_000;

export function installFooter(pi, ctx, { fleet, tasks, clock = createTurnClock(), tickMs = 1000 } = {}) {
  const state = { limits: null, changes: null, usageAt: 0, gitAt: 0, tui: null, tick: null, prompting: false, waiting: false, working: null, compacting: false };

  const refreshUsage = async () => {
    if (Date.now() - state.usageAt < USAGE_MIN_INTERVAL_MS) return;
    state.usageAt = Date.now();
    const limits = await readRateLimits();
    if (limits) {
      state.limits = limits;
      state.tui?.requestRender();
    }
  };
  const refreshGit = async cwd => {
    if (Date.now() - state.gitAt < GIT_MIN_INTERVAL_MS) return;
    state.gitAt = Date.now();
    const changes = await readGitChanges(cwd);
    if (changes !== state.changes) {
      state.changes = changes;
      state.tui?.requestRender();
    }
  };

  // The turn line: one entry per user turn. The clock starts at agent_start and
  // its label rides pi's own working spinner; agent_settled closes the turn
  // unless a background child or task is still running, in which case the turn
  // stays open until the follow-up run settles (or the user types). An
  // aborted run closes at once as "Interrupted".
  const label = () => (state.prompting ? "Waiting for you…" : clock.label());
  // The tick keeps calling this, so the stood-down state has to survive it.
  const showLabel = () => state.working?.setMessage(clock.running() && !state.compacting ? label() : "");
  const stopWorking = () => {
    state.working?.setMessage("");
    state.working?.stop();
  };
  const startWorking = () => {
    state.compacting = false;
    if (!clock.running()) return;
    state.working?.start();
    showLabel();
  };
  const close = options => {
    clearInterval(state.tick);
    state.tick = null;
    state.waiting = false;
    stopWorking();
    const turn = clock.stop(Date.now(), options);
    if (turn) { closeFolds(defaultFolds); pi.appendEntry("workflow-turn", turn); }
  };
  pi.on("agent_start", () => {
    clock.start();
    state.waiting = false;
    state.tick ??= setInterval(showLabel, tickMs);
    startWorking();
  });
  pi.on("agent_end", (event, eventCtx) => {
    void refreshUsage();
    void refreshGit(eventCtx.cwd);
    if (event.messages?.findLast(message => message.role === "assistant")?.stopReason === "aborted") close({ aborted: true });
  });
  pi.on("agent_settled", () => {
    if (!clock.running()) return;
    if ((fleet?.activeCount?.() ?? 0) + (tasks?.live?.() ?? 0) > 0) state.waiting = true;
    else close();
  });
  pi.on("input", event => { if (state.waiting && event.source !== "extension") close(); return { action: "continue" }; });
  pi.on("ui_prompt_start", () => { state.prompting = true; showLabel(); });
  pi.on("ui_prompt_end", () => { state.prompting = false; showLabel(); });
  // pi draws its own indicator while it compacts, in the status container just
  // above this row; rule 3 allows one, so the row stands down and comes back
  // with the turn. Its auto-retry countdown has no documented event and keeps
  // its own indicator alongside this one — the recorded residual.
  pi.on("session_before_compact", () => { state.compacting = true; stopWorking(); });
  pi.on("session_compact", () => startWorking());
  pi.on("session_compact_failed", () => startWorking());
  pi.on("session_shutdown", () => { clearInterval(state.tick); state.tick = null; stopWorking(); });
  pi.registerEntryRenderer("workflow-turn", (entry, _options, theme) => new Text(formatTurn(entry.data, theme), 0, 0));
  pi.on("turn_start", (_event, eventCtx) => void refreshGit(eventCtx.cwd));
  void refreshUsage();
  void refreshGit(ctx.cwd);

  // pi drops every extension surface on a session invalidate (/new, /resume),
  // so they are re-applied at each session start; events are wired once.
  const attach = uiCtx => {
    // pi's built-in working row is switched off in favour of the widget above
    // the composer; with it off no working indicator is ever built, so pi's
    // two-line idle placeholder never lands in the status container either.
    uiCtx.ui.setWorkingVisible(false);
    uiCtx.ui.setWidget("workflow-working", (tui, theme) => (state.working = new WorkingRow(tui, theme)), { placement: "aboveEditor" });
    uiCtx.ui.setFooter((tui, theme, footerData) => {
      state.tui = tui;
      fleet?.attach(tui);
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
      const separator = theme.fg("dim", " · ");
      return {
        dispose: unsubscribe,
        invalidate() {},
        render(width) {
          const segments = buildSegments({
            modelId: uiCtx.model?.id,
            thinkingLevel: uiCtx.thinkingLevel,
            contextPercent: uiCtx.getContextUsage()?.percent ?? null,
            limits: state.limits,
            branch: footerData.getGitBranch(),
            changes: state.changes,
          });
          // The workflow mode; other extensions keep their own surfaces. It is
          // painted here rather than at setStatus so a theme switch repaints it.
          const right = paintMode(footerData.getExtensionStatuses().get("workflow") ?? "", theme);
          // The left side yields first. Truncating the composed line instead
          // eats the mode, and `· auto` and `· ask` clip to the same string —
          // the mode says what the agent may do to the tree, where a branch and
          // its counts are one `git status` away. The composed line already
          // measures the full width; the outer truncate only bounds a terminal
          // too narrow to hold the mode at all.
          const rightWidth = visibleWidth(right);
          const left = truncateToWidth(segments.map(s => paintSegment(s, theme)).join(separator), Math.max(0, width - PAD.length * 2 - rightWidth - 1));
          const pad = " ".repeat(Math.max(1, width - PAD.length * 2 - visibleWidth(left) - rightWidth));
          // Child rows hang under the status line: pi's dock keeps the footer
          // last, so this is the only slot below it.
          return [truncateToWidth(PAD + left + pad + right + PAD, width), ...(fleet?.render(width, theme) ?? [])];
        },
      };
    });
  };
  attach(ctx);
  return { attach };
}
