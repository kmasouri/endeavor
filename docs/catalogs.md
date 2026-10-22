# Skills, connections, and grants

Admins keep two shared catalogs. Being in a catalog gives no agent access: access comes from per-agent **grants**.

## Skills

A skill is a named piece of guidance for a kind of work, such as "Billing lookup: use the Billing connection for invoice counts". Each skill has versions that never change once saved, and each version can list connections the skill uses.

- A skill's instructions aren't the agent's own instructions, and they aren't a knowledge source. The prompt labels them `## Skills`.
- Choosing a skill in an agent's configuration (`skillIds` on `POST /agents` or `/agents/:id/config`) pins the skill's current version into the agent's configuration version. Later skill edits don't change running work; save the agent's configuration again to pick them up.
- Choosing a skill also grants it to the agent.

## Connections

A connection is an outside HTTP API: a base URL, an auth header, an optional credential, the HTTP methods allowed, and the path prefixes allowed.

- The credential is encrypted with AES-256-GCM using `CREDENTIALS_KEY`, and is never returned by the API. `hasCredential` shows whether one is stored. Without `CREDENTIALS_KEY`, saving a credential fails with `credentialsKeyMissing`.
- Agents call connections through the `http_request` tool. The platform adds the credential, doesn't follow redirects, keeps the path on the connection's host, and cuts responses off at 20,000 characters.

## Grants and revocation

`POST /agents/:id/grants` grants a skill or connection; `DELETE /agents/:id/grants/:type/:targetId` revokes it. Every `http_request` call is checked at the moment it runs. The connection must be:

1. chosen in the task's configuration version, directly or through a chosen skill,
2. granted to the agent right now,
3. enabled, and
4. allow the method and path (`src/shared/connection-access.ts`).

So a revoke, a disabled connection, or a narrower path list applies on the very next call. That holds even for tasks on an older configuration version. Revoked or disabled skills drop out of the prompt on the task's next run.

## Approvals

A connection's `approvalMethods` (for example `["POST", "DELETE"]`) are methods that need a person's approval before each call. A matching call is never made right away:

1. The runner saves a pending approval with the exact request, the task waits, and the agent's turn ends.
2. `GET /approvals?status=pending` lists it for admins, members of the task's conversation, and the person who asked for the task. Others get 404.
3. On `POST /approvals/:id/approve`, the runner checks access again (it may have been revoked meanwhile), makes the call once, records the result on the approval, gives the result to the agent, and wakes the task. The call is claimed before it is made, so a crash can never make it twice.
4. On `POST /approvals/:id/reject`, the call is never made. The agent is told the reason, and its task wakes up.

A second decision on the same approval gets `approvalAlreadyDecided`.

## Not yet

- Explicitly supplied documents, and knowledge-source connections beyond plain HTTP calls, come with saved notes and context (CA-21).
