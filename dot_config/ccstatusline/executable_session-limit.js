#!/usr/bin/env node
// ccstatusline custom-command: print "ses N% <countdown>" from the payload's
// rate_limits.five_hour, or nothing when the plan has no 5h window. Exists
// because ccstatusline's reset-timer falls back to a transcript-estimated 5h
// block, so it can't be hidden. Countdown mirrors its non-compact
// formatUsageDuration so the line looks unchanged.

function main(raw) {
  const w = JSON.parse(raw).rate_limits?.five_hour;
  if (typeof w?.used_percentage !== "number") return;
  let out = `ses ${w.used_percentage.toFixed(1)}%`;
  if (Number.isFinite(w.resets_at)) {
    // resets_at is epoch seconds
    const ms = Math.max(0, w.resets_at * 1000 - Date.now());
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    out += " " + ([h > 0 && `${h}hr`, m > 0 && `${m}m`].filter(Boolean).join(" ") || "0m");
  }
  process.stdout.write(out + "\n");
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (buf += c));
process.stdin.on("end", () => {
  try {
    main(buf);
  } catch {
    // malformed input or no payload: print nothing
  }
});
