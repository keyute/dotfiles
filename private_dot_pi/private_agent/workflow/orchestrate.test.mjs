import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { rpcCall } from "./fleet.mjs";
import { saysUltracode } from "./keywords.mjs";
import { createOrchestrate } from "./orchestrate.mjs";

const roster = { scout: { readonly: true }, worker: { readonly: false } };
const config = (concurrency = 8) => ({ models: { provider: "openai", tiers: { small: "s-id", top: "t-id", frontier: "f-id" } }, orchestrateConcurrency: concurrency, agents: roster });

// A fake pi-subagents: the documented RPC request/reply channel, then per child
// async-started, process-terminal and async-complete. `behave(params, id)`
// resolves to the child's results[0] (or never, for a child that hangs);
// `gate(args)` holds a launch in its check.
function harness({ concurrency, behave = params => ({ status: "completed", output: `done:${params.task}` }), spawn: spawnMode = "reply", status = () => null, stopFailures = () => [], gate = () => {} } = {}) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  const events = { on: (name, fn) => { emitter.on(name, fn); return () => emitter.off(name, fn); }, emit: (name, data) => emitter.emit(name, data) };
  const h = { events, mode: "execute", spawns: [], log: [], held: [], inflight: 0, maxInflight: 0, adopted: [], stopped: [], groups: [], ready: true };
  const reply = (requestId, data) => events.emit(`subagents:rpc:v1:reply:${requestId}`, { version: 1, requestId, success: true, data });
  h.complete = (id, result, extra = {}) => {
    events.emit("subagent:process-terminal", { state: "observed", runId: id });
    events.emit("subagent:async-complete", { runId: id, success: result.status === "completed", state: result.status === "completed" ? "complete" : result.status, agent: "x", results: [result], ...extra });
  };
  events.on("subagents:rpc:v1:request", async ({ requestId, method, params }) => {
    await sleep(1);
    if (method === "status") { const data = status(params); if (data) reply(requestId, data); return; }
    if (method !== "spawn") return;
    const id = `run-${h.spawns.length + 1}`;
    const spawn = typeof spawnMode === "function" ? spawnMode(params) : spawnMode;
    h.spawns.push(params);
    h.log.push(`spawn:${params.task}`);
    h.inflight++;
    h.maxInflight = Math.max(h.maxInflight, h.inflight);
    const details = { runId: id, asyncDir: `/tmp/async/${id}` };
    const fail = code => events.emit(`subagents:rpc:v1:reply:${requestId}`, { version: 1, requestId, success: false, error: { code, message: "nope" } });
    if (spawn === "error") { fail("invalid_params"); return; }
    if (spawn === "reply") reply(requestId, { details });
    else if (spawn === "hold") h.held.push(() => reply(requestId, { details }));
    h.lastRequestId = requestId;
    // No reply, no launch event, no child: the outcome is unknowable.
    if (spawn === "vanish") return;
    events.emit("subagent:async-started", { id, asyncDir: details.asyncDir, toolCallId: `rpc-spawn-${requestId}` });
    // The executor's post-spawn step failed: the child is live, the reply an error.
    if (spawn === "error-after") { fail("execution_failed"); return; }
    const result = await behave(params, id);
    h.inflight--;
    h.log.push(`complete:${params.task}`);
    h.complete(id, result);
  });
  const fleet = {
    adopt: (id, launch) => h.adopted.push({ id, ...launch }),
    // Each change is logged as the statuses at that moment.
    track: ({ title, records }) => {
      const group = { title, records, log: [] };
      h.groups.push(group);
      return { changed: () => group.log.push(records.map(record => record.status).join(",")), end: () => group.log.push("end") };
    },
    stopRuns: async ids => { h.stopped.push(...ids); return ids.flatMap(stopFailures); },
  };
  const check = async (args, { outputSchema, model } = {}) => {
    await gate(args);
    delete args.title;
    if (outputSchema) args.outputSchema = outputSchema;
    if (model) args.model = model;
    if (!roster[args.agent]) throw new Error("A configured agent and bounded task are required");
    if (h.mode === "plan" && !roster[args.agent].readonly) throw new Error("Plan mode only permits read-only child agents");
    if (args.model === "openai/f-id") throw new Error("Children never run the frontier tier");
    args.agentScope = "user";
    args.async = true;
  };
  h.orchestrate = createOrchestrate({
    pi: { events }, config: config(concurrency), fleet, check, isReady: () => h.ready, description: "d",
    resultDir: mkdtempSync(join(tmpdir(), "orchestrate-")),
    rpc: (ev, method, params, timeoutMs, requestId, raw) => rpcCall(ev, method, params, Math.min(timeoutMs, 100), requestId, raw),
    graceMs: 200,
  });
  h.orchestrate.delivered({ role: "user", content: "ultracode" });
  h.run = (script, args, signal, ctx = { hasUI: true }) => h.orchestrate.tool.execute("call-1", { script, args }, signal, undefined, ctx);
  return h;
}
// The result's first line is the row summary; the value is the block below it.
const value = result => JSON.parse(result.content[0].text.split("\n\n")[1]);
// A failure after the VM ran is a returned error result, so its details survive.
const failure = result => { assert.equal(result.isError, true); return result.content[0].text; };

