# Error codes

Every error response has a `code` and a `name` from this list. Clients should check `code` (or `name`), not the message; messages can change.

```json
{
  "error": {
    "code": 20002,
    "name": "itemNotFound",
    "message": "Item 1f0c... was not found",
    "requestId": "8f3c..."
  }
}
```

Codes are grouped by feature: `10xxx` general, `20xxx` items, `30xxx` people and access, `40xxx` tasks, `50xxx` agents, `60xxx` conversations. A code never changes or gets reused once it ships.

The list lives in `src/shared/errors.ts`. When you add an error there, add it here too. A test fails if this page is missing one.

## General (10xxx)

| Code  | Name                   | HTTP | What it means                                                          | How to fix it                                                      |
| ----- | ---------------------- | ---- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 10000 | `internalError`        | 500  | Something broke on our side.                                           | Try again later. If it keeps happening, report the `x-request-id`. |
| 10001 | `validationError`      | 400  | Some input was wrong. `details` lists each bad field.                  | Fix the fields listed in `details`.                                |
| 10002 | `routeNotFound`        | 404  | No endpoint matches this method and URL.                               | Check the method and URL against `/docs`.                          |
| 10003 | `invalidRequest`       | 4xx  | The request could not be read, for example the body is not valid JSON. | Send a well-formed request.                                        |
| 10004 | `payloadTooLarge`      | 413  | The request body is too large.                                         | Send a smaller body.                                               |
| 10005 | `unsupportedMediaType` | 415  | The `Content-Type` is not supported.                                   | Send `Content-Type: application/json`.                             |

## Items (20xxx)

| Code  | Name            | HTTP | What it means                                                        | How to fix it                                 |
| ----- | --------------- | ---- | -------------------------------------------------------------------- | --------------------------------------------- |
| 20001 | `itemNameTaken` | 409  | An item with this name already exists. Names are not case sensitive. | Pick a different name.                        |
| 20002 | `itemNotFound`  | 404  | No item has this ID.                                                 | Check the ID. The item may have been removed. |

## People and access (30xxx)

| Code  | Name            | HTTP | What it means                                         | How to fix it                                  |
| ----- | --------------- | ---- | ----------------------------------------------------- | ---------------------------------------------- |
| 30001 | `actorNotFound` | 401  | The `x-actor-id` header does not name a known person. | Send the ID of a person from `GET /humans`.    |
| 30002 | `forbidden`     | 403  | The acting person's role does not allow this action.  | Ask an admin to do it, or to change your role. |

## Tasks (40xxx)

| Code  | Name                     | HTTP | What it means                                                                | How to fix it                                                        |
| ----- | ------------------------ | ---- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 40001 | `taskNotFound`           | 404  | No task has this ID.                                                         | Check the ID against `GET /tasks`.                                   |
| 40002 | `taskStateConflict`      | 409  | The task's state doesn't allow this, like resuming a task that isn't paused. | Get the task to see its state, then pick an allowed action.          |
| 40003 | `taskCompletionRejected` | 422  | The task can't complete: it has no output, or its criteria were not met.     | Attach an output and check it against the completion criteria first. |
| 40004 | `taskWaitNotFound`       | 404  | No open wait matches. It may already be resolved.                            | Get the task to see its open waits.                                  |

## Agents (50xxx)

| Code  | Name                   | HTTP | What it means                                              | How to fix it                                     |
| ----- | ---------------------- | ---- | ---------------------------------------------------------- | ------------------------------------------------- |
| 50001 | `agentNotFound`        | 404  | No agent has this ID.                                      | Check the ID against `GET /agents`.               |
| 50002 | `agentUnavailable`     | 409  | The agent is disabled, or has no saved configuration.      | Enable the agent, or save a configuration for it. |
| 50003 | `agentNameTaken`       | 409  | Another agent has this name. Names are not case sensitive. | Pick a different name.                            |
| 50004 | `agentVersionNotFound` | 404  | The version doesn't exist, or belongs to another agent.    | Pick an ID from `GET /agents/:agentId/versions`.  |

## Conversations (60xxx)

| Code  | Name                    | HTTP | What it means                                            | How to fix it                                        |
| ----- | ----------------------- | ---- | -------------------------------------------------------- | ---------------------------------------------------- |
| 60001 | `conversationNotFound`  | 404  | No conversation has this ID.                             | Check the ID against `GET /conversations`.           |
| 60002 | `notConversationMember` | 403  | You are not a member of this conversation.               | Ask a member to add you.                             |
| 60003 | `mentionNotMember`      | 422  | A mention names someone who isn't in the conversation.   | Add them first, or remove the mention.               |
| 60004 | `messageNotFound`       | 404  | The message being replied to isn't in this conversation. | Check `inReplyToMessageId`.                          |
| 60005 | `participantNotFound`   | 404  | The person or agent being added doesn't exist.           | Check the ID against `GET /humans` or `GET /agents`. |
