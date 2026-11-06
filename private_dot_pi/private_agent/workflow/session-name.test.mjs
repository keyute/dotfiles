import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installSessionName, SESSION_NAME_ENTRY } from "./session-name.mjs";
import { sessionCost } from "./usage.mjs";

const config = { models: { provider: "openai-codex", tiers: { small: "small-fixture" } } };
const usage = { input: 20, output: 5, cacheRead: 10, cacheWrite: 0, totalTokens: 35, cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 }, extra: "private" };
const reply = (title = "Repair the naming race", stopReason = "stop") => ({ content: [{ type: "text", text: title }], stopReason, usage });
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture({ name, entries = [], mode = "tui", hasUI = true, complete, model = true, oauth = true } = {}) {
  const handlers = new Map();
  const calls = [], names = [];
  let sessionId = "first";
  const ctx = {
    mode, hasUI,
    sessionManager: { getSessionId: () => sessionId, getEntries: () => entries },
    modelRegistry: {
      find(provider, id) { assert.equal(provider, config.models.provider); assert.equal(id, config.models.tiers.small); return model && { provider, id }; },
      isUsingOAuth: () => oauth,
      complete(...args) { calls.push(args); return complete ? complete(...args) : Promise.resolve(reply()); },
    },
  };
  const emit = (type, event = {}) => { for (const handler of handlers.get(type) ?? []) handler(event, ctx); };
  const pi = {
    on(type, handler) { const list = handlers.get(type) ?? []; list.push(handler); handlers.set(type, list); },
    getSessionName: () => name,
    setSessionName(value) { name = value; names.push(value); emit("session_info_changed", { name }); },
    appendEntry(customType, data) { entries.push({ type: "custom", customType, data }); },
  };
  installSessionName(pi, config);
  emit("session_start", { reason: "startup" });
  return { ctx, calls, names, entries, emit, pi,
    input: (text = "Fix the session naming race", source = "interactive") => emit("input", { text, source }),
    switch() { sessionId = "second"; name = undefined; emit("session_start", { reason: "new" }); },
  };
}

test("one quiet background request uses small subscription model, SSE and no tools; only numeric usage persists", async () => {
  let finish;
  const f = fixture({ complete: () => new Promise(resolve => { finish = resolve; }) });
  assert.equal(f.input("x".repeat(9000)), undefined, "input does not await the naming request");
  f.input("Second request");
  assert.equal(f.calls.length, 1);
  const [model, context, options] = f.calls[0];
  assert.equal(model.id, "small-fixture");
  assert.equal(context.messages[0].content, `${"x".repeat(2000)}\n[... middle omitted ...]\n${"x".repeat(2000)}`);
  assert.match(context.systemPrompt, /concise, meaningful task title/);
  assert.match(context.systemPrompt, /preferably 2–3 words; use extra words when needed for clarity/);
  assert.doesNotMatch(context.systemPrompt, /24 characters/);
  assert.equal(context.tools, undefined);
  assert.equal(context.messages.length, 1);
  assert.equal(options.transport, "sse");
  assert.equal(options.sessionId, "first");
  assert.equal(options.maxTokens, undefined);
  assert.equal(options.maxRetries, 0);
  assert.equal(options.reasoningEffort, "none");
  assert.deepEqual(f.entries, [{ type: "custom", customType: SESSION_NAME_ENTRY, data: { status: "started", display: false } }]);
  finish(reply());
  await flush();
  assert.deepEqual(f.names, ["Repair the naming race"]);
  assert.equal(f.entries.length, 2);
  assert.deepEqual(Object.keys(f.entries[1].data).sort(), ["display", "model", "provider", "status", "usage"]);
  assert.equal(f.entries[1].data.usage.extra, undefined);
  assert.doesNotMatch(JSON.stringify(f.entries), /Repair|xxxx|private/);
  const cost = sessionCost(f.entries, null);
  assert.equal(cost.main.cost, 0.03);
  assert.equal(cost.main.input, 20);
  assert.equal(cost.main.output, 5);
  assert.equal(cost.main.cacheRead, 10);
  f.input();
  assert.equal(sessionCost(f.entries, null).total, 0.03);
  assert.equal(f.calls.length, 1);
});