test("agent() returns the child's text and spawns exactly the checked object", async () => {
  const h = harness();
  const result = await h.run(`return await agent("look around", { agentType: "scout", label: "Look" })`);
  assert.equal(value(result), "done:look around");
  assert.deepEqual(h.spawns[0], { agent: "scout", task: "look around", context: "fresh", agentScope: "user", async: true });
  assert.deepEqual(result.details.runs, [{ runId: "run-1", agent: "scout", label: "Look", task: "Look", asyncDir: "/tmp/async/run-1", status: "completed" }]);
  assert.deepEqual(h.adopted, [{ id: "run-1", agent: "scout", task: "Look", asyncDir: "/tmp/async/run-1" }]);
  assert.match(result.content[0].text, /^1 agent · completed\n\n/);
  assert.match(result.content[0].text, /\nLook · completed$/);
  assert.equal(h.orchestrate.claim(["run-1"]), true);
  assert.equal(h.orchestrate.claim(["run-1"]), false);
  assert.equal(h.orchestrate.live(), 0);
});

test("a schema launch returns the structured value, false included, and fails without one", async () => {
  const h = harness({ behave: params => ({ status: "completed", output: "text", structuredOutput: params.task === "none" ? undefined : params.task === "no" ? false : { ok: 1 } }) });
  const schema = { type: "object" };
  const result = await h.run(`return [await agent("yes", { agentType: "scout", schema: ${JSON.stringify(schema)} }), await agent("no", { agentType: "scout", schema: { type: "boolean" } })]`);
  assert.deepEqual(value(result), [{ ok: 1 }, false]);
  assert.deepEqual(h.spawns[0].outputSchema, schema);
  const none = await h.run(`return await agent("none", { agentType: "scout", schema: { type: "object" } })`);
  assert.match(failure(none), /scout returned no structured output/);
  assert.equal(none.details.runs[0].status, "completed");
});

test("parallel() keeps order with null for a failed item; a failed child names its status", async () => {
  const h = harness({ behave: params => params.task === "b" ? { status: "failed", summary: "broke\nlater" } : { status: "completed", output: params.task } });
  const result = await h.run(`return await parallel(["a", "b", "c"].map(t => () => agent(t, { agentType: "scout" })))`);
  assert.deepEqual(value(result), ["a", null, "c"]);
  const message = await h.run(`try { await agent("b", { agentType: "scout" }) } catch (e) { return e.message }`);
  assert.equal(value(message), "scout failed: broke");
});

test("pipeline() has no barrier: a fast item reaches stage 2 before a slow item's stage 1 ends", async () => {
  const h = harness({ behave: async params => { if (params.task === "s1:a") await sleep(150); return { status: "completed", output: params.task }; } });
  const result = await h.run(`return await pipeline(["a", "b"], item => agent("s1:" + item, { agentType: "scout" }), prev => agent("s2:" + prev, { agentType: "scout" }))`);
  assert.deepEqual(value(result), ["s2:s1:a", "s2:s1:b"]);
  assert.ok(h.log.indexOf("spawn:s2:s1:b") < h.log.indexOf("complete:s1:a"), h.log.join(","));
});

