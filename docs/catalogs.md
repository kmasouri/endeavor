# Skills, connections, and grants

People keep two shared catalogs. Being in a catalog gives no agent access. Choosing an entry in an agent configuration grants access; removing it and saving revokes access. The runner enforces these choices through per-agent grants.

## Creating catalog entries

The **Create skill** and **Create connection** buttons open dedicated pages at
`#/skills/new` and `#/connections/new`. They share the new-agent page's
layout: a back link, heading, grouped fields, and a sticky Cancel/Create footer.
Cancel and successful saves return to the matching catalog list. Failed saves keep the
entered values and show the error on the form. Connection creation includes Profile,
Authentication, and Access sections for both HTTP APIs and MCP servers.

## Skills

A skill is a named piece of guidance for a kind of work, such as "Billing lookup: use the Billing connection for invoice counts". Each skill has versions that never change once saved. A version contains instructions only. Mentioning an outside service in those instructions grants no access.

- A skill's instructions aren't the agent's own instructions, and they aren't a knowledge source. The prompt labels them `## Skills`.
- Choosing a skill in an agent's configuration (`skillIds` on `POST /agents` or `/agents/:id/config`) pins the skill's current version into the agent's configuration version. Later skill edits don't change running work; save the agent's configuration again to pick them up.
- Choosing a skill grants its instructions to the agent. It never selects or grants connections. Creating, editing, or upgrading a skill leaves connection choices and grants unchanged.
- `POST /skills` accepts `name`, `description`, and `instructions`. `POST /skills/:id/versions` accepts `instructions`. Both reject the retired `connectionIds` field, including an empty array. Skill responses and version history omit it.

## Connections

A connection is an outside service: an HTTP API or a remote MCP server. Both have an endpoint, an auth header, and an optional credential. HTTP connections limit methods and path prefixes. MCP connections limit named tools; see [Remote MCP tools](#remote-mcp-tools-ca-64).

- The credential is encrypted with AES-256-GCM using `CREDENTIALS_KEY`, and is never returned by the API. `hasCredential` shows whether one is stored. Without `CREDENTIALS_KEY`, saving a credential fails with `credentialsKeyMissing`.
- Agents call HTTP connections through the `http_request` tool. The platform adds the credential, doesn't follow redirects, keeps the path on the connection's host, and cuts responses off at 20,000 characters.

Each HTTP call has a durable claim in `http_calls`, keyed by task and tool call ID. Only the
worker that inserts the claim may send it. A hash binds the claim to the connection, endpoint,
method, path and body without storing credentials or the request body in the claim. The bounded
response is saved before audit or batch results. Recovery reuses that response after checking
live access; it never sends that call ID again, even if approval policy changes.

A claim without a response has an unknown outcome, including a crash just before dispatch,
a timeout after a remote write, or a failure saving the response. Unattended work is blocked
for a person to check the external service. After checking, resume with instructions to accept
the observed outcome or explicitly request a new attempt. Resuming does not reset the original
claim. Calls from older builds with a `connection.called` event but no saved response also need
reconciliation. A pre-upgrade request that left no durable evidence cannot be identified.
No provider-specific idempotency header is invented; each provider has its own contract.

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

The Approvals page opens on Pending. History shows approved and rejected requests, newest
decision first, with the reason and recorded result. Both views load every API page.

A connection's `approvalMethods` (for example `["POST", "DELETE"]`) are methods that need a person's approval before each call. If you leave it out when creating a connection, every allowed method except GET needs approval: reading is free, and changing anything waits for a person. Send `[]` to need no approvals. A matching call is never made right away:

1. The runner saves a pending approval with the exact request, the task waits, and the agent's turn ends.
2. `GET /approvals?status=pending` lists it for every person, since v1 has one role. Agents can never approve.
3. On `POST /approvals/:id/approve`, the runner checks access again (it may have been revoked meanwhile), makes the call once, records the result on the approval, gives the result to the agent, and wakes the task. The call is claimed before it is made, so a crash can never make it twice.
4. On `POST /approvals/:id/reject`, the call is never made. The agent is told the reason, and its task wakes up.

A second decision on the same approval gets `approvalAlreadyDecided`.

## Discovery and access requests (CA-38)

A person can mark a skill or connection **discoverable** (`discoverable: true` on create,
`PATCH /skills/:skillId`, or `PATCH /connections/:connectionId`; the catalog shows a checkbox).
Entries are private by default. Discovery shows agents only the name, description, skill
version, and connection scope. It never shows credentials or connected content, and it grants
nothing.

1. An agent calls `find_capabilities` to list enabled, discoverable entries and see whether it
   can already use each one.
2. It calls `request_access` with the type, name, and a plain-language reason. It may recommend
   a duration and say why. The request records the exact skill version or the connection's
   current scope. The task waits, and the request appears in the conversation and on the
   Approvals page as an access request, separate from approving one action.
3. A person chooses **For this task** (the default) or **Ongoing**, then **Allow for this task**,
   **Allow ongoing**, or **Don't allow** (`POST /approvals/:id/approve` with
   `duration: "task" | "ongoing"`, or `POST /approvals/:id/reject`). Only people can decide.
   The capability must still be enabled, and the task must still be waiting.
