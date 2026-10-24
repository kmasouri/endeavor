# Design

The design for the web app (`apps/web`): every screen designed so far, and the shared style guide. All screens live on the "Chat view redesign" board on claude.ai, and this folder is their export. Codex first drafted the skills, access request, schedules, agent history, and profile screens; they were rebuilt on the board on October 24 so every screen shares one shell and the style guide. When the board and this folder disagree, ask Kayvan which one is current.

Everything here is a picture of the app, not app code. Build it in Svelte, using the tokens in `style-guide/tokens.css`.

## What's here

| Path                                                | What                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `chat-view/chat-view.html` + `.png`                 | The conversation screen, with the Details panel closed                                                              |
| `chat-view/chat-view-details.html` + `.png`         | The same screen with Details open while an agent is working                                                         |
| `chat-view/message-box.html` + `.png`               | The message box: the @ picker, replying, and how a reply shows                                                      |
| `chat-view/agent-states.html` + `.png`              | How agents look at each step: working, playful status words, its work folded, waiting, needs your OK, paused, stuck |
| `skills-and-connections/skills.html` + `.png`       | The tabbed catalog, on Skills, with Enabled and Disabled on every row                                               |
| `skills-and-connections/connections.html` + `.png`  | The Connections tab, with what each one allows and whether it has a credential                                      |
| `skills-and-connections/skill-editor.html` + `.png` | The full-width instructions editor                                                                                  |
| `approvals/access-request.html` + `.png`            | An agent asks for connection access in the conversation: for this task, or ongoing                                  |
| `schedules/schedules.html` + `.png`                 | The schedules list, with a missed-runs card and each schedule's state                                               |
| `schedules/schedule-details.html` + `.png`          | One schedule, with Pause, Run once now, and recent runs                                                             |
| `schedules/new-schedule.html` + `.png`              | The new schedule form: days, local time, and what to do about missed runs                                           |
| `agent-history/*.html` + `.png`                     | History from Details, each agent's own runs, and one run, with chat still visible                                   |
| `profile-settings/profile.html` + `.png`            | Your display name, and how you appear in conversations                                                              |
| `profile-settings/preferences.html` + `.png`        | Theme and time display                                                                                              |
| `style-guide/README.md`                             | The style guide: principles, color roles, type, spacing, words, icons, layout                                       |
| `style-guide/tokens.json`                           | Every token, with a note on when to use it                                                                          |
| `style-guide/tokens.css`                            | The same tokens as CSS custom properties, ready to import. Generated from `tokens.json`                             |
| `style-guide/components/<Name>/`                    | Each building block: `README.md` (how to use it) and `preview.html` (a live example)                                |

## How to look at it

- **Pictures:** open the `.png` files.
- **In a browser:** open any `.html` file directly. The screens are fixed mockups with sample data; they never call the app. The component previews read `style-guide/tokens.css`. Set `data-theme="light"` on their `<html>` element to see the light theme.
- **From an agent:** read the `.md` files, view the `.png` files, or render the `.html` files with a headless browser. On Kayvan's computer, Chrome 153 is at `~/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`; the system Chromium is too old.

## Decisions

### Colors

- **Two themes, Dark (default) and Light**, with the same token names.
- **Grounds are neutral graphite.** The selected conversation is neutral too.
- **Yolk means "do something":** primary buttons, Send, the brand mark, mentions, and anything waiting on you. Text on yolk is always dark (`accent-ink`).
- **Sky means "this is an agent":** the agent badge, the word "agent", and an agent's live status. No yolk or amber on agents.
- **Lime means "done":** approved and finished chips (`success`), and the first agent's avatar.
- **Red means "look here":** every count badge (unread conversations, Approvals) is the same red with white text. Nothing else is red, except "stuck".

### Every screen

