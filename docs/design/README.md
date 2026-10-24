# Design

The design for the web app (`apps/web`): the chat view redesign and the style guide it follows. Kayvan and Claude worked these out on two claude.ai boards in October 2026. This folder is the copy any person or agent can open. When the boards and this folder disagree, ask Kayvan which one is current.

Everything here is a picture of the app, not app code. Build it in Svelte, using the tokens in `style-guide/tokens.css`.

## What's here

| Path                                        | What                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `chat-view/chat-view.html` + `.png`         | The conversation screen, with the Details panel closed                                                              |
| `chat-view/chat-view-details.html` + `.png` | The same screen with Details open while an agent is working                                                         |
| `chat-view/message-box.html` + `.png`       | The message box: the @ picker, replying, and how a reply shows                                                      |
| `chat-view/agent-states.html` + `.png`      | How agents look at each step: working, playful status words, its work folded, waiting, needs your OK, paused, stuck |
| `style-guide/README.md`                     | The style guide: principles, color roles, type, spacing, words, icons, layout                                       |
| `style-guide/tokens.json`                   | Every token, with a note on when to use it                                                                          |
| `style-guide/tokens.css`                    | The same tokens as CSS custom properties, ready to import. Generated from `tokens.json`                             |
| `style-guide/components/<Name>/`            | Each building block: `README.md` (how to use it) and `preview.html` (a live example)                                |

## How to look at it

- **Pictures:** open the `.png` files.
- **In a browser:** open any `.html` file directly. The chat view pages are fixed mockups; the component previews read `tokens.css`. To see a preview in the light theme, set `data-theme="light"` on its `<html>` element.
- **From an agent:** read the `.md` files, view the `.png` files, or render the `.html` files with a headless browser. On Kayvan's computer, Chrome 153 is at `~/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`; the system Chromium is too old.

## Decisions

### Colors

- **Two themes, Dark (default) and Light**, with the same token names.
- **Grounds are neutral graphite.** The selected conversation is neutral too.
- **Yolk means "do something":** primary buttons, Send, the brand mark, mentions, and anything waiting on you. Text on yolk is always dark (`accent-ink`).
- **Sky means "this is an agent":** the agent badge, the word "agent", and an agent's live status. No yolk or amber on agents.
- **Red means "look here":** every count badge (unread conversations, Approvals) is the same red with white text. Nothing else is red, except "stuck".

### Who's who

- Every avatar is a rounded square, people included. People get initials on one of four colors, given out in turn.
- Every agent gets a sky spark badge in the avatar's corner, and the small word "agent" after its name. Use this everywhere a small avatar appears: messages, the @ list, Details, and task lists.

### The conversation screen

- **Sidebar:** collapsible. Main navigation with count badges, then the conversation list. Conversation names use dashes and no spaces (`#heat-pumps-cold-weather`), always on one line, with "…" when long. Unread conversations get a red badge and a bold name.
- **Header:** the title, one members button (at most 4 same-size pictures, then "+N"; it never grows, and it opens Details), "Add people or agents", and a Details toggle.
- **Messages:** grouped by sender, with short times ("9:31 PM") and the full date on hover. Formatting is rendered. An agent's steps fold into one line ("Read 6 Wikipedia pages · 24 s") that opens on click. Drafts and results arrive as artifact cards with actions ("Read it", "Accept", "Ask for changes"), plus time taken and cost. Hovering a message shows Reply, Copy, and "See what this agent did".
- **Status line**, just above the message box: one slim line for every busy agent and anyone typing ("Reviewer is fact-checking… · Researcher is waiting for it"). Playful words are picked from what the agent is really doing, always next to the plain detail. Waiting, paused, needs your OK, and stuck always use plain words.
- **Message box:** one line: attach, the text, and Send. No @ button: typing @ opens the picker. Replying shows a "Replying to…" bar.
- **Details panel:** hidden by default, opened from the header.
  - **People.**
  - **Agents:** a compact list, one line per agent, busy agents first, with the header counting "1 working · 1 waiting · 3 free". Only the agent you click expands, to show its current step and Pause, Stop, and History. Free agents fold into one "N more agents · Free" row.
  - **Artifacts:** draft or final, and when; no word counts.
  - **Spending:** one budget for all agent work in the conversation, with a per-agent split.

### States that need a person

These cards appear in the conversation itself, not only on other pages:

- **Needs your OK:** the exact request, "Allow once", and "Don't allow".
- **Paused:** who paused it and when, and one Resume button. Paused means on hold: it does nothing and spends nothing until someone resumes it.
- **Stuck:** the reason in plain words, and the fix as the main button ("Raise budget to $2 and continue").

## Gaps to check against the API

Some of these need data the API may not expose yet: the live "what is it doing now" line, who paused a task, a per-agent split of conversation spending, and whether an artifact is a draft or final. List each gap as its own ticket rather than faking it in the web app.
