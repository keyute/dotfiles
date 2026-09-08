import { VERSION } from "@earendil-works/pi-coding-agent";

// The pi mascot, taken from the coding agent's own custom-header example: a π
// whose eyes are a full block with a half-block pupil, so it reads as looking
// sideways. Replaces the built-in logo, key hints and onboarding lines.
const BLOCK = "█";
const PUPIL = "▌";

export function renderHeader(theme, version = VERSION) {
  const pi = text => theme.fg("accent", text);
  const eye = `${theme.fg("text", BLOCK)}${theme.fg("dim", PUPIL)}`;
  const leg = `     ${pi(BLOCK.repeat(2))}    ${pi(BLOCK.repeat(2))}`;
  return [
    "",
    `     ${eye}  ${eye}`,
    `  ${pi(BLOCK.repeat(14))}`,
    leg,
    leg,
    leg,
    leg,
    "",
    `  ${theme.bold(pi("pi"))}${theme.fg("dim", ` v${version}`)}`,
    "",
  ];
}

export function installHeader(ctx) {
  ctx.ui.setHeader((_tui, theme) => ({
    invalidate() {},
    render: () => renderHeader(theme),
  }));
}
