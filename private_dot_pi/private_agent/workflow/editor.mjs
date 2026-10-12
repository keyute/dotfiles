import * as sdk from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import { parseShellInput } from "./shell.mjs";
import { PAD, PROMPT, padRow, shade } from "./rows.mjs";

// The prompt glyph and its trailing space take the editor's padding columns.
const PROMPT_PADDING = PAD.length;

// pi routes Tab inside a command's arguments to forced file completion, and its
// built-in provider guards the whole slash branch on `!options.force`, so the
// command's own getArgumentCompletions never runs and Tab offers raw paths. The
// forced request asked again unforced is the command's candidates.
const WRAPPED = Symbol.for("pi-workflow:argument-completions");
// The path separators pi does not treat as typing.
const SEPARATORS = [" ", "/", "~"];
// Whether the cursor sits in a command's arguments, and which command's.
// pi runs a slash command from the first line only (`isSlashMenuAllowed`), so a
// later line opening with one is prose.
const commandArgument = (lines, cursorLine, cursorCol) => cursorLine === 0 && (lines[0] ?? "").slice(0, cursorCol).match(/^\/(\S+) /)?.[1];
export function argumentCompletions(current) {
  // pi keeps stacked providers across /reload, where session_start runs again
  // without the invalidation that clears them.
  if (current[WRAPPED]) return current;
  return {
    [WRAPPED]: true,
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const name = options.force && commandArgument(lines, cursorLine, cursorCol);
      if (!name) return current.getSuggestions(lines, cursorLine, cursorCol, options);
      // Unforced answers with the command's own candidates, and with null where
      // it declares none. That null is the answer: Tab offers what a command
      // accepts, never a file path it never asked for.
      return current.getSuggestions(lines, cursorLine, cursorCol, { ...options, force: false });
    },
    applyCompletion: (...args) => current.applyCompletion(...args),
    // Tab forces completion, and this gate is the only thing consulted on that
    // path, so answering it narrows Tab to a command's arguments. pi's own
    // provider says yes to everything but a half-typed slash command, which put
    // a file menu under Tab in ordinary prose; `@path` and the command-name
    // menu are unaffected, both being unforced.
    shouldTriggerFileCompletion: (lines, cursorLine, cursorCol) => Boolean(commandArgument(lines, cursorLine, cursorCol)),
  };
}