test("log() lines, console output, args and an exported meta reach the result", async () => {
  const h = harness();
  const result = await h.run(`export const meta = { name: "demo" };\nlog("hello \\x1b]0;t\\x07 there\\nnext"); log({ n: args.n }); console.log("c1"); return meta.name + args.n`, { n: 3 });
  const text = result.content[0].text;
  assert.equal(value(result), "demo3");
  assert.match(text, /\nhello \]0;t there next\n\{"n":3\}\nc1$/);
  assert.doesNotMatch(text, /[\x1b\x07]/);
});

test("phase() and opts.phase reach the records, the explicit option winning; a non-string phase is refused", async () => {
  const h = harness();
  await h.run(`await agent("a", { agentType: "scout" }); phase("Review\\nnow"); await parallel([() => agent("b", { agentType: "scout" }), () => agent("c", { agentType: "scout", phase: "Fix" })]); return 1`);
  assert.deepEqual(h.groups[0].records.map(({ task, phase }) => [task, phase]), [["a", undefined], ["b", "Review now"], ["c", "Fix"]]);
  const refused = await h.run(`try { await agent("x", { agentType: "scout", phase: 3 }) } catch (e) { return e.message }`);
  assert.equal(value(refused), "agent() phase must be a string");
  const viaPhase = await h.run(`phase(3); try { await agent("x", { agentType: "scout" }) } catch (e) { return e.message }`);
  assert.equal(value(viaPhase), "agent() phase must be a string");
});

test("a run tracks one fleet group: its title, each status change, and its end", async () => {
  const h = harness({ behave: params => params.task === "b" ? { status: "failed" } : { status: "completed", output: "" } });
  await h.orchestrate.tool.execute("call-1", { title: "Audit", script: `await agent("a", { agentType: "scout" }); await parallel([() => agent("b", { agentType: "scout" })]); return 1` }, undefined, undefined, { hasUI: true });
  assert.equal(h.groups.length, 1);
  assert.equal(h.groups[0].title, "Audit");
  assert.deepEqual(h.groups[0].log, ["launching", "running", "completed", "completed,launching", "completed,running", "completed,failed", "end"]);
});

test("opt-in: unarmed calls are refused; arming lasts until a prompt without the word", async () => {
  const h = harness();
  assert.ok(saysUltracode("use ULTRACODE here") && !saysUltracode("ultracoder"));
  await h.run(`return 1`);
  await h.run(`return 2`);
  h.orchestrate.delivered({ role: "user", content: [{ type: "text", text: "just a question" }] });
  await assert.rejects(h.run(`return 1`), /Workflows start only when the prompt says ultracode/);
  h.orchestrate.delivered({ role: "user", content: "ultracode" });
  h.orchestrate.disarm();
  await assert.rejects(h.run(`return 1`), /ultracode/);
});

test("opt-in: the delivered text decides; extension text is consumed once; a skill decides by its args", async () => {
  const h = harness();
  const armed = () => h.run(`return 1`).then(() => true, () => false);
  const deliver = text => h.orchestrate.delivered({ role: "user", content: [{ type: "text", text }, { type: "image", data: "x" }] });
  deliver("don't run a workflow");
  assert.equal(await armed(), false);
  deliver("ultracode it");
  h.orchestrate.noteExtensionInput("plain notice");
  h.orchestrate.noteExtensionInput("plain notice");
  deliver("plain notice");
  deliver("plain notice");
  assert.equal(await armed(), true);
  // Both noted copies are spent: the same text from the user decides.
  deliver("plain notice");
  assert.equal(await armed(), false);
  const skill = args => `<skill name="review" location="/s/SKILL.md">\nReferences are relative to /s.\n\nRun ultracode for big diffs.\n</skill>${args ? `\n\n${args}` : ""}`;
  deliver(skill());
  assert.equal(await armed(), false);
  deliver(skill("check the auth flow"));
  assert.equal(await armed(), false);
  deliver(skill("ultracode the auth flow"));
  assert.equal(await armed(), true);
  // The decided text is the return value: a skill's args, nothing for extension input.
  assert.equal(deliver(skill("ultrathink it")), "ultrathink it");
  h.orchestrate.noteExtensionInput("ultrathink");
  assert.equal(deliver("ultrathink"), undefined);
  h.orchestrate.noteExtensionInput("ultracode");
  h.orchestrate.disarm();
  deliver("ultracode");
  assert.equal(await armed(), true, "disarm clears the noted extension text");
});

