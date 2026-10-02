import * as sdk from "@earendil-works/pi-coding-agent";

export function skillCommand(text) {
  const skill = sdk.parseSkillBlock(text);
  return skill ? `/skill:${skill.name}${skill.userMessage ? ` ${skill.userMessage}` : ""}` : text;
}

// Both live rendering and restored history read this undocumented method; return
// a plain command before pi's skill-specific component sees the native block.
const SKILL_DISPLAY = Symbol.for("pi-workflow:skill-display");
export function installSkillDisplay(InteractiveMode = sdk.InteractiveMode) {
  const prototype = InteractiveMode.prototype;
  if (prototype.getUserMessageText[SKILL_DISPLAY]) return;
  const original = prototype.getUserMessageText;
  const display = function (message) {
    return skillCommand(original.call(this, message));
  };
  display[SKILL_DISPLAY] = true;
  prototype.getUserMessageText = display;
}
