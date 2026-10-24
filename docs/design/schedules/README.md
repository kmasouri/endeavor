# Schedules

The Schedules design Kayvan agreed on October 24, 2026. This is a preview with sample data, not the
application. It does not create schedules or call the API.

- Open `schedules.html` directly in a browser. It starts with the Quiet list. Open a row for details,
  or choose **New schedule** for the form.
- `schedules.png` shows the list, `schedule-details.png` shows an opened schedule, and
  `new-schedule.png` shows the form. All three use the dark theme and an
  Eastern Time browser context. The live preview follows the browser's light/dark preference and
  detects its local timezone.
- `schedules.fragment.html` is the editable source. `schedules.html` is its standalone export from
  the visualization skill's `scripts/render.py`. Export again after changing the source; do not
  edit the generated wrapper by hand.

The preview supports the day picker, repeat choices, time, interval validation, pause/resume,
manual-run feedback, and cancellation confirmation. Creating a schedule only shows a preview notice.
Run history is illustrative. Reload to reset the sample data.

The agreed design and storage decisions live in [Schedules design in Notion](https://app.notion.com/p/4031a83d088f8127b751ce0d99e066f7).
[CA-39](https://app.notion.com/p/4031a83d088f8162bc7de6978989c398) tracks implementation, including API,
persistence, local-time recurrence, daylight saving handling, migration compatibility, and tests.
The current app still supports intervals only; see [scheduling.md](../../scheduling.md).

The shell records the design as reviewed. Integrate the page with the shared shell and conversation
run-inspection work in CA-35 and CA-40; the Work navigation shown here is not a separate decision to
retain that destination.
