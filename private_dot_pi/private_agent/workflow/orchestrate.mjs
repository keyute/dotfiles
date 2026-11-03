import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import { CodemodeSandbox } from "@earendil-works/pi-codemode";
import { parseSkillBlock } from "@earendil-works/pi-coding-agent";
import { completionStatus, rpcCall } from "./fleet.mjs";
import { saysUltracode } from "./keywords.mjs";

// Ownership outlives the launch tool call and ends only after verified cleanup.

const KiB = 1024;
const MAX_SCRIPT = 256 * KiB;
const MAX_ARGS = 16 * KiB;
const MAX_PROMPT = 1024 * KiB;
const MAX_SCHEMA = 64 * KiB;
const MAX_RESULT = 64 * KiB;
const MAX_CALLS = 1000;
const MAX_LOG_CHARS = 2000;
const MAX_LOGS = 1000;
const OPT_KEYS = new Set(["agentType", "tier", "schema", "label", "phase"]);
const META = /^(\s*)export\s+(const\s+meta\b)/m;

const clean = (text, max) => String(text).replace(/[\r\n\t]+/g, " ").replace(/[\p{Cc}]/gu, "").slice(0, max);
const firstLine = text => clean(String(text).trim().split("\n")[0], 120);
const isObject = value => typeof value === "object" && value !== null && !Array.isArray(value);

// One line, so VM line numbers equal the script's. Bounds are in the VM because
// the host sees only single agent() calls. phase() sets the default that an
// explicit opts.phase overrides on the host.
const PRELUDE = 'const log = (...a) => console.log(...a); let __phase; const phase = title => { __phase = title; }; const agent = (prompt, opts) => tools.agent({ prompt, opts: opts ?? {}, phase: __phase }); const __bound = items => { if (!Array.isArray(items) || items.length > 4096) throw new RangeError("parallel takes an array of at most 4096 items"); }; const parallel = thunks => { __bound(thunks); return Promise.all(thunks.map(t => Promise.resolve().then(() => typeof t === "function" ? t() : t).catch(() => null))); }; const __failed = Symbol("failed"); const pipeline = (items, ...stages) => { __bound(items); return Promise.all(items.map((item, i) => stages.reduce((p, stage) => p.then(prev => prev === __failed ? prev : stage(prev, item, i)), Promise.resolve(item)).catch(() => __failed).then(v => v === __failed ? null : v))); }; ';

// Control characters out of text the VM or a child wrote, newlines kept.
const scrub = text => String(text).replace(/[\p{Cc}]/gu, c => (c === "\n" ? c : ""));

