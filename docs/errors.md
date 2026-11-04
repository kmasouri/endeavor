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

Codes are grouped by feature: `10xxx` general, `20xxx` items, `30xxx` people and access, `40xxx` tasks, `50xxx` agents, `60xxx` conversations and projects, `70xxx` catalogs, `80xxx` notes. A code never changes or gets reused once it ships.

The list lives in `apps/api/src/shared/errors.ts`. When you add an error there, add it here too. A test fails if this page is missing one.

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

| Code  | Name                      | HTTP | What it means                                                                                  | How to fix it                                                        |
| ----- | ------------------------- | ---- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 40001 | `taskNotFound`            | 404  | No task has this ID.                                                                           | Check the ID against `GET /tasks`.                                   |
| 40002 | `taskStateConflict`       | 409  | The task's state doesn't allow this, like resuming a task that isn't paused.                   | Get the task to see its state, then pick an allowed action.          |
| 40003 | `taskCompletionRejected`  | 422  | The task can't complete: it has no output, or its criteria were not met.                       | Attach an output and check it against the completion criteria first. |
| 40004 | `taskWaitNotFound`        | 404  | No open wait matches. It may already be resolved.                                              | Get the task to see its open waits.                                  |
| 40005 | `approvalNotFound`        | 404  | No approval has this ID, or you can't see its task.                                            | Check `GET /approvals`.                                              |
| 40006 | `approvalAlreadyDecided`  | 409  | Someone already approved or rejected it.                                                       | Get the approval to see the decision.                                |
| 40007 | `responsibilityNotFound`  | 404  | No responsibility has this ID.                                                                 | Check `GET /responsibilities`.                                       |
| 40008 | `responsibilityCancelled` | 409  | The responsibility is cancelled; it can't run or resume.                                       | Create a new responsibility.                                         |
| 40010 | `catchUpNotPending`       | 409  | No open "run now or wait?" question. It was answered, or it lapsed when the next run came due. | Check the schedule; nothing more is needed.                          |
| 40009 | `responsibilityRunOpen`   | 409  | The last run is still working, waiting, or blocked. Only one runs at a time.                   | Wait for it to finish, or cancel that task first.                    |
| 40011 | `taskCapabilityNotFound`  | 404  | No access with this ID was added to this task.                                                 | Check `GET /tasks/:taskId/capabilities`.                             |

## Agents (50xxx)

| Code  | Name                   | HTTP | What it means                                              | How to fix it                                     |
| ----- | ---------------------- | ---- | ---------------------------------------------------------- | ------------------------------------------------- |
| 50001 | `agentNotFound`        | 404  | No agent has this ID.                                      | Check the ID against `GET /agents`.               |
| 50002 | `agentUnavailable`     | 409  | The agent is disabled, or has no saved configuration.      | Enable the agent, or save a configuration for it. |
| 50003 | `agentNameTaken`       | 409  | Another agent has this name. Names are not case sensitive. | Pick a different name.                            |
| 50004 | `agentVersionNotFound` | 404  | The version doesn't exist, or belongs to another agent.    | Pick an ID from `GET /agents/:agentId/versions`.  |

## Conversations (60xxx)

| Code  | Name                     | HTTP | What it means                                                                                  | How to fix it                                                                                |
| ----- | ------------------------ | ---- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 60001 | `conversationNotFound`   | 404  | No conversation has this ID.                                                                   | Check the ID against `GET /conversations`.                                                   |
| 60002 | `notConversationMember`  | 403  | You are not a member of this conversation.                                                     | Ask a member to add you.                                                                     |
| 60003 | `mentionNotMember`       | 422  | A mention names someone who isn't in the conversation.                                         | Add them first, or remove the mention.                                                       |
| 60004 | `messageNotFound`        | 404  | The message being replied to isn't in this conversation.                                       | Check `inReplyToMessageId`.                                                                  |
| 60005 | `participantNotFound`    | 404  | The person or agent being added doesn't exist.                                                 | Check the ID against `GET /humans` or `GET /agents`.                                         |
| 60006 | `suggestionNotAvailable` | 422  | An agent suggested an agent that isn't in the directory, or is disabled.                       | The agent sees this as a tool error and can pick another name.                               |
| 60007 | `agentNotInConversation` | 422  | The agent must be in the conversation first, such as before it can report there on a schedule. | Add the agent to the conversation.                                                           |
| 60008 | `projectNotFound`        | 404  | No project has this ID, or you can't see it.                                                   | Check the ID against `GET /projects`.                                                        |
| 60009 | `projectArchived`        | 409  | The project is archived, so no new endeavors start in it.                                      | Restore it with `PATCH /projects/:projectId` and `archived: false`, or pick another project. |
| 60010 | `defaultProjectArchive`  | 409  | The default project takes endeavors started without a project, so it can't be archived.        | Leave it active.                                                                             |
| 60011 | `conversationClosed`     | 409  | The endeavor is closed, so it takes no new messages.                                           | Reopen it with `POST /conversations/:conversationId/reopen`.                                 |

