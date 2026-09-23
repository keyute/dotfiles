# Pi TUI design language

Last verified 2026-09-22 (pi 0.87.0, pi-subagents 0.70.1). Read this before editing `private_dot_pi/agent/workflow/{rows,footer,fleet,peek,replay,index,dialog,questionnaire,plan-approval}.mjs`;
change a rule only with a dated decision here, never by re-wording.

The intent, set on 2026-09-07 from a side-by-side of pi and Claude Code:
Claude Code's presentation of the work in progress, pi's own glyphs. Each rule carries the why that earned it. How each rule was
arrived at is in git history (`git log -p docs/pi-design.md`).

1. **Transcript = Claude Code's shape, pi's glyphs.** `•` rows coloured by
   state for every row (tool calls, subagent launches and actions, child
   completion lines), `○` only on a fleet row, `↳` for the line under a row and for a group's member line (rule 2),
   `π` for anything the harness says in its own voice (turn line), `❭` for the
   selection cursor (fleet, dialogs), `✔` for a chosen answer (rule 11), `❯` for the prompt and for the message it sent (rule 5),
   `▸`/`▾` for a fold handle's state (rule 2). No `⏺`/`✻`/`◯` (Claude's
   signatures), no `Called`/`Explored` headers. *Why:* a borrowed
   signature reads as a clone; a glyph set that is ours reads as pi.
   - *2026-09-21:* `❭` became the one selection cursor and `✔` joined, replacing the dialogs' unlisted `→` and `●`/`○` (rule 11).
