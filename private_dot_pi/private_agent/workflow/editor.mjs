import * as sdk from "@earendil-works/pi-coding-agent";
import { matchesKey, sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import { highlightProse, saysUltracode, saysUltrathink } from "./keywords.mjs";
import { parseShellInput } from "./shell.mjs";
import { PAD, PROMPT, padRow, shade } from "./rows.mjs";

// The prompt glyph and its trailing space take the editor's padding columns.
const PROMPT_PADDING = PAD.length;
const PASTE_MARKERS = /\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]/g;

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
  constructor(tui, theme, keybindings, { fleet, palette, shell, pending, notify, copyToClipboard = sdk.copyToClipboard } = {}) {
    super(tui, theme, keybindings, { paddingX: PROMPT_PADDING, embedWorkingStatus: false });
    this.fleet = fleet;
    this.palette = palette;
    this.shell = shell;
    this.pending = pending;
    this.notify = notify;
    this.copyToClipboard = copyToClipboard;
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
  commandStart() {
    const prefix = this.shellPrefix();
    return prefix + (prefix && this.state.lines[0][prefix] === " " ? 1 : 0);
  }
  leadingPaste() {
    const match = this.state.lines[0].match(/^\[paste #(\d+) [^\]]+\]/);
    if (!match) return;
    const id = Number(match[1]), text = this.pastes.get(id);
    if (text !== undefined) return { id, text };
  }
  shellMode() {
    return this.shellPrefix() > 0 || this.leadingPaste()?.text.startsWith("!") === true;
  }
  // Keep native text, history, paste expansion and dispatch untouched. Layout
  // and visual navigation see only the command; their columns map back below.
  commandView(draw) {
    const prefix = this.commandStart();
    if (!prefix) return draw();
    const state = this.state;
    this.state = { ...state, lines: [state.lines[0].slice(prefix), ...state.lines.slice(1)], cursorCol: state.cursorLine === 0 ? Math.max(0, state.cursorCol - prefix) : state.cursorCol };
    try { return draw(); } finally { this.state = state; }
  }
  layoutText(width) {
    return this.commandView(() => super.layoutText(width));
  }
  buildVisualLineMap(width) {
    const prefix = this.commandStart();
    return this.commandView(() => super.buildVisualLineMap(width)).map(line => line.logicalLine === 0 ? { ...line, startCol: line.startCol + prefix } : line);
  }
  setCursorCol(col) {
    super.setCursorCol(Math.max(this.state.cursorLine === 0 ? this.commandStart() : 0, col));
  }
  handleBackspace() {
    if (this.deleteSelection()) return;
    const prefix = this.commandStart();
    const paste = !prefix ? this.leadingPaste() : undefined;
    const hiddenPrefix = paste?.text.match(/^!{1,2} ?/)?.[0];
    if ((!prefix && !hiddenPrefix) || this.state.cursorLine !== 0 || this.state.cursorCol !== prefix) {
      const marker = this.state.lines[this.state.cursorLine].slice(0, this.state.cursorCol).match(/\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]$/);
      const removed = marker?.[1];
      // Native Backspace renumbers even unregistered literal markers. Range
      // deletion keeps their text and the surviving registry ids unchanged.
      if (removed && this.pastes.has(Number(removed)) &&
        [...this.getText().matchAll(PASTE_MARKERS)].some(match => !this.pastes.has(Number(match[1])))) {
        const focus = this.getCursor();
        this.selection = { anchor: { line: focus.line, col: marker.index }, focus, text: this.getText() };
        this.deleteSelection();
        return;
      }
      const counter = this.pasteCounter;
      super.handleBackspace();
      if (removed && this.pasteCounter < counter && this.state.pasteSeparators) {
        const id = Number(removed);
        this.state.pasteSeparators = new Set([...this.state.pasteSeparators].filter(key => key !== id).map(key => key > id ? key - 1 : key));
      }
      return;
    }
    this.exitHistoryBrowsing();
    this.lastAction = null;
    this.pushUndoSnapshot();
    if (hiddenPrefix) this.pastes.set(paste.id, paste.text.slice(hiddenPrefix.length));
    else this.state.lines[0] = this.state.lines[0].slice(prefix);
    this.setCursorCol(0);
    this.onChange?.(this.getText());
  }
  // Only the range mutation and completed-paste insertion need native private
  // state; mouse hit-testing, normalization, collapse and undo stay native.
  selectionRange() {
    const selection = this.selection;
    if (!selection || selection.text !== this.getText()) return undefined;
    return [selection.anchor, selection.focus].sort((a, b) => a.line - b.line || a.col - b.col);
  }
  selectionText() {
    const range = this.selectionRange();
    if (!range) return "";
    const [start, end] = range;
    const lines = this.getLines().slice(start.line, end.line + 1);
    lines[lines.length - 1] = lines.at(-1).slice(0, end.col);
    lines[0] = lines[0].slice(start.col);
    return this.expandPasteMarkers(lines.join("\n"));
  }
  deleteSelection() {
    const range = this.selectionRange();
    this.selection = undefined;
    if (!range) return false;
    const [start, end] = range;
    if (start.line === end.line && start.col === end.col) return false;
    this.cancelAutocomplete();
    this.exitHistoryBrowsing();
    this.lastAction = null;
    this.pushUndoSnapshot();
    const before = new Set([...this.getText().matchAll(PASTE_MARKERS)].map(match => Number(match[1])).filter(id => this.pastes.has(id)));
    this.state.lines.splice(start.line, end.line - start.line + 1,
      this.state.lines[start.line].slice(0, start.col) + this.state.lines[end.line].slice(end.col));
    const remaining = new Set([...this.getText().matchAll(PASTE_MARKERS)].map(match => Number(match[1])));
    for (const id of before) {
      if (remaining.has(id)) continue;
      this.pastes.delete(id);
      this.state.pasteSeparators?.delete(id);
    }
    this.state.cursorLine = start.line;
    this.setCursorCol(start.col);
    this.onChange?.(this.getText());
    return true;
  }
  handleForwardDelete() {
    if (!this.deleteSelection()) super.handleForwardDelete();
  }
  setText(text) {
    this.selection = undefined;
    super.setText(text);
    delete this.state.pasteSeparators;
  }
  handleMouse(event) {
    const content = event.y > 0 && event.y <= this.renderedVisibleLineCount;
    if ((event.button === "left" && event.type === "press" && content) ||
      (this.dragging && ["drag", "release"].includes(event.type))) {
      // A native click maps terminal cells to grapheme/marker-safe logical columns.
      super.handleMouse({ ...event, type: "click", button: "left", y: Math.max(1, Math.min(this.renderedVisibleLineCount, event.y)) });
      const cursor = this.getCursor();
      // Native layout may split a wide paste marker across visual rows. The
      // logical range must still treat that registry-backed segment atomically.
      for (const segment of this.segment(this.state.lines[cursor.line], "grapheme")) {
        const end = segment.index + segment.segment.length;
        if (cursor.col > segment.index && cursor.col < end) {
          cursor.col = cursor.col - segment.index < end - cursor.col ? segment.index : end;
          this.setCursorCol(cursor.col);
          break;
        }
      }
      if (event.type === "press") {
        this.selection = { anchor: cursor, focus: cursor, text: this.getText() };
        this.dragging = true;
      } else if (this.selectionRange()) {
        this.selection.focus = cursor;
      }
      if (event.type === "release") {
        this.dragging = false;
        if (this.tui.getCopyOnSelect?.()) {
          const text = this.selectionText();
          if (text) this.copySelection(text);
        }
      }
      return { handled: true, capture: event.type === "press", focus: true, render: true };
    }
    if (event.type === "click") this.selection = undefined;
    return super.handleMouse(event);
  }
  async copySelection(text) {
    try { await this.copyToClipboard(text); }
    catch (error) { this.notify?.(`Copy failed: ${error.message}`, "error"); }
  }
  pushUndoSnapshot() {
    // Native undo merges state, so every snapshot must explicitly carry even
    // empty provenance rather than leave a later paste's separator ids behind.
    this.state.pasteSeparators ??= new Set();
    super.pushUndoSnapshot();
    if (this.completingPaste) {
      // Reserve literal ids, including those still inside collapsed payloads,
      // after the native undo snapshot but before handlePaste allocates an id.
      const reserved = new Set();
      for (const value of [this.getText(), ...this.pastes.values()]) {
        for (const match of value.matchAll(PASTE_MARKERS)) reserved.add(Number(match[1]));
      }
      while (reserved.has(this.pasteCounter + 1)) this.pasteCounter++;
      this.completingPaste.counter = this.pasteCounter;
    }
  }
  handlePaste(text) {
    this.selection = undefined;
    const { cursorLine: line, cursorCol: col } = this.state;
    this.completingPaste = { counter: this.pasteCounter, wordBefore: /\w/.test(this.state.lines[line][col - 1] ?? "") };
    try { super.handlePaste(text); } finally { this.completingPaste = undefined; }
  }
  normalizeText(text) {
    const normalized = super.normalizeText(text);
    // Observe native decoding/normalization before its control filter and path
    // separator; only the separator's provenance is ours, not a second normalizer.
    if (this.completingPaste && this.completingPaste.separator === undefined) {
      const firstRetained = normalized.match(/[^\x00-\x09\x0b-\x1f]/)?.[0] ?? "";
      this.completingPaste.separator = this.completingPaste.wordBefore && /^[/~.]/.test(firstRetained);
    }
    return normalized;
  }
  insertTextAtCursorInternal(text) {
    this.selection = undefined;
    const completing = this.completingPaste;
    const id = completing && this.pasteCounter > completing.counter && Number(text.match(/^\[paste #(\d+) [^\]]+\]$/)?.[1]);
    if (completing) {
      const payload = id ? this.pastes.get(id) : text;
      const clipboard = completing.separator ? payload.slice(1) : payload;
      const { cursorLine: line, cursorCol: col } = this.state;
      const previous = this.state.lines[line].slice(0, col).match(/\[paste #(\d+) [^\]]+\]$/);
      if (previous) {
        const previousId = Number(previous[1]);
        const stored = this.pastes.get(previousId);
        const previousClipboard = this.state.pasteSeparators?.has(previousId) ? stored?.slice(1) : stored;
        if (stored !== undefined && previousClipboard === clipboard) {
          this.state.lines[line] = this.state.lines[line].slice(0, previous.index) + this.state.lines[line].slice(col);
          this.state.cursorCol = previous.index;
          if (id) this.pastes.delete(id);
          const remaining = new RegExp(`\\[paste #${previousId}( (\\+\\d+ lines|\\d+ chars))?\\]`);
          if (!remaining.test(this.getText())) {
            this.pastes.delete(previousId);
            this.state.pasteSeparators?.delete(previousId);
          }
          const literalIds = new Set([...stored.matchAll(PASTE_MARKERS)].map(match => Number(match[1])));
          const conflicts = [...literalIds].filter(key => this.pastes.has(key));
          if (conflicts.length) {
            // Move live references, not literal payload text. Keep registry order:
            // native expansion visits each entry once, including inserted text.
            const reserved = new Set(this.pastes.keys());
            for (const value of [this.getText(), stored, ...this.pastes.values()]) {
              for (const match of value.matchAll(PASTE_MARKERS)) reserved.add(Number(match[1]));
            }
            const rekeys = new Map();
            for (const key of conflicts) {
              do { this.pasteCounter++; } while (reserved.has(this.pasteCounter));
              rekeys.set(key, this.pasteCounter);
            }
            this.pastes = new Map([...this.pastes].map(([key, value]) => [rekeys.get(key) ?? key, value]));
            this.state.pasteSeparators = new Set([...this.state.pasteSeparators].map(key => rekeys.get(key) ?? key));
            const cursorCol = this.state.cursorCol;
            this.state.lines = this.state.lines.map((value, lineIndex) => value.replace(PASTE_MARKERS, (match, key, suffix, _size, offset) => {
              const next = rekeys.get(Number(key));
              if (next === undefined) return match;
              const replacement = `[paste #${next}${suffix ?? ""}]`;
              if (lineIndex === line && offset < cursorCol) this.state.cursorCol += replacement.length - match.length;
              return replacement;
            }));
          }
          super.insertTextAtCursorInternal(stored);
          return;
        }
      }
      // Native snapshots clone state along with the registry, so provenance
      // follows undo without changing native stored payloads or thresholds.
      if (id && completing.separator) (this.state.pasteSeparators ??= new Set()).add(id);
    }
    super.insertTextAtCursorInternal(text);
  }
  // Fleet navigation is an editor-owned mode (widgets cannot take focus). Down
  // enters it only when the editor itself had nothing left to do with the key,
  // so wrapped lines, line-end moves, history and autocomplete keep priority.
  handleInput(data) {
    if (this.keybindings.matches(data, "app.message.copy")) {
      const text = this.selectionText();
      if (text) { this.copySelection(text); return; }
    }
    if (!["backspace", "shift+backspace", "delete", "shift+delete"].some(key => matchesKey(data, key)) &&
      !["tui.editor.deleteCharBackward", "tui.editor.deleteCharForward"].some(key => this.keybindings.matches(data, key))) this.selection = undefined;
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
    if (this.shellMode() && this.keybindings.matches(data, "tui.editor.cursorUp") && !this.isShowingAutocomplete() && this.state.cursorLine === 0 && this.state.cursorCol === this.commandStart()) {
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
    // A keyword takes the accent only when the draft as sent would trigger it.
    const text = this.getText();
    const words = [saysUltracode(text) && "ultracode", saysUltrathink(text) && "ultrathink"].filter(Boolean);
    for (let i = 1; i < end; i++) {
      const prompt = i === 1 && lines[i].startsWith(" ".repeat(PROMPT_PADDING));
      const content = prompt ? lines[i].slice(PROMPT_PADDING) : lines[i];
      // Each layout line keeps the editor's padding, which would read as indented code.
      const indent = content.length - content.trimStart().length;
      lines[i] = this.shade((prompt ? this.palette.fg(shell ? "error" : "accent", `${shell ? "!" : PROMPT} `) : "") + (shell ? this.palette.fg("userMessageText", content) : content.slice(0, indent) + highlightProse(this.palette, content.slice(indent), undefined, words)));
    }
    const range = this.selectionRange();
    if (range) {
      const [start, finish] = range;
      const map = this.buildVisualLineMap(this.lastWidth);
      const padding = Math.min(this.paddingX, Math.max(0, Math.floor((width - 1) / 2)));
      for (let row = 1; row < end; row++) {
        const visual = map[this.scrollOffset + row - 1];
        if (!visual || visual.logicalLine < start.line || visual.logicalLine > finish.line) continue;
        const text = this.state.lines[visual.logicalLine];
        const from = Math.max(visual.startCol, visual.logicalLine === start.line ? start.col : 0);
        const to = Math.min(visual.startCol + visual.length, visual.logicalLine === finish.line ? finish.col : text.length);
        const newline = visual.logicalLine < finish.line && visual.startCol + visual.length === text.length;
        if (to <= from && !newline) continue;
        const left = padding + visibleWidth(text.slice(visual.startCol, from));
        const size = Math.min(width - left, visibleWidth(text.slice(from, to)) + (newline ? 1 : 0));
        // Native fake-cursor resolution runs later and would reset inverse
        // inside the range. Keep the IME marker, but let selection own its highlight.
        const selected = sliceByColumn(lines[row], left, size).replaceAll("\x1b_pi:fc\x07", "").replaceAll("\x1b_pi:/fc\x07", "");
        lines[row] = sliceByColumn(lines[row], 0, left) + this.palette.inverse(selected) + sliceByColumn(lines[row], left + size, width);
      }
    }
    return lines;
  }
}
