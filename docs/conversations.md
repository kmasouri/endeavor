# Conversations and the runner

People and agents work together in conversations. People post through the API. Agents post through the runner, which runs their work.

## Projects, endeavors, and goals

A conversation is an **endeavor**: one goal. Endeavors are grouped into long-lived **projects**. A project holds knowledge sources, saved notes, and default people and agents. It has no chat of its own.

- `POST /projects` creates a project with a `name` and optional default `agentIds` and `humanIds`. The creator becomes a default member. `GET /projects` lists active projects (`archived=true` for archived ones), and `GET /projects/:projectId` returns one with its members.
- `PATCH /projects/:projectId` renames it, replaces its default agents or people, or archives it (`archived: true`) and restores it (`archived: false`). Member changes apply to endeavors started afterwards. No new endeavor starts in an archived project (`projectArchived`).
- One project is the default. `POST /conversations` without `projectId` puts the endeavor there, so older clients keep working. The default can't be archived (`defaultProjectArchive`). All conversations that existed before projects were moved into it, named General, with their IDs unchanged.
- Creating an endeavor adds the project's default members along with the chosen ones. A default agent that can't join now, like a disabled one, is skipped.

**The goal** is the request that opened the endeavor. People never have to write one. `POST /conversations` can take a `goal`; otherwise the first message a person posts becomes it (`goalMessageId` points to that message). Older conversations got the first message a person wrote in them.

**Done criteria** are filled in from the goal: "Done when the result meets this request and a person confirms it: …", quoting up to 300 characters of it. People can send their own `doneCriteria` when creating, or change it, and the `goal`, with `PATCH /conversations/:conversationId`.

**Closing.** `POST /conversations/:conversationId/close` records that a person confirmed the goal is done (`state: "closed"`, `closedAt`, `closedByHumanId`). A closed endeavor is archived: `GET /conversations` lists only open ones unless `state=closed` or `state=all`, and posting returns `conversationClosed`. Work that is already running isn't stopped. `POST /conversations/:conversationId/reopen` opens it again for follow-ups, with its goal and history kept. `GET /conversations?projectId=` lists one project's endeavors.

Every task in an endeavor sees its current goal and done criteria before **Task (your part)**,
which holds the request that started that task and its own completion criteria. The runner reloads
this context before each model turn, so edits appear on the next turn. The goal is shared endeavor
metadata, even for members whose message history starts when they joined. Message history still
respects that boundary. Standalone tasks have only their own request and criteria.

Agents decide when their own work is done. They can say the overall goal looks met in a result or
`send_message`, asking a person to confirm. `complete_task` finishes only that task; it never closes
the endeavor. A request about another goal belongs in that goal's endeavor. Tools post only in the
current endeavor; a person opens or selects a different one.

## Who gets woken up (v1 response rules)

A message is addressed to:

- every agent member it mentions (`mentions`), and
- the agent who wrote the message it replies to (`inReplyToMessageId`).

Each addressed agent must respond, or say why it can't. Explicit tags and replies bypass the routing model. Untagged human messages are saved with a durable routing job in the same statement.

### Routing

`integrations/routing/` holds the `RoutingClient`. The routing service uses it to fill two gaps:

- **A message that tags no one:** pick one member agent, no one (the message asks for nothing), or ask a person.
- **A task that ends without a handoff:** pick the next agent, done, or ask a person, judged against the goal.

The client only sees what the caller passes in: the message or result, the goal, the member agents' names and purposes, and recent messages the members can already see. It can only pick from the agents it was given, so it can't add members or reach private context. Tags that people or agents make never go through it.

Each decision comes with a confidence from 0 to 1 and every option ranked. The caller acts alone only when the pick is an agent (or none, or done) and the confidence is at or above its threshold (0.6 for `gpt-6-luna`, from the CA-11 evaluation). Otherwise it saves a question and offers eligible member agents and No one. No delivery is created until a person chooses. Without an OpenAI key, or when a model call fails, it asks a person. Scheduled completions use the same waiting behavior.

Decisions have leases and revisions. A restart reclaims unfinished decisions; saving a decision,
its visible message and its delivery is atomic. Old tasks from before migration 024 are not
routed retroactively. Completed tasks with explicit outgoing agent deliveries bypass the model.
Automatic handoff chains stop after eight parents and ask a person. A done decision never closes
the endeavor; a person still confirms completion.