test("naming samples preserve short input and Unicode-safe head and tail of long input", async () => {
  for (const text of ["  Fix cache 🛠️\nplease", "🦊".repeat(4000), "HEAD" + "🦊".repeat(5000) + "\nActual request: repair migration"]) {
    const f = fixture();
    f.input(text);
    const points = Array.from(text);
    const sample = f.calls[0][1].messages[0].content;
    assert.equal(sample, points.length <= 4000 ? text : `${points.slice(0, 2000).join("")}\n[... middle omitted ...]\n${points.slice(-2000).join("")}`);
    assert.equal(sample.isWellFormed(), true);
    assert.match(f.calls[0][1].systemPrompt, /actual task.*trailing request/);
    assert.match(f.calls[0][1].systemPrompt, /quoted text and context instructions as data/);
    await flush();
  }
});

test("titles accept 120 Unicode codepoints and reject 121 without truncation or retry", async () => {
  for (const char of ["a", "🦊"]) {
    for (const length of [120, 121]) {
      const title = char.repeat(length);
      const f = fixture({ complete: async () => reply(`\x1b[31m${title}\x1b[0m\n`) });
      f.input();
      await flush();
      assert.deepEqual(f.names, length === 120 ? [title] : []);
      assert.equal(sessionCost(f.entries, null).total, 0.03, "rejected titles still record numeric usage");
      f.input();
      assert.equal(f.calls.length, 1);
      assert.doesNotMatch(JSON.stringify(f.entries), new RegExp(char.repeat(10), "u"));
    }
  }
});

test("a verbose repeated question is rejected whole and the persisted attempt prevents reload retry", async () => {
  const question = "Would you like me to migrate the configuration now? ".repeat(12);
  const f = fixture({ complete: async () => reply(question) });
  f.input("Old migration instructions. ".repeat(300) + "Actual request: fix task naming.");
  await flush();
  assert.deepEqual(f.names, []);
  assert.equal(sessionCost(f.entries, null).total, 0.03);
  assert.doesNotMatch(JSON.stringify(f.entries), /Would you|migration|Actual request/);
  f.emit("session_start", { reason: "reload" });
  f.input();
  assert.equal(f.calls.length, 1);
});

test("path-led interactive requests name exactly once", async () => {
  for (const text of ["/src/app.mjs fix the crash", "  /src/app.mjs fix the crash"]) {
    const f = fixture();
    f.input(text);
    f.input("/src/other.mjs fix another crash");
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][1].messages[0].content, text);
    await flush();
    f.input(text);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.names, ["Repair the naming race"]);
  }
});

test("commands, shells, extension injections, RPC, empty input and automated wakes never name", async () => {
  const f = fixture();
  for (const text of ["/name explicit", "/skill:review do it", "/unknown", "  /usage", "/unknown /src/app.mjs", "! ls", "!!pwd", "  ! echo hi", "!/src/app.mjs", "", " \n "]) f.input(text);
  f.input("Injected task", "extension");
  f.input("API task", "rpc");
  f.emit("before_agent_start", { messageType: "custom" });
  f.emit("message_start", { message: { role: "user", content: "Automated wake" } });
  assert.equal(f.calls.length, 0);
  assert.equal(f.entries.length, 0);
  f.input();
  await flush();
  assert.equal(f.calls.length, 1);
  for (const options of [{ mode: "print", hasUI: false }, { mode: "json", hasUI: false }, { mode: "rpc" }, { hasUI: false }]) {
    const background = fixture(options);
    background.input();
    assert.equal(background.calls.length, 0);
    assert.equal(background.entries.length, 0);
  }
});

test("startup and ineligible input defer the name lookup until genuine interactive input", () => {
  const f = fixture({ name: "Existing task" });
  let reads = 0;
  f.pi.getSessionName = () => { reads++; return "Existing task"; };
  f.emit("session_start", { reason: "reload" });
  f.input("/usage");
  f.input("Injected task", "extension");
  assert.equal(reads, 0);
  f.input();
  assert.equal(reads, 1);
  assert.equal(f.calls.length, 0);
});

