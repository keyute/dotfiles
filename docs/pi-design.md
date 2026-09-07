# Pi TUI design language

Last verified 2026-09-07 (pi 0.85.1). Read this before editing
`private_dot_pi/agent/workflow/{rows,footer,fleet,index}.mjs`; change a rule
only with a dated decision here, never by re-wording.

The intent, set on 2026-09-07 from a side-by-side of pi, Codex and Claude
Code: Claude Code's presentation of the work in progress, Codex's composer,
pi's own glyphs. Each rule carries the why that earned it.

1. **Transcript = Claude Code's shape, pi's glyphs.** `•` rows coloured by
   state, `↳` for the line under a row, `π` for anything the harness says in
   its own voice (turn line, fleet root row), `⊙` for children, `›` for the
   fleet cursor, `❯` for the prompt. No `⏺`/`✻`/`◯` (Claude's signatures), no
   Codex `Called`/`Explored` headers. *Why:* a borrowed signature reads as a
   clone; a glyph set that is ours reads as pi.
2. **Quiet while working.** Reasoning is hidden (`hideThinkingBlock` plus an
   empty hidden label, so no row is emitted). A tool row is its title and one
   `↳` summary line (`+12 −4`, `4 matches`, `31 lines · ctrl+o to expand`),
   never output; errors show in full. When the assistant speaks, the
   `workspace_*` rows since its last words fold to one dim line ("Read 3
   files, ran 9 shell commands") and ctrl+o brings every row back. Rows from
   other plugins (MCP compact rows, `subagent` launches) are not ours and stay
   as one-liners. *Why:* Codex's per-step reasoning summaries and head/tail
   previews were the "too verbose" the owner named; what was done stays one
   keystroke away.
3. **One place per fact.** Elapsed time rides pi's working spinner while the
   turn runs (`⠋ Interpolating… 1m 12s`) and the `π` turn line once it ends;
   the status line carries model · context · usage windows · branch, and the
   mode on the right, nothing transient. *Why:* the clock on the status line
   duplicated the spinner two rows above it.
4. **A turn ends when nothing is running.** The turn line prints at
   `agent_settled` only when no background child is live; with children
   running it waits for the follow-up run to settle (or the user to type) and
   then prints the total. An aborted run prints `π Interrupted after …` at
   once. *Why:* pi's `agent_settled` is honest about the root run, not about
   the work; printing "done" while a child still ran was the complaint.
5. **Composer = `❯` in Codex's shaded block.** Two-column inset shared with the
   status line, no placeholder, full-size glyph. *Why:* the prompt glyph
   flipped `❯→›→❯` across three commits; the owner chose the full-size glyph
   on 2026-09-07 and the shaded block the same day.
6. **Fleet = Claude's subagent statusline shape, pi's glyphs.** `π main`, then
   `⊙ title · tokens · model` per child, five rows then `↓ N more`; Down from
   the prompt's last line enters the rows, the highlighted row shows `›`,
   Enter peeks the child's transcript, Esc or up returns. *Why:* the owner
   wants the Claude Code panel with its Enter peek and asked for pi-flavoured
   markers in place of `⏺`/`◯`.
7. **Stability over fidelity.** Build on a documented pi or plugin API. An
   undocumented export or heuristic is allowed only with an entry in
   `harness.md`'s coupling inventory and a test that fails on the pin bump;
   `stability.test.mjs` enforces the import and event side mechanically.
   *Why:* pi breaks extension APIs across 0.x releases; prose fails silently,
   tests fail loudly.
