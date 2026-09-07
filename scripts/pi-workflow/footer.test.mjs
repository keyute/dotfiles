import test from "node:test";
import assert from "node:assert/strict";
import { buildSegments, footerEnv, formatReset, installFooter, parseGitChanges, parseRateLimits, windowLabel } from "./footer.mjs";

test("footer subprocesses never inherit workflow broker credentials", () => {
  const clean = footerEnv({ PATH: "/bin", PI_WORKFLOW_SOCKET: "/tmp/s", PI_WORKFLOW_TOKEN: "secret" });
  assert.deepEqual(clean, { PATH: "/bin" });
});

test("rate limits key only on stable window fields", () => {
  const parsed = parseRateLimits({
    rateLimits: {
      primary: { usedPercent: 12, resetsAt: 1_800_000_000, windowDurationMins: 300 },
      secondary: { usedPercent: 40 },
      credits: { hasCredits: true, unlimited: false },
    },
    rateLimitUpsell: { anything: "ignored" },
  });
  assert.deepEqual(parsed, [
    { usedPercent: 12, resetsAt: 1_800_000_000, windowMins: 300 },
    { usedPercent: 40, resetsAt: null, windowMins: null },
  ]);
  assert.equal(parseRateLimits({ rateLimits: {} }), null);
  assert.equal(parseRateLimits(undefined), null);
  assert.equal(parseRateLimits({ rateLimits: { primary: { usedPercent: "50" } } }), null);
});

test("windows label by duration, not position", () => {
  assert.equal(windowLabel(300), "ses");
  assert.equal(windowLabel(10_080), "wk");
  assert.equal(windowLabel(720), "12h");
  assert.equal(windowLabel(null), "usage");
});

test("segments follow the ccstatusline order and omit missing data", () => {
  const texts = segments => segments.map(s => s.text);
  assert.deepEqual(
    texts(
      buildSegments({
        modelId: "gpt-5.6-sol",
        thinkingLevel: "high",
        contextPercent: 12.34,
        limits: [
          { usedPercent: 7, resetsAt: null, windowMins: 300 },
          { usedPercent: 41, resetsAt: null, windowMins: 10_080 },
        ],
        branch: "main",
        changes: "+3 -1",
      }),
    ),
    ["gpt-5.6-sol high", "12.3%", "ses 7%", "wk 41%", "main +3 -1"],
  );
  assert.deepEqual(texts(buildSegments({ modelId: "gpt-5.6-sol", contextPercent: null, limits: null, branch: null })), [
    "gpt-5.6-sol",
  ]);
});

test("reset timestamps format as time, weekly with weekday", () => {
  assert.match(formatReset(1_800_000_000), /^\d{2}:\d{2}$/);
  assert.match(formatReset(1_800_000_000, { weekday: true }), /^[A-Z][a-z]{2} \d{2}:\d{2}$/);
  assert.equal(formatReset(null), "");
});

test("git shortstat parses to compact change counts", () => {
  assert.equal(parseGitChanges(" 3 files changed, 14 insertions(+), 2 deletions(-)"), "+14 -2");
  assert.equal(parseGitChanges(" 1 file changed, 5 deletions(-)"), "-5");
  assert.equal(parseGitChanges(""), null);
});

test("footer renders the status line first and the fleet rows under it", () => {
  const path = process.env.PATH;
  process.env.PATH = ""; // codex/git lookups fail fast instead of spawning
  try {
    let factory;
    const attached = [];
    const fleet = { attach: tui => attached.push(tui), render: (width, theme) => [theme.fg("dim", `rows@${width}`)] };
    const ctx = { cwd: ".", model: { id: "gpt-5.6-sol" }, thinkingLevel: "high", getContextUsage: () => ({ percent: 27.2 }), ui: { setFooter: make => { factory = make; } } };
    installFooter({ on() {} }, ctx, { fleet });
    const tui = { requestRender() {} };
    const footerData = { onBranchChange: () => () => {}, getGitBranch: () => "main", getExtensionStatuses: () => new Map([["workflow", "plan"]]) };
    const lines = factory(tui, { fg: (_color, text) => text }, footerData).render(60);
    assert.deepEqual(attached, [tui]);
    assert.equal(lines[0], "  gpt-5.6-sol high · 27.2% · main" + " ".repeat(60 - 4 - 31 - 4) + "plan  ");
    assert.deepEqual(lines.slice(1), ["rows@60"]);
  } finally {
    process.env.PATH = path;
  }
});
