# Rex preferences

Set these manually in native Settings:

- Appearance: Auto; light theme Catppuccin Latte, dark theme Catppuccin Mocha.
  Use built-ins if present; otherwise import the actual Ghostty/iTerm palette.
- Font: PragmataPro VF Mono Liga, 13 pt; prefer ligatures enabled.
- Copy on selection: on.
- Option as Alt: on. Left-only Option is undocumented; do not add a shim.
- Match program backgrounds: **off**. Enabling it caused the confirmed large
  Pi prompt background issue.

Keep Cmd+K as the default picker; no `init.lua` or custom key bindings.

[Native macOS Settings](https://www.superlogical.com/rex/docs/reference/mac-settings)
own these preferences. [Lua configuration](https://www.superlogical.com/rex/docs/customize/config)
covers bindings, actions and server configuration, not native appearance
preferences; settings serialization is not documented.

Install Rex manually and use its native updater. No Homebrew package is verified;
the invite-only app is not a fresh-machine CI requirement.
