#!/usr/bin/env node
// PreToolUse hook on the Agent tool: no child runs the frontier tier (on
// Claude it is escalation-only via `/model`). CLAUDE_CODE_SUBAGENT_MODEL
// only sets the default for unpinned children; a per-call `model` still wins,
// which is the path this hook closes. Superseded by the Agent(model:fable)
// deny rule in agents.claude.denied_tools; deleted once that rule is trialled.
// The match is by family prefix, not the exact pin, so the alias and any
// point release of the frontier family are caught with it. Forks
// (`subagent_type: fork`) always run the parent model by harness design and
// carry no `model`; they are a driver-context continuation, not a worker, and
// pass through here.
const FRONTIER_FAMILY = /^(claude-)?(fable|mythos)/;

let input = "";
for await (const chunk of process.stdin) input += chunk;
const model = JSON.parse(input).tool_input?.model;
if (typeof model !== "string") process.exit(0);
// `[1m]` selects the 1M-context variant of the same model
const requested = model.replace(/\[1m\]$/, "");
if (!FRONTIER_FAMILY.test(requested)) process.exit(0);
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: `Children never run the frontier tier (${model}); dispatch it at its pinned tier or the top worker tier, or do the piece yourself.`,
  },
}));
