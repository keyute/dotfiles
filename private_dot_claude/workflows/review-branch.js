export const meta = {
  name: 'review-branch',
  description:
    'Whole-branch correctness review. A sonnet planner maps the change and rates complexity; the four core ' +
    'dimensions (correctness, integration, security, tests) ALWAYS run, plus any extra angle the diff warrants; ' +
    'findings are adversarially verified (blockers + high-complexity warnings on opus) and a go/no-go is reported. ' +
    'Args: base (default main), focus (freeform steer), dirs (read-only context dirs, e.g. /add-dir paths), ' +
    'deep (force opus[1m] planner + opus verification of warnings). ' +
    'Invoke naturally, e.g. "/review-branch --base develop --deep, focus on the auth flow, also use ../lib for context".',
  phases: [
    { title: 'Plan', detail: 'sonnet planner: intent, complexity, extra dimensions', model: 'sonnet' },
    { title: 'Review', detail: 'core dimensions + extras over the full diff (sonnet)' },
    { title: 'Verify', detail: 'refute each finding; blockers + high-complexity warnings on opus' },
  ],
}

const base = args?.base || 'main'
const deep = !!(args && args.deep) // master override: opus[1m] planner + opus verify of warnings
// optional freeform steer, e.g. { focus: 'the new auth flow' }
const focus = (args && typeof args.focus === 'string' && args.focus.trim()) || ''
const focusNote = focus
  ? ` The reviewer specifically asked you to focus on: ${focus}. Prioritize this without ignoring other serious issues.`
  : ''
// read-only context dirs (e.g. the /add-dir paths); NOT part of the diff under review
const dirs = Array.isArray(args?.dirs) ? args.dirs.filter(d => typeof d === 'string' && d.trim()) : []
const dirsNote = dirs.length
  ? ` Additional directories are available READ-ONLY for cross-file context (NOT part of the diff under review): ` +
    `${dirs.join(', ')}. Use them to check call sites, signatures, and integration consistency, ` +
    `but only report findings about the branch diff itself.`
  : ''

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['blocker', 'warning', 'nit'] },
          note: { type: 'string' },
        },
        required: ['file', 'severity', 'note'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT = {
  type: 'object',
  properties: {
    real: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['real', 'reason'],
}

const PLAN = {
  type: 'object',
  properties: {
    intent: { type: 'string' },
    complexity: { type: 'string', enum: ['low', 'medium', 'high'] },
    // extra dimensions are ADDED to the mandatory core set below — they never replace it.
    extraDimensions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          focus: { type: 'string' },
        },
        required: ['key', 'focus'],
      },
    },
  },
  required: ['intent', 'complexity', 'extraDimensions'],
}

// Core dimensions ALWAYS run. The planner may add to these but can never drop them, so a cheap
// planner cannot open a silent coverage hole — its job is triage + complexity + bonus angles.
const DIMENSIONS = [
  { key: 'correctness', focus: 'logic bugs, wrong conditions, off-by-one, broken control flow, missing error handling' },
  { key: 'integration', focus: 'cross-file consistency: renamed/changed symbols updated at every call site, matching signatures, no dangling references' },
  { key: 'security', focus: 'committed secrets/credentials, unsafe shell or template expansion, injection, overly broad permissions' },
  { key: 'tests', focus: 'missing or incorrect test coverage for the new/changed behavior' },
]

// 1. Plan the whole change once — sonnet by default, opus[1m] only when --deep. Rates complexity and
//    proposes extra angles; cannot remove the core dimensions.
const planModel = deep ? 'opus[1m]' : 'sonnet'
const plan = await agent(
  `Run \`git diff ${base}...HEAD --stat\` and \`git log ${base}..HEAD --oneline\`, then read the full diff ` +
  `(\`git diff ${base}...HEAD\`). Summarize the branch intent in a sentence or two, rate its complexity ` +
  `(low|medium|high) based on size, blast radius, and architectural risk, and propose any EXTRA review ` +
  `dimensions this specific diff warrants beyond the mandatory core set (correctness, integration, security, ` +
  `tests) — e.g. concurrency, performance, api-compatibility, migration-safety. Return {key, focus} for each ` +
  `extra dimension, or an empty array if the core set suffices.` + focusNote + dirsNote,
  { label: 'plan', phase: 'Plan', model: planModel, schema: PLAN },
)

const dimensions = DIMENSIONS.concat(plan.extraDimensions || [])
// blocker findings always get opus verification; warnings escalate only when the change is high-complexity
// (per the planner) or --deep was passed. blockers are rare but the costly ones to get wrong.
const deepVerify = plan.complexity === 'high' || deep

// 2. Fan out finders (core + extras); 3. verify each finding as its dimension lands (pipeline, no barrier).
const reviewed = await pipeline(
  dimensions,
  d =>
    agent(
      `Branch intent:\n${plan.intent}\n\n` +
      `Review the FULL branch diff (\`git diff ${base}...HEAD\`) for this dimension only: ${d.focus}. ` +
      `Report concrete findings (file, line, severity blocker|warning|nit, note). Empty array if none.` +
      focusNote + dirsNote,
      { label: `review:${d.key}`, phase: 'Review', model: 'sonnet', schema: FINDINGS },
    ),
  (review, d) =>
    parallel(
      (review?.findings || []).map(f => () =>
        agent(
          `Try to REFUTE this ${d.key} finding from a branch review. Default real=false if you cannot ` +
          `confirm it from the diff. Finding: "${f.note}" at ${f.file}:${f.line || '?'} (severity ${f.severity}).` +
          dirsNote,
          {
            label: `verify:${f.file}`,
            phase: 'Verify',
            model: f.severity === 'blocker' || (deepVerify && f.severity === 'warning') ? 'opus' : 'sonnet',
            schema: VERDICT,
          },
        ).then(v => ({ ...f, dimension: d.key, verdict: v })),
      ),
    ),
)

const confirmed = reviewed.flat().filter(Boolean).filter(f => f.verdict && f.verdict.real)
const blockers = confirmed.filter(f => f.severity === 'blocker')
log(`review-branch: ${confirmed.length} confirmed finding(s), ${blockers.length} blocker(s)`)
return {
  go: blockers.length === 0,
  blockers: blockers.length,
  total: confirmed.length,
  findings: confirmed,
}
