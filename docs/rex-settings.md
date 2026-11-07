# Rex preferences

Set these manually in native Settings:

- Appearance: Auto; light theme Catppuccin Latte, dark theme Catppuccin Mocha.
  Rex ships no Catppuccin; import the Latte and Mocha palettes (e.g. from the
  Catppuccin Ghostty/iTerm theme files) as custom themes.
- Font: PragmataPro VF Mono Liga, 13 pt; prefer ligatures enabled.
- Copy on selection: on.
- Option as Alt: on. Left-only Option is unavailable; do not add a shim.
- Match program backgrounds: **off**. Enabling it caused the confirmed large
  Pi prompt background issue.
- Integrations › Coding Agents: off, and do not run `rex skill setup` — it writes
  a hook into `~/.claude/settings.json` and skills into directories chezmoi owns.

Keep Cmd+K as the default picker; no `init.lua` or custom key bindings.

[Native macOS Settings](https://www.superlogical.com/rex/docs/reference/mac-settings)
own these preferences. [Lua configuration](https://www.superlogical.com/rex/docs/customize/config)
covers bindings, actions and server configuration, not native appearance
preferences; settings serialization is not documented.

Install Rex manually and use its native updater. No Homebrew package is verified;
the invite-only app is not a fresh-machine CI requirement.
