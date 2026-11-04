# Context, saved notes, and knowledge sources

**Context** is what goes into a model for one turn. It isn't stored anywhere as its own thing. For each task, the runner builds it from these parts, each labeled the same way in prompts, the API, and the UI:

| Label                      | What it is                                                                     | Example                                             | Who controls it                               |
| -------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------- | --------------------------------------------- |
| Instructions               | How the agent should behave, from its configuration version.                   | "Investigate billing issues and cite your sources." | People                                        |
| Knowledge sources          | Documents people attach to a project or one endeavor, and connections to outside sources. | A refund policy document.                           | The source's owners                           |
| Conversation history       | Messages the agent may see in this conversation.                               | "Kim: please summarize the billing changes"         | Everyone in the conversation                  |
| Saved notes (agent memory) | What the agent wrote down for later work. May be incomplete or wrong.          | "Yesterday's check ruled out the payment gateway."  | The agent writes; people inspect, fix, delete |

## Saved notes

- Agents save notes only with the `save_note` tool. What people say never becomes a note on its own.
- **Scope keeps contexts apart.** A note saved in an endeavor gets `scope: "project"`: it shows up in that agent's tasks in every endeavor of the same project, and never in another project. A note saved outside any conversation, or one a person widens to `scope: "agent"`, shows up in all of the agent's tasks.
- Notes saved before projects existed keep `scope: "conversation"`: only their own endeavor sees them. Every existing conversation moved into one General project, so widening them all would have mixed their details together. A person can widen one to `project` or `agent`.
- The newest 20 notes in scope go into the prompt under `## Saved notes (agent memory)`, with their date and who saved them, plus a warning that they may be wrong.
- `GET /agents/:agentId/notes` lists notes with their origin and `projectId`. Every person sees them all, since v1 has one role. `GET /projects/:projectId/notes` lists every agent's project notes in one project.
- `PATCH` corrects a note or changes its scope. `DELETE` hides it and records who deleted it. Changes apply on the agent's next run.

## Knowledge sources

- `POST /projects/:projectId/documents` attaches a document (title and text) for every endeavor in the project. `POST /conversations/:id/documents` attaches one for that endeavor only (`conversationId` is set). Agents can read documents but never change them, and documents are never mixed up with notes.
- `GET /conversations/:id/documents` lists what that endeavor's agents see: its project's shared documents and its own. `GET /projects/:projectId/documents` lists only the shared ones.
- Documents attached before projects existed stay limited to their own endeavor.
- Up to 20,000 characters of documents go into the prompt under `## Knowledge sources`.
- Outside sources the agent should look things up in are connections (`docs/catalogs.md`).

Retrieval is newest-first for now. Search by relevance is a later improvement.