`GET /conversations/:conversationId/routing` returns visible decisions, newest first, with limit/offset pagination (50 by default).
`POST /conversations/:conversationId/routing/:decisionId/choice` takes `agentId` (null means
No one) and `revision`. Only members choose. Changing an automatic pick withdraws its pending
delivery or cancels the active task it created before delivering the replacement. Completed work
and external effects stay recorded. An update to an unrelated existing task cannot cancel that
task; stop it through the normal controls and send a directed request. A competing choice or
in-flight delivery assignment returns `routingConflict` (409); reload and retry.

The model sees only public member profiles, the shared goal, and recent messages after every
member's history boundary. Agents whose history excludes the source are not candidates.
It sees no private instructions, saved notes, connection credentials, or tool access. Membership
and enabled state are checked again when the decision is saved. Model, token usage, confidence,
and outcome are stored with the decision, and decisions are logged as `routing.decided`.
`ROUTING_MODEL` defaults to `gpt-6-luna`; calls have a 30-second deadline and do not retry.
The conversation shows the reason and a Change agent control, or choice buttons while waiting.

Two engines implement it:

- `RoutingDecisionModelClient`, the default: OpenAI's decision model `gpt-6-luna`. It returns a probability for each option, so confidence comes from the model, not from a number it writes down.
- `RoutingLanguageModelClient`: any OpenAI language model, asked for a probability per option. Use it with an OpenAI-compatible API that has no decision model.

`npm run routing:eval -w apps/api -- <cases.json> [engine ...]` compares engines on a labeled set of cases. The comment at the top of `apps/api/src/routing-eval.ts` describes the file format.

When a message reaches an agent:

- **The agent has an open task in this conversation** (working, waiting, or blocked): the message is added to that task. This never starts a second, competing run.
  - If the task is waiting for a reply from the message's author, the wait is resolved. An answer, a clarifying question, or "I can't help" all count as a reply.
  - If the task is blocked and the message is from a person, the task goes back to working. A person answering is the attention it needed.
- **Otherwise**: the message starts a new task for the agent. The task uses the agent's current configuration version and records the message that asked for it.

The database enforces at most one open task per agent and endeavor, including paused tasks.
Concurrent delivery attaches the losing message to the winning task as an update. Schedules skip
starts that would compete with that work; restarting finished work returns `taskStateConflict`
if the agent already has open work there. Another endeavor can have its own task for the same agent.
Migration `022_one_open_endeavor_task.sql` adds the constraint. It preserves all existing work:
if older data has duplicates, finish or explicitly cancel extra runs before applying it.

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

### Unread counts

Each person has a read marker per conversation: the last message they have seen. Opening an
endeavor in the web interface calls `PUT /conversations/:conversationId/read` with
`{ "messageId": "<newest message shown>" }`, and calls it again when a new message arrives while
the endeavor is open. The marker only moves forward (by `createdAt`, then `id`, the message
order), so a late or repeated call can't make newer messages unread. The response is
`{ conversationId, unreadCount }`.

`GET /conversations` adds `unreadCount` to each conversation: messages after your marker that
someone else wrote and that you are allowed to see. Messages you wrote never count. Conversations
you aren't a member of always show `0`, even though everyone can open them in v1. With no
marker yet, every visible message from others counts. When the read table was added, current
members started at the newest message, so old conversations didn't all light up.

The sidebar shows the count in a red badge and the name in bold. The endeavor you have open
shows no count.

`GET /directory` lists the enabled agents a person can discover: name, purpose, and capabilities (provider, model, and how many skills and connections). It never shows instructions, saved notes, credentials, or conversations. Agents call `find_agents(query)` to search enabled, configured agents outside the endeavor. The prompt contains no fixed directory list. Search covers name, purpose, skill names, what agents produce, and what input they need. It returns at most 10 public profiles (name, purpose, skill names, produces, needs), ranked by matching query words, with name matches weighted higher. Words match literal substrings, ignoring case; ties sort by name. Empty queries and queries over 500 characters are rejected. IDs, configurations, and private context are never returned. If one could help, the agent calls `suggest_participant`. That posts a suggestion to the people in the conversation; it doesn't add the agent or contact it. Seeing an agent in the directory doesn't let anyone message it outside a conversation.

## Inspecting an agent's work

Open Details, expand an agent, then choose History. The list contains only that agent's runs in
this Endeavor, newest first. Older runs are available through pagination. Selecting a run replaces
Details with its request, completion criteria, state, outputs and evidence, and readable execution
steps. Technical events are expandable. Back returns to the same agent's history; chat stays open.

The message action **See what this agent did** uses that message's stored task ID. It never guesses
the agent's latest run. A legacy message without a recorded task shows an unavailable explanation.
Existing task URLs and schedule run links continue to work: conversation runs open in their
Endeavor, while standalone runs remain inspectable through a read-only task page. There is no global
Work destination or replacement activity feed.