## Catalogs (70xxx)

| Code  | Name                             | HTTP | What it means                                                                                     | How to fix it                                                                                               |
| ----- | -------------------------------- | ---- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 70001 | `skillNotFound`                  | 404  | No skill has this ID.                                                                             | Check the ID against `GET /skills`.                                                                         |
| 70002 | `connectionNotFound`             | 404  | No connection has this ID.                                                                        | Check the ID against `GET /connections`.                                                                    |
| 70003 | `catalogNameTaken`               | 409  | Another skill or connection already has this name. Names ignore case.                             | Pick a different name.                                                                                      |
| 70004 | `catalogEntryUnavailable`        | 409  | The skill or connection is disabled, or the skill has no version.                                 | Enable it, or choose another.                                                                               |
| 70005 | `credentialsKeyMissing`          | 409  | A credential was sent, but `CREDENTIALS_KEY` isn't set, so it can't be stored safely.             | Set `CREDENTIALS_KEY` to 32 random bytes (base64 or hex) and restart.                                       |
| 70006 | `toolAccessDenied`               | 403  | An agent's tool call was refused: no active grant, or a method or path that isn't allowed.        | Agents see this as a tool error. Grant access, or widen the connection's rules.                             |
| 70007 | `connectionSignInRequired`       | 409  | OAuth authentication is unavailable or expired.                                                   | Sign in again from Catalogs.                                                                                |
| 70008 | `connectionOAuthFailed`          | 400  | OAuth sign-in could not complete.                                                                 | Check server setup and reconnect.                                                                           |
| 70009 | `connectionOAuthCallbackInvalid` | 400  | The callback is expired or does not match its browser, connection, or state.                      | Start sign-in again from Catalogs.                                                                          |
| 70010 | `connectionCallOutcomeUnknown`   | 409  | An HTTP call was claimed but its response is unavailable, or its request changed during recovery. | Check the external service. Resume with reconciliation instructions; request a new attempt only explicitly. |

## Notes and documents (80xxx)

| Code  | Name               | HTTP | What it means                                            | How to fix it                                                                                 |
| ----- | ------------------ | ---- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 80001 | `noteNotFound`     | 404  | No note has this ID, or you can't change it.             | Check `GET /agents/:agentId/notes`.                                                           |
| 80002 | `documentNotFound` | 404  | No document has this ID in this project or conversation. | Check `GET /projects/:projectId/documents` or `GET /conversations/:conversationId/documents`. |

## Task workspaces (90xxx)

Agents see these as tool results when a file tool call fails. They aren't returned by the HTTP API today.

| Code  | Name                    | HTTP | What it means                                                         | How to fix it                                     |
| ----- | ----------------------- | ---- | --------------------------------------------------------------------- | ------------------------------------------------- |
| 90001 | `workspacePathInvalid`  | 422  | The path leaves the task's workspace, is absolute, or names a folder. | Use a relative path inside it, like `notes/a.md`. |
| 90002 | `workspaceFileNotFound` | 404  | No file or folder at that path in this task's workspace.              | Call `list_files` to see what's there.            |
| 90003 | `workspaceFileTooLarge` | 422  | The file is over the 1 MB write limit.                                | Split it into smaller files.                      |
| 90004 | `workspaceFileNotText`  | 422  | The file isn't text, so it can't be read as text.                     | Only read text files.                             |

## Routing decisions (85xxx)

| Code | Name | HTTP | Meaning |
| --- | --- | --- | --- |
| 85001 | `routingNotFound` | 404 | Routing decision not found or hidden by the member history boundary. |
| 85002 | `routingConflict` | 409 | The decision changed or a worker is assigning delivery. Reload and retry. Updates to unrelated existing work must be stopped through the normal task controls. |
