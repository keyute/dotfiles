export const meta = {
  name: 'review-branch',
  description: 'Whole-branch correctness review: map the change, fan out review dimensions, adversarially verify findings, report a go/no-go',
  phases: [
    { title: 'Map', detail: 'summarize branch intent + risky areas' },
    { title: 'Review', detail: 'one finder per dimension over the full diff' },
    { title: 'Verify', detail: 'refute each finding; drop the ones that do not survive' },
  ],
}

const base = args?.base || 'main'
const deep = !!(args && args.deep) // run as: review-branch { deep: true } for large/complex branches
// optional freeform steer, e.g. review-branch { focus: 'the new auth flow' }
const focus = (args && typeof args.focus === 'string' && args.focus.trim()) || ''
const focusNote = focus
  ? ` The reviewer specifically asked you to focus on: ${focus}. Prioritize this without ignoring other serious issues.`
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

const DIMENSIONS = [
  { key: 'correctness', focus: 'logic bugs, wrong conditions, off-by-one, broken control flow, missing error handling' },
  { key: 'integration', focus: 'cross-file consistency: renamed/changed symbols updated at every call site, matching signatures, no dangling references' },
  { key: 'security', focus: 'committed secrets/credentials, unsafe shell or template expansion, injection, overly broad permissions' },
  { key: 'tests', focus: 'missing or incorrect test coverage for the new/changed behavior' },
]

// 1. Map the whole change once — shared context for every finder.
// sonnet by default; opus[1m] when opted in for large/architecturally complex branches.
const mapModel = deep ? 'opus[1m]' : 'sonnet'
const map = await agent(
  `Run \`git diff ${base}...HEAD --stat\` and \`git log ${base}..HEAD --oneline\`, then read the full diff ` +
  `(\`git diff ${base}...HEAD\`). Summarize in a few sentences: the intent of this branch, the main areas it ` +
  `changes, and anything that looks risky, surprising, or incomplete.` + focusNote,
  { label: 'map', phase: 'Map', model: mapModel },
)

// 2. Fan out dimension finders; 3. verify each finding as its dimension lands (pipeline, no barrier).
const reviewed = await pipeline(
  DIMENSIONS,
  d =>
    agent(
      `Branch summary:\n${map}\n\n` +
      `Review the FULL branch diff (\`git diff ${base}...HEAD\`) for this dimension only: ${d.focus}. ` +
      `Report concrete findings (file, line, severity blocker|warning|nit, note). Empty array if none.` + focusNote,
      { label: `review:${d.key}`, phase: 'Review', model: 'sonnet', schema: FINDINGS },
    ),
  (review, d) =>
    parallel(
      (review?.findings || []).map(f => () =>
        agent(
          `Try to REFUTE this ${d.key} finding from a branch review. Default real=false if you cannot ` +
          `confirm it from the diff. Finding: "${f.note}" at ${f.file}:${f.line || '?'} (severity ${f.severity}).`,
          {
            label: `verify:${f.file}`,
            phase: 'Verify',
            // blocker-only escalation: blockers are few but the costly ones to get wrong.
            model: f.severity === 'blocker' ? 'opus' : 'sonnet',
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
