# Pi TUI design language

Last verified 2026-09-08 (pi 0.85.1). Read this before editing
`private_dot_pi/agent/workflow/{rows,footer,fleet,index}.mjs`; change a rule
only with a dated decision here, never by re-wording.

The intent, set on 2026-09-07 from a side-by-side of pi, Codex and Claude
Code: Claude Code's presentation of the work in progress, Codex's composer,
pi's own glyphs. Each rule carries the why that earned it.

1. **Transcript = Claude Code's shape, pi's glyphs.** `•` rows coloured by
   state, `○` for a subagent wherever it appears (launch row, completion line,
   fleet row), `↳` for the line under a row, `π` for anything the harness says
   in its own voice (turn line), `›` for the fleet cursor, `❯` for the prompt.
   No `⏺`/`✻`/`◯` (Claude's signatures), no Codex `Called`/`Explored` headers.
   *Why:* a borrowed signature reads as a clone; a glyph set that is ours reads
   as pi. *2026-09-08:* the owner chose `○` over `⊙` for subagents so a child
   is told apart from a tool at a glance.
2. **Quiet while working.** Reasoning is hidden (`hideThinkingBlock` plus an
   empty hidden label, so no row is emitted; pi's one spacer after a hidden
   run stays). A tool row is its title and one `↳` summary line (`+12 −4`,
   `4 matches`, `31 lines · ctrl+o to expand`, `no output`), never output. A
   failed shell command shows its first two and last two lines with `… N more
   lines` between and the exit status last; other errors show in full. When
   the assistant speaks, the `workspace_*` and MCP rows since its last words
   fold to one dim, dotless line at the text column ("Read 3 files, ran 9
   shell commands, called 2 MCP tools"); clicking it or ctrl+o brings every
   row of the group back. *Why:* Codex's per-step reasoning summaries and
   head/tail previews were the "too verbose" the owner named; what was done
   stays one keystroke away. *2026-09-08:* plugin rows (pi-mcp-adapter's
   `mcp`/`mcp__*`, pi-subagents' `subagent`) take the same shape through a
   `registerTool` wrapper that swaps only their renderers — the owner wants
   one form, and the plugins' own rows (`mcp__… {json} → …`, green cards) were
   the odd ones out. Subagent rows never fold: their completion line refers
   back to them. The fold summary lost its dot and the error rows their full
   dump on the same day, from the Claude Code reference the owner sent.
3. **One place per fact.** Elapsed time rides pi's working spinner while the
   turn runs (`⠋ Interpolating… 1m 12s`) and the `π` turn line once it ends;
   the status line carries model · context · usage windows · branch, and the
   mode on the right, nothing transient. *Why:* the clock on the status line
   duplicated the spinner two rows above it.
4. **A turn ends when nothing is running.** The turn line prints at
   `agent_settled` only when no background child is live; with children
   running it waits for the follow-up run to settle (or the user to type) and
   then prints the total. An aborted run prints `π Interrupted after …` at
   once. Each async child that ends prints `○ agent finished · task`, or its
   status word (`failed`/`stopped` in the error colour, `paused`/`partial`/
   `detached` in the warning colour). *Why:* pi's `agent_settled` is
   honest about the root run, not about the work; printing "done" while a
   child still ran was the complaint. *2026-09-08:* the completion line
   returned because pi-subagents shows its own notice only for failures and
   the owner wants finished children visible in the chat.
5. **Composer = `❯` in Codex's shaded block.** Two-column inset shared with the
   status line and the transcript, no placeholder, full-size glyph. *Why:* the
   prompt glyph flipped `❯→›→❯` across three commits; the owner chose the
   full-size glyph on 2026-09-07 and the shaded block the same day.
6. **Fleet = Claude's subagent statusline shape, pi's glyphs.** `○ title ·
   tokens · model` per child under the status line, five rows then `↓ N more`;
   Down from the prompt's last line enters the rows, the highlighted row shows
   `›`, Enter peeks the child's transcript, Esc or up returns. *Why:* the owner
   wants the Claude Code panel with its Enter peek and asked for pi-flavoured
   markers in place of `⏺`/`◯`. *2026-09-08:* the `π main` root row went — pi
   has no thread to switch into, so the row said nothing.
7. **Stability over fidelity.** Build on a documented pi or plugin API. An
   undocumented export or heuristic is allowed only with an entry in
   `harness.md`'s coupling inventory and a test that fails on the pin bump;
   `stability.test.mjs` enforces the import and event side mechanically and
   pins the source text every heuristic assumes. *Why:* pi breaks extension
   APIs across 0.x releases; prose fails silently, tests fail loudly.
8. **One inset.** Everything the extension draws starts two columns in: `•`,
   `○` and `π` rows, the fold summary and `↳` lines two further in, the
   assistant bullet (a leading space in the markdown, which pi's one-column
   pad turns into two), the `❯` prompt, the status line. Pi's own surfaces are
   re-applied on every `session_start` because `/new` and `/resume` reset the
   header, footer, editor and hidden-thinking label. *Why (2026-09-08):* rows
   flush against the frame while the status line sat two columns in read as
   two different programs; the owner asked for padding before the prompt and
   the turn line, and one column for all of it is the rule that stops the next
   such request.
