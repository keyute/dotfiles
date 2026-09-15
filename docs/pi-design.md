# Pi TUI design language

Last verified 2026-09-09 (pi 0.85.1). Read this before editing
`private_dot_pi/agent/workflow/{rows,footer,fleet,index}.mjs`; change a rule
only with a dated decision here, never by re-wording.

The intent, set on 2026-09-07 from a side-by-side of pi, Codex and Claude
Code: Claude Code's presentation of the work in progress, Codex's composer,
pi's own glyphs. Each rule carries the why that earned it. How each rule was
arrived at is in git history (`git log -p docs/pi-design.md`).

1. **Transcript = Claude Code's shape, pi's glyphs.** `•` rows coloured by
   state for every row (tool calls, subagent launches and actions, child
   completion lines), `○` only on a fleet row, `↳` for the line under a row,
   `π` for anything the harness says in its own voice (turn line), `❭` for the
   fleet cursor, `❯` for the prompt and for the message it sent (rule 5),
   `▸`/`▾` for a fold handle's state (rule 2). No `⏺`/`✻`/`◯` (Claude's
   signatures), no Codex `Called`/`Explored` headers. *Why:* a borrowed
   signature reads as a clone; a glyph set that is ours reads as pi.
   - *2026-09-08:* `○` chosen over `⊙` for subagents, then retired from the
     transcript the same day — one glyph for all tool calls.
   - *2026-09-10:* the fleet cursor moved `›`→`❭`; `›` is the row's own
     `agent › title` separator and too small at the accent colour.
