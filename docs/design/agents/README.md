# Agents

Kayvan approved this design on October 24, 2026. It covers the Agents list, one agent's page, and
creating an agent. Before it, `apps/web` had Agents pages but no design to match.

It was made on the "Agents page design" canvas on claude.ai
(<https://claude.ai/artifact/UbWjtSq7zNAqqLmq4z8wsT>). The canvas is the source. Change it there,
then export again. It uses the shell from the approved [Endeavors design](../conversation-workspace/README.md):
the app bar with search, **Endeavors** in the sidebar, and **Recent**. Pages use the 1,220px centered
frame from [Schedules](../schedules-centered/README.md).

## Files

- `agents.html`: a standalone preview of every screen. Open it directly. The bar at the top picks
  the screen and appearance. It's a review control, not part of the design. Filters, Disable, and
  the skill and connection pickers work. Nothing calls the API.
- `agents*.png`, `agent-*.png`, `new-agent*.png`, `picker-search.png`: screenshots at 1,440px, in
  light, and at 390px for phones.
- `source/`: the canvas files. Each `.dc.html` is one screen, and `agents.css` holds the shared
  styles, with colors copied from `../style-guide/tokens.css`. `support.js` is a small local stand-in
  for the canvas runtime, used to build the preview and screenshots.

## Screens

| Screenshot                         | What                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `agents.png`                       | Every agent: purpose, provider and model, current version, spending, and status |
| `agents-empty.png`                 | No agents yet, with Create agent and two examples that fill in the form         |
| `agent-overview.png`               | One agent: current configuration, open work, profile, spending, and saved notes |
| `agent-configuration.png`          | The configuration form. Saving makes a new version                              |
| `agent-configuration-removing.png` | Removing a skill and a connection, with what that does to open tasks            |
| `agent-versions.png`               | Every version, newest first, with moving open tasks to the current one          |
| `new-agent.png`                    | Creating an agent on its own page                                               |
| `picker-search.png`                | The skill and connection picker, searching the catalog                          |

## Agreed behavior

- **List.** One row per agent: purpose, provider and model, current version, this month's spending
  against its budget, and a status. The status is Enabled, Disabled, or Needs setup (its provider
  has no API key). Filter by All, Enabled, or Disabled, and search by name.
- **Empty.** Explain what an agent is and offer Create agent. The examples (Researcher, QA) only
  fill in the form; they aren't built-in roles.
- **One agent** has three tabs: Overview, Configuration, Versions. The header shows the status and
  Disable or Enable. A disabled agent takes no new work; its open tasks go on until someone pauses
  or cancels them.
- **Overview.** The current configuration, open work with each task's version, profile (name and
  purpose, not versioned), spending with the monthly budget and costliest tasks, and saved notes.
- **Configuration.** Saving makes a new version. Only new tasks use it.
- **Versions.** Each row says what changed from the version before it. The API doesn't store this,
  so work it out by comparing the two. A version with open tasks offers to move them to the current
  one. Versions that relied on inherited connections show a warning.
- **New agent** is its own page, not a side panel. Limits are folded away and show their defaults.

### Skills and connections: chosen means allowed

The configuration lists only the chosen skills and connections. Search the catalog to add more.
"Browse" opens the full catalog in Skills and connections. This works with hundreds of items.

**What an agent has chosen is what it's allowed to use.** There is no separate Access tab. Kayvan
decided this on October 24, 2026
([question](https://app.notion.com/p/4031a83d088f81d68e19fcc65580182d)):

- Choosing a skill or connection grants it.
- Removing one and saving revokes the grant. Open tasks on older versions lose it too, at their
  next call. The row turns amber and says so before you save, with an Undo.
- Approving access "ongoing" in an endeavor adds the item to the configuration as a new version.

**This changes the API.** Today a save only adds grants; it never revokes one (see
[catalogs.md](../../catalogs.md#grants-and-revocation)). CA-57 covers that change. Until
it ships, `docs/catalogs.md` describes how the code behaves now.

## Sample data

Agents, spending, versions, and tasks are made up. The catalog sizes (214 skills, 38 connections)
show the scale the picker must handle. `[model name]` stands in for an OpenAI model.

## Regenerate

Edit the canvas, export its files into `source/`, then from the repo root:

```sh
node docs/design/agents/source/build.mjs        # writes agents.html
node docs/design/agents/source/screenshots.mjs  # writes the PNGs; needs the repo's Playwright
```

The screenshot script fails if a screen scrolls sideways. Don't edit `agents.html` by hand.

[CA-55](https://app.notion.com/p/4031a83d088f814fadacf24a377cb459) tracks this design.
[CA-57](https://app.notion.com/p/4031a83d088f81899996d9c7e651a90e) tracks building it, including the
API change.
