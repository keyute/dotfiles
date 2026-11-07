---
name: workflow-authoring
description: "Reference for writing an orchestrate script — staged shapes, one exploration and one execute-mode example. Load before authoring a workflow the user already opted into; it does not itself authorize running one."
---
# Writing an orchestrate script

A workflow earns its cost when later agents work on earlier agents' results. A script that only fans out and returns the reports is `subagent` with extra steps.

Explore shape: find, check, distil.
- Find in parallel, each agent with a narrow, non-overlapping scope and a `schema`, so the next stage reads fields, not prose.
- Verify what was found with a different role or lens than the finder, in batches per group (one verifier per finder's set or per theme), never one agent per fact. Trace each claimed connection against source; count a fact as not confirmed when its evidence cannot be located.
- Synthesise once: one agent, or plain script code, merges what survived, folds duplicates, and names coverage gaps and unresolved disagreement.
- `return` that distilled value. The return value is what the driver receives; `log()` lines are progress.

```js
const list = item => ({ type: "array", items: { type: "object", properties: item, required: Object.keys(item) } });
const FACTS = { type: "object", properties: { facts: list({ claim: { type: "string" }, where: { type: "string" } }) }, required: ["facts"] };
const VERDICTS = { type: "object", properties: { verdicts: list({ claim: { type: "string" }, confirmed: { type: "boolean" }, evidence: { type: "string" } }) }, required: ["verdicts"] };

// args: { areas: ["src/auth", "src/session"] }; a stage gets (previous result, item, index), the first stage's previous is the item
const findStage = area => agent(`Trace the entry points and call flow in ${area}. Return code-flow facts as claims, each with supporting file:line locations in where.`, { agentType: "explore-deep", schema: FACTS, label: `find ${area}` });
const verifyStage = (found, area) => agent(`Locate the source supporting each code-flow claim in ${area}, following its cited connections. Return one verdict per claim; confirmed is false if supporting evidence cannot be located. Put file:line locations and what they establish, or what could not be located, in evidence.\n${JSON.stringify(found.facts)}`, { agentType: "Explore", schema: VERDICTS, label: `verify ${area}` });

const results = await pipeline(args.areas, findStage, verifyStage);
const failed = args.areas.filter((area, i) => results[i] === null);
if (failed.length) log(`not covered (a stage failed): ${failed.join(", ")}`);
const confirmed = results.filter(Boolean).flatMap(r => r.verdicts.filter(v => v.confirmed));
if (confirmed.length === 0) return { confirmed: [], notCovered: failed };
return agent(`Synthesize these verified code-flow facts and their source locations: fold duplicates, group by flow, and name coverage gaps (not covered: ${failed.join(", ") || "none"}). Do not infer coverage beyond the supplied facts.\n${JSON.stringify(confirmed)}`, { agentType: "explore-deep", label: "synthesis" }).catch(error => { log(`synthesis failed: ${error.message}`); return { confirmed, notCovered: failed }; });
```

Execute shape (execute mode only): implement, verify, integrate.
- One `implementer` per slice, each slice naming disjoint files: there is no worktree or write isolation, so the file list is the only separation between concurrent writers. The implementer runs the slice's gate itself; read-only roles cannot write the workspace, so a test runner that writes caches fails in them.
- Verify each slice with a read-only reviewer (`diff-reviewer` on the slice's uncommitted changes, `spec-reviewer` against its requirements) returning a `schema` verdict. A finished child cannot be resumed, so on a failed verdict the driver relaunches one writer for that slice once the first has finished, never two at once on the same files.
- Return the verdicts; the driver integrates and runs the whole gate once.

```js
const RESULT = { type: "object", properties: { files: { type: "array", items: { type: "string" } }, gate: { type: "string" } }, required: ["files", "gate"] };
const VERDICT = { type: "object", properties: { passes: { type: "boolean" }, findings: { type: "array", items: { type: "string" } } }, required: ["passes", "findings"] };
// args: { slices: [{ name, task, files: [...], gate: "npm test -- x" }] }
const implementStage = slice => agent(`Edit only ${slice.files.join(", ")}: ${slice.task}. Run \`${slice.gate}\`; return the files you changed and the gate output.`, { agentType: "implementer", schema: RESULT, label: `implement ${slice.name}` });
const verifyStage = (result, slice) => agent(`Review the uncommitted changes to ${slice.files.join(", ")} against: ${slice.task}. Gate output:\n${result.gate}`, { agentType: "spec-reviewer", schema: VERDICT, label: `verify ${slice.name}` });
return pipeline(args.slices, implementStage, verifyStage);
```

Patterns to compose: source crosschecks; distinct exploration lenses (callers, definitions, cross-file wiring) instead of identical searches; a coverage pass that asks what was not located; loop until a round finds nothing new. When a stage samples or caps, `log()` what was dropped.

Rules here:
- `pipeline()` when each item flows on by itself; `parallel()` only when the next step needs every result together (dedup, early exit). A bare `agent()` rejects on child failure; `.filter(Boolean)` the others.
- Verify with a different role than the one that found or wrote.
- For larger work run several workflows in turn — understand, design, implement, verify — reading each result before writing the next script.
