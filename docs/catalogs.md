# Skills, connections, and grants

People keep two shared catalogs. Being in a catalog gives no agent access. Choosing an entry in an agent configuration grants access; removing it and saving revokes access. The runner enforces these choices through per-agent grants.

## Skills

A skill is a named piece of guidance for a kind of work, such as "Billing lookup: use the Billing connection for invoice counts". Each skill has versions that never change once saved. A version contains instructions only. Mentioning an outside service in those instructions grants no access.

- A skill's instructions aren't the agent's own instructions, and they aren't a knowledge source. The prompt labels them `## Skills`.
- Choosing a skill in an agent's configuration (`skillIds` on `POST /agents` or `/agents/:id/config`) pins the skill's current version into the agent's configuration version. Later skill edits don't change running work; save the agent's configuration again to pick them up.
- Choosing a skill grants its instructions to the agent. It never selects or grants connections. Creating, editing, or upgrading a skill leaves connection choices and grants unchanged.
- `POST /skills` accepts `name`, `description`, and `instructions`. `POST /skills/:id/versions` accepts `instructions`. Both reject the retired `connectionIds` field, including an empty array. Skill responses and version history omit it.

## Connections

A connection is an outside HTTP API: a base URL, an auth header, an optional credential, the HTTP methods allowed, and the path prefixes allowed.

- The credential is encrypted with AES-256-GCM using `CREDENTIALS_KEY`, and is never returned by the API. `hasCredential` shows whether one is stored. Without `CREDENTIALS_KEY`, saving a credential fails with `credentialsKeyMissing`.
- Agents call connections through the `http_request` tool. The platform adds the credential, doesn't follow redirects, keeps the path on the connection's host, and cuts responses off at 20,000 characters.

## Grants and revocation

`POST /agents/:id/grants` grants ongoing access to a skill or connection and adds it to configuration as a new version when needed; `DELETE /agents/:id/grants/:type/:targetId` revokes it. Every `http_request` call is checked at the moment it runs. The connection must be:

1. explicitly chosen in the task's configuration version (`connectionIds`),
2. granted to the agent right now,
3. enabled, and
4. allow the method and path (`apps/api/src/shared/connection-access.ts`).

So a revoke, a disabled connection, or a narrower path list applies on the very next call. That holds even for tasks on an older configuration version. Revoked or disabled skills drop out of the prompt on the task's next run.

## Moving from inherited connections (CA-37)

Deploy the API and web interface together. No data migration is required: new skill versions leave the retired database column at its empty default. Older `skill_versions.connection_ids` remain stored as immutable history. They never authorize calls and are omitted from skill API responses.

Stored agent versions, task pins, credentials, and grants stay unchanged. There are no bulk grants, revokes, or automatic task migrations during rollout. Later configuration saves apply the removal and re-selection rules above. Explicit connections continue to work, subject to live checks. An old task that depended only on an inherited connection cannot call it after rollout. The model is told to explain the missing capability and ask a person through the existing conversation flow; it must never claim it used unavailable access.

Agent version responses include `legacyConnectionIds`: distinct connections listed by old pinned skill versions but absent from the explicit connection list. This is review information only, including disabled or revoked entries. The configuration form names these connections and version history flags affected versions. This field is never accepted as configuration input or used to authorize calls. No dependency checklist or consent flow is added to skill assignment.

Before resuming affected work, a person should:

1. Review the warning on the agent's configuration and explicitly select any connections still needed. Disabled connections must be enabled separately first.
2. Save a new agent configuration. Newly chosen entries receive grants, including entries removed and saved earlier. Removing a choice revokes its grant for open tasks too. Unchanged choices preserve an explicit API revocation; use `POST /agents/:id/grants` to restore one directly. Configuration and changed grants save in one statement.
3. Move each affected open task to the reviewed version with `POST /tasks/:taskId/version`. Until then, its original pin stays unchanged and inherited-only calls remain unavailable. Restart finished tasks to use the current version.

New skill versions contain no associations, so upgrading skills can remove historical review information. Review the old agent version in history when transitioning. Connection choices still never change automatically. The pilot setup selects each agent's connections explicitly; existing pilot agents must be reviewed using the steps above.

## Approvals

A connection's `approvalMethods` (for example `["POST", "DELETE"]`) are methods that need a person's approval before each call. If you leave it out when creating a connection, every allowed method except GET needs approval: reading is free, and changing anything waits for a person. Send `[]` to need no approvals. A matching call is never made right away:

1. The runner saves a pending approval with the exact request, the task waits, and the agent's turn ends.
2. `GET /approvals?status=pending` lists it for every person, since v1 has one role. Agents can never approve.
3. On `POST /approvals/:id/approve`, the runner checks access again (it may have been revoked meanwhile), makes the call once, records the result on the approval, gives the result to the agent, and wakes the task. The call is claimed before it is made, so a crash can never make it twice.
4. On `POST /approvals/:id/reject`, the call is never made. The agent is told the reason, and its task wakes up.

A second decision on the same approval gets `approvalAlreadyDecided`.

## Not yet

- Explicitly supplied documents, and knowledge-source connections beyond plain HTTP calls, come with saved notes and context (CA-21).
