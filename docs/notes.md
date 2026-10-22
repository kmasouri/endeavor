# Context, saved notes, and knowledge sources

**Context** is what goes into a model for one turn. It isn't stored anywhere as its own thing. For each task, the runner builds it from these parts, each labeled the same way in prompts, the API, and the UI:

| Label                      | What it is                                                                     | Example                                             | Who controls it                               |
| -------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------- | --------------------------------------------- |
| Instructions               | How the agent should behave, from its configuration version.                   | "Investigate billing issues and cite your sources." | Admins                                        |
| Knowledge sources          | Documents people attach to a conversation, and connections to outside sources. | A refund policy document.                           | The source's owners                           |
| Conversation history       | Messages the agent may see in this conversation.                               | "Kim: please summarize the billing changes"         | Everyone in the conversation                  |
| Saved notes (agent memory) | What the agent wrote down for later work. May be incomplete or wrong.          | "Yesterday's check ruled out the payment gateway."  | The agent writes; people inspect, fix, delete |

## Saved notes

- Agents save notes only with the `save_note` tool. What people say never becomes a note on its own.
- **Scope keeps contexts apart.** A note saved in a conversation only shows up in that agent's tasks in that same conversation. A note saved outside any conversation, or one an admin widens to `scope: "agent"`, shows up in all of the agent's tasks.
- The newest 20 notes in scope go into the prompt under `## Saved notes (agent memory)`, with their date and who saved them, plus a warning that they may be wrong.
- `GET /agents/:agentId/notes` lists notes with their origin. Admins see them all. Members see notes from their conversations, plus agent-wide ones.
- `PATCH` corrects a note; only admins change its scope. `DELETE` hides it and records who deleted it. Changes apply on the agent's next run.

## Knowledge sources

- `POST /conversations/:id/documents` attaches a document (title and text) for the agents in that conversation. Agents can read documents but never change them, and documents are never mixed up with notes.
- Up to 20,000 characters of documents go into the prompt under `## Knowledge sources`.
- Outside sources the agent should look things up in are connections (`docs/catalogs.md`).

Retrieval is newest-first for now. Search by relevance is a later improvement.
