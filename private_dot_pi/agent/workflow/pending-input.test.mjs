import test from "node:test";
import assert from "node:assert/strict";
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { installPendingInput } from "./pending-input.mjs";

const palette = name => ({ fg: (color, text) => `\x1b[${color === "userMessageText" ? 36 : name === "mocha" ? 31 : 32}m${text}\x1b[39m`, bg: (_color, text) => `\x1b[${name === "mocha" ? 41 : 42}m${text}\x1b[49m` });
const plain = line => line.replace(/\x1b\[[0-9;]*m/g, "");

function host() {
  const queue = { steering: [], followUp: [] };
  const children = [];
  const mode = Object.create(InteractiveMode.prototype);
  mode.pendingMessagesContainer = { children, clear: () => { children.length = 0; }, addChild: child => children.push(child) };
  mode.ui = { requestRender() {} };
  mode.getAppKeyDisplay = action => action === "app.message.dequeue" ? "alt+up" : "unexpected";
  Object.defineProperty(mode, "session", { value: {
    getSteeringMessages: () => [...queue.steering], getFollowUpMessages: () => [...queue.followUp],
    clearQueue: () => { const prior = { steering: [...queue.steering], followUp: [...queue.followUp] }; queue.steering.length = 0; queue.followUp.length = 0; return prior; },
  } });
  mode.compactionQueuedMessages = [];
  mode.editor = { getText: () => "", setText: text => { mode.restored = text; } };
  return { mode, queue, children, render: width => children.flatMap(child => child.render(width)) };
}

test("display reads native queues, retains order, and clears only the view on dequeue/compaction", () => {
  let theme = palette("mocha");
  installPendingInput(() => theme);
  const { mode, queue, children, render } = host();
  queue.steering.push("first steering", "second steering");
  queue.followUp.push("later follow-up");
  mode.updatePendingMessagesDisplay();
  const output = render(60).map(plain).join("\n");
  assert.ok(output.indexOf("first steering") < output.indexOf("second steering"));
  assert.ok(output.indexOf("second steering") < output.indexOf("later follow-up"));
  assert.match(output, /π Steering · next response/);
  assert.match(output, /π Follow-up · after current task/);
  assert.equal(output.match(/alt\+up/g)?.length, 1);
  assert.equal(output.match(/❯ /g)?.length, 3);
  assert.match(render(60).join("\n"), /\x1b\[36mfirst steering/);
  const shaded = render(60).filter(line => line.startsWith("\x1b[41m"));
  assert.equal(shaded.length, 9, "each queued input has a content row and two shaded blank rows");
  assert.ok(shaded.every(line => visibleWidth(line) === 60), "shading spans the entire render width");
  assert.equal(plain(shaded[0]), " ".repeat(60));
  assert.equal(plain(shaded[2]), " ".repeat(60));
  assert.deepEqual(queue, { steering: ["first steering", "second steering"], followUp: ["later follow-up"] });
  mode.compactionQueuedMessages.push({ text: "compaction follow-up", mode: "followUp" });
  mode.updatePendingMessagesDisplay();
  assert.match(render(60).map(plain).join("\n"), /compaction follow-up/);
  assert.equal(mode.restoreQueuedMessagesToEditor(), 4);
  assert.equal(mode.restored, "first steering\n\nsecond steering\n\nlater follow-up\n\ncompaction follow-up");
  assert.deepEqual(queue, { steering: [], followUp: [] });
  assert.equal(children.length, 0);
});

test("consumed steering leaves follow-ups visible, and native abort restores the remainder with the draft", () => {
  installPendingInput(() => palette("mocha"));
  const { mode, queue, children, render } = host();
  queue.steering.push("consumed steer");
  queue.followUp.push("remaining follow-up");
  mode.updatePendingMessagesDisplay();
  queue.steering.shift();
  mode.updatePendingMessagesDisplay();
  const text = render(60).map(plain).join("\n");
  assert.doesNotMatch(text, /consumed steer|π Steering/);
  assert.match(text, /remaining follow-up/);
  let aborted = false;
  mode.session.abort = () => { aborted = true; };
  assert.equal(mode.restoreQueuedMessagesToEditor({ abort: true, currentText: "draft" }), 1);
  assert.equal(mode.restored, "remaining follow-up\n\ndraft");
  assert.equal(aborted, true);
  assert.equal(children.length, 0);
});

test("width and live theme switch, including reinstallation, never stale-cache queued blocks", () => {
  let theme = palette("mocha");
  installPendingInput(() => theme);
  const method = InteractiveMode.prototype.updatePendingMessagesDisplay;
  installPendingInput(() => theme);
  assert.equal(InteractiveMode.prototype.updatePendingMessagesDisplay, method);
  const { mode, queue, render } = host();
  queue.followUp.push("界 long words across narrow widths\nsecond line");
  mode.updatePendingMessagesDisplay();
  for (const width of [3, 12, 40]) assert.ok(render(width).every(line => visibleWidth(line) <= width));
  assert.match(render(40).join("\n"), /\x1b\[41m/);
  theme = palette("latte");
  assert.match(render(40).join("\n"), /\x1b\[42m/);
});

test("a fresh module updates the installed display's theme getter without wrapping it again", async () => {
  installPendingInput(() => palette("mocha"));
  const method = InteractiveMode.prototype.updatePendingMessagesDisplay;
  const { mode, queue, render } = host();
  queue.followUp.push("new theme");
  mode.updatePendingMessagesDisplay();
  assert.match(render(40).join("\n"), /\x1b\[41m/);
  const fresh = await import(new URL(`./pending-input.mjs?reload=${Date.now()}`, import.meta.url));
  fresh.installPendingInput(() => palette("latte"));
  assert.equal(InteractiveMode.prototype.updatePendingMessagesDisplay, method);
  mode.updatePendingMessagesDisplay();
  assert.match(render(40).join("\n"), /\x1b\[42m/);
});