test("check refusals and tier overrides: plan-mode writer, top pin, frontier, unknown tier, opts.model", async () => {
  const h = harness();
  const attempt = opts => h.run(`try { return await agent("t", ${opts}) } catch (e) { return "error: " + e.message }`).then(value);
  h.mode = "plan";
  assert.equal(await attempt(`{ agentType: "worker" }`), "error: Plan mode only permits read-only child agents");
  h.mode = "execute";
  assert.equal(await attempt(`{ agentType: "worker", tier: "top" }`), "done:t");
  assert.equal(h.spawns.at(-1).model, "openai/t-id");
  assert.equal(await attempt(`{ agentType: "scout", tier: "frontier" }`), "error: tier must be one of small, top");
  assert.equal(await attempt(`{ agentType: "scout", tier: "huge" }`), "error: tier must be one of small, top");
  for (const key of ["model", "effort", "isolation"]) assert.equal(await attempt(`{ agentType: "scout", ${key}: "x" }`), `error: agent() option ${key} is not supported`);
  assert.equal(await attempt(`{ agentType: "nobody" }`), "error: A configured agent and bounded task are required");
  h.ready = false;
  assert.equal(await attempt(`{ agentType: "scout" }`), "error: Managed workflow is not ready");
  assert.equal(h.spawns.length, 1);
});

test("the concurrency cap holds in-flight children to orchestrateConcurrency", async () => {
  const h = harness({ concurrency: 2, behave: async params => { await sleep(40); return { status: "completed", output: params.task }; } });
  const result = await h.run(`return await parallel([1, 2, 3].map(n => () => agent("t" + n, { agentType: "scout" })))`);
  assert.deepEqual(value(result), ["t1", "t2", "t3"]);
  assert.equal(h.maxInflight, 2);
});

test("an abort before the spawn reply stops the run once its id is known", async () => {
  const h = harness({ spawn: "hold", behave: () => new Promise(() => {}) });
  const controller = new AbortController();
  const done = h.run(`return await agent("t", { agentType: "scout" })`, undefined, controller.signal);
  while (!h.held.length) await sleep(5);
  controller.abort();
  await sleep(10);
  assert.deepEqual(h.stopped, []);
  h.held[0]();
  const result = await done;
  assert.match(failure(result), /Workflow interrupted/);
  assert.equal(result.details.runs[0].status, "stopped");
  assert.deepEqual(h.stopped, ["run-1"]);
  assert.deepEqual(h.groups[0].log.slice(-2), ["stopped", "end"]);
  assert.equal(h.orchestrate.claim(["run-1"]), true);
});

test("a completion that arrives before the spawn reply is replayed once the id is known", async () => {
  const h = harness({ spawn: "hold", behave: () => new Promise(() => {}) });
  const done = h.run(`return await agent("t", { agentType: "scout" })`);
  while (!h.held.length) await sleep(5);
  h.events.emit("subagent:async-complete", { runId: "run-1", success: true, state: "complete", results: [{ status: "completed", output: "early" }] });
  h.held[0]();
  assert.equal(value(await done), "early");
  assert.equal(h.orchestrate.claim(["run-1"]), true);
});

test("an exit that arrives before the spawn reply starts the grace once the id is known", async () => {
  const h = harness({ spawn: "hold", behave: () => new Promise(() => {}) });
  const done = h.run(`try { await agent("t", { agentType: "scout" }) } catch (e) { return e.message }`);
  while (!h.held.length) await sleep(5);
  h.events.emit("subagent:process-terminal", { state: "observed", runId: "run-1" });
  h.held[0]();
  assert.equal(value(await done), "scout exited without a completion");
});

test("a lost spawn reply is recovered by status on the rpc-spawn alias, the asyncDir from the launch event", async () => {
  let asked;
  // pi-subagents' status details carry the run id but no asyncDir.
  const h = harness({ spawn: "drop", status: params => { asked = params.id; return { details: { runId: "run-1" } }; } });
  const result = await h.run(`return await agent("t", { agentType: "scout" })`);
  assert.equal(value(result), "done:t");
  assert.equal(asked, `rpc-spawn-${h.lastRequestId}`);
  assert.equal(h.spawns.length, 1);
  assert.equal(h.adopted[0].asyncDir, "/tmp/async/run-1");
  assert.equal(result.details.runs[0].asyncDir, "/tmp/async/run-1");
});

