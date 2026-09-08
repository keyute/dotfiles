# Pi TUI design language

Last verified 2026-09-08 (pi 0.85.1). Read this before editing
`private_dot_pi/agent/workflow/{rows,footer,fleet,index}.mjs`; change a rule
only with a dated decision here, never by re-wording.

The intent, set on 2026-09-07 from a side-by-side of pi, Codex and Claude
Code: Claude Code's presentation of the work in progress, Codex's composer,
pi's own glyphs. Each rule carries the why that earned it.

1. **Transcript = Claude Code's shape, pi's glyphs.** `•` rows coloured by
   state for every row (tool calls, subagent launches and actions, child
   completion lines), `○` only on a fleet row, `↳` for the line under a row,
   `π` for anything the harness says in its own voice (turn line), `›` for the
   fleet cursor, `❯` for the prompt. No `⏺`/`✻`/`◯` (Claude's signatures), no
   Codex `Called`/`Explored` headers. *Why:* a borrowed signature reads as a
   clone; a glyph set that is ours reads as pi. *2026-09-08:* the owner chose
   `○` over `⊙` for subagents, then the same day retired it from the transcript:
   a launch and a `subagent list` are both tool calls, and one glyph for tool
   calls is simpler than a second one that marked only some of them.
2. **Quiet while working.** Reasoning renders as nothing: pi's
   `hideThinkingBlock` stays off and the markdown transformer returns "" for
   `assistant-thinking`, so the block has no lines and no click region (ctrl+t
   is moot). pi's assistant component still spaces a message that carried
   reasoning from raw content (one blank line before it, one more before
   text that follows), and no documented API reaches that; it is the accepted
   residual. A tool row is its title and one `↳` summary line (`+12 −4`,
   `4 matches`, `31 lines · ctrl+o to expand`, `no output`), never output. A
   failed shell command shows its first two and last two lines with `… N more
   lines` between and the exit status last; other errors show in full. When
   the assistant speaks, the `workspace_*` and MCP rows since its last words
   fold to one dim, dotless line at the text column ("Read 3 files, ran 9
   shell commands, called 2 MCP tools"); that line is the group's handle in
   both states — it sits above the group, a click on it opens or closes the
   group, ctrl+o opens a closed one. *Why:* Codex's per-step reasoning
   summaries and head/tail previews were the "too verbose" the owner named;
   what was done stays one keystroke away. *2026-09-08:* plugin rows take the
   same shape through a `registerTool` wrapper that swaps only their
   renderers — the owner wants one form, and the plugins' own rows
   (`mcp__… {json} → …`, green cards) were the odd ones out; the wrapper now
   covers every registration (`bg_wait` still showed a card), and the
   questionnaire tool renders nothing (its overlay and the answers entry
   already say everything). Subagent rows never fold: their completion line
   refers back to them. The fold summary lost its dot and the error rows their
   full dump on the same day, from the Claude Code reference the owner sent.
   *2026-09-08, later:* the "empty hidden label" was not empty — pi wraps it
   in colour codes, so it rendered an invisible, clickable line per thinking
   run (the "space that reveals thinking"); hence the transformer. The fold
   handle moved to the top of the group because an opened group had no
   visible way back.
3. **One place per fact.** Elapsed time rides pi's working spinner while the
   turn runs (`⠋ Interpolating… 1m 12s`) and the `π` turn line once it ends;
   the status line carries model · context · usage windows · branch, and the
   mode on the right, nothing transient. *Why:* the clock on the status line
   duplicated the spinner two rows above it.
4. **A turn ends when nothing is running.** The turn line prints at
   `agent_settled` only when no background child is live; with children
   running it waits for the follow-up run to settle (or the user to type) and
   then prints the total. An aborted run prints `π Interrupted after …` at
   once. Each async child that ends prints `• agent finished · task ·
   2m 14s` (the run's own `durationMs`, launch to end), or its status word
   (`failed`/`stopped` in the error colour, `paused`/`partial`/`detached` in
   the warning colour). *Why:* pi's `agent_settled` is honest about the root
   run, not about the work; printing "done" while a child still ran was the
   complaint. *2026-09-08:* the completion line returned because pi-subagents
   shows its own notice only for failures and the owner wants finished
   children visible in the chat, with how long they took.
5. **Composer = Claude Code's.** pi's rule lines above and below, `❯` at
   column 0 on the first content line, no shade, no blank rows, no
   placeholder; the status line follows the bottom rule directly. *Why:* the
   prompt glyph flipped `❯→›→❯` across three commits; the owner chose the
   full-size glyph on 2026-09-07 and Codex's shaded block the same day, then
   on 2026-09-08 sent Claude Code's composer as the reference: the shaded
   block's blank rows were "too much padding".
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
8. **Glyph at the edge, text two in.** A line that opens with a glyph (`•`,
   `π`, `❯`) starts at column 0; a line without one (`↳`, the fold summary,
   the status line, the fleet rows) starts two columns in. pi's `outputPad`
   is 0 so its own lines (assistant text, the user box, "Operation aborted")
   share column 0; pi allows only 0 or 1 there. Pi's own surfaces are
   re-applied on every `session_start` because `/new` and `/resume` reset the
   header, footer and editor. *Why (2026-09-08):* the morning's "one inset"
   (everything two columns in) read as margins on the chat; the owner's
   Claude Code reference has the rows at the edge and only the status block
   inset, and "glyph or not" is a rule that needs no list.
9. **Background = the user's sent messages only.** pi's user box keeps its
   background; nothing else the extension draws has one: no composer shade,
   no tool card (every plugin registration takes the row renderer), no
   coloured summary. pi's rare compaction and branch notices are pi's. *Why
   (2026-09-08):* `bg_wait`'s green card and the shaded composer were the
   only backgrounds left, and each one read as a different program; Claude
   Code colours only what the user typed.
