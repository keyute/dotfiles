# Pi TUI design language

Last verified 2026-09-09 (pi 0.85.1). Read this before editing
`private_dot_pi/agent/workflow/{rows,footer,fleet,index}.mjs`; change a rule
only with a dated decision here, never by re-wording.

The intent, set on 2026-09-07 from a side-by-side of pi, Codex and Claude
Code: Claude Code's presentation of the work in progress, Codex's composer,
pi's own glyphs. Each rule carries the why that earned it.

1. **Transcript = Claude Code's shape, pi's glyphs.** `•` rows coloured by
   state for every row (tool calls, subagent launches and actions, child
   completion lines), `○` only on a fleet row, `↳` for the line under a row,
   `π` for anything the harness says in its own voice (turn line), `›` for the
   fleet cursor, `❯` for the prompt and for the message it sent (rule 5),
   `▸`/`▾` for a fold handle's state (rule 2). No
   `⏺`/`✻`/`◯` (Claude's signatures), no Codex `Called`/`Explored` headers.
   *Why:* a borrowed signature reads as a
   clone; a glyph set that is ours reads as pi. *2026-09-08:* the owner chose
   `○` over `⊙` for subagents, then the same day retired it from the transcript:
   a launch and a `subagent list` are both tool calls, and one glyph for tool
   calls is simpler than a second one that marked only some of them.
2. **Quiet while working.** Reasoning renders as nothing and takes no space:
   pi's `hideThinkingBlock` stays off and the markdown transformer returns ""
   for `assistant-thinking` while the stream runs, so the block has no lines
   and no click region (ctrl+t is moot); the settled message's thinking text
   is blanked, which takes pi's own spacer with it (below). A tool row is its
   title and one `↳` summary line (`+12 −4`, the counts in the theme's own
   success/error pair, `4 matches`, `31 lines`, `no output`), never output. A
   failed shell command shows its first two and last two lines with `… N more
   lines` between and the exit status last; other errors show in full. The
   `workspace_*` and MCP rows between two things that stay visible fold to
   one dim, dotless line at the text column ("Read 3 files, ran 9 shell
   commands, called 2 MCP tools"); that line is the group's handle in both
   states — it sits above the group and opens with `▸` closed, `▾` open, and a
   click on it opens or closes the group. ctrl+o drives every group to match
   it, so a group clicked open against the flag follows it again at the next
   press. Whatever stays visible closes the group:
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
   day's spacing complaint has two sources: every tool row draws its own
   leading blank line (pi's tool component), and pi's assistant component adds
   a spacer for any message whose raw content carried reasoning, transformer
   or not (earendil-works/pi#8154, open). *2026-09-08, night:* a shell row
   that ran outside the sandbox (Claude Code's
   `dangerouslyDisableSandbox`) carries `· unsandboxed` on its title, the
   background launch row included: under auto approvals the classifier may
   allow the escalation without a dialog, and the title is then its only
   visible record. *2026-09-08, night:* the reasoning spacer stacked — a
   folded run hid the rows but not the spacers between them, so the owner saw
   six blank lines under one fold summary. Fixed at the content, since no display hook reaches
   it: a `message_end` handler blanks the thinking text, and the component
   then renders neither the block nor its spacer. Only where the provider
   replays reasoning from the opaque item — pi's OpenAI Responses path sends
   `JSON.parse(block.thinkingSignature)` and never the text, and that item
   carries the provider's own summary, so the same model loses nothing and the
   session file keeps the summary inside the signature; the Anthropic path
   sends the text with its signature and rejects a modified block, hence the
   gate on the message's `api`. The one cost, found in review and accepted: pi's
   `transformMessages` keeps a signed block only where provider, api and model
   id all match, forwards the reasoning as plain text otherwise, and drops the
   block once that text is empty — so after a model change the new model no
   longer sees the earlier summaries. Only the model id can change under the
   managed roster, which fixes the provider and validates the id before every
   turn. Accepted because the opaque item does not survive that change either,
   and the owner holds that the human-language summary is not the load-bearing
   part. The
   transformer stays: it covers the live stream, which runs before the message
   settles. *2026-09-09:* an open group was indistinguishable from a closed
   one, and the `· ctrl+o to expand` hints rendered without their key — pi's
   `keyText` resolves through a module global that falls back to the pi-tui
   bindings, which do not define `app.tools.expand`. The hints went (the owner:
   "dont need the ctrl+o hint"), taking the broken lookup with them, and the
   caret carries the state instead. Chosen over a flipping label, a brightened
   handle alone and a background: both reference CLIs use only a flipping label
   and their users report exactly the confusion that predicts, NN/g's 2020
   accordion study measured the caret as the one signifier that beats no icon,
   and WCAG 1.4.1 plus rule 9 ruled out colour or background as the sole
   carrier. The handle also undims when open, a second cue that is not
   colour-alone. The same day ctrl+o was found one-way — the flag change only
   ever opened a group, so a second press left it open and only a click
   collapsed it. Residual: pi announces its own `Tool output: expanded` in the
   chat from `setToolsExpanded`, which pushes a Spacer and a Text straight onto
   its chat container; no documented surface reaches it (`extensions.md` offers
   `setStatus`, `notify`, `setWidget`, `setFooter`, `custom`, all elsewhere)
   and the container is not exposed to an extension at all, so not even an
   undocumented reach is available. The caret carries the state regardless;
   worth an upstream request for a settings switch.
3. **One place per fact.** Elapsed time rides the working spinner while the
   turn runs (`⠋ Interpolating… 1m 12s`) and the `π` turn line once it ends;
   the status line carries model · context · usage windows · branch, and the
   mode on the right, nothing transient. *Why:* the clock on the status line
   duplicated the spinner two rows above it. *2026-09-08:* the spinner moved
   from pi's standalone row into the composer's top shaded row (pi's
   documented `embedWorkingStatus`): the standalone row is pi's, one column
   in with a blank line above, and the owner saw both misalignments.
   *2026-09-08, night:* it moved back out to a line of its own directly above
   the composer, at column 0 under rule 8, because the owner wants the
   composer to hold what they type and nothing else. Neither of pi's own
   shapes fits — its standalone row and its string-array widget both take
   pi-tui `Loader`'s hardcoded one-column pad, and the row a blank line with
   it — so the extension subclasses `Loader`, drops that line, and hands it to
   the documented `setWidget` at `placement: "aboveEditor"`, the slot pi docks
   between the status container and the composer. pi's own row is switched off
   with the documented `setWorkingVisible(false)`, and the row stands down for
   pi's compaction indicator (`session_before_compact`/`session_compact`),
   which draws in that same status container. Residual: pi's auto-retry
   countdown draws there too and has no documented event, so a retry shows two
   spinners — an undocumented `auto_retry_start` subscription is the only
   reach, and rule 7 prices that above the cost. *2026-09-09:* the row takes a
   trailing blank line instead of `Loader`'s leading one, so it stands off the
   composer's shaded block rather than sitting flush against it; between turns
   the row is still nothing, so no gap opens where the spinner is not running.
   The expand state stays off the status line: every caret already follows
   pi's flag, and a copy there would state one fact twice.
4. **A turn ends when nothing is running.** The turn line prints at
   `agent_settled` only when no background child or task is live; with either
   running it waits for the follow-up run to settle (or the user to type) and
   then prints the total. An aborted run prints `π Interrupted after …` at
   once. Each async child that ends prints `• agent finished · task ·
   2m 14s` (the run's own `durationMs`, launch to end), or its status word
   (`failed`/`stopped` in the error colour, `paused`/`partial`/`detached` in
   the warning colour); a background task ends the same way, `• task t1
   finished · command · 12s`. *Why:* pi's `agent_settled` is honest about the
   root run, not about the work; printing "done" while a child still ran was
   the complaint. *2026-09-08:* the completion line returned because
   pi-subagents shows its own notice only for failures and the owner wants
   finished children visible in the chat, with how long they took.
   *2026-09-08, evening:* background shell tasks (Claude Code's
   `run_in_background`) joined children as running work: the launch row is
   `• Started cmd in background` with `↳ task t1 · running`, the end is the
   completion line above, and the in-progress bullet stays static — the
   owner kept the composer spinner as the one moving element.
   *2026-09-09:* pi-subagents' control notice takes the same line —
   `• researcher needs attention · is waiting for a supervisor reply`, the
   warning colour for attention and the error colour for a failed run — and
   the message's own content, which the model acts on, is untouched. *Why:*
   the plugin drew a twelve-line box in the chat holding a run UUID, a
   `Facts:` line and four literal `subagent({ action: … })` calls: the
   model's instructions, printed at the reader. Claude Code draws the same
   line, keeping steer and resume payloads in the model's context and giving
   the transcript a status. The row is composed over the plugin's renderer
   rather than replacing it, so a payload the row does not recognise is the
   plugin's box again.
5. **Composer = the user box, and the user box = the composer.** A shaded
   block in pi's `userMessageBg`: one blank shaded row above and below the
   content, `❯` at column 0 on the first content line, no rule lines, no
   placeholder; the status line follows the bottom row directly. *2026-09-08,
   night:* a sent message carries the same `❯` in the same column — the owner
   asked for it once the composer's own glyph settled, and pi's user box
   renders its content at `outputPad`, which is 0, so the two line up. It
   arrives through the markdown transformer, the only hook into that box, in
   the box's own colour: the box colours its content through one function, and
   an inner colour's reset would end it for the rest of the line. A message
   whose first line opens with a markdown block marker renders as a paragraph
   instead — the accepted cost of the only available hook. *Why:* the
   prompt glyph flipped `❯→›→❯` across three commits; the owner chose the
   full-size glyph on 2026-09-07 and Codex's shaded block the same day, then
   on 2026-09-08 sent Claude Code's composer (rules, no shade: "too much
   padding"), then the same afternoon settled it on consistency: "if we are
   going to do the background thing for user messages in the chat, the input
   should be the same". pi's user box hardcodes its blank row above and
   below, so the composer carries the same two; the standard is the user box,
   not either reference. *2026-09-08, later:* Tab completes what the command
   accepts — the command's own candidates in argument position, and the next
   level after an accept, so Tab walks a directory tree. *Why:* pi opened that
   menu only on a typed letter and answered Tab with file paths, so `/add-dir`
   offered directories its policy refuses and never opened at all for a path
   starting `~` or `/`. *2026-09-09:* Tab opens nothing on a line that does
   not start with `/`.
   The wrapper answers pi's `shouldTriggerFileCompletion` itself instead of
   delegating; pi's own says yes to everything but a half-typed slash command,
   which put a file menu under every Tab. Only the forced path consults that
   gate, so `@path` and the command-name menu, both unforced, are untouched.
   *2026-09-09, later:* Tab offers only what a command declares, and nothing
   where it declares none. The wrapper used to fall back to a raw path request
   for a command with no candidates, and pi appends a space when it accepts a
   command name, so the walk's replay read `/new ` as an argument position and
   put a file menu under every command-name accept — the owner's "every command
   i mid-type and press tab the autosuggestions pop out". Typing `/new ` and
   pressing Tab reached it without any accept, which is why the fallback went
   rather than the replay. This also retired the residual the fallback carried:
   a line opening with an absolute path and a space (`/tmp/x `) parses as a
   command argument, and now offers nothing rather than paths. Chosen over an
   allowlist of the commands that may complete: pi's own `/model`, `/thinking`
   and `/login` declare candidates and get them for free, where a list of
   command names would take them away and rot besides.
   *2026-09-09, later still:* the menu also opens on the characters a path is
   typed with — the command's own space, `/` and `~` — which is the
   typed-character counterpart to the Tab walk above, and `..` is offered as a
   candidate so the walk goes up as well as down. Both are the first line's
   only, as pi runs a slash command from there and nowhere else. *Why:* pi opens the menu
   while typing on `[A-Za-z0-9.\-_]` only, so a path left it closed at exactly
   the separator that had just named a new directory to list; and `readdirSync`
   never returns `..`, so `/add-dir ../` could only descend. `rootRejection`
   already polices the new candidate: from `~/`, `..` is home's ancestor and
   drops out with no case for it. Tab on a command name with no argument yet
   was pi's own unforced slash menu all along, ahead of the forced branch the
   wrapper gates — nothing was needed for it.
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
   `π`, `❯`, `▸`/`▾`) starts at column 0; a line without one (`↳`, the status
   line, the fleet rows) starts two columns in. pi's `outputPad`
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
   *2026-09-09:* the fold handle stopped being dotless — its caret takes the
   dot column so the handle lines up with the `•` rows it owns and reads as
   their header, which is the rule rather than an exception to it.
9. **Background = the user's sent messages and the composer.** pi's user
   box keeps its background and the composer takes the same one (rule 5);
   nothing else the extension draws has one: no tool card (every plugin
   registration takes the row renderer), no coloured summary. pi's rare
   compaction and branch notices are pi's. *Why (2026-09-08):* `bg_wait`'s
   green card was a third background and read as a different program; the
   composer's shade came back the same afternoon because the owner wants the
   place they type to look like what they typed.
10. **A pinned plugin earns a tool row, not a panel.** `web_search`
   (pi-web-search) is a plain row, `• Searched "query"` with the answer's
   first line under it, and the `π` voice also records workspace changes
   (`π Added … to the workspace`). The one panel above the composer is the
   working row (rule 3). *Why (2026-09-08, evening):* `@juicesharp/rpiv-todo`
   drew Claude Code's task list there and its `todo` tool took the row shape;
   restyling its panel would have meant a fork, so a second `○` meaning
   (pending there, a child in the fleet) was judged the cheaper cost.
   *2026-09-08, night:* it was removed. The panel existed to mirror Claude
   Code, and both references dropped the surface within a fortnight — Claude
   Code v2.1.233 (2026-08-14) disabled `TodoWrite` by default on its newest
   models, Codex CLI v0.152.0 (PR #41744, 2026-08-31) made `update_plan`
   opt-in for all of them — and the owner had stopped seeing it used in
   either. Weighed against it and overruled: 2026 SWE-bench work finds an
   explicit plan raises resolution rates. `○` now means one thing again.
