import test from "node:test";
import assert from "node:assert/strict";
import { installProgramStatus } from "./program-status.mjs";

const wire = state => `\x1b]7501;state=${state}:app=pi\x1b\\`;
function harness(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const frames = [];
  const reporter = installProgramStatus({ isTTY: true, write: frame => frames.push(frame) });
  const report = (state, message) => reporter.report({ state, ...(message !== undefined && { message }) });
  return { frames, reporter, report, tick: ms => t.mock.timers.tick(ms) };
}

test("reports only on a TTY stdout", () => {
  const frames = [];
  const reporter = installProgramStatus({ isTTY: true, write: frame => frames.push(frame) });
  reporter.report({ state: "idle" });
  reporter.shutdown();
  assert.deepEqual(frames, [wire("idle"), wire("clear")]);
  for (const isTTY of [false, undefined]) assert.equal(installProgramStatus({ isTTY, write: () => assert.fail("non-TTY write") }), undefined);
});

test("exact OSC states omit activity bodies and dedupe preserves explicit completion", t => {
  const { frames, reporter, report, tick } = harness(t);
  report("idle");
  report("idle");
  report("working");
  report("working");
  reporter.report({ state: "blocked", message: "PRIVATE QUESTION SENTINEL", title: "PRIVATE TITLE SENTINEL", id: "PRIVATE ID SENTINEL" });
  report("blocked", "another private question");
  assert.deepEqual(frames, [wire("idle"), wire("working"), wire("blocked")]);
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
  assert.deepEqual(frames, [wire("idle"), wire("blocked"), wire("idle")]);
});

test("unused shutdown is silent and idempotent, and attach does not replay status", t => {
  const { frames, reporter, report, tick } = harness(t);
  reporter.shutdown();
  reporter.shutdown();
  report("working");
  tick(1000);
  assert.deepEqual(frames, []);
  reporter.attach();
  assert.deepEqual(frames, []);
  report("idle");
  assert.deepEqual(frames, [wire("idle")]);
  reporter.shutdown();
  reporter.shutdown();
  tick(1000);
  assert.deepEqual(frames, [wire("idle"), wire("clear")]);
});

test("shutdown clears completed status once without replaying it on attach", t => {
  const { frames, reporter, report, tick } = harness(t);
  report("working");
  report("idle");
  tick(250);
  assert.deepEqual(frames, [wire("working"), wire("done")]);
  reporter.shutdown();
  reporter.shutdown();
  report("idle");
  tick(1000);
  assert.deepEqual(frames, [wire("working"), wire("done"), wire("clear")]);
  reporter.attach();
  assert.equal(frames.length, 3);
  report("idle");
  assert.deepEqual(frames, [wire("working"), wire("done"), wire("clear"), wire("idle")]);
});

test("shutdown clears status with no fake done, cancels idle and suspends writes; attach resets timers and work", t => {
  const { frames, reporter, report, tick } = harness(t);
  report("working");
  report("idle");
  tick(100);
  reporter.shutdown();
  report("blocked", "stale");
  report("working");
  tick(1000);
  assert.deepEqual(frames, [wire("working"), wire("clear")]);
  reporter.attach();
  report("idle");
  assert.equal(frames.at(-1), wire("idle"));
  report("working");
  report("idle");
  tick(100);
  reporter.attach();
  report("blocked", "New menu");
  tick(1000);
  assert.equal(frames.length, 5, "attach cancels the old delayed completion");
  report("idle");
  tick(250);
  assert.equal(frames.at(-1), wire("idle"));
});
