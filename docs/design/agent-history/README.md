# Agent history

The conversation-first history design Kayvan agreed on October 24, 2026. This is a preview with
sample data, not the application. It does not call the API or start agents.

- Open `agent-history.html` directly in a browser. In **Details**, choose **History** under
  Researcher or Reviewer, then **View run**. Each agent has a separate history in this conversation.
- **See what this agent did** on a message opens that message's run directly. **Ask for changes**
  puts the feedback in the conversation composer.
- `agent-history.fragment.html` is the editable source. `agent-history.html` is its standalone
  export from the visualization skill's `scripts/render.py`. Export again after editing the source;
  do not edit the generated wrapper by hand. It works without Codex and follows the browser theme.
- `conversation-details.png` shows the entry points. `researcher-history.png` and
  `reviewer-history.png` show the separate histories. `run-details.png` shows a selected run.
  Screenshots use the dark theme.

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
by default. This preview leaves Details open to demonstrate the entry points. Use the shared
[style guide](../style-guide/README.md) when implementing it.

[CA-40](https://app.notion.com/p/4031a83d088f81be8b37ca3c556e539b) tracks implementation after
[CA-35](https://app.notion.com/p/4031a83d088f81ed9179e94c8903a35a), the broader chat redesign.
Saving these references does not complete either implementation ticket. Notion holds the ticket and
decision notes; the design files live here in the repo.