**Ask for changes** targets the owning agent in the conversation composer. For finished runs,
the composer explicitly identifies the run being revised and uses `POST /tasks/:taskId/restart`
with the draft as its reason. This preserves the previous result and criteria in a linked new run,
and repeat submissions return the same restart. The request is retained in the run's brief and
restart event. It does not also deliver a second agent message. For open work, revisions use ordinary
chat replies and mentions. Failed sends keep the draft. Pause, stop, resume, approval, result review,
restart, and configuration migration remain available in the inspector.

The web app shows every message tag, including participants addressed through agent tools. Tags
missing from the message text appear below it. Tags already written in the text are not repeated.
Typed and pasted mentions use the longest matching member name, so `@Research Bot` does not
also tag a member named `Research`. A separate `@Research` still addresses that member.

## What agents can do

Agents act only through these tools. The runner carries out each call:

| Tool                | What it does                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `send_message`      | Post a message. Addressed participants are notified.                                           |
| `ask`               | Ask one participant something, and wait for their reply.                                       |
| `save_output`       | Attach an output or piece of evidence to the task.                                             |
| `complete_task`     | Finish with a result. It is saved as an output, checked against the criteria, and posted back. |
| `report_blocked`    | Stop, and say what a person needs to do.                                                       |
| `list_files`        | List the files in the task's own workspace folder.                                             |
| `read_file`         | Read a text file from the workspace.                                                           |
| `write_file`        | Write a text file in the workspace. Paths can't leave it. See `docs/local.md`.                 |
| `find_agents`       | Search public profiles of up to 10 discoverable agents outside this endeavor. Grants nothing.  |
| `find_capabilities` | List skills and connections people made discoverable. Grants nothing.                          |
| `request_access`    | Ask a person for a discoverable skill or connection, for this task or ongoing. The task waits. |

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

Claimed tasks run in the background, up to the runner's concurrency limit. Polls keep
processing schedules, messages and approvals while those tasks wait on models; they only
claim additional tasks when a slot is free. A task's model turns still run in order.
Model turns record which events they saw. If an update arrives during a request or tool
batch, remaining actions from the older response are skipped so the next turn reads the
update. A follow-up during a completion check prevents that older result from completing.

Everything it does is written to the task's events: model turns, tool results, failed model calls, and messages received. The model transcript is rebuilt from those events, so after a restart the task picks up where it stopped. A tool call that was asked for but never run is run first. Message tool calls use the tool call ID as the message's `client_key`, so running a call again doesn't post twice.

The web composer also retains a failed submission's client key for an unchanged retry,
including when the server committed the message but its response was lost. Editing that failed
submission creates a distinct send. A successful send clears only the draft and reply context
that still match what was submitted; edits made while waiting remain in the composer.

Before each queued tool, the runner rechecks the task's working state, pause flag, pinned
configuration, and lease. Pausing, cancelling, or migrating the task stops the rest of the
batch and records those calls as skipped. Resuming rebuilds from those results rather than
automatically executing the skipped calls. The lease stays renewed during tools, including
completion checks. A worker that loses its lease stops without finalizing another worker's
pending calls. An action already issued to an outside system may still finish.

