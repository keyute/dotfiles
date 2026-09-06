import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = new URL("./merge-pi-settings.mjs", import.meta.url);

const run = (current, managed) =>
  spawnSync(process.execPath, [script.pathname, managed], {
    input: current,
    encoding: "utf8",
  });

const merge = (current, managed) => run(current, JSON.stringify(managed));

test("preserves unmanaged settings and recursively merges managed keys", () => {
  const result = merge(
    JSON.stringify({
      defaultProvider: "anthropic",
      models: { enabled: ["old"], labels: { old: "Old" } },
      trustedProjects: ["/work"],
    }),
    {
      defaultProvider: "openai-codex",
      models: { enabled: ["gpt-5.6-sol"], labels: { sol: "Sol" } },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    defaultProvider: "openai-codex",
    models: { enabled: ["gpt-5.6-sol"], labels: { old: "Old", sol: "Sol" } },
    trustedProjects: ["/work"],
  });
});

test("is stable across repeated application", () => {
  const current = JSON.stringify({ ui: { theme: "dark" }, recentModels: ["old"] });
  const managed = { ui: { toolOutputExpanded: false }, recentModels: ["gpt-5.6-sol"] };
  const first = merge(current, managed);

  assert.equal(first.status, 0, first.stderr);
  const second = merge(first.stdout, managed);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout, first.stdout);
});

test("treats an absent settings file as an empty object", () => {
  const result = merge("", { defaultProvider: "openai-codex" });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { defaultProvider: "openai-codex" });
});

test("rejects malformed and non-object inputs", () => {
  for (const [current, managed] of [
    ["{", "{}"],
    ["[]", "{}"],
    ["{}", "["],
    ["{}", "[]"],
  ]) {
    const result = run(current, managed);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
  }
});
