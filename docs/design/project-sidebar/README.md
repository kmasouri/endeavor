# Project sidebar

Kayvan approved this sidebar layout on November 20, 2026, for
[CA-122: Redesign the project sidebar](https://app.notion.com/p/41e1a83d088f81e1ae2fda4559e3dfa5).
It is option A ("tidy tree") of four proposals on the
[project sidebar design canvas](https://claude.ai/artifact/CthXXDyuB98WxpduT57Sxx). It replaces the
project sidebar from CA-102 and CA-110. The [Endeavors](../conversation-workspace/README.md) rules
for titles, search, and creation still apply.

## Files

- `project-sidebar.html`: static export of the approved board, with sample data. Open it directly.
  Set `data-theme="light"` on `.sb` for the light theme.
- `project-sidebar.png` and `project-sidebar-light.png`: dark and light references.

## Agreed layout

- **Main navigation comes first:** New endeavor, then Approvals through Setup. It never moves when
  projects or endeavors are added.
- **Projects** follows as a small uppercase section heading. The heading opens the projects page,
  and a `+` beside it creates a project.
- Each project is one row: its icon on a soft tile of its own color, its name, then a chevron at
  the end. A collapsed project shows its unread count before the chevron.
- With a mouse, the project's options and **New endeavor in …** appear over the end of the row on
  hover. On touch screens they stay visible.
- A project's endeavors sit one step in, joined to the project icon by a thin guide line.
- Endeavors without a project follow under a **No project** heading, styled like **Projects**,
  without the guide line.
- Endeavor titles are shown as written, with no `#` prefix.
- The project list hides when the sidebar collapses to icons.

Sample projects, colors, and endeavors are illustrative. The colors come from the existing
project color choices; everything else uses `style-guide/tokens.css`.
