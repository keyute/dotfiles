import { spawn } from "node:child_process";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// The root workflow exports the broker socket and bearer token into
// process.env for child sessions; footer subprocesses sit outside that
// boundary and must not inherit them.
export function footerEnv(env = process.env) {
  const clean = { ...env };
  for (const key of Object.keys(clean)) if (key.startsWith("PI_WORKFLOW_")) delete clean[key];
  return clean;
}

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
        env: footerEnv(),
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
    const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
    let buffer = "";
    child.stdout.on("data", chunk => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1) {
          send({ method: "initialized" });
          // no params: codex-cli 0.153.4 declares them as unit and rejects a
          // map; the newer optional params object is nullable anyway
          send({ id: 2, method: "account/rateLimits/read" });
        } else if (message.id === 2) {
          done(message.error ? null : parseRateLimits(message.result));
        }
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
  if (branch) segments.push({ text: changes ? `${branch} ${changes}` : branch, color: "accent" });
  return segments;
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
        env: footerEnv(),
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

const USAGE_MIN_INTERVAL_MS = 60_000;
const GIT_MIN_INTERVAL_MS = 5_000;

export function installFooter(pi, ctx) {
  const state = { limits: null, changes: null, usageAt: 0, gitAt: 0, tui: null };

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
  pi.on("agent_end", (_event, eventCtx) => {
    void refreshUsage();
    void refreshGit(eventCtx.cwd);
  });
  pi.on("turn_start", (_event, eventCtx) => void refreshGit(eventCtx.cwd));
  void refreshUsage();
  void refreshGit(ctx.cwd);

  ctx.ui.setFooter((tui, theme, footerData) => {
    state.tui = tui;
    const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
    const separator = theme.fg("dim", " · ");
    return {
      dispose: unsubscribe,
      invalidate() {},
      render(width) {
        const segments = buildSegments({
          modelId: ctx.model?.id,
          thinkingLevel: ctx.thinkingLevel,
          contextPercent: ctx.getContextUsage()?.percent ?? null,
          limits: state.limits,
          branch: footerData.getGitBranch(),
          changes: state.changes,
        });
        const left = segments.map(s => (s.color ? theme.fg(s.color, s.text) : s.text)).join(separator);
        // Only the workflow mode; other extensions keep their own surfaces.
        const right = footerData.getExtensionStatuses().get("workflow") ?? "";
        const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
        return [truncateToWidth(left + pad + right, width)];
      },
    };
  });
}
