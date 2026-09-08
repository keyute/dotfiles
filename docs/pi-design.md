# Pi TUI design language

Last verified 2026-09-08, afternoon (pi 0.85.1). Read this before editing
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
   lines` between and the exit status last; other errors show in full. The
   `workspace_*` and MCP rows between two things that stay visible fold to
   one dim, dotless line at the text column ("Read 3 files, ran 9 shell
   commands, called 2 MCP tools"); that line is the group's handle in both
   states — it sits above the group, a click on it opens or closes the group,
   ctrl+o opens a closed one. Whatever stays visible closes the group:
   assistant text, a subagent or other plugin row, a failed row (it renders as
   its group's last row), a child's completion line, the turn line, the next
   run. *Why:* Codex's per-step reasoning
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
   visible way back. *2026-09-08, afternoon:* one group used to run from the
   assistant's last words to its next, so a single handle at the top of a turn
   swallowed rows that sat after subagent launches and failed rows, with no
   handle of their own; the owner asked for the simpler rule above. The same
   day's spacing complaint has two sources and no fix: every tool row draws
   its own leading blank line (pi's tool component), and pi's assistant
   component adds a spacer for any message whose raw content carried
   reasoning, transformer or not (earendil-works/pi#8154, open) — two blanks
   wherever the model reasoned between tool calls. Accepted.
3. **One place per fact.** Elapsed time rides pi's working spinner while the
   turn runs (`⠋ Interpolating… 1m 12s`) and the `π` turn line once it ends;
   the status line carries model · context · usage windows · branch, and the
   mode on the right, nothing transient. *Why:* the clock on the status line
   duplicated the spinner two rows above it. *2026-09-08:* the spinner moved
   from pi's standalone row into the composer's top shaded row (pi's
   documented `embedWorkingStatus`): the standalone row is pi's, one column
   in with a blank line above, and the owner saw both misalignments.
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
5. **Composer = the user box.** A shaded block in pi's `userMessageBg`: one
   blank shaded row above and below the content (the spinner rides the top
   one, rule 3), `❯` at column 0 on the first content line, no rule lines, no
   placeholder; the status line follows the bottom row directly. *Why:* the
   prompt glyph flipped `❯→›→❯` across three commits; the owner chose the
   full-size glyph on 2026-09-07 and Codex's shaded block the same day, then
   on 2026-09-08 sent Claude Code's composer (rules, no shade: "too much
   padding"), then the same afternoon settled it on consistency: "if we are
   going to do the background thing for user messages in the chat, the input
   should be the same". pi's user box hardcodes its blank row above and
   below, so the composer carries the same two; the standard is the user box,
   not either reference.
6. **Fleet = Claude's subagent statusline shape, pi's glyphs.** `○ agent ›
   title · tokens · model` per child under the status line, five rows then
   `↓ N more`; Down from the prompt's last line enters the rows, the
   highlighted row shows `›`, Enter peeks the child's transcript, Esc or up
   returns. *Why:* the owner wants the Claude Code panel with its Enter peek
   and asked for pi-flavoured markers in place of `⏺`/`◯`. *2026-09-08:* the
   `π main` root row went — pi has no thread to switch into, so the row said
   nothing. The agent name went with it that morning (Claude's panel shows
   the task) and came back in the afternoon: the owner missed it, and
   `agent › title` is already the launch row's and the peek header's shape.
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
   inset, and "glyph or not" is a rule that needs no list. The one line that
   breaks it is pi's: assistant text sits at column 0 under its bullet where
   Claude Code keeps every line at the text column. pi pads assistant text by
   `outputPad`, an on/off switch by design (earendil-works/pi#6168, a range
   declined in #6757), and offers no hook on its assistant component (#6747
   chose the display-only markdown transformer; #6876 and #5834 closed
   unanswered); no maintained package restyles it. Only patching pi reaches
   it, which the owner ruled out on 2026-09-08 as not worth the maintenance
   for a cosmetic gain. A leading heading renders bold on the bullet line
   instead of leaving the bullet on a line of its own (same day).
9. **Background = the user's sent messages and the composer.** pi's user
   box keeps its background and the composer takes the same one (rule 5);
   nothing else the extension draws has one: no tool card (every plugin
   registration takes the row renderer), no coloured summary. pi's rare
   compaction and branch notices are pi's. *Why (2026-09-08):* `bg_wait`'s
   green card was a third background and read as a different program; the
   composer's shade came back the same afternoon because the owner wants the
   place they type to look like what they typed.