2. **Quiet while working.** Reasoning renders as nothing and takes no space:
   pi's `hideThinkingBlock` stays off and the markdown transformer returns ""
   for `assistant-thinking` while the stream runs, so the block has no lines
   and no click region (ctrl+t is moot); the settled message's thinking text is
   blanked, which takes pi's own spacer with it. A tool row is its title and
   one `↳` summary line (`+12 −4`, the counts in the theme's own success/error
   pair, `4 matches`, `31 lines`, `no output`), never output. A failed shell
   command shows its first two and last two lines with `… N more lines` between
   and the exit status last; other errors show in full. The `workspace_*` and
   MCP rows between two things that stay visible fold to one dim, dotless line
   at the text column ("Read 3 files, ran 9 shell commands, called 2 MCP
   tools"); that line is the group's handle in both states — it sits above the
   group and opens with `▸` closed, `▾` open, and a click on it opens or closes
   the group. ctrl+o drives every group to match it, so a group clicked open
   against the flag follows it again at the next press. Whatever stays visible
   closes the group: assistant text, a subagent or other plugin row, a failed
   row (it renders as its group's last row), a child's completion line, the
   turn line, the next run. A group holds hidden rows only, so a run of one is
   not a group and a failed row separates the runs around it. *Why:* Codex's
   per-step reasoning summaries and head/tail previews were the "too verbose"
   the owner named; what was done stays one keystroke away.
   - *2026-09-08:* plugin rows take the same shape through a `registerTool`
     wrapper that swaps only their renderers; the questionnaire tool renders
     nothing, subagent rows never fold, the fold summary lost its dot and error
     rows their full dump.
   - *2026-09-08, later:* the hidden-thinking label moved to the markdown
     transformer (pi wraps an "empty" label in colour codes, rendering an
     invisible clickable line); the fold handle moved to the group's top.
   - *2026-09-08, afternoon:* a group runs between separators instead of from
     the assistant's last words to its next.
   - *2026-09-08, night:* a shell row that ran outside the sandbox (Claude
     Code's `dangerouslyDisableSandbox`) carries `· unsandboxed` on its title,
     background launch row included — the classifier may allow the escalation
     without a dialog.
   - *2026-09-08, night:* a `message_end` handler blanks the settled message's
     thinking text, taking pi's reasoning spacer (earendil-works/pi#8154) with
     it; gated on the message's `api`, as only the OpenAI Responses replay
     sends the opaque item. Cost: after a model change the new model no longer
     sees the earlier summaries.
   - *2026-09-09:* the `· ctrl+o to expand` hints went and the caret plus an
     undimmed handle carry the open state; ctrl+o became two-way. Residual:
     pi's own `Tool output: expanded` line is unreachable.
   - *2026-09-09, later:* `workspace_task` left the fold set (a background task
     is running work under rule 4), and the plan row took the tool's own
     `Plan approval` label.
   - *2026-09-10:* the plan renders as markdown under its row from the call's
     own `executionStarted` while the decision is open, the dialog carries only
     the question, and a result retires it through the row's `isPartial`.
   - *2026-09-10:* fold extent is derived from `rows.mjs`'s ordered timeline of
     facts — a maximal stretch of settled successful rows with a separator on
     its right, keyed by that boundary so ctrl+o and click state survive —
     after two close-trigger fixes six call sites had to remember and four did
     not. Residual: a visible custom message pi appends outside the agent
     stream registers no boundary and can still be swallowed.
3. **One place per fact.** Elapsed time rides the working spinner while the
   turn runs (`⠋ Interpolating… 1m 12s`) and the `π` turn line once it ends;
   the status line carries model · context · usage windows · branch, and the
   mode on the right, nothing transient. *Why:* the clock on the status line
   duplicated the spinner two rows above it.
   - *2026-09-08:* the spinner moved into the composer's top shaded row (pi's
     documented `embedWorkingStatus`).
   - *2026-09-08, night:* it moved back out to its own line at column 0 above
     the composer — a `Loader` subclass without pi-tui's hardcoded pad, docked
     through `setWidget` at `placement: "aboveEditor"` with pi's own row off via
     `setWorkingVisible(false)` — and stands down for pi's compaction indicator.
     Residual: pi's undocumented auto-retry countdown draws there too.
   - *2026-09-09:* the row takes a trailing blank line instead of `Loader`'s
     leading one; the expand state stays off the status line.
   - *2026-09-09, later:* the branch's diff counts take the theme's
     success/error pair, rule 2's colours for the transcript's own `+12 −4`;
     the shared painter keys on the `+`, as the two surfaces spell the minus
     differently.
   - *2026-09-10:* the mode takes the theme's success/warning pair with the
     approval setting beside it in dim (`execute · auto`), painted in the
     footer's render and travelling as one string; the left side is truncated
     against the space the mode does not need, so mode and approval stay whole.
4. **A turn ends when nothing is running.** The turn line prints at
   `agent_settled` only when no background child or task is live; with either
   running it waits for the follow-up run to settle (or the user to type) and
   then prints the total. An aborted run prints `π Interrupted after …` at
   once. Each async child that ends prints `• agent finished · task · 2m 14s`
   (the run's own `durationMs`, launch to end), or its status word
   (`failed`/`stopped` in the error colour, `paused`/`partial`/`detached` in
   the warning colour); a background task ends the same way, `• task t1
   finished · command · 12s`. *Why:* pi's `agent_settled` is honest about the
   root run, not about the work; printing "done" while a child still ran was
   the complaint.
   - *2026-09-08:* the completion line returned, since pi-subagents notices
     only failures and finished children should stay visible with their time.
   - *2026-09-08, evening:* background shell tasks joined children as running
     work (`• Started cmd in background`, `↳ task t1 · running`), and the
     in-progress bullet stays static.
   - *2026-09-09:* pi-subagents' control notice takes the same line
     (`• researcher needs attention · …`), composed over the plugin's renderer
     so an unrecognised payload is its box again; content is untouched.
   - *2026-09-09, later:* goal-mission notices go back to the plugin's box
     whole, since the row's `<agent> <state>` strip assumes one producer's
     wording.
   - *2026-09-12:* the completion notice itself no longer draws — the plugin
     wrapper sends it with `display` off, the path pi-subagents' quiet
     background successes ride; its content is untouched.
5. **Composer = the user box, and the user box = the composer.** A shaded block
   in pi's `userMessageBg`: one blank shaded row above and below the content,
   `❯` at column 0 on the first content line, no rule lines, no placeholder;
   the status line follows the bottom row directly. *Why:* the standard is the
   user box, not either reference CLI — "if we are going to do the background
   thing for user messages in the chat, the input should be the same" — and
   pi's box hardcodes its blank row above and below, so the composer carries
   the same two.
   - *2026-09-08, night:* a sent message carries the same `❯` in the same
     column, through the markdown transformer in the box's own colour; a
     message opening with a markdown block marker renders as a paragraph.
   - *2026-09-08, later:* Tab completes what the command accepts — the
     command's own candidates in argument position, and the next level after an
     accept, so Tab walks a directory tree.
   - *2026-09-09:* Tab opens nothing on a line that does not start with `/`;
     the wrapper answers pi's `shouldTriggerFileCompletion` itself, and only
     the forced path consults it, so `@path` is untouched.
   - *2026-09-09, later:* Tab offers only what a command declares, and nothing
     where it declares none — chosen over an allowlist of completing commands,
     which would take pi's own `/model`, `/thinking` and `/login` off it.
   - *2026-09-09, later still:* the menu also opens on the characters a path is
     typed with (the command's space, `/`, `~`), first line only, and `..` is
     offered while the walk climbs; an accept shows the next level and stops.
   - *2026-09-10:* the walk climbs on its own past a level offering nothing but
     `..` and the directory it came out of, opening on the first level with an
     unrelated directory; the skipped levels lose their ancestor from the menu.
6. **Fleet = Claude's subagent statusline shape, pi's glyphs.** `○ agent ›
   title · tokens · model` per child under the status line, five rows then `↓ N
   more`; Down from the prompt's last line enters the rows, the highlighted row
   shows `❭`, Enter peeks the child's transcript, Esc or up returns. *Why:* the
   owner wants the Claude Code panel with its Enter peek and asked for
   pi-flavoured markers in place of `⏺`/`◯`.
   - *2026-09-08:* the `π main` root row went (pi has no thread to switch
     into); the agent name went with it that morning and came back in the
     afternoon, `agent › title` being the launch row's shape already.
7. **Stability over fidelity.** Build on a documented pi or plugin API. An
   undocumented export or heuristic is allowed only with an entry in the
   coupling inventory (`docs/pi-coupling.md`) and a test that fails on the pin
   bump; `stability.test.mjs` enforces the import and event side mechanically
   and pins the source text every heuristic assumes. *Why:* pi breaks extension
   APIs across 0.x releases; prose fails silently, tests fail loudly.
   - *2026-09-12:* the inventory moved out of `~/.pi/agent/docs/harness.md`
     into the repository, whose sessions are its only consumers.
8. **Glyph at the edge, text two in.** A line that opens with a glyph (`•`,
   `π`, `❯`, `▸`/`▾`) starts at column 0; a line without one (`↳`, the status
   line, the fleet rows) starts two columns in. pi's `outputPad` is 0 so its
   own lines (assistant text, the user box, "Operation aborted") share column
   0; pi allows only 0 or 1 there. Pi's own surfaces are re-applied on every
   `session_start` because `/new` and `/resume` reset the header, footer and
   editor. *Why (2026-09-08):* "one inset" read as margins on the chat, the
   owner's reference has the rows at the edge and only the status block inset,
   and "glyph or not" needs no list. The one line that breaks it is pi's:
   assistant text sits at column 0 under its bullet, and only patching pi
   reaches it — ruled out as cosmetic.
   - *2026-09-08:* a leading heading renders bold on the bullet line instead of
     leaving the bullet on a line of its own.
   - *2026-09-09:* the fold handle stopped being dotless — its caret takes the
     dot column, so the handle lines up with the `•` rows it owns.
9. **Background = the user's sent messages and the composer.** pi's user box
   keeps its background and the composer takes the same one (rule 5); nothing
   else the extension draws has one: no tool card (every plugin registration
   takes the row renderer), no coloured summary. pi's rare compaction and
   branch notices are pi's. *Why (2026-09-08):* `bg_wait`'s green card was a
   third background and read as a different program; the composer's shade came
   back the same afternoon because the owner wants the place they type to look
   like what they typed.
10. **A pinned plugin earns a tool row, not a panel.** `web_search`
    (pi-web-search) is a plain row, `• Searched "query"` with the answer's
    first line under it, and the `π` voice also records workspace changes
    (`π Added … to the workspace`). The one panel above the composer is the
    working row (rule 3). *Why (2026-09-08, evening):* `@juicesharp/rpiv-todo`
    drew Claude Code's task list there and restyling its panel would have meant
    a fork, so a second `○` meaning was judged the cheaper cost.
    - *2026-09-08, night:* the todo plugin was removed — both reference CLIs
      dropped the surface the panel existed to mirror — and `○` means one thing
      again.
