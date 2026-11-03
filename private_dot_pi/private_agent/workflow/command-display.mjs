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
  if (!palette) return markdown;
  let fence;
  return markdown.split("\n").map(line => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
      return line;
    }
    return fence || !/^ {0,3}!/.test(line) || !command.test(line) ? line : line.replace("!", palette.fg("error", "!"));
  }).join("\n");
}
