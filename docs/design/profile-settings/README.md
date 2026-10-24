# Profile and settings

The desktop Profile and Preferences designs reviewed with Kayvan on October 24, 2026.
These are previews with sample data, not application code. They do not call the API or change a
person's real profile. The images preserve the desktop design shown in chat.

- Open `profile-settings.html` directly in a browser. It starts on Profile. Choose Preferences
  to see appearance and time display settings.
- `profile-settings.fragment.html` is the editable source. `profile-settings.html` is its
  standalone export from the visualization skill's `scripts/render.py`. Export again after editing
  the fragment; do not edit the generated wrapper by hand.
- `profile.png` and `preferences.png` show the two desktop tabs in the dark theme, with an Eastern
  Time browser context. They make the design viewable without the interactive chat preview.
- The live preview follows the browser's theme. Appearance choices change the preview immediately.
  Editing the name updates the initials and conversation example. Save and Discard work locally;
  reload to reset. Sample navigation in the sidebar is only context.

The archived screens use the solid blue avatar shown in the review. CA-41 changed the shared style
guide to tinted avatars afterward. Build the feature with the current
[style guide](../style-guide/README.md) and `person-1-bg` / `person-1-ink` tokens; these pictures do not
override that decision.

[Profile and settings in Notion](https://app.notion.com/p/4031a83d088f8137a038fdbb99d877b0)
records the behavior and storage default.
[CA-43](https://app.notion.com/p/4031a83d088f81a4b909f0e5b34b5fd3) tracks implementation, including
person-name persistence, preferences, validation, save failures, and handling unsaved changes.
Saving these references completes only the design archive criterion.

The implementation uses the existing person picker. Sign-in, account roles, passwords, billing,
avatar uploads, and notification settings are outside this design. Time display preferences must
not change existing schedules or their source timezone.
