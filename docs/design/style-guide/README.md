# Collaborative Agents

The look and feel of the Collaborative Agents web app: a shared workspace where people and AI agents talk in conversations, hand each other work, and produce artifacts. It should feel like Slack or Discord: calm, dense, readable, and always clear about who is a person and who is an agent.

This guide is the source of truth for the web interface (`apps/web`). The chat view design that it came from is in `../chat-view/`.

## Principles

- **Who's who, at a glance.** Every participant has a rounded-square avatar. Agents always carry the spark badge in the avatar's corner and the small word "agent" after their name. Never tell people and agents apart by color alone.
- **Quiet until it matters.** Most of the screen is neutral graphite. Color has jobs: **yolk** means "do something" (buttons, Send, mentions, things waiting on you), **sky** means "this is an agent", and **red** means "look here" (count badges) or "stuck".
- **Show the work, don't dump it.** An agent's steps fold into one line ("Read 6 Wikipedia pages · 24 s") that opens on click. Long results arrive as artifact cards, not walls of text.
- **Short lists stay short.** Anything that can grow (members, agents, artifacts) shows a few items and a count, and the rest opens on demand.

## Themes

Two themes, picked per person, with the same token names, so a component never names a theme:

| Theme | Grounds | Action color | Agents |
| --- | --- | --- | --- |
| Dark (default) | Neutral graphite | Deep yolk `#f59e0b`, dark text on it | Sky `#7dd3fc` |
| Light | White and soft grays | Deep yolk `#e08e00`, dark text on it | Sky `#0ea5e9` |

The palette was picked on the "Chat view redesign" board (5C + Sky agents, deep yolk). Text meets 4.5:1 contrast on its ground in both themes; control borders and icons meet 3:1. Text on yolk is always dark (`accent-ink`): white is not readable on it.

## Color, by role

- **Grounds:** `bg-000` sidebar, `bg-100` conversation, `bg-150` Details panel, `bg-200` raised cards and the message box, `bg-300` hover, `bg-selected` the open item (neutral, not yolk).
- **Lines:** `border-100` hairlines between areas, `border-200` around controls and cards.
- **Text:** `text-100` main, `text-200` secondary, `text-300` quiet (times, labels, hints).
- **Action (yolk):** `accent` with `accent-ink`, for primary buttons, Send and the brand mark. One primary button per card.
- **Mentions:** others get `mention-bg` and `mention-ink`. You get `you-bg` and `you-ink`, and the whole message row gets `you-row`.
- **Agents (sky):** `agent` (the badge), `agent-ink` (its spark), `agent-label` (the word "agent" and an agent's live status). No yolk or amber on agents, so "agent" and "do something" never blur.
- **Counts:** `notify` with `notify-ink`, on every count badge (unread conversations, Approvals). Nothing else is red.
- **States:** `success` (lime) for done and approved; `waiting` (yolk) for needs you; `danger` for stuck. Each has a `-bg` and, for cards, a `-border`.
- **Avatars:** every avatar is a tinted ground with a bright mark: dark grounds in the dark theme, light grounds with deep marks in the light theme. People take `person-1` to `person-4` (indigo, violet, rose, slate) in turn; agents take `agent-1` to `agent-3` (lime, sky, teal) in turn. Each has a `-bg` and an `-ink`.

## Type

Inter for everything in the interface, JetBrains Mono for requests, paths and IDs. Both come from Google Fonts.

- `title-lg` 18/26 semibold: the conversation title.
- `title` 15/22 semibold: names on messages, card and panel titles.
- `body` 15/22: messages.
- `body-sm` 14/20: inside cards and Details.
- `meta` 13/18: secondary lines and status lines.
- `caption` 12/16: times and small statuses.
- `label` 12/16 semibold, capitals, 0.04em tracking: section labels.
- `badge` 12/16 bold: numbers in count badges.

## Shape and space

- A 4px grid: `space-1` to `space-8`. Lay out with `gap`.
- Corners: `radius-md` for buttons and 28px avatars, `radius-lg` for 36px avatars and agent rows, `radius-xl` for big cards and the message box, `radius-full` for badges and chips.
- Sizes: avatars `avatar-sm` 20, `avatar-md` 28, `avatar-lg` 36. Controls are `control` (36px) tall; on a phone, touch targets are at least `touch` (44px).
- Borders, not shadows. `shadow-pop` is only for floating menus.

## Words

- Plain words, short sentences. Name things the way people do: "conversation", "agent", "artifact", "budget".
- Times are short ("9:31 PM"); the full date shows on hover.
- **Live agent status can be playful**, picked from what the agent is really doing, always next to the plain detail: "Rummaging…" (searching), "Skimming…" (reading a page), "Scribbling…" (writing a draft), "Fact-checking…" (comparing claims to sources), "Poking the API…" (calling a connection), "Mulling it over…" (thinking).
- **States that need a person are never playful:** "Waiting for Reviewer", "Paused by Sam", "Needs your OK", "Stopped: this conversation reached its $1.00 budget".
- Buttons say exactly what happens: "Read it", "Accept", "Ask for changes", "Allow once", "Raise budget to $2 and continue".

## Icons

Simple stroke icons on a 24px grid, 1.8 to 2px lines, round joins, drawn in the text color they sit next to. No emoji. Icon-only buttons always have an accessible name ("Reply", "Copy", "See what this agent did").

## Layout

- **Sidebar** (collapsible): app name, main navigation with count badges, the conversation list (dashed names, always one line), and who you are.
- **Conversation:** header (title, members button, Add people or agents, Details), messages grouped by sender, the status line, and the one-line message box.
- **Details** (hidden until opened): People, Agents (compact rows, busy first, free ones folded), Artifacts, Spending.
