# Schedules

The Schedules design Kayvan agreed on October 24, 2026. These are fixed mockups with sample data,
exported from the "Collaborative Agents app design" board on claude.ai. They do not create schedules or call the API.

- `schedules.html` + `.png`: the list, with a missed-runs card and each schedule's state.
- `schedule-details.html` + `.png`: one schedule, with Pause, Run once now, and its recent runs.
- `new-schedule.html` + `.png`: the form, with the day picker, local time, and the missed-run choice.

The board is the source. Change the board, then export again; don't edit these pages by hand.

The live preview Codex first built also showed interval checks, pause and resume, run feedback, and a
cancel confirmation. Build those states in the app; the mockups show the resting screens.

The agreed design and storage decisions live in [Schedules design in Notion](https://app.notion.com/p/4031a83d088f8127b751ce0d99e066f7).
[CA-39](https://app.notion.com/p/4031a83d088f8162bc7de6978989c398) tracks implementation, including API,
persistence, local-time recurrence, daylight saving handling, migration compatibility, and tests.
The current app still supports intervals only; see [scheduling.md](../../scheduling.md).

The page uses the shared shell from the chat design, so it already has no Work item; see CA-35 and CA-40.
