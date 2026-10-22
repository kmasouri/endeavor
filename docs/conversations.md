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

Only people add members. Adding a member with `history: "from_now"` hides older messages from them. An agent can't add anyone: if it needs a specialist, it asks a person.

## What agents can do

Agents act only through these tools. The runner carries out each call:

| Tool             | What it does                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `send_message`   | Post a message. Addressed participants are notified.                                           |
| `ask`            | Ask one participant something, and wait for their reply.                                       |
| `save_output`    | Attach an output or piece of evidence to the task.                                             |
| `complete_task`  | Finish with a result. It is saved as an output, checked against the criteria, and posted back. |
| `report_blocked` | Stop, and say what a person needs to do.                                                       |

Every directed request gets an answer in the conversation. That is the result from `complete_task`, the reason from `report_blocked`, or a message from the runner when the platform itself can't go on, such as a missing API key or a model that declined.

## The runner

The runner is not an agent and makes no decisions about the work. It runs in the server, every `RUNNER_INTERVAL_MS`. Each tick it:

1. Turns pending deliveries into new tasks or updates.
2. Wakes waiting tasks whose waits are all resolved.
3. Claims working tasks with a lease, and runs up to 8 model turns on each.

Everything it does is written to the task's events: model turns, tool results, failed model calls, and messages received. The model transcript is rebuilt from those events, so after a restart the task picks up where it stopped. A tool call that was asked for but never run is run first. Message tool calls use the tool call ID as the message's `client_key`, so running a call again doesn't post twice.

Limits:

- A task is blocked after 40 model turns.
- A failed model call that can be retried waits 5 s, then 10 s. After 3 failures, the task is blocked.
- A model that keeps ending its turn without finishing gets two nudges, then the task is blocked.

Budgets and per-agent limits come with CA-5.
