# Centered Schedules workspace

Kayvan approved this follow-up on October 24, 2026, after reviewing the running Schedules page on
a large screen. The selected page width was **1,220px**, with example schedules enabled in the
preview. Both the empty and populated views are saved here.

This reference was made in Codex. It refines the Schedules page frame, row alignment, and empty
state. The original board exports in `../schedules/` remain unchanged and continue to define
schedule details, creation fields, recurrence, missed-run policies, and schedule/run controls.
Kayvan explicitly approved this refinement of those exports.

## Files

- `schedules-centered.fragment.html`: editable source, using sample data and local interactions.
- `schedules-centered.html`: generated standalone preview. The controls above the app switch
  between Empty state and With schedules, and between appearances. They are review controls,
  not product controls.
- `schedules-empty.png`, `schedules-populated.png`: dark desktop views at 1,920px.
- `schedules-empty-light.png`, `schedules-populated-light.png`: light desktop views.
- `schedules-empty-mobile.png`, `schedules-populated-mobile.png`: narrow views at 390px.

The preview never calls the app, saves schedules, or starts agents. New schedule demonstrates
local navigation and sample creation only. Its shortened form is illustrative; it does not
replace the original form reference or the real API's validation rules.

## Approved layout

- Center one page frame, at most **1,220px** wide, within the workspace beside the sidebar.
  The heading, main action, list, notices, and cancelled disclosure share its edges.
- Let rows fill that frame. Keep next-run timestamps and status chips aligned in consistent
  columns. Reflow them on narrow screens instead of stretching text or causing overflow.
- With no active schedules, show a quiet centered clock, **No active schedules**, a short
  explanation, and a nearby **Create schedule** button. Hide the duplicate header action.
- Once schedules exist, show the count and the **New schedule** action in the header.
- Keep cancelled schedules folded below the main content. Their presence does not suppress
  the empty state when there are no enabled or paused schedules.
- Keep the page frame when opening creation or details. Forms may use a narrower reading width
  within it. Preserve the shared sidebar, theme tokens, keyboard interaction, loading/errors,
  missed-run prompts, and all scheduling behavior.

[CA-39](https://app.notion.com/p/4031a83d088f8162bc7de6978989c398) tracks saving this reference and
implementing this layout. The reference itself is sample-only; the app uses the API's real data.
Work removal and conversation history still belong to CA-40, and conversation navigation still
belongs to CA-52. The sidebar shown here does not replace those designs.

## Regenerate and verify

```sh
python3 "$VISUALIZE_SKILL_DIR/scripts/render.py" \
  docs/design/schedules-centered/schedules-centered.fragment.html \
  docs/design/schedules-centered/schedules-centered.html \
  --title 'Centered Schedules — approved CA-39 follow-up' --force
```

Use the installed visualize skill directory for `VISUALIZE_SKILL_DIR`. Edit the fragment and
regenerate the standalone page; do not edit generated HTML. Capture the product area at each
state from a fresh preview. The renderer supplies icons through its pinned CDN, so rendering
icons needs internet access. Check both appearances, state switching, local sample creation,
and narrow widths, then run `npm run check` from the repository root.