// graceMs sits above pi-subagents' result watcher's 60 s healthy scan
// (result-watcher.js HEALTHY_SCAN_INTERVAL_MS), so a completion the native
// notify missed still arrives before the exit is taken as the end.
export function createOrchestrate({ pi, config, fleet, check, isReady, description, resultDir, rpc = rpcCall, graceMs = 120_000, generation = () => 0, onComplete = () => {} }) {
  const owned = new Set();
  const running = new Set();
  const terminal = new Map();
  const listeners = new Set();
  let epoch = 0;
  const changed = () => { for (const fn of listeners) { try { fn(); } catch {} } };
  const current = run => run.generation === generation() && run.epoch === epoch;
  const shaped = run => ({
    content: [{ type: "text", text: [`Workflow ${run.workflow.id} · ${run.workflow.title} · ${run.workflow.status}`,
      ...run.records.map(record => `${record.runId ?? "launching"} · ${record.agent} · ${record.label ?? record.task} · ${record.status}${record.phase ? ` · ${record.phase}` : ""}`)].join("\n") }],
    details: { workflow: { ...run.workflow }, runs: run.records.map(({ runId, agent, label, task, asyncDir, status, phase }) => ({ runId, agent, label, task, asyncDir, status, ...(phase && { phase }) })) },
  });
  let armed = false;
  const extensionInput = new Map();
  const nonFrontier = () => Object.keys(config.models.tiers).filter(key => key !== "frontier");

  function validate(input) {
    const { prompt, opts, phase: current } = isObject(input) ? input : {};
    if (typeof prompt !== "string" || !prompt.trim()) throw new Error("agent() needs a non-empty prompt");
    if (prompt.length > MAX_PROMPT) throw new Error("agent() prompt exceeds 1 MiB");
    if (!isObject(opts)) throw new Error("agent() options must be an object");
    for (const key of Object.keys(opts)) if (!OPT_KEYS.has(key)) throw new Error(`agent() option ${key} is not supported`);
    const { agentType, tier, schema, label, phase = current } = opts;
    if (typeof agentType !== "string" || !agentType) throw new Error("agent() needs opts.agentType");
    if (tier !== undefined && !nonFrontier().includes(tier)) throw new Error(`tier must be one of ${nonFrontier().join(", ")}`);
    if (schema !== undefined && (!isObject(schema) || JSON.stringify(schema).length > MAX_SCHEMA)) throw new Error("agent() schema must be an object of at most 64 KiB");
    if (label !== undefined && typeof label !== "string") throw new Error("agent() label must be a string");
    if (phase !== undefined && typeof phase !== "string") throw new Error("agent() phase must be a string");
    return { prompt, agentType, tier, schema, label: label === undefined ? undefined : clean(label, 120), phase: phase === undefined ? undefined : clean(phase, 60) };
  }

  function startRun() {
    const run = { records: [], unverified: [], logs: [], droppedLogs: 0, calls: 0, inflight: 0, waiters: [], settling: new Set(), open: new Map(), buffer: new Map(), terminal: new Set(), started: new Map(), done: new Map(), lost: [], finished: false, aliases: new Set() };
    // Per open id: { agent, wait, timer }. Completions for ids not
    // yet known are buffered while the run lives (a spawn reply can lag its child).
    const finish = (id, outcome) => {
      const entry = run.open.get(id);
      clearTimeout(entry.timer);
      run.open.delete(id);
      run.done.set(id, outcome);
      entry.wait?.(outcome);
      if (run.finished && !run.open.size) run.off();
    };
    const graceFor = id => {
      const entry = run.open.get(id);
      if (entry.timer) return;
      // A completion that never follows the exit would hang the script.
      entry.timer = setTimeout(() => run.open.has(id) && finish(id, { error: `${entry.agent} exited without a completion` }), graceMs);
      entry.timer.unref?.();
    };
    const offs = [
      // A status recovery carries no asyncDir; the launch event does, and its
      // toolCallId names the spawn request it answered.
      pi.events.on("subagent:async-started", payload => { if (!run.finished && payload?.id && run.aliases.has(payload.toolCallId)) { run.started.set(payload.id, payload); owned.add(payload.id); } }),
      pi.events.on("subagent:async-complete", payload => {
        const id = payload?.runId ?? payload?.id;
        if (run.open.has(id)) finish(id, { payload });
        else if (!run.finished && id) run.buffer.set(id, payload);
      }),
      pi.events.on("subagent:process-terminal", proof => {
        if (proof?.state !== "observed" || !proof.runId) return;
        run.terminal.add(proof.runId);
        if (run.open.has(proof.runId)) graceFor(proof.runId);
      }),
    ];
    run.off = () => { for (const off of offs) off?.(); };
    run.track = (id, agent) => {
      run.open.set(id, { agent });
      if (run.buffer.has(id)) finish(id, { payload: run.buffer.get(id) });
      else if (run.terminal.has(id)) graceFor(id);
    };
    // Settles with the outcome, or rejects on abort; a completion observed
    // before the wait is kept in `done`.
    run.completion = (id, signal) => new Promise((resolve, reject) => {
      const settle = outcome => outcome.payload ? resolve(outcome.payload) : reject(new Error(outcome.error));
      if (run.done.has(id)) return settle(run.done.get(id));
      const entry = run.open.get(id);
      const onAbort = () => { entry.wait = undefined; reject(new Error("Workflow interrupted")); };
      signal.addEventListener("abort", onAbort, { once: true });
      entry.wait = outcome => { signal.removeEventListener("abort", onAbort); settle(outcome); };
    });
    return run;
  }

  async function launch(run, input, signal) {
    // Counted before validation and ended through the run, not a catchable
    // rejection: the VM records every host call, so a loop of refused calls
    // would grow the host's memory without bound.
    if (++run.calls > MAX_CALLS) run.end(`A workflow runs at most ${MAX_CALLS} agent() calls`);
    const { prompt, agentType, tier, schema, label, phase } = validate(input);
    while (run.inflight >= config.orchestrateConcurrency) await new Promise(resolve => run.waiters.push(resolve));
    run.inflight++;
    try {
      if (signal.aborted || !current(run)) throw new Error("Workflow interrupted");
      if (!isReady()) throw new Error("Managed workflow is not ready");
      const args = { agent: agentType, task: prompt, context: "fresh", title: label };
      await check(args, { outputSchema: schema, model: tier ? `${config.models.provider}/${config.models.tiers[tier]}` : undefined });
      if (signal.aborted || !current(run)) throw new Error("Workflow interrupted");
      const task = label ?? firstLine(prompt);
      const record = { runId: undefined, agent: agentType, label, phase, task, asyncDir: undefined, status: "launching" };
      run.records.push(record);
      run.group.changed();
      const requestId = randomUUID();
      const alias = `rpc-spawn-${requestId}`;
      run.aliases.add(alias);
      fleet.own(alias, run.group);
      const reply = await rpc(pi.events, "spawn", args, 30_000, requestId, true).catch(() => undefined);
      const refused = reply?.success === false ? reply.error?.message ?? "spawn failed" : undefined;
      // Only invalid_params precedes execution. Any other error reply, like a
      // lost one, may follow a spawned child (the executor's post-spawn budget
      // step can throw), so the run is recovered by the spawn's tool-call alias,
      // never redispatched, and a recovered child of a failed launch is stopped.
      if (refused !== undefined && reply.error?.code === "invalid_params") { fleet.disown(alias); record.status = "failed"; run.group.changed(); throw new Error(`${agentType} launch refused: ${refused}`); }
      let details = reply?.data?.details;
      if (!(details?.runId ?? details?.asyncId)) details = (await rpc(pi.events, "status", { id: alias }, 5_000).catch(() => undefined))?.details;
      const started = [...run.started.values()].find(payload => payload.toolCallId === alias);
      const id = details?.runId ?? details?.asyncId ?? started?.id;
      if (!id) {
        record.status = refused !== undefined ? "failed" : "unknown";
        run.group.changed();
        // The child may still register under the alias; execute() stops it then.
        run.lost.push({ alias, record });
        run.unverified.push(`launch outcome unknown: ${agentType}`);
        // Its slot is not freed for another child while this one may be running.
        run.end(`launch outcome unknown: ${agentType}`);
        throw new Error(refused !== undefined ? `${agentType} launch refused: ${refused}` : `launch outcome unknown: ${agentType}`);
      }
      const asyncDir = details?.asyncDir ?? run.started.get(id)?.asyncDir;
      Object.assign(record, { runId: id, asyncDir, status: "running", startedAt: Date.now() });
      run.group.changed();
      if (!run.started.has(id)) owned.add(id);
      fleet.adopt(id, { agent: agentType, task, asyncDir });
      run.track(id, agentType);
      if (refused !== undefined || signal.aborted) {
        await stop(run, [record]);
        throw new Error(refused !== undefined ? `${agentType} launch failed after its spawn: ${refused}` : "Workflow interrupted");
      }
      // An observed end without a completion failed; an aborted wait stays
      // running so stop() still stops the child.
      const payload = await run.completion(id, signal).catch(error => { if (run.done.has(id)) { record.status = "failed"; run.group.changed(); } throw error; });
      const r = payload.results?.[0];
      const status = completionStatus(payload);
      Object.assign(record, { status, durationMs: payload.durationMs, tokens: (r?.usage?.input ?? 0) + (r?.usage?.output ?? 0) });
      run.group.changed();
      if (status !== "completed") throw new Error(`${agentType} ${status}${r?.summary ? `: ${firstLine(r.summary)}` : ""}`);
      if (!schema) return r?.output ?? "";
      if (r.structuredOutput === undefined) throw new Error(`${agentType} returned no structured output`);
      return r.structuredOutput;
    } finally {
      run.inflight--;
      run.waiters.shift()?.();
    }
  }

  async function stop(run, records) {
    // A result is not process-exit proof, even when the child succeeded.
    const pending = records.filter(record => record.runId && !run.terminal.has(record.runId) && !record.stopping);
    if (!pending.length) return;
    for (const record of pending) record.stopping = true;
    const failures = await fleet.stopRuns(pending.map(record => record.runId));
    run.unverified.push(...failures.map(failure => `unverified cleanup: ${failure}`));
    for (const record of pending) if (!failures.length) {
      run.terminal.add(record.runId);
      if (record.status === "running") record.status = "stopped";
    }
    run.group.changed();
  }

  function recoverRecord(run, record, id, asyncDir) {
    const payload = run.buffer.get(id) ?? run.done.get(id)?.payload;
    Object.assign(record, { runId: id, asyncDir, status: payload ? completionStatus(payload) : run.terminal.has(id) ? "stopped" : "running" });
    if (payload) {
      const usage = payload.results?.[0]?.usage;
      Object.assign(record, { durationMs: payload.durationMs, tokens: (usage?.input ?? 0) + (usage?.output ?? 0) });
    }
    run.group.changed();
    fleet.adopt(id, { agent: record.agent, task: record.task, asyncDir });
  }

  const statusLines = run => [...run.records.map(record => `${record.label ?? record.agent} · ${record.status}`), ...run.unverified];

  function trailer(run) {
    const lines = [...run.logs];
    if (run.droppedLogs) lines.push(`… ${run.droppedLogs} more log lines`);
    lines.push(...statusLines(run));
    return lines.length ? `\n\n${lines.join("\n")}` : "";
  }

  async function executeRun(run, params, argsJson) {
    const { controller } = run;
    const script = params.script;
    const runId = run.workflow.id;
    const pushLog = message => {
      if (run.logs.length >= MAX_LOGS) run.droppedLogs++;
      else run.logs.push(clean(typeof message === "string" ? message : JSON.stringify(message) ?? String(message), MAX_LOG_CHARS));
    };
    const workers = [];
    let sandbox;
    let result;
    let interrupted;
    try {
      if (!current(run) || controller.signal.aborted) throw new Error("Workflow interrupted");
      sandbox = new CodemodeSandbox({
        timeoutMs: Infinity,
        onWorkerStarted: exited => { workers.push(exited); },
        memoryLimitBytes: 256 * 1024 * 1024,
        tools: [{ name: "agent", description: "Launch one roster child and resolve to its final text or structured value", execute: (input, ctx) => {
          const call = launch(run, input, AbortSignal.any([ctx.signal, controller.signal]));
          run.settling.add(call);
          call.then(() => run.settling.delete(call), () => run.settling.delete(call));
          return call;
        } }],
      });

      const code = `const args = JSON.parse(${JSON.stringify(argsJson)}); ${PRELUDE}${script.replace(META, "$1$2")}`;
      result = await sandbox.execute(code, { signal: controller.signal });
      // The VM's text()/console output, log() lines included, in call order.
      for (const item of result.output) if (item.type === "text") pushLog(item.text);
    } catch (error) { run.error = error; }
    finally {
      interrupted = controller.signal.aborted;
      controller.abort();
      try { await sandbox?.close(); } catch (error) { run.error ??= error; }
      try { await Promise.all(workers); } catch (error) { run.error ??= error; }
      try { await stop(run, run.records); } catch (error) { run.unverified.push(`unverified cleanup: ${error.message}`); }
      while (run.settling.size) await Promise.allSettled([...run.settling]);
      try {
        // After settling, so a launch still recovering when the VM settled is seen.
        for (const { alias, record } of run.lost) {
          const payload = [...run.started.values()].find(payload => payload.toolCallId === alias);
          if (!payload) continue;
          record.startedAt = Date.now();
          recoverRecord(run, record, payload.id, payload.asyncDir);
        }
        await stop(run, run.records);
      } catch (error) { run.unverified.push(`unverified cleanup: ${error.message}`); }
    }
    const details = { runs: run.records.map(({ runId, agent, label, task, asyncDir, status }) => ({ runId, agent, label, task, asyncDir, status })) };
    // Failures after the VM return, not throw: pi replaces a thrown tool
    // error's details with {}, and fleet restores these runs from details.runs.
    const failed = text => ({ content: [{ type: "text", text }], details, isError: true });
    if (run.error) return failed(`${scrub(run.error.message)}${trailer(run)}`);
    if (interrupted || run.ended) return failed(`${run.ended ?? "Workflow interrupted"}${trailer(run)}`);
    if (!result.ok) {
      const stack = result.error.stack?.split("\n").find(line => line.trim());
      return failed(scrub(`${result.error.kind}: ${result.error.message}${stack ? `\n${stack.trim()}` : ""}`) + trailer(run));
    }
    const value = JSON.stringify(result.value, null, 1) ?? "undefined";
    // The first line counts the agents for the model; the value follows, then
    // the logs and per-child lines. The cap cuts the value and logs, never the
    // per-child and cleanup lines.
    let text = `${run.records.length} agent${run.records.length === 1 ? "" : "s"} · completed\n\n${value}${trailer(run)}`;
    if (text.length > MAX_RESULT) {
      const dir = join(resultDir, runId);
      await mkdir(dir, { recursive: true });
      const path = join(dir, "result.txt");
      await writeFile(path, text);
      const lines = statusLines(run);
      const tail = `\n… full result: ${path}${lines.length ? `\n\n${lines.join("\n")}` : ""}`;
      text = `${text.slice(0, Math.max(0, MAX_RESULT - tail.length))}${tail}`;
    }
    // A child whose end was not observed may still be writing: the root must
    // not read this as done and start conflicting work.
    if (run.unverified.length) return failed(`Workflow finished but its child cleanup is unverified\n\n${text}`);
    return { content: [{ type: "text", text }], details };
  }

  function release(run) {
    if (!running.has(run)) return;
    run.group.end();
    run.finished = true;
    run.off();
    running.delete(run);
    terminal.set(run.workflow.id, run.result);
    while (terminal.size > 20) terminal.delete(terminal.keys().next().value);
    changed();
  }

  async function finish(run, params, argsJson) {
    let result;
    try {
      run.group = fleet.track({ title: params.title, records: run.records });
      result = await executeRun(run, params, argsJson);
    } catch (error) {
      result = { ...shaped(run), isError: true, content: [{ type: "text", text: scrub(error.message) }] };
    }
    const unresolved = run.unverified.some(text => !text.startsWith("launch outcome unknown:")) || run.lost.some(({ record }) => !run.terminal.has(record.runId));
    Object.assign(run.workflow, { status: unresolved ? "cleanup-unverified" : result.isError ? (run.stopped ? "stopped" : "failed") : "completed", endedAt: Date.now() });
    run.workflow.durationMs = run.workflow.endedAt - run.workflow.startedAt;
    result.details.workflow = { ...run.workflow };
    run.result = result;
    if (current(run)) { try { await onComplete(result); } catch {} }
    if (!unresolved) release(run);
    else changed();
    return result;
  }

  function stopOwner(run) {
    if (!run.stoppingOwner) {
      run.stoppingOwner = stopOwned(run).finally(() => { run.stoppingOwner = undefined; });
    }
    return run.stoppingOwner;
  }

  async function stopOwned(run) {
    run.stopped = true;
    run.controller.abort();
    await run.settled;
    if (running.has(run)) {
      run.unverified = [];
      for (const record of run.records) record.stopping = false;
      try {
        await stop(run, run.records);
        for (const { alias, record } of run.lost) {
          if (record.runId && run.terminal.has(record.runId)) continue;
          const details = (await rpc(pi.events, "status", { id: alias }, 5_000))?.details;
          const started = [...run.started.values()].find(payload => payload.toolCallId === alias);
          const id = details?.runId ?? details?.asyncId ?? started?.id;
          if (!id) { run.unverified.push(`launch outcome unknown: ${record.agent}`); continue; }
          record.stopping = false;
          recoverRecord(run, record, id, details?.asyncDir ?? started?.asyncDir);
          await stop(run, [record]);
        }
      } catch (error) { run.unverified.push(error.message); }
      if (run.unverified.length) throw new Error(run.unverified.join("\n"));
      run.workflow.status = "stopped";
      run.result.details.workflow = { ...run.workflow };
      run.result.details.runs = shaped(run).details.runs;
      release(run);
    }
    return run.result;
  }

  async function execute(_id, params, signal, _onUpdate, ctx) {
    if (params?.action !== undefined) {
      const { action, id } = params;
      if (!["status", "result", "stop"].includes(action) || Object.keys(params).some(key => !["action", "id"].includes(key))) throw new Error("Use either a launch or a management action");
      const run = [...running].find(run => run.workflow.id === id);
      const result = terminal.get(id);
      if (action === "status" && id === undefined) {
        const workflows = [...running].map(run => run.workflow).concat([...terminal.values()].map(result => result.details.workflow));
        return { content: [{ type: "text", text: workflows.map(workflow => `${workflow.id} · ${workflow.title} · ${workflow.status}`).join("\n") || "No workflows" }], details: { workflows } };
      }
      if (!run && !result) throw new Error("Unknown workflow id");
      if (action === "stop") return run ? await stopOwner(run) : result;
      if (action === "status") return run ? shaped(run) : { ...result, content: [{ type: "text", text: [`Workflow ${result.details.workflow.id} · ${result.details.workflow.title} · ${result.details.workflow.status}`,
        ...result.details.runs.map(record => `${record.runId ?? "unknown"} · ${record.agent} · ${record.label ?? record.task} · ${record.status}`)].join("\n") }] };
      return run ? run.result ?? shaped(run) : result;
    }
    if (!params || typeof params.script !== "string" || Object.keys(params).some(key => !["script", "args", "title"].includes(key))) throw new Error("A launch requires script");
    if (!armed) throw new Error("Ultracode is off: workflows run only after the user's prompt says ultracode or /ultracode turns it on");
    if (!ctx?.hasUI) throw new Error("Workflows run only in an interactive session");
    if (signal?.aborted) throw new Error("Workflow interrupted");
    if (running.size) throw new Error("A workflow already owns this session");
    if (params.script.length > MAX_SCRIPT) throw new Error("script exceeds 256 KiB");
    const argsJson = JSON.stringify(params.args ?? null) ?? "null";
    if (argsJson.length > MAX_ARGS) throw new Error("args exceed 16 KiB of JSON");
    const run = startRun();
    run.controller = new AbortController();
    run.generation = generation();
    run.epoch = epoch;
    run.workflow = { id: `wf_${randomUUID()}`,  title: clean(params.title ?? "Workflow", 120), status: "running", startedAt: Date.now() };
    run.end = reason => { run.ended ??= reason; run.controller.abort(); };
    run.group = { changed() {}, end() {} };
    running.add(run);
    const admitted = shaped(run);
    run.settled = Promise.resolve().then(() => finish(run, params, argsJson));
    changed();
    return admitted;
  }

  return {
    tool: {
      name: "orchestrate",
      label: "Workflow",
      description,
      parameters: Type.Object({
        script: Type.Optional(Type.String()),
        args: Type.Optional(Type.Any()),
        title: Type.Optional(Type.String()),
        action: Type.Optional(Type.Union([Type.Literal("status"), Type.Literal("result"), Type.Literal("stop")])),
        id: Type.Optional(Type.String()),
      }, { additionalProperties: false }),
      // Admission, not tool-call serialization, retains the session concurrency cap.
      executionMode: "sequential",
      execute,
    },
    noteExtensionInput: text => { extensionInput.set(text, (extensionInput.get(text) ?? 0) + 1); },
    delivered: message => {
      const content = message?.content;
      const text = typeof content === "string" ? content : Array.isArray(content) ? content.filter(part => part?.type === "text").map(part => part.text).join("") : "";
      const count = extensionInput.get(text);
      if (count) { if (count > 1) extensionInput.set(text, count - 1); else extensionInput.delete(text); return; }
      // A /skill: prompt is decided by its args, not the expanded skill body.
      const skill = parseSkillBlock(text);
      const authored = skill ? skill.userMessage ?? "" : text;
      if (saysUltracode(authored)) armed = true;
      return authored;
    },
    disarm: () => { armed = false; extensionInput.clear(); },
    armed: () => armed,
    toggle: () => (armed = !armed),
    // True iff every id is owned; releases each owned one, since a run's
    // notice is sent once.
    claim: ids => {
      const all = ids.length > 0 && ids.every(id => owned.has(id));
      if (all) for (const id of ids) owned.delete(id);
      return all;
    },
    onChange: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    reset: async () => {
      epoch++;
      await Promise.all([...running].map(stopOwner));
      terminal.clear();
      owned.clear();
      armed = false;
      extensionInput.clear();
      changed();
    },
    live: () => running.size,
    stopAll: async () => {
      const entries = [...running];
      await Promise.all(entries.map(stopOwner));
    },
  };
}