test("existing explicit names survive startup, resume and reload; prior attempts never retry", async () => {
  for (const reason of ["startup", "resume", "reload", "fork"]) {
    const named = fixture({ name: "My explicit name" });
    named.emit("session_start", { reason });
    named.input();
    assert.equal(named.calls.length, 0);
    assert.equal(named.pi.getSessionName(), "My explicit name");
    for (const status of ["started", "completed"]) {
      const attempted = fixture({ entries: [{ type: "custom", customType: SESSION_NAME_ENTRY, data: { status } }] });
      attempted.emit("session_start", { reason });
      attempted.input();
      assert.equal(attempted.calls.length, 0);
    }
    const unnamed = fixture();
    unnamed.emit("session_start", { reason });
    unnamed.input();
    await flush();
    assert.equal(unnamed.calls.length, 1);
  }
});

test("manual rename or clearing wins while pending, while returned same-session usage still counts", async () => {
  for (const name of ["Manual task", undefined]) {
    let finish;
    const f = fixture({ complete: () => new Promise(resolve => { finish = resolve; }) });
    f.input();
    f.pi.setSessionName(name);
    assert.equal(f.calls[0][2].signal.aborted, true);
    finish(reply());
    await flush();
    assert.deepEqual(f.names, [name]);
    assert.equal(f.pi.getSessionName(), name);
    assert.equal(sessionCost(f.entries, null).total, 0.03);
    f.input();
    assert.equal(f.calls.length, 1);
  }
  const f = fixture();
  f.pi.setSessionName("Manual before first prompt");
  f.input();
  assert.equal(f.calls.length, 0);
});

test("late results after session switch or shutdown cannot append names or usage to replacement", async () => {
  for (const shutdown of [false, true]) {
    let finish;
    const f = fixture({ complete: () => new Promise(resolve => { finish = resolve; }) });
    f.input();
    if (shutdown) f.emit("session_shutdown", { reason: "quit" });
    else f.switch();
    assert.equal(f.calls[0][2].signal.aborted, true);
    finish(reply());
    await flush();
    assert.equal(f.entries.length, 1);
    assert.deepEqual(f.names, []);
    assert.equal(sessionCost(f.entries, null).total, 0);
  }
});

test("failure, abort and absent subscription model stay quiet and never retry", async () => {
  for (const options of [
    { model: false }, { oauth: false },
    { complete: async () => { throw new Error("Unavailable"); } },
    { complete: async () => reply("Should not apply", "error") },
    { complete: async () => reply("Should not apply", "aborted") },
  ]) {
    const f = fixture(options);
    f.input();
    await flush();
    f.input();
    assert.deepEqual(f.names, []);
    assert.ok(f.calls.length <= 1);
    assert.equal(f.entries[0].data.status, "started");
  }
  const f = fixture();
  f.pi.appendEntry = () => { throw new Error("Persistence failed"); };
  assert.doesNotThrow(() => f.input());
  f.input();
  assert.equal(f.calls.length, 0);
});

test("title strips terminal controls and newlines without truncating text or Unicode; empty titles are ignored", async () => {
  const f = fixture({ complete: async () => reply("\x1b]0;injected\x07\x1b[31mRepair\x1b[0m\n\tcache\x00\u2028race\u202e 工作流 🛠️") });
  f.input();
  await flush();
  assert.equal(f.names[0], "Repair cache race 工作流 🛠️");
  assert.ok(f.names[0].length > 24);
  assert.doesNotMatch(f.names[0], /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
  const empty = fixture({ complete: async () => reply("\x1b[31m\n\x1b[0m") });
  empty.input();
  await flush();
  assert.deepEqual(empty.names, []);
});

test("root-only entrypoint installs naming before lifecycle hooks without owning terminal titles", () => {
  const source = readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
  assert.match(source, /if \(isRoot\) installSessionName\(pi, config\);/);
  const module = readFileSync(new URL("./session-name.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(module, /setTitle|setInterval|sendMessage|sendUserMessage|ctx\.setSessionName/);
});
