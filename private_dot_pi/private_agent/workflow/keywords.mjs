// Prompt keywords: `ultracode` turns the session's orchestrate opt-in on,
// `ultrathink` raises the root's thinking level for it.
const WORDS = ["ultracode", "ultrathink"];

// pi-tui draws the cursor as zero-width APC sequences (CURSOR_MARKER,
// FAKE_CURSOR_*), so a word the cursor sits in still matches.
const APC = "(?:\\x1b_[^\\x07]*\\x07)*";
const spelled = word => [...word].join(APC);
// URL, path and email neighbours (x.io/ultracode, ultracode.dev, ?q=ultracode,
// ultracode@x.com) are not words: accent ANSI inside an OSC 8 link destination
// breaks the link.
const keywords = (words, flags) => new RegExp(`(?<![\\w/.:@?=#&-]${APC})(?:${words.map(spelled).join("|")})(?!${APC}(?:[\\w/@-]|[.:]${APC}\\w))`, flags);
const KEYWORDS = keywords(WORDS, "gi");

// Skipped as not prose: a fenced block (to the end when unterminated), an
// indented code block, a backtick code span within a paragraph, a reference
// definition line, an inline or reference link, an autolink. cli-highlight
// would split the accent's CSI in code, and pi-tui's Markdown would carry it
// into link text and destinations.
const SKIP = /^ {0,3}(`{3,}(?![^\n]*`)|~{3,})[\s\S]*?(?:\n {0,3}\1[`~]*[ \t]*$|(?![\s\S]))|(?:(?<=^[ \t]*\n)|(?<![\s\S]))(?: {4}|\t).*(?:\n(?: {4}|\t).*)*|(`+)(?!`)(?:(?!\n[ \t]*\n)[\s\S])*?[^`]\2(?!`)|^ {0,3}\[[^\]\n]+\]:.*$|\[[^\]\n]*\](?:\([^)\n]*\)|\[[^\]\n]*\])|<[^\s<>]+>/gm;

// Each prose run paired with the skipped text that follows it.
function* segments(text) {
  let at = 0;
  for (const skip of text.matchAll(SKIP)) {
    yield [text.slice(at, skip.index), skip[0]];
    at = skip.index + skip[0].length;
  }
  yield [text.slice(at), ""];
}

// The triggers follow the sent box's accent: a keyword counts only where it
// would be highlighted.
export const [saysUltracode, saysUltrathink] = WORDS.map(word => {
  const pattern = keywords([word], "i");
  return text => [...segments(text)].some(([prose]) => pattern.test(prose));
});

// `restore` re-opens that foreground after accent's \x1b[39m reset; `words`
// narrows the accent to those keywords.
export function highlightKeywords(palette, text, restore, words) {
  if (words && !words.length) return text;
  const reopen = restore ? palette.fg(restore, "").replace(/\x1b\[39m$/, "") : "";
  return text.replace(words ? keywords(words, "gi") : KEYWORDS, word => palette.fg("accent", word) + reopen);
}

// Markdown source: keywords in prose only. Without a palette, text is unchanged.
export function highlightProse(palette, text, restore, words) {
  if (!palette) return text;
  let out = "";
  for (const [prose, skipped] of segments(text)) out += highlightKeywords(palette, prose, restore, words) + skipped;
  return out;
}

// Scoped per delivered message: a later message without the word, the prompt
// settling or the session shutting down puts the previous level back unless
// the user changed it meanwhile.
export function createUltrathink(pi) {
  let previous;
  let raised;
  const end = () => {
    if (raised === undefined) return;
    if (pi.getThinkingLevel() === raised) pi.setThinkingLevel(previous);
    raised = undefined;
  };
  return {
    delivered: text => {
      if (!saysUltrathink(text)) return end();
      if (raised !== undefined) return;
      previous = pi.getThinkingLevel();
      // pi clamps to the model's highest supported level.
      pi.setThinkingLevel("max");
      raised = pi.getThinkingLevel();
    },
    end,
  };
}