test("an invalid_params reply means nothing launched: the agent fails with the plugin's message, never 'unknown'", async () => {
  const h = harness({ spawn: "error" });
  const result = await h.run(`try { await agent("t", { agentType: "scout" }) } catch (e) { return e.message }`);
  assert.equal(value(result), "scout launch refused: nope");
  assert.equal(result.details.runs[0].status, "failed");
  assert.deepEqual(h.stopped, []);
});

test("an execution_failed reply after a live spawn recovers the child by the launch event and stops it", async () => {
  const h = harness({ spawn: "error-after" });
  const result = await h.run(`try { await agent("t", { agentType: "scout" }) } catch (e) { return e.message }`);
  assert.equal(value(result), "scout launch failed after its spawn: nope");
  assert.deepEqual(h.stopped, ["run-1"]);
  assert.deepEqual(result.details.runs[0], { runId: "run-1", agent: "scout", label: undefined, task: "t", asyncDir: "/tmp/async/run-1", status: "stopped" });
  assert.equal(h.spawns.length, 1);
});

test("a successful script whose child cleanup is unverified is an error, not a result", async () => {
  const h = harness({ behave: () => new Promise(() => {}), stopFailures: id => [`${id}: terminal state was not established`] });
  const result = await h.run(`agent("t", { agentType: "scout" }); return 1`);
  assert.match(failure(result), /^Workflow finished but its child cleanup is unverified\n\n1 agent · completed\n\n1\n\nscout · running\nunverified cleanup: run-1: terminal state was not established$/);
  assert.deepEqual(result.details.runs.map(run => [run.runId, run.status]), [["run-1", "running"]]);
});

test("a headless root is refused", async () => {
  const h = harness();
  await assert.rejects(h.run(`return 1`, undefined, undefined, { hasUI: false }), /interactive session/);
});

test("pipeline() passes a legitimate null through later stages", async () => {
  const h = harness();
  const result = await h.run(`return await pipeline([1, null], () => null, prev => prev === null ? "n" : "y")`);
  assert.deepEqual(value(result), ["n", "n"]);
});

test("a lost spawn reply with no status and no launch event leaves the outcome unknown, ends the run and never redispatches", async () => {
  const h = harness({ spawn: "vanish" });
  const result = await h.run(`try { await agent("t", { agentType: "scout" }) } catch {} return await agent("u", { agentType: "scout" })`);
  assert.match(failure(result), /^launch outcome unknown: scout\n\nscout · unknown\nlaunch outcome unknown: scout$/);
  assert.deepEqual(result.details.runs.map(run => run.status), ["unknown"]);
  assert.equal(h.spawns.length, 1);
});

test("a child that registers under a lost launch's alias after the script returned is adopted into its record and stopped", async () => {
  let asked, release;
  const h = harness({
    spawn: "vanish",
    status: params => { asked = params.id; return null; },
    gate: args => args.task === "g" ? new Promise(resolve => { release = resolve; }) : undefined,
  });
  const done = h.run(`agent("t", { agentType: "scout" }); agent("g", { agentType: "scout" }); return 1`);
  while (!asked) await sleep(5);
  // Past the status timeout: the launch has given up while "g" still settles.
  await sleep(150);
  h.events.emit("subagent:async-started", { id: "late-1", asyncDir: "/tmp/async/late-1", toolCallId: asked });
  release();
  const result = await done;
  assert.match(failure(result), /^launch outcome unknown: scout\n\nscout · stopped\nlaunch outcome unknown: scout$/);
  assert.deepEqual(result.details.runs, [{ runId: "late-1", agent: "scout", label: undefined, task: "t", asyncDir: "/tmp/async/late-1", status: "stopped" }]);
  assert.deepEqual(h.adopted, [{ id: "late-1", agent: "scout", task: "t", asyncDir: "/tmp/async/late-1" }]);
  assert.deepEqual(h.stopped, ["late-1"]);
  // Its stop notice is owned too, so a busy root drops it.
  assert.equal(h.orchestrate.claim(["late-1"]), true);
  assert.equal(h.spawns.length, 1);
});

test("a launch of unknown outcome caught by parallel() still fails the run as unverified", async () => {
  const h = harness({ spawn: "vanish" });
  assert.match(failure(await h.run(`return await parallel([() => agent("t", { agentType: "scout" })])`)), /launch outcome unknown: scout\n\nscout · unknown\nlaunch outcome unknown: scout$/);
});

