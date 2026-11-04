import test from "node:test";
import assert from "node:assert/strict";
import { installProgramStatus } from "./program-status.mjs";

const wire = state => `\x1b]7501;state=${state}:app=pi\x1b\\`;
function harness(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const frames = [];
  const reporter = installProgramStatus({ TUIOS_ENV: "1" }, { isTTY: true, write: frame => frames.push(frame) });
  const report = (state, message) => reporter.report({ state, ...(message !== undefined && { message }) });
  return { frames, reporter, report, tick: ms => t.mock.timers.tick(ms) };
}

test("reports only in TuiOS on terminal stdout", () => {
  const frames = [];
  for (const env of [{}, { TUIOS_ENV: "0" }, { TUIOS_ENV: "true" }]) {
    assert.equal(installProgramStatus(env, { isTTY: true, write: frame => frames.push(frame) }), undefined);
  }
  for (const isTTY of [false, undefined]) assert.equal(installProgramStatus({ TUIOS_ENV: "1" }, { isTTY, write: frame => frames.push(frame) }), undefined);
  assert.deepEqual(frames, []);
});

test("exact OSC states, message escaping and dedupe preserve explicit completion", t => {
  const { frames, report, tick } = harness(t);
  report("idle");
  report("idle");
  report("working");
  report("working");
  report("blocked", "  Approve\x07\x1b\\\nnow\x9c  ");
  const encoded = Buffer.from("Approve \\ now").toString("base64");
  assert.deepEqual(frames, [wire("idle"), wire("working"), `\x1b]7501;state=blocked:app=pi:msg=${encoded}\x1b\\`]);
  report("idle");
  tick(249);
  assert.equal(frames.length, 3);
  tick(1);
  assert.equal(frames.at(-1), wire("done"));
  report("idle");
  tick(1000);
  assert.equal(frames.length, 4, "repeated idle must not erase done");
});

test("work-block-work completes once, and a short idle gap never completes", t => {
  const { frames, report, tick } = harness(t);
  report("working");
  report("blocked", "Question");
  report("working");
  report("idle");
  tick(100);
  report("working");
  tick(300);
  assert.deepEqual(frames.filter(frame => frame === wire("done")), []);
  report("idle");
  tick(249);
  assert.equal(frames.length, 3);
  tick(1);
  assert.equal(frames.at(-1), wire("done"));
});

test("initial idle and menu-only block do not manufacture completed work", t => {
  const { frames, report, tick } = harness(t);
  report("idle");
  report("blocked", "Menu");
  report("idle");
  tick(249);
  assert.equal(frames.length, 2);
  tick(1);
  assert.deepEqual(frames, [wire("idle"), `\x1b]7501;state=blocked:app=pi:msg=TWVudQ==\x1b\\`, wire("idle")]);
});

test("shutdown cancels idle with no fake done, suspends writes, and attach resets stale timers and work", t => {
  const { frames, reporter, report, tick } = harness(t);
  report("working");
  report("idle");
  tick(100);
  reporter.shutdown();
  report("blocked", "stale");
  report("working");
  tick(1000);
  assert.deepEqual(frames, [wire("working")]);
  reporter.attach();
  report("idle");
  assert.equal(frames.at(-1), wire("idle"));
  report("working");
  report("idle");
  tick(100);
  reporter.attach();
  report("blocked", "New menu");
  tick(1000);
  assert.equal(frames.length, 4, "attach cancels the old delayed completion");
  report("idle");
  tick(250);
  assert.equal(frames.at(-1), wire("idle"));
});