- **One sidebar everywhere:** Conversations, Approvals, Schedules, Agents, Skills and connections, Setup, then the conversation list. Work is gone (see Agent history below). Your name at the bottom opens Profile and settings.
- **One header:** pages that aren't a conversation get the same header bar as a conversation: the page name, a short line under it, and the page's main action on the right ("New schedule"). No "Workspace /" breadcrumb.
- **Selected is neutral, never yolk:** the open tab (light text, light underline), chosen days (light fill, dark letter), a chosen option card (graphite fill, light border). Yolk stays for actions and for things waiting on you.
- **Waiting on you is yolk:** "Researcher is waiting for your OK" in the status line, and the "Needs your OK" card.
- **Status chips:** Enabled and Done are lime (`success`), with an icon. Disabled and Paused are neutral, with an icon.
- **Agents in lists** show their small avatar, their name, and the word "agent" in sky, like in messages.

### Who's who

- Every avatar is a rounded square, people included, in one tinted style: a dark ground with a bright mark (a light ground with a deep mark in the light theme).
- People get initials in indigo, violet, rose, or slate, given out in turn (`person-1` to `person-4`). Agents get their icon in lime, sky, or teal (`agent-1` to `agent-3`).
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

### Skills and connections

- **Tabbed catalog:** one page with Skills and Connections tabs and one creation action for the selected catalog.
- **Skills are instructions only.** No required-connection picker or dependency summary. Humans select skills and connections independently on each agent.
- **Status stays visible:** every catalog row and open item shows Enabled or Disabled, with an icon and text.
- **Full-width editing:** opening a skill replaces the list with a wide instructions editor. Back to skills returns to the list. Saving creates a new version; agents keep their pinned version until their configuration changes.
- This is the agreed target design for [CA-37](https://app.notion.com/p/4031a83d088f8108a631eb9174f94db0). The current app still associates skills with connections until that ticket ships.

### Requests for capability access

- **Ask in the conversation:** the request names the agent and connection, explains why it is needed, and shows the allowed requests on demand. It also appears in Approvals.
- **For this task is selected by default.** Access survives pauses and service restarts, then ends when the task completes or is cancelled.
- **Ongoing is an explicit human choice:** access applies to this agent's current task and future work until revoked. Access never transfers to other agents.
- **"Don't allow" grants nothing.** The agent receives the decision and can explain the limitation or use another available capability.
- **Access and actions are different approvals.** Giving a connection does not approve individual calls that require a person's OK.
- This is the agreed target design for [CA-38](https://app.notion.com/p/4031a83d088f81999042d1aadfd02466), which also covers filtered discovery, skill requests, and revocation. The saved screen shows a connection request; it is not an implemented app feature.

## Gaps to check against the API

### User profile and settings

The [Profile and settings reference](profile-settings/README.md) shows a person's display name and
personal appearance and time display choices. It is separate from agent configuration.
[CA-43](https://app.notion.com/p/4031a83d088f81a4b909f0e5b34b5fd3) tracks persistence, save/error
states, and integration with the current person picker. Sign-in and roles stay deferred.

### Schedules

The approved [Schedules preview](schedules/README.md) follows the Skills and connections list pattern.
It uses explicit **Pause schedule**, **Resume schedule**, **Run once now**, and **Cancel schedule**
labels. The form offers calendar recurrence and minute intervals, detects the local timezone, and
keeps **If runs are missed** visible. [CA-39](https://app.notion.com/p/4031a83d088f8162bc7de6978989c398)
tracks the UI and backend work. Calendar rules need their source IANA timezone as well as UTC run
instants; the current interval-only API cannot implement the new picker yet. See the linked Notion
design for the agreed behavior.

### Conversation data

Some of these need data the API may not expose yet: the live "what is it doing now" line, who paused a task, a per-agent split of conversation spending, and whether an artifact is a draft or final. List each gap as its own ticket rather than faking it in the web app.

### Agent history and run inspection

The approved [Agent history preview](agent-history/README.md) keeps inspection in the conversation:
**Details → selected agent → History → run**. History is scoped to that agent and conversation.
**See what this agent did** opens the specific run associated with a message. Directing agents and
requesting changes stay in chat. Remove Work from main navigation without a global Activity or Run
history replacement. [CA-40](https://app.notion.com/p/4031a83d088f81be8b37ca3c556e539b) implements
this after CA-35. The saved reference is not application code; task records and existing inspection
links must remain available. Earlier mockups that show Work do not override this navigation decision.
