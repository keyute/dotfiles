import { formatProgramStatus } from "@earendil-works/pi-tui";

export function installProgramStatus(env = process.env, stdout = process.stdout) {
  if (env.TUIOS_ENV !== "1" || !stdout.isTTY) return undefined;
  let sent, idle, worked = false, suspended = false;
  const send = activity => {
    if (activity.state === sent?.state && activity.message === sent?.message) return;
    sent = activity;
    // OSC idle is not completion. Remember work across a genuine user wait,
    // but never turn an idle menu's dismissal into done.
    const state = activity.state === "idle" && worked ? "done" : activity.state;
    if (activity.state === "working") worked = true;
    else if (activity.state === "idle") worked = false;
    stdout.write(formatProgramStatus({ ...activity, state, app: "pi" }));
  };
  return {
    // Called before workflow cleanup awaits; a later event handler is too late.
    shutdown() {
      suspended = true;
      clearTimeout(idle);
      sent = undefined;
      worked = false;
    },
    // Before the footer's attach, whose initial report belongs to the new session.
    attach() {
      clearTimeout(idle);
      suspended = false;
      sent = undefined;
      worked = false;
    },
    report(activity) {
      if (suspended) return;
      clearTimeout(idle);
      if (activity.state !== "idle" || !sent || sent.state === "idle") return send(activity);
      // Hold gaps before shell follow-ups, abort-and-send and compaction.
      idle = setTimeout(() => send(activity), 250);
      idle.unref?.();
    },
  };
}