test("an early return stops a live child, reports it, and keeps it owned until its notice is claimed", async () => {
  const h = harness({ behave: async params => { if (params.task === "hang") return new Promise(() => {}); await sleep(50); return { status: "completed", output: "q" }; } });
  const result = await h.run(`agent("hang", { agentType: "scout", label: "Hang" }); await agent("quick", { agentType: "scout" }); return "early"`);
  assert.equal(value(result), "early");
  assert.deepEqual(h.stopped, ["run-1"]);
  assert.match(result.content[0].text, /\nHang · stopped\nscout · completed$/);
  h.complete("run-1", { status: "stopped" });
  assert.equal(h.orchestrate.claim(["run-1"]), true);
  assert.equal(h.orchestrate.claim(["run-1"]), false);
});

test("a stop without terminal proof is reported as unverified cleanup", async () => {
  const h = harness({ behave: () => new Promise(() => {}), stopFailures: id => [`${id}: terminal state was not established`] });
  const controller = new AbortController();
  const done = h.run(`return await agent("t", { agentType: "scout" })`, undefined, controller.signal);
  while (!h.adopted.length) await sleep(5);
  controller.abort();
  const result = await done;
  assert.equal(failure(result), "Workflow interrupted\n\nscout · running\nunverified cleanup: run-1: terminal state was not established");
  assert.equal(result.details.runs[0].status, "running");
});

test("stopAll aborts a running workflow and waits for it", async () => {
  const h = harness({ behave: () => new Promise(() => {}) });
  const done = h.run(`return await agent("t", { agentType: "scout" })`);
  while (!h.adopted.length) await sleep(5);
  assert.equal(h.orchestrate.live(), 1);
  await h.orchestrate.stopAll();
  assert.equal(h.orchestrate.live(), 0);
  assert.match(failure(await done), /Workflow interrupted/);
  assert.deepEqual(h.stopped, ["run-1"]);
});

test("a child that exits without a completion fails after the grace", async () => {
  const h = harness({ behave: () => new Promise(() => {}) });
  const done = h.run(`try { await agent("t", { agentType: "scout" }) } catch (e) { return e.message }`);
  while (!h.adopted.length) await sleep(5);
  h.events.emit("subagent:process-terminal", { state: "observed", runId: "run-1" });
  assert.equal(value(await done), "scout exited without a completion");
});

test("a child that exits without a completion is reported failed, never stopped", async () => {
  const h = harness({ behave: () => new Promise(() => {}) });
  const done = h.run(`try { await agent("t", { agentType: "scout" }); return "resolved" } catch (e) { return e.message }`);
  while (!h.adopted.length) await sleep(5);
  h.events.emit("subagent:process-terminal", { state: "observed", runId: "run-1" });
  const result = await done;
  assert.equal(value(result), "scout exited without a completion");
  assert.equal(result.details.runs[0].status, "failed");
  assert.match(result.content[0].text, /\nscout · failed$/);
  assert.deepEqual(h.stopped, []);
});

test("a script error carries its kind, message, the children and the logs", async () => {
  const h = harness();
  const result = await h.run(`log("before"); await agent("t", { agentType: "scout" }); throw new TypeError("bad")`);
  assert.match(failure(result), /^script: bad/);
  assert.match(failure(result), /\n\nbefore\nscout · completed$/);
  assert.equal(result.details.runs[0].runId, "run-1");
  assert.equal(h.groups[0].log.at(-1), "end");
});

test("a result over 64 KiB is cut, its child lines kept, and written whole to result.txt", async () => {
  const h = harness();
  const result = await h.run(`await agent("t", { agentType: "scout", label: "L" }); log("y".repeat(1000)); return "x".repeat(70000)`);
  const text = result.content[0].text;
  const path = text.match(/\n… full result: (.+result\.txt)\n\nL · completed$/)[1];
  assert.equal(text.length <= 64 * 1024, true);
  assert.equal(readFileSync(path, "utf8"), `1 agent · completed\n\n${JSON.stringify("x".repeat(70000))}\n\n${"y".repeat(1000)}\nL · completed`);
});