4. The runner adds the access to the waiting task as a recorded task capability, without
   changing the task's pinned version. For ongoing access it also adds the item to the agent's
   configuration as a new version, with its grant. Then the task wakes with the decision.

Rules:

- Task-only access belongs to that agent and task. It survives pauses, waits, and restarts of
  the service, and ends when the task completes or is cancelled. It never carries over to other
  agents, follow-up tasks, restarted tasks, or later scheduled runs.
- Ongoing access is part of the agent's configuration, so recurring responsibilities can use it
  without asking on every run. Remove it from the configuration to take it away; that also
  takes it away from tasks that got it through the request.
- A pending request for the same capability and task is reused. After a decline, the agent is
  told not to ask again for that task. A stale request for a finished task adds nothing.
- A connection added to a task is limited to the overlap of the approved scope and its current
  scope, so later catalog edits can narrow it but never widen it. Ongoing access follows the
  connection's current scope like any configured connection.
- Every call still passes the live checks above, and per-call action approvals still apply.
  Approving access never runs an action that was waiting for approval.
- `GET /tasks/:taskId/capabilities` lists the access added to a task, and
  `DELETE /tasks/:taskId/capabilities/:capabilityId` revokes it from the next call. The task page
  shows both. Task events record the request (`access.requested`), the decision, the added
  access (`access.granted`, `access.ongoing.added`), and revocations (`access.revoked`).

## Not yet

- Explicitly supplied documents, and knowledge-source connections beyond plain HTTP calls, come with saved notes and context (CA-21).

## Remote MCP tools (CA-64)

Connections support two types: `http` (the default for existing API clients) and `mcp`.
A connection's type is fixed at creation. Both types use the same encrypted credentials,
agent configuration selections, live grants, enable/disable controls, and task history.

