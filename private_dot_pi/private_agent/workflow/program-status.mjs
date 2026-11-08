import { writeSync } from "node:fs";
import { replaceControlCharacters } from "@earendil-works/pi-tui";

// OSC 7501 (https://www.superlogical.com/rex/docs/build/program-status): the
// root record plus one `id` record per live child. pi-tui's encoder carries
// neither `id` nor `title`, so the records are encoded here.
const HEADER = "\x1b]7501;";
const QUERY = `${HEADER}?\x1b\\`;
const REPLY = /\x1b\]7501;\?[^\x07\x1b]*(?:\x07|\x1b\\)/;
const ROOT = "";
const MAX_RECORDS = 32;
const MAX_TITLE_BYTES = 192;
const MAX_MESSAGE_BYTES = 2048;
const ACTIVE = new Set(["working", "blocked"]);

function text(value, maxBytes) {
  let bytes = Buffer.from(replaceControlCharacters(value ?? "").trim(), "utf8");
  if (bytes.length > maxBytes) {
    let end = maxBytes;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
    bytes = bytes.subarray(0, end);
  }
  return bytes.length ? bytes.toString("base64") : "";
}

const recordId = id => String(id).replace(/[^A-Za-z0-9_.+-]/g, "-").slice(0, 32);

function encodeRecord({ id, state, kind, title, message }) {
  const pairs = [`state=${state}`, "app=pi"];
  if (id) pairs.push(`id=${id}`);
  if (state === "blocked" && kind) pairs.push(`kind=${kind}`);
  const encodedTitle = text(title, MAX_TITLE_BYTES);
  if (encodedTitle) pairs.push(`title=${encodedTitle}`);
  const encodedMessage = text(message, MAX_MESSAGE_BYTES);
  if (encodedMessage) pairs.push(`msg=${encodedMessage}`);
  return `${HEADER}${pairs.join(":")}\x1b\\`;
}

// `report({ root, children })` takes the footer's whole activity; only records
// whose encoding changed are written, and a vanished child is cleared.
// Nothing is written until the terminal answers the query: with
// PI_PROGRAM_STATUS=0 pi-tui sends none of its own, and swallows every reply
// before extension input, so the reply is read off raw stdin.
export function installProgramStatus({ stdout = process.stdout, stdin = process.stdin, proc = process } = {}) {
  if (!stdout.isTTY) return undefined;
  let supported = false, stopped = false, suspended = false, current, grace;
  let sent = new Map();
  let pending = "";
  const records = () => {
    if (!current) return new Map();
    const children = new Map(current.children.map(child => [recordId(child.id), child]));
    const ids = [...children.keys()].filter(Boolean).sort().slice(0, MAX_RECORDS);
    return new Map([...ids.map(id => [id, { state: children.get(id).state, frame: encodeRecord({ ...children.get(id), id }) }]),
      [ROOT, { state: current.root.state, frame: encodeRecord({ ...current.root, id: undefined, title: undefined }) }]]);
  };
  // `sent` keeps the children ahead of the root.
  const clears = () => [...sent.keys()].map(id => encodeRecord({ id, state: "clear" })).join("");
  const flush = () => {
    const next = records();
    const frames = [...sent.keys()].filter(id => !next.has(id)).map(id => encodeRecord({ id, state: "clear" }));
    for (const [id, record] of next) if (sent.get(id)?.frame !== record.frame) frames.push(record.frame);
    sent = next;
    if (frames.length) stdout.write(frames.join(""));
  };
  const live = () => supported && !stopped && !suspended;
  const clearAll = () => {
    clearTimeout(grace);
    grace = undefined;
    if (live() && sent.size) stdout.write(clears());
    sent = new Map();
  };
  // A crash or plain exit skips session_shutdown; stdout may not drain after exit.
  const onExit = () => { if (sent.size) writeSync(stdout.fd, clears()); };
  const onContinue = () => {
    suspended = false;
    if (live()) flush();
  };
  const onData = chunk => {
    pending += String(chunk);
    if (REPLY.test(pending)) {
      stdin.off("data", onData);
      pending = "";
      supported = true;
      proc.once("exit", onExit);
      if (live()) flush();
      return;
    }
    // Carry over what could start a split reply.
    const start = pending.lastIndexOf(HEADER);
    pending = start >= 0 ? pending.slice(start) : pending.slice(1 - HEADER.length);
  };
  stdin.on("data", onData);
  stdout.write(QUERY);
  return {
    // Called before workflow cleanup awaits; a later event handler is too late.
    shutdown() {
      clearAll();
      stopped = true;
      stdin.off("data", onData);
      proc.off("exit", onExit);
      proc.off("SIGCONT", onContinue);
      pending = "";
    },
    // Before the footer's attach, whose initial report belongs to the new session.
    attach() {
      clearTimeout(grace);
      grace = undefined;
      stopped = false;
      current = undefined;
      stdin.off("data", onData);
      proc.off("exit", onExit);
      if (supported) proc.once("exit", onExit);
      else stdin.on("data", onData);
      proc.off("SIGCONT", onContinue);
      if (suspended) proc.once("SIGCONT", onContinue);
    },
    // Ctrl+Z hands the pane to the shell; pi's resume reports nothing of ours.
    suspend() {
      if (stopped || suspended) return;
      clearAll();
      suspended = true;
      proc.once("SIGCONT", onContinue);
    },
    report(activity) {
      if (stopped) return;
      current = activity;
      if (!live()) return;
      // Hold the gaps before shell follow-ups, abort-and-send and compaction:
      // only the root leaving work for rest waits, and a pending hold sends
      // whatever is current when it ends.
      if (ACTIVE.has(sent.get(ROOT)?.state) && !ACTIVE.has(activity.root.state)) {
        grace ??= setTimeout(() => { grace = undefined; flush(); }, 250);
        grace.unref?.();
        return;
      }
      clearTimeout(grace);
      grace = undefined;
      flush();
    },
  };
}
