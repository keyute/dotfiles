import { Marked } from "@earendil-works/pi-tui";

const markdownParser = new Marked();

// Only command-shaped starts are markers, never punctuation embedded in prose.
const command = /^([ \t]*)!(?![!=])(?= ?[a-zA-Z0-9_./~][^\n]*$)/;
const shellLanguage = lang => !lang || /^(?:sh|bash|zsh|shell|console)$/i.test(lang);
const sgr = /\x1b\[[0-9;]*m/g;

function paintMarker(styled, palette) {
  const plain = styled.replace(sgr, "");
  const match = plain.match(command);
  if (!match) return styled;
  let visible = 0;
  let restore = "";
  const target = match[1].length;
  return styled.replace(/\x1b\[[0-9;]*m|[^]/g, token => {
    if (token.startsWith("\x1b[")) { restore += token; return token; }
    return visible++ === target ? palette.fg("error", token) + restore : token;
  });
}

// Fences keep their native syntax highlighting. Decorate its result, rather
// than feeding ANSI into a syntax lexer that may colour the marker again.
export function commandMarkdownTheme(theme, palette) {
  if (!palette) return theme;
  return {
    ...theme,
    code: text => paintMarker(theme.code(text), palette),
    highlightCode: (code, lang) => {
      const lines = theme.highlightCode ? theme.highlightCode(code, lang) : code.split("\n").map(line => theme.codeBlock(line));
      return shellLanguage(lang) ? lines.map(line => paintMarker(line, palette)) : lines;
    },
  };
}

// The public Markdown transform owns standalone lines; inline code and fences
// are styled by the theme decorator after native code styling.
export function commandMarkdown(markdown, palette) {
  if (!palette || !/^ {0,3}!/m.test(markdown)) return markdown;
  markdown = markdown.replace(/\r\n?/g, "\n");
  let blockOffset = 0;
  const htmlBlocks = [];
  // Native block boundaries prevent an unmatched opener from claiming a later
  // command. Keep gaps such as reference definitions in the original source.
  const blockEnds = markdownParser.lexer(markdown).map(token => {
    const start = markdown.indexOf(token.raw, blockOffset);
    blockOffset = start + token.raw.length;
    if (token.type === "html") htmlBlocks.push({ start, end: blockOffset });
    return blockOffset;
  });
  let fence;
  let offset = 0, inlineEnd = 0, fenceEnd = 0;
  return markdown.split("\n").map(line => {
    const start = offset;
    offset += line.length + 1;
    if (htmlBlocks.some(block => start >= block.start && start < block.end)) return line;
    const insideInline = start < inlineEnd;
    const marker = !insideInline && line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && /^[ \t]*$/.test(line.slice(marker[0].length))) {
        fence = undefined;
        fenceEnd = offset;
      }
      return line;
    }
    if (fence) return line;
    if (!insideInline && /^ {0,3}!/.test(line) && command.test(line)) {
      const blockIndex = blockEnds.findIndex(limit => limit > start);
      // The fence scanner can close whitespace-padded fences before the native token ends.
      const block = markdown.slice(Math.max(blockEnds[blockIndex - 1] || 0, fenceEnd), blockEnds[blockIndex]);
      // An unmatched backtick elsewhere in this native block must not claim the generated span.
      const delimiter = "`".repeat(Math.max(0, ...(block.match(/`+/g) || []).map(run => run.length)) + 1);
      // Markdown strips one padding space at each edge, preserving literal backticks and whitespace.
      return `${delimiter} ${line} ${delimiter}`;
    }
    // Existing code spans can cross lines; an unmatched or escaped opener is prose.
    for (const match of line.matchAll(/(\\*)(`+)/g)) {
      const opening = start + match.index + match[1].length;
      if (opening < inlineEnd || match[1].length % 2) continue;
      const end = opening + match[2].length;
      const rest = markdown.slice(end, blockEnds.find(limit => limit > opening)).split(/\n[ \t]*\n/, 1)[0];
      const closing = rest.match(new RegExp("(?<!`)" + match[2] + "(?!`)"));
      if (closing) inlineEnd = end + closing.index + match[2].length;
    }
    return line;
  }).join("\n");
}
