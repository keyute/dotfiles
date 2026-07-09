# Claude Code workflow reference

Answers the recurring "which command / which flag / which model" questions without a
lookup agent. If behavior seems to have changed, verify with the claude-code-guide
agent and update this file.

## Review & cleanup commands

- `/code-review [effort] [instructions]` — reviews the **current working diff**.
  Effort levels: `low`/`medium` (fewer, high-confidence findings), `high`/`max`
  (broader coverage, may include uncertain findings), `ultra` (multi-agent cloud
  review of the branch, billed, user-triggered only; `/ultrareview` is a deprecated
  alias). Flags: `--comment` posts findings as inline PR comments, `--fix` applies
  findings to the working tree. Custom instructions go inline after the effort level.
- `/review <PR#>` — reviews a **GitHub pull request** (not the local diff).
- `/simplify` — reuse/simplification/efficiency cleanups on changed code, then applies
  them. Quality only; it does not hunt bugs — that's `/code-review`.
- `/security-review` — security review of the branch's pending changes.
- There is no separate `/review-branch`; `/code-review` on the branch covers it.
  Extra directories come in via `/add-dir` before invoking.

## Verification & running

- `/verify` — run the app and observe that a change actually behaves as intended.
- `/run` — launch/drive the project app (screenshots, smoke checks).

## Models

- Global model is pinned in settings (`model` key) from the chezmoi repo; `/model`
  changes only the current session. Pin stays on `opus[1m]` for the 1M context
  window; bump up to Fable manually (`/model`) for orchestration-heavy sessions when
  the plan offers it — it's opted into per session, not every session. (`best` =
  most capable available — Fable where accessible, else latest Opus — but it's not
  pinned here, since the pin exists to hold the `[1m]` context.)
- `/fast` — fast mode: Opus with faster output, not a smaller model.
- Subagent tiers are relative capability, not fixed model names — the session's own
  context reports the current roster. Map: cheapest tier = mechanical lookups/triage;
  mid tier = routine implementation and review; most-capable available = architecture,
  orchestration, or expensive-if-wrong work. Subagents default to inheriting the main
  session model, so a `/model` bump cascades to them; a subagent that names an
  unavailable model silently falls back to the inherited one (no pay-as-you-go
  surprise). Route on total tokens-to-done, not sticker price — a stronger model that
  one-shots beats a cheaper one that retries.

## Modes & isolation

- Plan mode is the default (`permissions.defaultMode: "plan"`): read-only until the
  plan is approved. `shift+tab` cycles modes.
- Worktrees isolate parallel work; `worktree.baseRef` is set to `head` in settings.

## Recurring maintenance

- `/fewer-permission-prompts` — mine transcripts to grow the project allowlist.
- Sandbox/permission questions: see `~/.claude/docs/sandbox.md`.
