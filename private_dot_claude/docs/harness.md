# Claude Code workflow reference

Answers the recurring "which command / which flag / which model" questions. If
behavior seems changed, verify with the claude-code-guide agent and update this file.

## Review & cleanup commands

- `/code-review [effort] [instructions]` — reviews the **current working diff**.
  Effort: `low`/`medium` (fewer, high-confidence findings), `high`/`max` (broader,
  may include uncertain findings), `ultra` (multi-agent cloud review of the branch,
  billed, user-triggered only; `/ultrareview` is a deprecated alias). Flags:
  `--comment` posts inline PR comments, `--fix` applies findings to the working
  tree. Custom instructions go inline after the effort level.
- `/review <PR#>` — reviews a **GitHub pull request** (not the local diff).
- `/simplify` — reuse/simplification/efficiency cleanups on changed code, then
  applies them. Quality only; bug-hunting is `/code-review`'s job.
- `/security-review` — security review of the branch's pending changes.
- No `/review-branch` exists; `/code-review` on the branch covers it. Extra
  directories come in via `/add-dir` first.

## Verification & running

- `/verify` — run the app and observe that a change actually behaves as intended.
- `/run` — launch/drive the project app (screenshots, smoke checks).

## Models

- Global model is pinned in settings (`model` key) from the chezmoi repo; `/model`
  changes only the current session. Pin stays on `opus[1m]` for the 1M context
  window; bump to Fable per session (`/model`) for orchestration-heavy work.
  (`best` = most capable available — Fable where accessible, else latest Opus —
  but the pin exists to hold `[1m]`.)
- `/fast` — Opus with faster output, not a smaller model.
- Subagent tiers are relative capability, not fixed model names; the session's own
  context reports the current roster. Subagents inherit the main session model by
  default, so a `/model` bump cascades; a subagent naming an unavailable model
  silently falls back to the inherited one. Tier routing rules live in CLAUDE.md
  (tokens-to-done, not sticker price).

## Modes & isolation

- Plan mode is the default (`permissions.defaultMode: "plan"`): read-only until
  the plan is approved. `shift+tab` cycles modes.
- Worktrees isolate parallel work; `worktree.baseRef` is `head` in settings.

## Codex plugin (not installed — blocked)

- OpenAI's official plugin (`codex` from `openai/codex-plugin-cc`) is deliberately
  NOT enabled: nested sandboxing is broken on macOS. Codex refuses to start its
  own Seatbelt inside Claude Code's (openai/codex#30615), and `--sandbox
  danger-full-access` panics because CC's sandbox blocks the `configd` lookup its
  HTTP stack needs (anthropics/claude-code#42857). Revisit when #30615 lands or
  `external-sandbox` becomes user-reachable; until then the only workaround is
  sandbox-disabled Bash, which this setup rejects.

## Recurring maintenance

- `/fewer-permission-prompts` — mine transcripts to grow the project allowlist.
- Sandbox/permission questions: `~/.claude/docs/sandbox.md`.
