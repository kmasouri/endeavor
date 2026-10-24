# Agent history

The conversation-first history design Kayvan agreed on October 24, 2026. These are fixed mockups
with sample data, exported from the "Chat view redesign" board on claude.ai. They do not call the API or start agents.

- `conversation-details.html` + `.png`: the conversation with Details open. Researcher is expanded,
  with its last run and **History**. Hovering the final message shows **See what this agent did**.
- `researcher-history.html` + `.png` and `reviewer-history.html` + `.png`: each agent's own runs in
  this conversation.
- `run-details.html` + `.png`: one run. Its message stays marked in the chat while you look.

The board is the source. Change the board, then export again; don't edit these pages by hand.

## Agreed behavior

- Remove **Work** from main navigation. Do not replace it with a global Activity or Run history feed.
- Open history through **Conversation → Details → selected agent → History**.
- Show only runs owned by that agent in that conversation, newest first. Label the agent and
  conversation clearly. Selecting a run opens its request, completion criteria, status, outputs and
  evidence, and execution history. Raw technical events are expandable.
- A message's **See what this agent did** action opens its specific run, not the latest run or the
  agent's entire history. Back returns to the same agent's history. Keep chat visible during inspection.
- Direct agents and ask for revisions in chat. Do not add a separate **Direct this work** form to the
  inspector. Keep pause, stop, resume, approvals, and result review contextual to the conversation.
- Preserve task records, outputs, events, access boundaries, and execution semantics. Approvals still
  collects pending decisions; Schedules still manages recurring responsibilities. Existing task and
  schedule run links must still allow inspection, including runs without a conversation.

This reference refines history and run inspection. The existing [chat design](../README.md) still
defines compact agent rows, expanding only the selected agent, folding free agents, and hiding Details
by default. These mockups leave Details open to show the entry points. Use the shared
[style guide](../style-guide/README.md) when implementing it.

[CA-40](https://app.notion.com/p/4031a83d088f81be8b37ca3c556e539b) tracks implementation after
[CA-35](https://app.notion.com/p/4031a83d088f81ed9179e94c8903a35a), the broader chat redesign.
Saving these references does not complete either implementation ticket. Notion holds the ticket and
decision notes; the design files live here in the repo.
