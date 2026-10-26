# Conversations and the runner

People and agents work together in conversations. People post through the API. Agents post through the runner, which runs their work.

## Who gets woken up (v1 response rules)

A message is addressed to:

- every agent member it mentions (`mentions`), and
- the agent who wrote the message it replies to (`inReplyToMessageId`).

Each addressed agent must respond, or say why it can't. A message that addresses no agent is saved, but starts no work and makes no model call. No model decides who should answer; relevance routing is future work.

When a message reaches an agent:

- **The agent has an open task in this conversation** (working, waiting, or blocked): the message is added to that task. This never starts a second, competing run.
  - If the task is waiting for a reply from the message's author, the wait is resolved. An answer, a clarifying question, or "I can't help" all count as a reply.
  - If the task is blocked and the message is from a person, the task goes back to working. A person answering is the attention it needed.
- **Otherwise**: the message starts a new task for the agent. The task uses the agent's current configuration version and records the message that asked for it.

Delivering the same message twice finds the same task (its run key is `message:<message>:<agent>`), so a crash in the middle of delivery doesn't create duplicate work.

## Membership

The endeavor header’s member avatars open a compact People and agents dialog. It shows current members and a searchable people and agents list matching creation. People can select several additions and choose whether to hide earlier messages. Successful additions disappear from the choices; a failed addition keeps the remaining selection for retry. Details remains a separate panel for activity and artifacts.

The web interface calls conversations **Endeavors**. Existing conversation URLs and APIs remain
compatible. Endeavors opens the last accessible selection saved for the current person in this
browser, falling back to another accessible endeavor or a first-endeavor prompt. Recent displays
Discord/Slack-style names such as `#heat-pump-brief`, with lowercase words separated by hyphens.
The name is canonical in storage and every view; the leading `#` is a navigation decoration.
The app header and Cmd/Ctrl K open search across
all accessible endeavors, including older API pages. The list is refreshed when the person changes.

**+ New** opens a native modal with a required name and optional searchable people and agents.
No agents are selected by default. Cancel, Close, and Escape restore the opener; saving disables
those actions until the request finishes. Errors retain the form values. Success updates Recent,
selects the new endeavor, and focuses its message box. Creating an endeavor never posts a message
or starts agent work. The full chat, Details, member controls, and history remain available.

`POST /conversations` accepts `title` (at most 200 input characters; nonempty after normalization), optional `agentIds`, and
optional `humanIds` (up to 20 each). It validates every chosen participant before creating the
conversation, adds the creator automatically, and ignores duplicate selections. Only humans can
create conversations or add members. Initial members can access the full history.

### Channel names

Channel names contain lowercase ASCII letters (`a–z`), numbers, and single hyphens. They have no
leading/trailing hyphen and are stored without `#`. Creating or renaming a conversation normalizes
spaces and punctuation to hyphens and lowercases letters. For example, `Heat Pumps: Brief!` is
stored and returned as `heat-pumps-brief`. Input with no letters or numbers is rejected with the
existing `validationError`. Budgets can still be updated without sending a name.

The creation field applies this format while typing or pasting. A trailing separator remains
while typing the next word, then is removed on blur or submission. The server applies the same
rule to direct API clients. A database check protects all stored names, including writes that
bypass the API.

API clients can send human-readable titles; responses return the canonical name.
The pilot setup reuses its canonical schedule conversation name to avoid creating duplicates.

Only people add members. Adding a member with `history: "from_now"` hides older messages from them. An agent can't add anyone.

`GET /directory` lists the enabled agents a person can discover: name, purpose, and capabilities (provider, model, and how many skills and connections). It never shows instructions, saved notes, credentials, or conversations. Agents also see directory agents that aren't in the conversation, by name and purpose only. If one could help, the agent calls `suggest_participant`. That posts a suggestion to the people in the conversation; it doesn't add the agent or contact it. Seeing an agent in the directory doesn't let anyone message it outside a conversation.

## What agents can do

Agents act only through these tools. The runner carries out each call:

| Tool             | What it does                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `send_message`   | Post a message. Addressed participants are notified.                                           |
| `ask`            | Ask one participant something, and wait for their reply.                                       |
| `save_output`    | Attach an output or piece of evidence to the task.                                             |
| `complete_task`  | Finish with a result. It is saved as an output, checked against the criteria, and posted back. |
| `report_blocked` | Stop, and say what a person needs to do.                                                       |
| `list_files`     | List the files in the task's own workspace folder.                                             |
| `read_file`      | Read a text file from the workspace.                                                           |
| `write_file`     | Write a text file in the workspace. Paths can't leave it. See `docs/local.md`.                 |

## Outputs, evidence, and finishing

Agents attach outputs with `save_output`: text, links, data, logs, or a file from their workspace (`path`). A file is copied into the output, so it stays inspectable even if the workspace changes. `GET /tasks/:taskId/outputs` lists one task's outputs, and `GET /conversations/:conversationId/outputs` lists every task's outputs in a conversation, newest first.

When an agent calls `complete_task`:

1. It must say the criteria are met, and explain how (`criteria_check`).
2. **The completion check**, only when `COMPLETION_CHECK=true` (it's off by default; people and other agents review results instead). A separate call to the agent's model, with no tools, reads the request, the criteria, the outputs, and the result. It must answer `MET:`. Anything else, even an unclear answer, counts as not met, and the gaps go back to the agent as a tool error to fix. After 2 failed checks the task is blocked for a person, who is told why.
3. If the task needs review, a person approves it or sends it back. Otherwise it completes, and the result is saved as an output and posted.

Each check is saved as a `completion.checked` event with its verdict. A replay after a crash reuses the verdict instead of paying for another check. The check's tokens count toward the task's `maxTokens`. It's skipped for the `scripted` test provider.

To ask for a revision of finished work, restart it with a reason (`POST /tasks/:taskId/restart` with `reason`). The new run's brief gets the requested changes and the previous result, and the previous run stays as it was.

Every directed request gets an answer in the conversation. That is the result from `complete_task`, the reason from `report_blocked`, or a message from the runner when the platform itself can't go on, such as a missing API key or a model that declined.

## The runner

The runner is not an agent and makes no decisions about the work. It runs in the server, every `RUNNER_INTERVAL_MS`. Each tick it:

1. Turns pending deliveries into new tasks or updates.
2. Wakes waiting tasks whose waits are all resolved.
3. Claims working tasks with a lease, and runs up to 8 model turns on each.

Everything it does is written to the task's events: model turns, tool results, failed model calls, and messages received. The model transcript is rebuilt from those events, so after a restart the task picks up where it stopped. A tool call that was asked for but never run is run first. Message tool calls use the tool call ID as the message's `client_key`, so running a call again doesn't post twice.

Limits:

- A task is blocked after 40 model turns, or at its agent version's own limits (`docs/agents.md`).
- A failed model call that can be retried waits 5 s, then 10 s. After 3 failures, the task is blocked.
- A model that keeps ending its turn without finishing gets two nudges, then the task is blocked.