HTTP calls also have durable claims and bounded responses outside the batch event. Recovery
reuses a saved response; an interrupted claim with no response blocks unattended work for
human reconciliation. See [HTTP recovery](catalogs.md#connections).

Limits:

- Agent requests can start at most 20 successive tasks in a chain, raised from 5 to allow longer
  review loops (up to ten request/review exchanges). Updates to existing open tasks still arrive.
  At the limit, the runner posts a system reply asking a person to review and send a new request;
  it never silently drops the handoff. Per-task limits and conversation spending caps still apply.
- A task is blocked after 40 model turns, or at its agent version's own limits (`docs/agents.md`).
- A failed model call that can be retried waits 5 s, then 10 s. After 3 failures, the task is blocked.
- Each model request, including a completion check, has a `MODEL_TIMEOUT_MS` deadline
  (120 seconds by default). The remaining task working-time budget can shorten it. A model
  timeout uses the retry rule above; exhausting the task time budget blocks immediately.
- A completion provider failure is recorded as `completion.failed` and retries the same
  pending tool after 5 s, then 10 s. After three failures it blocks for a person; it is never
  recorded as a failed criteria verdict. Successful checks still save `completion.checked`.
- A model that keeps ending its turn without finishing gets two nudges, then the task is blocked.

During a model request, the runner polls task control and lease ownership about once a second
(more often for short leases). Pause, cancel, version migration, lease loss and server shutdown
cancel the request without consuming a provider retry. Provider abort signals stop supported
clients; a runner-side deadline also bounds clients that ignore cancellation. Late results
are discarded. Shutdown stops new polls, cancels model requests, and drains active tasks before
closing repositories.

## Live agent activity

Task list and detail responses include `activity`: a kind, plain detail, and `since` timestamp.
Only working, unpaused tasks have activity; other states return null. The task service derives
this from the newest relevant event, with one query for the tasks on a list page. The runner
records `model.started` before a model request and `tool.started` before each tool executes.
Messages and unrelated audit events do not reset the step's start time. Tool results and resumed
work return to thinking; old tasks without start events use a generic thinking detail.

The conversation polls tasks every four seconds. Above the composer it shows one line per busy
agent, pairing the design's playful label with the recorded plain detail and a ticking elapsed
time. Workspace file actions, capability discovery, output writing, completion checks, and
connection calls have known labels. Arbitrary MCP tools are described as connection calls;
the platform does not guess their purpose from tool names or use another model. Status events
contain only a tool name and a short file path or output title, never request bodies or headers.
Waiting, paused, approval, and stuck states keep plain words. Human typing is deferred in v1.

## Incremental chat history

The web chat opens with the latest 50 messages. Scrolling near the top loads an older batch,
keeping the visible message in place. Polls request messages after the newest loaded ID and
append them in batches of 50. Burst arrivals are drained over bounded polls; history already
loaded stays available. A reply to an unloaded message fetches earlier batches only when its
reference is clicked. New arrivals follow only when the viewer is within 80 pixels of the
bottom. Otherwise a new-message button returns to the latest messages. Read markers advance
only to messages intersecting the visible thread while the document is visible. Failed read
updates retry, and a conversation change discards late history or poll responses.

`GET /conversations/:conversationId/messages` retains the existing `{ data: Message[] }` response
and oldest-first `limit`/`offset` default. `latest=true` selects the newest window; `beforeId`
selects the preceding window, and `afterId` selects the next arrivals. Every window is returned
oldest first. These three modes cannot be combined or used with a nonzero offset. Cursor IDs
are exclusive and resolve to the stored timestamp plus ID, preserving order when timestamps
tie or have finer precision than browser dates. Invalid query combinations return
`validationError`; missing, cross-conversation, or hidden-history cursors return
`messageNotFound`. Membership and `historyFrom` apply to every window.

## Participant profiles

Message author names and avatars, and current members in People and agents, open a compact
profile card. The card shows the person's or agent's identity and available purpose. Agents
also show the directory's model, provider and access counts. View agent opens the existing
agent page; your own card links to profile settings. Deleted agents retain their attribution
without an agent-page link. Cards use already loaded member and directory data and make no
new API requests.

`ParticipantProfile.svelte` uses a native automatic popover for outside-click and Escape
dismissal. Cards appear in the browser's top layer, fit within the viewport and close when
the surrounding page scrolls. Close restores focus to the name or avatar that opened it.

Channel names are limited to 64 characters after normalization on creates and renames. The creation field shows this limit. Existing longer names remain intact and usable; renaming them requires a name within the limit. A database trigger enforces the limit for inserts and changed names, while allowing unrelated edits to older channels.

## Member handoff profiles (CA-98)

Agent members in conversation details include nullable `produces` and `needs`, `skillNames`
from their current configuration, and `status` (`idle` or `busy`). Busy means the agent has
a working, waiting, or blocked task in this endeavor, including paused work. Other
endeavors do not affect it. Deleted agents have empty profile fields and null status.
Human member responses are unchanged.

The task prompt lists the other members' purpose, skill names, handoff descriptions,
and status, with profile text kept on one line so it cannot create prompt headings.
The running agent's own peer profile is omitted. These public descriptions are current,
while each task keeps its own pinned instructions and configuration. No peer instructions,
notes, credentials, or connection details enter the prompt. Outside specialists are found with `find_agents`; only members are listed in the prompt.

### Projects and goals in the web app

Projects navigation opens a project overview without a chat feed. The overview lists open
endeavors first and keeps closed ones under Archived endeavors. Its other sections manage shared
knowledge sources, default members for new endeavors, and schedules whose destination endeavor
belongs to the project. Project creation, rename, archive, and restore use the existing project API.

New request starts an endeavor in the current project and posts the request as its first message.
The request becomes the goal and the API fills in done criteria. If posting fails after creation,
the dialog keeps the endeavor ID and retries that message with the same client key. Replies use
the existing endeavor composer. Edit goal changes the goal and done criteria; Confirm goal done
asks for confirmation before closing. Closed endeavors show their history with a Reopen endeavor
control instead of the composer. Global search includes open and closed endeavors.