// Malicious input (docs/pi-design.md rule 7): the script reaches only agent and log.
test("the VM reaches no host capability", async () => {
  const h = harness();
  const outcome = script => h.run(script).then(result => result.isError ? `error: ${result.content[0].text.split("\n")[0]}` : value(result));
  assert.equal(await outcome(`return typeof process + typeof require + typeof fetch + typeof setTimeout`), "undefinedundefinedundefinedundefined");
  assert.match(await outcome(`return globalThis.constructor.constructor("return process")()`), /^error: script: .*process/);
  assert.equal(await outcome(`return globalThis.constructor.constructor("return typeof process")()`), "undefined");
  assert.equal(await outcome(`return eval("typeof fleet + typeof pi + typeof check + typeof rpc")`), "undefinedundefinedundefinedundefined");
  assert.notEqual(await outcome(`try { await import("node:fs"); return "reached" } catch (e) { return "blocked" }`), "reached");
  assert.equal(h.spawns.length, 0);
});

test("a busy loop is ended by abort", async () => {
  const h = harness();
  const controller = new AbortController();
  const done = h.run(`while (true) {}`, undefined, controller.signal);
  await sleep(200);
  controller.abort();
  assert.match(failure(await done), /Workflow interrupted/);
});

test("hostile sizes, labels, args and fan-out are bounded", async () => {
  const h = harness();
  const attempt = body => h.run(`try { ${body} } catch (e) { return e.name + ": " + e.message }`).then(value);
  assert.equal(await attempt(`return await agent("x".repeat(1024 * 1024 + 1), { agentType: "scout" })`), "Error: agent() prompt exceeds 1 MiB");
  assert.equal(await attempt(`return await agent("x", { agentType: "scout", schema: { d: "x".repeat(65536) } })`), "Error: agent() schema must be an object of at most 64 KiB");
  assert.equal(await attempt(`return await agent("x", { agentType: "scout", schema: [1] })`), "Error: agent() schema must be an object of at most 64 KiB");
  assert.equal(await attempt(`return await agent("", { agentType: "scout" })`), "Error: agent() needs a non-empty prompt");
  assert.equal(await attempt(`return await agent("x")`), "Error: agent() needs opts.agentType");
  assert.equal(await attempt(`return await parallel(Array.from({ length: 4097 }, () => () => 1))`), "RangeError: parallel takes an array of at most 4096 items");
  assert.equal(await attempt(`return await pipeline(Array.from({ length: 4097 }, () => 1), x => x)`), "RangeError: parallel takes an array of at most 4096 items");
  await assert.rejects(h.run(`return 1`, { d: "x".repeat(16 * 1024) }), /args exceed 16 KiB/);
  await assert.rejects(h.run("x".repeat(256 * 1024 + 1)), /script exceeds 256 KiB/);
  assert.match((await h.run(`for (let i = 0; i < 1001; i++) log(i); return 1`)).content[0].text, /\n… 1 more log lines$/);
  await h.run(`return await agent("x", { agentType: "scout", label: "\\x1b]0;evil\\x07ok\\x1b[31m\\u009b" + "y".repeat(200) })`).then(result => {
    const { label } = result.details.runs[0];
    assert.doesNotMatch(label, /[\x1b\x07\x9b]/);
    assert.equal(label, `]0;evilok[31m${"y".repeat(120 - 13)}`);
    assert.equal(h.adopted[0].task, label);
  });
  const polluted = await h.run(`return [({}).polluted === undefined, args.a, Object.keys(args)]`, JSON.parse('{"__proto__": {"polluted": true}, "a": 1}'));
  assert.deepEqual(value(polluted), [true, 1, ["__proto__", "a"]]);
  assert.equal({}.polluted, undefined);
});

test("the 1001st agent() call ends the run, refused calls counted, and the script cannot catch it", async () => {
  const h = harness({ behave: params => ({ status: "completed", output: params.task }) });
  const ended = result => assert.match(failure(result), /^A workflow runs at most 1000 agent\(\) calls/);
  ended(await h.run(`for (let i = 0; i < 1001; i++) await agent("t", { agentType: "scout" }); return "unreached"`));
  assert.equal(h.spawns.length, 1000);
  const loop = harness();
  ended(await loop.run(`while (true) { try { await tools.agent({}) } catch {} }`));
  assert.equal(loop.spawns.length, 0);
});
