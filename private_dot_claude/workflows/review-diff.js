export const meta = {
  name: 'review-diff',
  description: 'Route changed files to the matching language reviewer (each on its pinned cheap model), merge findings in JS',
  phases: [
    { title: 'Review', detail: 'one reviewer per language, on its own haiku/sonnet tier' },
  ],
}

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

// Each reviewer pins its own model (haiku/sonnet) in its frontmatter, so calling it by
// agentType inherits the cheap tier automatically — no Opus fan-out.
const ROUTES = [
  { agentType: 'shell-reviewer', lang: 'shell/zsh/bash and chezmoi .tmpl' },
  { agentType: 'ts-reviewer', lang: 'TypeScript/JavaScript' },
  { agentType: 'go-reviewer', lang: 'Go' },
]

const ref = args?.ref || '' // e.g. 'main...HEAD'; empty = uncommitted working tree
const diffCmd = ref ? `git diff ${ref}` : 'git diff'

const results = await pipeline(ROUTES, route =>
  agent(
    `Run \`${diffCmd}\` yourself and review ONLY the ${route.lang} files in it. ` +
    `Report concrete findings (file, line, severity, note). ` +
    `If there are no ${route.lang} changes, return an empty findings array.`,
    { agentType: route.agentType, phase: 'Review', schema: FINDINGS },
  ),
)

const all = results.filter(Boolean).flatMap(r => r.findings || [])
log(`review-diff: ${all.length} finding(s) across ${ROUTES.length} languages`)
return { count: all.length, findings: all }