// The composer takes the user box's shape (docs/pi-design.md rule 5): pi's rule
// lines become blank shaded rows, the content rows between them are shaded,
// and "❯ " sits in the padding columns of the first content line. The working
// spinner is not embedded here: it is the footer's own row above the composer,
// since pi's embedded status renders inside this top row and its standalone one
// is a column in under a blank line. Rendered lines carry their cursor marker
// inline, so replacing the padding shifts the cursor correctly; if the render
// shape ever changes, the prompt silently disappears instead of corrupting the
// editor.
export class CaretEditor extends sdk.CustomEditor {
  // The editor factory is handed an EditorTheme (borders and autocomplete only),
  // so the palette for the shade and the caret arrives separately.
  constructor(tui, theme, keybindings, { fleet, palette, shell, pending } = {}) {
    super(tui, theme, keybindings, { paddingX: PROMPT_PADDING, embedWorkingStatus: false });
    this.fleet = fleet;
    this.palette = palette;
    this.shell = shell;
    this.pending = pending;
    // pi-tui's Editor declares `onSubmit` as a bare class field, which
    // installs an own data property on this instance during super() and
    // would shadow the accessor pair below forever; dropping it here lets
    // property access reach the prototype's getter/setter instead.
    delete this.onSubmit;
  }
  // pi assigns its own submit callback onto this editor once, right after
  // construction (`newEditor.onSubmit = this.defaultEditor.onSubmit`); the
  // setter only ever stores it. The getter is read fresh on every submit
  // (Editor.submitValue does `this.onSubmit(result)`), so a configured shell
  // gets first refusal: unhandled input (not `!…`, or `!` alone) forwards to
  // pi's own callback unchanged.
  set onSubmit(fn) {
    this.hostSubmit = fn;
  }
  get onSubmit() {
    if (!this.shell) return this.hostSubmit;
    return text => {
      const result = this.shell.submit(text);
      if (result === false) { this.hostSubmit?.(text); return; }
      // submitValue() already cleared the editor before calling onSubmit; a
      // busy runner restores the text instead of losing it.
      if (result === "busy") this.setText(text);
      else this.addToHistory(text);
    };
  }
  // The palette is pi's live theme (a theme switch invalidates this editor
  // rather than rebuilding it), so the sequence is read per render, never cached.
  shade(line) {
    return this.shellMode() ? shade(this.palette, line, "toolErrorBg", "userMessageText") : shade(this.palette, line);
  }
  shellPrefix() {
    return this.state.lines[0].match(/^!{1,2}/)?.[0].length ?? 0;
  }
  shellMode() {
    return this.shellPrefix() > 0;
  }
  // Keep native text, history, paste expansion and dispatch untouched. Layout
  // and visual navigation see only the command; their columns map back below.
  commandView(draw) {
    const prefix = this.shellPrefix();
    if (!prefix) return draw();
    const state = this.state;
    this.state = { ...state, lines: [state.lines[0].slice(prefix), ...state.lines.slice(1)], cursorCol: state.cursorLine === 0 ? Math.max(0, state.cursorCol - prefix) : state.cursorCol };
    try { return draw(); } finally { this.state = state; }
  }
  layoutText(width) {
    return this.commandView(() => super.layoutText(width));
  }
  buildVisualLineMap(width) {
    const prefix = this.shellPrefix();
    return this.commandView(() => super.buildVisualLineMap(width)).map(line => line.logicalLine === 0 ? { ...line, startCol: line.startCol + prefix } : line);
  }
  setCursorCol(col) {
    super.setCursorCol(Math.max(this.state.cursorLine === 0 ? this.shellPrefix() : 0, col));
  }
  handleBackspace() {
    const prefix = this.shellPrefix();
    if (!prefix || this.state.cursorLine !== 0 || this.state.cursorCol !== prefix) return super.handleBackspace();
    this.exitHistoryBrowsing();
    this.lastAction = null;
    this.pushUndoSnapshot();
    this.state.lines[0] = this.state.lines[0].slice(prefix);
    this.setCursorCol(0);
    this.onChange?.(this.getText());
  }
  // Fleet navigation is an editor-owned mode (widgets cannot take focus). Down
  // enters it only when the editor itself had nothing left to do with the key,
  // so wrapped lines, line-end moves, history and autocomplete keep priority.
  handleInput(data) {
    if (this.pending && matchesKey(data, "ctrl+enter") && !this.fleet?.focused() && !this.shellMode()) {
      this.cancelAutocomplete();
      void this.pending.sendNow(this);
      return;
    }
    // Native Alt+Enter queues raw editor text as a follow-up. Shell input
    // instead takes Enter's expanded-paste submit path before that action.
    if (this.shell && !this.fleet?.focused() && this.keybindings.matches(data, "app.message.followUp") && parseShellInput(this.getExpandedText().trim())) {
      this.submitValue();
      return;
    }
    const fleet = this.fleet;
    if (fleet?.focused()) {
      const action = ["down", "up", "confirm", "cancel"].find(name => this.keybindings.matches(data, `tui.select.${name}`)) ?? "other";
      if (fleet.handleKey(action)) return;
    } else if (fleet && this.keybindings.matches(data, "tui.editor.cursorDown") && !this.isShowingAutocomplete()) {
      const before = JSON.stringify([this.getCursor(), this.getLines()]);
      super.handleInput(data);
      if (JSON.stringify([this.getCursor(), this.getLines()]) === before) fleet.handleKey("enter");
      return;
    }
    // pi's own Esc (app.interrupt) aborts a streaming agent first, as its own
    // onEscape does; only once the agent is idle does a live `!` take this
    // key instead. Ctrl+C also carries `tui.select.cancel` and must keep pi's
    // meaning, so this checks the plain Escape binding, not that one.
    if (this.keybindings.matches(data, "app.interrupt") && !this.isShowingAutocomplete() && !fleet?.focused() && this.shell?.abortable()) {
      this.shell.abort();
      return;
    }
    // Native history uses logical column zero; shell mode starts after its
    // hidden prefix instead.
    if (this.shellMode() && this.keybindings.matches(data, "tui.editor.cursorUp") && !this.isShowingAutocomplete() && this.state.cursorLine === 0 && this.state.cursorCol === this.shellPrefix()) {
      this.navigateHistory(-1);
      return;
    }
    // Accepting an item with Tab closes the menu and nothing re-opens it, so the
    // command's arguments show nothing until a character is typed (and `~` and
    // `/`, where an added directory starts, are not pi's natural triggers). An
    // accept that changes the text and leaves the cursor on the command's space
    // or on a directory separator has a next level to show, so that level is
    // asked for — as the request a typed character makes, not as another Tab:
    // pi applies a lone candidate outright on an explicit Tab, so a level
    // holding one entry would be walked into as well, descending twice on the
    // one keypress.
    if (this.keybindings.matches(data, "tui.input.tab") && this.isShowingAutocomplete()) {
      const before = this.getText();
      super.handleInput(data);
      if (this.isShowingAutocomplete() || this.getText() === before) return;
      const { line, col } = this.getCursor();
      const lines = this.getLines();
      if (/[ /]$/.test((lines[line] ?? "").slice(0, col)) && commandArgument(lines, line, col)) this.tryTriggerAutocomplete();
      return;
    }
    const at = this.getCursor();
    const was = (this.getLines()[at.line] ?? "").length;
    super.handleInput(data);
    // pi opens the argument menu while typing on [A-Za-z0-9.\-_] only, so the
    // characters a path is typed with — the command's space, `/` and `~` — left
    // it closed. The same unforced request a letter makes is made for them,
    // through the gate the completion wrapper uses so the two cannot drift. The
    // character pi inserted is read back instead of matching `data`: a terminal
    // negotiating kitty or modifyOtherKeys sends a printable as an escape
    // sequence, and pi decodes it. The line has to have grown by that one
    // character too: moving the cursor right across a `/` advances it just the
    // same, and history recall replaces the whole line. An open menu has
    // already re-asked itself for the character; asking again would cancel that
    // request and start it over.
    const { line, col } = this.getCursor();
    if (line !== at.line || col !== at.col + 1 || this.isShowingAutocomplete()) return;
    const lines = this.getLines();
    const text = lines[line] ?? "";
    if (text.length !== was + 1) return;
    if (SEPARATORS.includes(text[col - 1]) && commandArgument(lines, line, col)) this.tryTriggerAutocomplete();
  }
  // The host copies the settings editorPaddingX (default 0) onto custom
  // editors right after construction and on settings reloads; the caret
  // needs its padding columns.
  setPaddingX(padding) {
    super.setPaddingX(Math.max(PROMPT_PADDING, padding));
  }
  // The rule lines become shaded rows (a scroll count when clipped, blank
  // otherwise), so the block keeps its line count and pi's mouse and
  // autocomplete row offsets stay valid.
  renderTopBorder(width, hidden) {
    return this.shade(padRow(hidden ? `${PAD}↑ ${hidden} more` : "", width));
  }
  renderBottomBorder(width, hidden) {
    this.bottomRow = this.shade(padRow(hidden ? `${PAD}↓ ${hidden} more` : "", width));
    return this.bottomRow;
  }
  render(width) {
    const lines = super.render(width);
    // Content sits between the two shaded rows; autocomplete follows the
    // bottom one and stays unshaded.
    const end = lines.lastIndexOf(this.bottomRow);
    const shell = this.shellMode();
    for (let i = 1; i < end; i++) {
      const prompt = i === 1 && lines[i].startsWith(" ".repeat(PROMPT_PADDING));
      const content = prompt ? lines[i].slice(PROMPT_PADDING) : lines[i];
      lines[i] = this.shade((prompt ? this.palette.fg(shell ? "error" : "accent", `${shell ? "!" : PROMPT} `) : "") + (shell ? this.palette.fg("userMessageText", content) : content));
    }
    return lines;
  }
}