2. **Quiet while working.** Reasoning renders as nothing and takes no space:
   pi's `hideThinkingBlock` stays off and the markdown transformer returns ""
   for `assistant-thinking` while the stream runs, so the block has no lines
   and no click region (ctrl+t is moot); the settled message's thinking text is
   blanked, which takes pi's own spacer with it. A tool row is its title and
   one `↳` summary line (`+12 −4`, the counts in the theme's own success/error
   pair, `4 matches`, `31 lines`, `no output`), never output. A failed shell
   command shows its first two and last two lines with `… N more lines` between
   and the exit status last; other errors show in full. The rows between two
   things that stay visible — successful workspace/MCP/search calls, agent discovery,
   launches and child/task completions — are one group: a sentence that counts them
   ("Read 3 files, ran 9 shell commands, launched 3 agents"). While the group
   is the newest thing in the transcript it lists its members under a `•`
   sentence, one `↳` line per row in the row's own words (`↳ Ran npm test · 31
   lines`, `↳ researcher › title`); once anything visible lands after it, it
   closes to the sentence alone, dim, behind `▸`. A click on that handle moves
   the one group between sentence and members (`▸`/`▾`); ctrl+o shows every
   group's rows in full and is the only way to output — while it is on, a click
   has nothing to change. A row still running is a plain row below the group
   and joins it when it succeeds. Whatever stays visible closes the group:
   assistant text, a `workspace_task` or other plugin row, a failed row (never
   a member), an unsuccessful completion, the turn line, the next run. One row is not a
   group. *Why:* per-step reasoning summaries and head/tail previews were
   the "too verbose" the owner named; what was done stays a keystroke away.
   - *2026-09-08, night:* a shell row that ran outside the sandbox (Claude
     Code's `dangerouslyDisableSandbox`) carries `· unsandboxed` on its title,
     background launch row included — the classifier may allow the escalation
     without a dialog.
   - *2026-09-08, night:* a `message_end` handler blanks the settled message's
     thinking text, taking pi's reasoning spacer (earendil-works/pi#8154) with
     it; gated on the message's `api`, as only the OpenAI Responses replay
     sends the opaque item. Cost: after a model change the new model no longer sees the earlier summaries.
   - *2026-09-18, later:* the reasoning is blanked in the streaming message too, so the gap above a reply is one line from its first token.
   - *2026-09-09:* the `· ctrl+o to expand` hints went and the caret plus an
     undimmed handle carry the open state; ctrl+o became two-way. Residual:
     pi's own `Tool output: expanded` line is unreachable.
   - *2026-09-09, later:* `workspace_task` left the fold set (a background task
     is running work under rule 4), and the plan row took the tool's own
     `Plan approval` label.
   - *2026-09-10:* fold extent is derived from `rows.mjs`'s ordered timeline of
     facts — a maximal stretch of settled successful rows with a separator on
     its right, keyed by that boundary so ctrl+o and click state survive —
     after two close-trigger fixes six call sites had to remember and four did
     not. Residual: a visible custom message pi appends outside the agent
     stream registers no boundary and can still be swallowed.
   - *2026-09-18:* the fold became the group and launches joined it, reversing
     the 2026-09-08 exemption of subagent rows: the fleet holds the running
     child (rule 6) and the completion line names agent and task (rule 4). Not
     taken from Claude Code's grouped launch row: `├`/`└`, `Agent (title)`, the
     `↓ to manage` hint, members listed for good. *Why:* the reader needs the
     list while it is happening and the count once it has passed; one rule for
     every class of row leaves nothing to remember per tool.
   - *2026-09-22, input:* user input closes the preceding group immediately, including queued steer/follow-up input; extension input does not. Pending/error rows and manual/Ctrl+O expansion keep their existing behavior.
   - *2026-09-22:* subagent management calls (steer, status, interrupt, stop) joined the group (`steered 1 agent`,
     `checked on 2 agents`), reversing their boundary-row exemption; `bg_wait` and `workspace_task` stay visible, each a
     blocking wait whose own sentence is the information. *Why:* a steer between two reads split the group for a row that says nothing its completion line does not.
   - *2026-09-22, images and shell:* `terminal.showImages: false` suppresses native inline previews, not model image input; image results obey the same folding rules as text results. A user shell command closes the preceding group because Pi draws its native block outside normal message events.
3. **One place per fact.** Elapsed time rides the working spinner while the
   turn runs (`⠋ Interpolating… 1m 12s`) and the `π` turn line once it ends;
   the status line carries model · context · usage windows · branch, and the
   mode on the right, nothing transient. *Why:* the clock on the status line
   duplicated the spinner two rows above it.
   - *2026-09-08, night:* the spinner sits on its own line at column 0 above
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
     approval setting beside it in dim (`execute · auto`); the left side yields
     so mode and approval stay whole.
   - *2026-09-16:* the right footer prepends live background shells (`2 shells · execute · auto`), omits zero, and yields them first when narrow.
     It counts no subagents or MCP; completion notices stay normal except actual-shutdown shell settlements, which are silent.
4. **A turn ends when nothing is running.** The turn line prints at
   `agent_settled` only when no background child or task is live; with either running it waits for the follow-up run to settle (or the user to type) and
   then prints the total. An aborted run prints `π Interrupted after …` at once. Each async child that ends prints `• agent finished · task · 2m 14s`
   (the run's own `durationMs`, launch to end), or its status word (`failed`/`stopped` in the error colour, `paused`/`partial`/`detached` in
   the warning colour); a background task ends the same way, `• task t1 finished · command · 12s`. *Why:* pi's `agent_settled` is honest about the
   root run, not about the work; printing "done" while a child still ran was
   the complaint.
   - *2026-09-08, evening:* background shell tasks joined children as running
     work (`• Started cmd in background`, `↳ task t1 · running`), and the
     in-progress bullet stays static.
   - *2026-09-09:* pi-subagents' control notice takes the same line (`• researcher needs attention · …`), composed over the plugin's renderer; goal-mission notices stay in the plugin's box whole, since the row's `<agent> <state>` strip assumes one producer's wording.
   - *2026-09-12:* the completion notice does not draw: the plugin wrapper sends
     it with `display` off, pi-subagents' quiet-background-success path; content
     is untouched.
   - *2026-09-18, later decision:* `completed` lines join successful calls on rule 2's
     chronological ladder, superseding completion-only groups. Other statuses stay visible;
     resumed rows stay ungrouped. *Why:* separate completion milestones fragmented activity.
   - *2026-09-22, settled root:* with background work still live, the existing working row shows a frozen `π <verb> for <duration>` snapshot instead of a spinner. A child wake reuses that row; only the final settle appends a turn entry. *Why:* root inactivity must be visible without a fresh transcript milestone for every staggered completion.
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
   - *2026-09-09:* Tab opens nothing on a line that does not start with `/`;
     the wrapper answers pi's `shouldTriggerFileCompletion` itself, and only
     the forced path consults it, so `@path` is untouched.
   - *2026-09-09, later:* Tab offers only what a command declares, and nothing
     where it declares none — chosen over an allowlist of completing commands,
     which would take pi's own `/model`, `/thinking` and `/login` off it.
   - *2026-09-09, later still:* the menu also opens on the characters a path is
     typed with (the command's space, `/`, `~`), first line only; an accept shows the next level and stops.
   - *2026-09-17:* superseding the 2026-09-10 ancestor-skipping decision, `/add-dir` respects explicit paths literally:
     an addable slash-ended path comes first, children below, preserving relative, `~/…` and absolute spelling.
     Empty input starts at siblings; policy exclusions still apply. Tab accepting unchanged text closes the menu;
     accepting a different directory opens its level. *Why:* automatic descent selected the wrong directory; literal paths also remove the climbing heuristic.
   - *2026-09-22, shell mode:* a leading `!`/`!!` moves into a red (`error`) `!` prompt, with command text in `userMessageText` and the whole composer in subtle `toolErrorBg`. Backspace at command start exits the mode; native submission and `!!` context exclusion stay intact. *Why:* the owner wants the mode in the prompt, not an extra character in the command; normal text keeps the tinted surface readable. The native shell-output block remains upstream-owned pending a renderer hook.
6. **Fleet = Claude's subagent statusline shape, pi's glyphs.** `○ agent ›
   title · tokens · model` per child under the status line, five rows then `↓ N
   more`; Down from the prompt's last line enters the rows, the highlighted row
   shows `❭`, Enter peeks the child's transcript, Esc or up returns. *Why:* the
   owner wants the Claude Code panel with its Enter peek and asked for
   pi-flavoured markers in place of `⏺`/`◯`.
   - *2026-09-22:* the peek is a rule 11 dialog over the child's own transcript: the run's `events.jsonl` replayed
     through rule 2's row grammar (tool rows with their `↳` summary, bodies under ctrl+o, assistant markdown, sent
     steers as rule 5 blocks), a live header (`agent › task · model · tokens · elapsed · current tool`), scrolling, a
     rule 5 composer whose Enter steers the child, `/stop` behind a confirm, Esc back to the row it left. A run whose
     artifact directory this process never saw (restored, foreground) keeps pi-subagents' text tail. *Why:* the text
     tail named tools without outcomes; the owner wants to look at and talk to a child as if it were the main thread.
7. **Stability over fidelity.** Build on a documented pi or plugin API. An
   undocumented export or heuristic is allowed only with an entry in the
   coupling inventory (`docs/pi-coupling.md`) and a test that fails on the pin
   bump; `stability.test.mjs` enforces the import and event side mechanically
   and pins the source text every heuristic assumes. *Why:* pi breaks extension
   APIs across 0.x releases; prose fails silently, tests fail loudly.
8. **Glyph at the edge, text two in.** A line that opens with a glyph (`•`,
   `π`, `❯`, `❭`, `▸`/`▾`) starts at column 0; a line without one (`↳`, the status
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
   - *2026-09-18:* a group is one block: one blank line above, none inside; a
     row that draws nothing takes no line (`docs/pi-coupling.md`).
9. **Background = user messages, composer and a dialog's active tab.** The user
   box and composer share rule 5's shade; a dialog's active tab is the explicit
   2026-09-21 exception (rule 11). No tool card (every plugin takes the row renderer)
   or activity summary has a background. pi's rare compaction and
   branch notices are pi's. *Why (2026-09-08):* `bg_wait`'s green card was a
   third background and read as a different program; the composer's shade came
   back the same afternoon because the owner wants the place they type to look
   like what they typed.
10. **A pinned plugin earns a tool row, not a panel.** `web_search`
    (pi-web-search) uses `• Searched "query"`, joining rule 2's group on success;
    alone it has the answer's first line below. The `π` voice records workspace changes
    (`π Added … to the workspace`). The one panel above the composer is the
    working row (rule 3). *Why (2026-09-08):* the todo plugin's panel above the
    composer was a second `○` meaning and was removed the same night, when
    both reference CLIs dropped the surface it mirrored.
11. **A dialog is one frame, one cursor, one accent.** Every surface we draw that takes the keyboard follows this: plan approval and the questionnaire through
    `dialog.mjs`, the fleet peek on the same grid; pi's native `confirm`/`select` stay pi's (rule 7) until owned. *Why (2026-09-21):* each dialog had collected exceptions under rules 2, 9 and 10 and drifted
    from rules 1 and 8; the accent discipline the owner liked in RPIV's questionnaire — one accent that always means "here" — needs none of its glyphs or boxes.
    - Frame and grid: top and bottom `borderAccent` rules, no side walls; `❭` at column 0 and everything else two in (rule 8). Nested content (a preview) is a `borderMuted` box centred in the free width, stacked when narrow.
    - Accent = focus (cursor, focused label, active tab on `userMessageBg`); bold = title, question and chosen, both when both; muted = descriptions and `↳ note:` lines; dim = hint and placeholder; success = answered inactive tab; warning = missing answer; answers plain.
    - Marks: single-select none, the chosen row ends ` ✔`; multi-select `[✔]` accent, `[ ]` muted. Text is typed inline through the borderless native editor behind a dim placeholder, never in an editor box.
    - Plan approval: title, vertical Yes/No, feedback beside No, no hint. Blank Enter or Esc stops without another model turn; Up from the first line or Tab returns to Yes keeping the draft.
    - Questionnaire: a single question has no header; tabs are padded cells; Tab opens the note under its option; the free answer is typed, and kept literal, in its own last row; one blank below the header or top rule and above the one dim ` · `-joined hint; eight-row minimum; arrows move, PgUp/PgDn page.
    - *2026-09-22, questionnaire:* question tabs use `☐`/`☑` for unanswered/answered; the action tab is `✔ Submit`, retaining review-before-confirmation and missing-answer checks. No bracketed tabs; narrow headers keep the active tab visible.
    - *2026-09-22:* the fleet peek's composer takes rule 5's shade and `❯`, not the dim inline field: it is a composer, and its sent steers sit above it in the same shade.
    - *2026-09-22, free answer:* the custom row carries the next option number (`N. Type something.`), including during editing; the number is presentation, never part of the answer.
12. **Use semantic theme colours, not literal palette values.** Accent means identity/focus; success/error/warning mean outcome or state; muted/dim carry hierarchy. Plan=warning and execute=success are local conventions, not Catppuccin requirements. Shell-red is rule 5's explicit mode exception; backgrounds remain confined to rule 9's surfaces. *Why (2026-09-22):* one semantic mapping survives the Latte/Mocha switch without recolouring already-consistent surfaces. Raw SGR is only reset repair or cursor styling, not a second palette.