An MCP connection's `baseUrl` is its full remote MCP endpoint, such as
`https://tools.example.com/mcp`. It uses Streamable HTTP through the official MCP client
SDK, with protocol negotiation and compatibility with 2025 servers. JSON and SSE responses
are supported. `authHeader` and `credential` work as they do for HTTP connections; for bearer
authentication, save the full `Bearer …` value. Redirects are refused. Servers needing browser sign-in can use [OAuth](#oauth-sign-in-ca-65).

Create an MCP connection with:

```json
{
  "kind": "mcp",
  "name": "Records",
  "description": "Look up and create records",
  "baseUrl": "https://tools.example.com/mcp",
  "allowedTools": ["lookup", "create"],
  "approvalTools": ["create"]
}
```

- `allowedTools` contains exact, case-sensitive server tool names. There are no wildcards.
  An empty list grants no tools and lets a person save the endpoint before discovery.
- Omitting `approvalTools` requires approval for every allowed tool. An explicit empty list
  permits unattended calls. Server annotations never decide the platform's approval policy.
- `POST /connections/:connectionId/tools` discovers tools for the acting person without
  executing them or granting access. It returns `success([{ name, description, inputSchema }])`.
  The connection must be enabled. In the web catalog, open **Discover and manage tools**,
  discover, select allowed tools and approval requirements, then save. Discovery alone
  does not change agent access.
- `PATCH /connections/:connectionId` accepts `allowedTools` and `approvalTools` for MCP
  connections. Adding allowed tools without supplying an approval policy makes the new
  tools require approval. HTTP method/path fields are rejected on MCP connections, and
  MCP tool fields are rejected on HTTP connections. `kind` cannot be patched.
- Agents receive only allowed tools, with the server's descriptions and input schemas.
  Their model-facing names include a stable connection ID and tool-name hash, fitting the
  model provider's name limit and avoiding collisions across servers. HTTP's `http_request`
  cannot call MCP connections.
- Calls recheck explicit task-version selection, live grant, enabled state, and allowed tool
  name. The client validates arguments with Zod against the discovered schema before calling
  the server. Unsupported schema conversions fail discovery. Discovery failure leaves the
  other platform tools available and records `connection.discovery.failed`.
- A pending approval stores the tool name, exact arguments, endpoint, and credential header.
  After approval, the runner checks access again and refuses a changed endpoint or header.
  It claims the approval before execution, records the result, and wakes the task through
  the existing recovery path. An approval authorizes one call and never grants a connection.
- Unattended calls record `connection.mcp.started` before contacting the server, followed
  by `connection.mcp.result`. Recovery reuses a recorded result. If the service stopped
  between those events, the outcome is unknown: the call is not repeated automatically.
  Check the external system before requesting another action.

Each client operation has a 30-second deadline. Individual HTTP responses are capped at
2 MB; results returned to the agent are capped at 20,000 characters. Discovery is limited
to 20 pages and 1,000 tools; each connection can allow up to 100 tool names. Credentials
are not included in model definitions, approval requests, or transport failure messages.
Tool arguments and results are recorded as task evidence and should not contain secrets.

Local stdio servers, MCP resources/prompts, deferred tasks,
server-initiated sampling, and interactive elicitation are outside this increment.

### Local verification

The MCP client test starts a real local HTTP server and verifies handshake, paginated
discovery, JSON/SSE results, exact arguments, invalid arguments, failed authentication,
and redirect refusal. Runner tests cover unattended reads, pending and approved actions,
revocation, disabled connections, changed endpoints, removed tools, paused/cancelled tasks,
and restart recovery. The browser test creates an MCP connection, discovers tools, saves
permissions, and checks the approval's exact arguments.

Run these without an external account, model API key, or database:

```bash
npm test -w apps/api -- --runInBand mcp-http.client.test.ts task-runner.service.test.ts
npm run test:e2e -w apps/web -- connections.test.ts
```

## Managing the catalogs

Skills and Connections have separate sidebar entries at `#/skills` and `#/connections`.
Their lists use the same centered frame, status filters, search, and create action as Agents.
Search checks names and descriptions; connection search also checks the endpoint URL.
All pages of each catalog are loaded before filtering, including disabled entries.

Open a row to configure it at `#/skills/:id` or `#/connections/:id`. Skill changes create a
new instruction version. Connection details keep credential replacement/removal and MCP
tool discovery and access settings together on a dedicated page. Enable and disable
controls show failed requests without changing the displayed status.

Creation uses `#/skills/new` and `#/connections/new`. Older `#/catalogs` links, including
`?tab=connections` and the original creation URLs, still open the matching destination.

## OAuth sign-in (CA-65)

Set `APP_PUBLIC_URL` to the browser origin used to open Endeavor, for example
`http://localhost:3100`. It must be HTTPS, or HTTP on localhost. Do not derive it from
request headers. Keep `CREDENTIALS_KEY` stable. Apply migration 014 before starting the app.

Create an MCP connection with its endpoint and an empty tool list. Open its connection configuration page, then
open **Sign in with OAuth**, then **Sign in**. The browser opens the service's consent page
and returns to that connection. **Refresh status**, **Reconnect**, and **Disconnect** manage the
login. Notion's hosted endpoint is `https://mcp.notion.com/mcp`.

OAuth uses the installed MCP SDK for protected-resource and authorization-server discovery,
dynamic client registration, S256 PKCE, resource indicators, and callback issuer validation.
The service must publish protected-resource metadata and support dynamic client registration.
Pre-registered client IDs and client metadata documents are not configured in this increment.
Metadata and token requests refuse redirects, require HTTPS except loopback test servers,
and have a 30-second deadline and a 2 MB body cap.

The callback is bound to the connection endpoint, initiating person, random single-use state,
and a separate HttpOnly SameSite cookie. It expires after ten minutes. Callback query strings
are removed from request logs. Reconnect replaces the pending flow; old callbacks fail.
The return address is fixed by server configuration. Tokens, refresh tokens, client secrets,
PKCE verifiers, and discovery state are encrypted together in `connection_oauth`. The API
returns status and expiry only. Database transaction locks serialize refresh and disconnect
across workers, including refresh-token rotation.

Discovery and task calls refresh expiring tokens before use. An expired token without a
refresh token, failed refresh, or server 401 requires human sign-in again. Pending consent
is preserved if a task tries to run meanwhile. Calls are not retried after authentication
failure; task history and the existing unknown-outcome rule stay intact.

Signing in never grants an agent access, selects tools, changes approval rules, or migrates
task configuration versions. After consent, discover tools, allow only those needed, and
explicitly select the connection in the agent configuration. OAuth uses the consenting
account's provider permissions. One connection holds one shared provider login: every
agent granted that connection uses the same account. The initiating Endeavor person's ID
is an audit record, not a separate provider identity for each agent or requester. For shared
enterprise work, prefer a dedicated account with the required content permissions when
the provider supports it. Per-user connections and delegated requester identities are not
implemented here. A tool allowlist or an agent instruction does not restrict
which Notion pages that account can read. Verify the provider account's actual page access
before claiming that a connection is scoped to one knowledge base.

Disconnect removes the local tokens and pending callback. It preserves grants and history,
and blocks OAuth calls. It does not revoke the provider's consent; revoke that in the
provider's settings if needed. Disconnect before replacing the header credential or endpoint.
Existing HTTP and header-auth MCP connections continue to work without OAuth.

Verification uses a real local OAuth server and mocked repositories, plus production browser
coverage. No external account or database is needed for the tests. A real Notion sign-in
still requires the person to complete consent in their browser.

## GitHub and isolated execution (CA-78)

The connection creation form includes GitHub MCP and Isolated execution examples. Both save
ordinary MCP connections with no allowed tools by default. Discover tools, choose permissions
and approvals, then explicitly select each connection in the agent configuration. GitHub
authentication currently uses a bearer token, since its remote server does not support dynamic
client registration. See [GitHub coding and review](coding.md) for setup and execution limits.

MCP discovery and calls made by the task runner include `X-Endeavor-Task-Id`, derived from the
authorized task rather than model input. The execution service uses it to isolate checkouts
and execution evidence. Catalog discovery has no task identity and grants no workspace access.
Approval execution retains the original task identity. Other MCP services may ignore the header.

Server output remains untrusted data. The MCP protocol envelope is checked by the SDK. Its
optional structured output schema is checked with Zod when representable; vendor schemas
that Zod cannot convert remain opaque data. Tool input schemas and arguments still must
convert and validate before transport. Server metadata is excluded from model results, and
identical content repeated in structuredContent is emitted only once.

### Authentication choice and status

Connection creation offers No authentication, API key / token, and (for MCP) OAuth sign-in.
The Notion example fills its endpoint and selects OAuth. **Create and sign in** first saves
one connection, then opens its configuration page and starts browser consent. If setup or
consent fails, retry Sign in on that saved connection; it is not created again. Token fields
are hidden for OAuth and any previously typed token is omitted from the create request.

The catalog list and detail header show one connection status: **Disabled** when switched
off, **Authentication required** when enabled but authentication is missing, or **Enabled**
otherwise. Disabled takes precedence even if credentials are saved or missing. Public
connections need no authentication to show Enabled. The enable/disable control and OAuth
controls stay in configuration. OAuth controls appear expanded near the top of an OAuth
connection. An empty tool list still allows no tools after authentication.

Migration 015 records the authentication method. Existing OAuth sessions become OAuth
connections; existing saved header credentials remain header authentication; other existing
connections retain anonymous access. Requests omitting authMethod remain compatible.
Choosing OAuth does not fall back to an old header credential when a session is absent.
The list and detail read stored authentication state without contacting the provider.
For header authentication, satisfied authentication means a credential is saved; it is not a live
validation of the provider or a guarantee that every tool call will succeed. OAuth expiry
without a refresh token requires authentication again; a renewable login remains authenticated
until renewal or a provider response establishes that sign-in is required.
