# Profile and settings

The Profile and Preferences designs reviewed with Kayvan on October 24, 2026. These are fixed
mockups with sample data, exported from the "Chat view redesign" board on claude.ai. They do not call the API or change a person's
real profile.

- `profile.html` + `.png`: the display name, and how you appear in a conversation.
- `preferences.html` + `.png`: the theme (match this computer, dark, or light) and how times show.
- You open this page from your name at the bottom of the sidebar.

The board is the source. Change the board, then export again; don't edit these pages by hand.
In the app, editing the name updates the preview, and Save and Discard turn on once something changes.

[Profile and settings in Notion](https://app.notion.com/p/4031a83d088f8137a038fdbb99d877b0)
records the behavior and storage default.
[CA-43](https://app.notion.com/p/4031a83d088f81a4b909f0e5b34b5fd3) tracks implementation, including
person-name persistence, preferences, validation, save failures, and handling unsaved changes.
Saving these references completes only the design archive criterion.

The implementation uses the existing person picker. Sign-in, account roles, passwords, billing,
avatar uploads, and notification settings are outside this design. Time display preferences must
not change existing schedules or their source timezone.
