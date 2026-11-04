# Architecture

A request passes through these layers, in this order:

```text
routes -> handlers -> services -> repositories -> data stores
                               -> integrations -> outside systems
```

Each layer has one job. Because of this split, you can test the business logic without starting a server or a database.

Endeavor is the current product name. See [rebrand compatibility](rebranding.md) for retained identifiers and design provenance.

## Where things live

```text
package.json               npm workspaces: apps/api and apps/web, plus scripts for both

apps/api/                  the API, runner, and scheduler (its own package.json)
  src/
    index.ts               starts the server
    app.ts                 builds the app: plugins, error handler, routes
    config.ts              reads and checks environment variables
    web.ts                 serves the built web interface at /app/

    routes/<feature>/        URLs: which method and path run which handler
    schemas/<feature>/       Zod schemas for request input, and their types
    handlers/<feature>/      read the request, call a service, send the response
    services/<feature>/      business logic, errors, logging
    data/<feature>/          repositories: read and write data
    integrations/<feature>/  call outside systems, like another company's API
    plugins/                 build each feature's service at startup
    observability/loggers/   one logger per feature, one method per event
    shared/                  types, response helpers, the error catalog
  db/schema/               SQL files that create the tables

apps/web/                  the web interface (Svelte 5 and Vite, its own package.json). Vite
                           builds it into apps/web/dist, and the API serves that at /app/.
                           It shares no code with the API and only calls its HTTP API.
pilot/                     scripts for the milestone pilots (docs/pilot.md)
docs/                      how the code works, and what the API returns
infrastructure/            Terraform for AWS
```

The API and the web interface are separate npm workspaces, so each has its own dependencies and config. Run commands from the repo root: `npm run check` runs lint, typecheck, build, and tests for both, and `npm run dev` and `npm run dev:web` start each one.

The web interface uses one Svelte component per page or form. Shared request and action state lives in `apps/web/src/state.svelte.ts`; hash navigation stays in `App.svelte`. Requests ignore answers from closed pages or older reloads, and polling stops when its component is removed. The typed HTTP client stays in `api.ts`. `svelte-check` checks components and TypeScript together. Web unit tests use Node's test runner with Svelte's compiler and browser runtime; they need no browser or database.
The committed Playwright suite in `apps/web/e2e/` exercises the production web build with a mocked
HTTP API. `npm run check` runs it locally, including browser setup. CI runs browser tests in
parallel with lint, type checks, workspace builds, and unit/pilot tests; the final `check` job
requires both jobs to pass. CI caches browser binaries and cancels superseded PR runs.
The suite checks core chat, configuration, approvals and navigation flows, alongside schedule
badge geometry, themes,
responsive layout, empty/error states, and keyboard navigation without starting agents or
requiring a database. Browser traces and screenshots are retained on failure. The
[browser coverage matrix](browser-tests.md) records covered behavior, design references and gaps.

Endeavors is the product-facing conversation destination. Its header search and native creation
modal live in the shared shell; the selected chat keeps its existing features and compatible hash
URL. Conversation names are canonical in backend storage: lowercase ASCII letters, numbers, and single
hyphens, with a decorative `#` only in navigation. Creation input and API create/rename requests
normalize names; migration 034 upgrades existing names and adds a database constraint. IDs and all
conversation relationships stay intact. Selection is remembered per person in browser storage and restored only from the current
accessible list. Paginated lists are fully loaded for restoration and search; old requests cannot
publish into another person's shell. A successful creation refreshes Recent and focuses the
composer. Optional initial human and agent members use the existing membership validation; no
message or agent invocation occurs during creation. See [conversations](conversations.md).

The sidebar stays mounted when collapsed, with a compact rail of navigation icons. Hovering
with a mouse or focusing a control with the keyboard expands it temporarily. The header toggle
pins it open. On narrow screens, the expanded sidebar overlays the page and navigation returns
it to the rail. Width and label transitions respect the browser's reduced-motion setting.
Recent endeavors and its New action appear only in the Endeavors view. Other sections retain
main navigation and show their own page content. Returning to Endeavors restores the last
accessible conversation for the selected person.

Agents uses the centered page frame, a searchable list, a separate creation page, and Overview,
Configuration, and Versions tabs. Configuration uses catalog search with chosen-item removal
and Undo. Version summaries are computed in the browser. The API returns skill identities
alongside pinned version IDs so an older pin remains editable. Configuration versions and their
added or revoked grants save in one SQL statement. A checked current-version ID rejects stale
concurrent edits. Ongoing grants add missing choices to a new configuration version. Task pins
remain explicit; the runner checks live grants before each call. See [agents](agents.md).

The web app imports `apps/web/src/design-tokens.css`, an exact copy of
`docs/design/style-guide/tokens.css`. A test checks that the copy stays in sync, so the Docker image
can build without the design documentation. `appearance.ts` applies the browser's
remembered theme before mounting the app. Shared avatars, icons, and page headers keep the shell
and feature pages consistent. The sidebar name opens Profile and settings. Switch person opens
a native modal with a dimmed backdrop and large avatar tiles. Person records store theme and hour
format, defaulting to system
appearance and 12-hour time. The browser keeps a theme copy for startup and restores authoritative
preferences from the API on reload or person switch. System appearance follows changes to the
computer's theme. `time-display.svelte.ts` formats message and run timestamps in the device timezone.
It changes no stored instants or schedule rules. Schedules uses one centered 1,220px page frame
for its header, actions, and content. An empty state provides the creation action while cancelled schedules stay folded below; populated rows
align their metadata and reflow based on the page width. It separates source calendar summaries
from viewer-local next-run and history instants. Calendar recurrence stores a named source timezone,
local time, frequency, and optional ISO weekdays alongside durable UTC slots. The task service
computes source dates through clock changes, skipping gaps and choosing the earlier repeated instant.
The existing scheduler and run keys retain restart recovery and missed-run handling; a partial
unique index also prevents different starts from creating competing open runs for one responsibility.
See `docs/scheduling.md` for API compatibility and migration steps. `profile-state.svelte.ts` keeps separate drafts for
the two settings tabs, retains failed saves for retry, and guards navigation and person switching
until edits are saved or discarded. `PATCH /humans/me` updates only the selected person's profile
and preferences, preserving identity and message ownership.

The conversation page owns its messages, tasks, outputs, approval requests, and spending resources.
Details starts closed. Messages render a small Markdown subset as Svelte text nodes, including
safe HTTP links (including plain URLs and www addresses), emphasis, code, lists, and highlighted mentions. Raw HTML stays text. Typing `@`
opens the member picker; adding a directory agent uses the membership API before sending a mention.
Reply actions preserve the source message ID. Run steps load on the first expansion and remain cached when folded. The chat shows a short list of recorded actions, with all steps and manual refresh available on demand. Raw event names and tool response bodies remain in the full run inspector. Step lists use the conversation scroll area rather than a nested scroller. Generic Result records that repeat an agent message stay in task
inspection; the conversation shows the answer once, without a duplicate card or steps control.
Named outputs, files, links, distinct content, and pending reviews keep their artifact cards. Artifact cards use task
review when review is pending; requests for changes return to the conversation composer.

Run inspection lives in the conversation's Details panel. Agent History requests both conversationId
and ownerAgentId from the task API, newest first, with explicit pagination. Message actions use the
recorded taskId; legacy messages without a run association show an unavailable state. The inspector
keeps chat visible and shows the request, criteria, state, outputs, readable steps, and expandable
technical events. Event loading follows afterId through every page. Pending decisions, result review,
pause, stop, resume, restart, version migration, and task access remain available in context.

Ask for changes focuses the conversation composer. For completed or cancelled work it sends the
composer text to the existing restart API, preserving its linked-new-run and retry semantics rather
than creating an unrelated message-triggered task. The composer identifies the selected run and agent;
a failed send retains the draft. Open work receives ordinary directed chat messages.

Work is no longer in navigation. Existing task links open their exact run in its conversation;
standalone runs keep a read-only inspector at the existing task URL. No task records or API access
rules changed. Live steps derive from task events in the task service and appear above the composer. Human
typing, pause attribution, spending by agent, and draft/final labels remain follow-up work.

Code is grouped by layer first, then by feature. For example, all handlers are in `handlers/`, and the item handlers are in `handlers/items/`. We chose this over one folder per feature because:

- Each file does one job, so files stay small.
- You can see a whole layer at a glance. `routes/` alone is the full list of URLs.
- The import rules below are easy to check, because each rule is about a folder.

The cost is that one endpoint is spread over a few files. `docs/adding-a-feature.md` lists which ones.

## Layers

| Folder           | What goes here                                                                                                               | Why it's separate                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `routes/`        | The URL and HTTP method for each endpoint, and which schema and handler it uses. Swagger `description` and `tags`.           | The router file reads like a table of contents for the API.                                                              |
| `schemas/`       | Zod schemas that check request input, with the TypeScript type made from each one.                                           | Routes need the schemas and handlers need the types. A shared folder lets both use them without depending on each other. |
| `handlers/`      | Read the request, call one service, send the response.                                                                       | Keeps HTTP details out of the business logic.                                                                            |
| `services/`      | The business logic. For example, a name that is already taken throws `itemNameTaken`. Services also log events.              | Business logic can be tested with plain values, no server or database.                                                   |
| `data/`          | Repositories: everything that reads or writes data, such as SQL, caches, Databricks, or file storage.                        | The rest of the app doesn't care where data is kept. Tests swap in a mock.                                               |
| `integrations/`  | Calls to any outside system that isn't storage: another company's API, an LLM, email, payments, and so on.                   | The rest of the app doesn't care how the outside system works. Tests swap in a mock.                                     |
| `plugins/`       | Build each feature's repositories, integrations, logger, and service when the app starts, and attach the service to Fastify. | All the wiring for a feature is in one place.                                                                            |
| `observability/` | Loggers for now. Metrics and tracing can go here later.                                                                      | Log names and fields stay the same everywhere.                                                                           |
| `shared/`        | Data types, response helpers, and the error catalog.                                                                         | Every layer needs these, so they can't live in any one layer.                                                            |

A repository has two parts: an interface that lists the methods services can call, and a class that does the real work, such as running SQL. Services only know about the interface. Repositories never make business decisions.

The `items` feature is an example that uses every layer. It uses the `webhooks` integration. Replace it or delete it when you build your own features. To add a feature, follow `docs/adding-a-feature.md`.

A feature only needs the layers it uses. `healthcheck` has a route and a handler, but no schema, service, or repository, because it has no input, no logic, and no data.

## Who can import what

Imports only go one way, down the list:

```text
routes       -> schemas, handlers
handlers     -> schemas (types only), services through request.server
services     -> data, integrations, observability, feature rule helpers (never service classes)
data         -> (nothing but shared)
integrations -> (nothing but shared)
schemas      -> (nothing but shared)
everything   -> shared
```

`plugins/` is the one place that imports repositories, integrations, loggers, and services together, because its job is to connect them.

These rules keep each layer easy to change without breaking the ones above it. Lint enforces the important ones:

- Routes and handlers can't import from `data/` or `integrations/`. Only services use them.
- Service classes can't import other service classes. Services may import feature-owned `.rules.ts` helpers.
- Repositories and integrations can only import from `shared/`.
- Handlers can't import from `routes/`.
- Schemas can't import from any other layer.

## Checking input with Zod

Zod checks all request input. It replaces Ajv, the checker Fastify uses by default. `apps/api/src/app.ts` sets this up once:

```ts
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);
```

The same Zod schemas also produce the API docs. Swagger UI is at `GET /docs`, and the raw OpenAPI JSON is at `GET /docs/json`.

Each feature keeps its schemas in `schemas/<feature>/<feature>.schemas.ts`. Each schema has a TypeScript type made from it, right below it:

```ts
export const createItemBodySchema = z.strictObject({
  name: z.string().trim().min(1),
  description: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type CreateItemBody = z.infer<typeof createItemBodySchema>;
```

The route uses the schema. The handler uses the type:

```ts
// routes/items/items.ts
fastifyInstance.post(
  '/items',
  {
    schema: {
      description: 'Create an item.',
      tags: ['items'],
      body: createItemBodySchema
    }
  },
  createItemHandler
);

// handlers/items/items.ts
export async function createItemHandler(
  request: FastifyRequest<{ Body: CreateItemBody }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const item = await request.server.itemService.createItem(request.body);
  return reply.code(201).send(success(item));
}
```

Both come from the same schema, so the checks and the types always match.

By the time the handler runs, Zod has already cleaned the input. Default values are filled in (`.default(50)`), strings are turned into numbers (`z.coerce.number()`), and text is trimmed (`.trim()`).

Query strings and URL params are always strings. Use `z.coerce.number()` when you need a number from them.

Routes do not check their responses yet. To add that, put a schema under `schema.response`. If a response does not match it, the client gets a 500 error.

## Integrations

An integration wraps one outside system that a service needs, such as the OpenAI API, an email provider, or a payment provider. Use `data/` for storing and reading data, and `integrations/` for everything else outside the app.

An integration works like a repository. It has two parts: an interface that lists the methods services can call, and a class that does the real work. Services only know about the interface.

- It gets its settings, like a URL or API key, in its constructor. The plugin reads them from `config`.
- The plugin builds it and passes it to each service that needs it.
- It is never attached to Fastify, so handlers can't call it.
- It throws when the call fails, and makes no business decisions. The service decides what a failure means.

`webhooks` is the working example. `WebhookHttpClient` POSTs events to `WEBHOOK_URL`. `ItemService` sends `item.created` after it saves an item. If the webhook fails, the item is already saved, so the service logs `item.webhook.failed` and still returns the item:

```ts
// plugins/item.ts
const webhookClient = new WebhookHttpClient(config.WEBHOOK_URL);
const itemService = new ItemService(itemRepository, webhookClient, new ItemLogger(fastify.log));
```

Service tests mock the interface with `jest.fn()`, the same way as a repository. The client's own test mocks `fetch`, so no real calls are made.

## Services never use each other

A service class never imports another service class. Share data access through repositories and outside calls through integrations, and give those dependencies to each service. Share business rules through feature-owned `.rules.ts` helpers that work on plain values and import only shared contracts or packages. This keeps services free of import loops and keeps their tests small.

## Plugins

Plugins create each feature's objects when the app starts and attach them to the Fastify app. For example, `itemPlugin` creates `ItemPostgresRepository`, `WebhookHttpClient`, and `ItemLogger`, passes them to `ItemService`, and attaches only `itemService`.

Only services use repositories. Routes and handlers never touch them, and lint fails if they try to import from `apps/api/src/data`. If a service needs another feature's data, the plugin passes it that feature's repository too. The same goes for integrations.

Each plugin also tells TypeScript about these new fields (with `declare module 'fastify'`). It lists the plugins it needs (with `fp(..., { dependencies })`), so the app fails at startup if they are loaded in the wrong order.

Handlers are plain functions, not plugins. They get services through `request.server`:

```ts
const item = await request.server.itemService.getItem(request.params.itemId);
```

## Logging

Each feature has a logger with one method per event. The service gets it in its constructor and calls it after something happens:

```ts
this.itemLogger.onItemCreated();
```

Every log line still gets the request ID. The `@fastify/request-context` plugin remembers which request is running, and `getCurrentLogger()` in `apps/api/src/observability/loggers/request-logger.ts` picks up that request's logger. Outside a request, such as at startup, it uses the app logger instead.

Every event log has an `event` field:

```json
{ "event": "item.created" }
```

Event names are lowercase, with dots between words, and start with the feature name. Logger methods are named `onThingHappened()`.

## Responses and errors

The full response format, for API clients, is in `docs/responses.md`. In short:

```jsonc
// success
{ "data": { "id": "1f0c...", "name": "Widget" } }

// list
{ "data": [], "page": { "limit": 50, "offset": 0, "total": 132 } }

// error
{ "error": { "code": 20002, "name": "itemNotFound", "message": "...", "requestId": "8f3c..." } }
```

Handlers use `success(data)` or `paged(items, { limit, offset, total })` from `apps/api/src/shared/response.ts`. Error responses are built only by the error handler in `apps/api/src/app.ts`.

Every error has its own `code` and `name`. The full list, with what each one means, is in `docs/errors.md`. The list itself lives in `apps/api/src/shared/errors.ts`.

Services throw errors by name from that list:

```ts
throw new AppError('itemNotFound', `Item ${itemId} was not found`);
```

Fastify catches any error thrown in a handler or service and passes it to the error handler in `apps/api/src/app.ts`, which turns it into the error response above. It also handles errors that don't come from our code:

- Bad request input from Zod becomes `validationError`.
- Fastify's own request errors become `invalidRequest`, `payloadTooLarge`, or `unsupportedMediaType`.
- An unknown URL becomes `routeNotFound`.
- Anything else becomes `internalError`. The client only sees "Unexpected server error". The real error goes to the log, with the request ID.

Handlers should not catch errors just to format them.

Every response includes the request ID in a header. The header name comes from `REQUEST_ID_HEADER` and is `x-request-id` by default. If the caller sends an ID, the app uses it. If not, the app makes a new one.

## Tasks

A task is one run of work by one agent. `TaskService` owns every change to a task, and the rules for which state changes are allowed are in `apps/api/src/services/tasks/task-state.ts`. The product rules behind them are on the Architecture page in Notion.

- **Compare and set.** `TaskRepository.update()` only writes if the task still has the state and pause flag the service read. If another change got there first, the service throws `taskStateConflict` instead of overwriting it.
- **History.** Every change adds a row to `task_events`, and rows there are never changed. This is the execution history the API shows. The runner will also use it to pick up where a task left off.
- **No duplicates.** Every task has a unique `run_key`. Creating a task with a key that already exists returns the existing task.
- **Leases.** The runner claims working tasks with `claimRunnable()`. If the service stops, the lease runs out and the task can be claimed again.

### Sharing lifecycle rules between services

Two services change tasks: `TaskService`, for the API and human actions, and `TaskRunnerService`, the runner acting for agents. Services never use each other, so both use `TaskLifecycle` (`apps/api/src/services/tasks/task-lifecycle.ts`). It is a helper inside the tasks feature, not a service, and it holds the rules for state changes, waits, outputs, and completion. Keep business rules in the service layer even when several features use them. Put reusable rules in feature-owned `<name>.rules.ts` files: `services/access/access.rules.ts` for human authorization, `services/conversations/addressing.rules.ts` for message recipients, `services/conversations/goal.rules.ts` for default done criteria, and `services/connections/connection-access.rules.ts` for connection calls. Services import these helpers directly, including across feature folders; do not export them through the service barrel. Rule helpers work on plain values and import only shared contracts or packages, which lint enforces. They never load records, call providers, log, or import service classes.

`shared/` holds cross-layer contracts and infrastructure: types, response helpers, and the error catalog. Conversation-name normalization stays there because both input schemas and services use it. The OAuth session type stays there because repositories, integrations, and services use that contract. Usage by several services alone is not a reason to put business rules in `shared/`.

How messages become work is in `docs/conversations.md`.

## Projects and endeavors

A **project** is a long-lived group of endeavors (`ProjectService`, `services/projects/`). It holds knowledge sources, the notes agents save for it, and default people and agents that join every new endeavor in it. It has no messages of its own. An **endeavor** is a conversation with one goal: `ConversationService` gives it a `projectId`, a `goal`, `doneCriteria`, and an open or closed `state`.

- The project and conversation services never call each other. Both use `ProjectRepository`, and both use `DocumentRepository` (`data/projects/`).
- The default done criteria come from `services/conversations/goal.rules.ts`. Migration `021_projects.sql` builds the same text for older conversations.
- One project has `is_default`. Endeavors created without a `projectId` go there, so older clients keep working. It can't be archived.
- Every model turn loads the endeavor's current goal and done criteria before the task request.
  Agents finish their own tasks and may propose goal completion; only people close endeavors.
- Migration `022_one_open_endeavor_task.sql` enforces one open task per agent and endeavor,
  including paused work. A concurrent message delivery joins the winning task. Run-key retries
  still find their original task; conflicting restarts are rejected and schedule starts are skipped.
- Documents and notes carry a `project_id`. The runner asks the repositories for what one conversation may see, and the queries work out its project. See `docs/notes.md`.

## Configuration

Every environment variable is listed in one Zod schema in `apps/api/src/config.ts`. The rest of the code reads settings from the `config` object it exports. If a value is wrong, the app stops at startup and names the bad variable.

The `.env` file is loaded only when `ENVIRONMENT=local`. Everywhere else, settings come from real environment variables.

## Database

The app uses Postgres through `@fastify/postgres`. It only connects when the first query runs, so the app and its tests can start without a database.

If `DATABASE_URL` is set, the app uses it and ignores `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, and `DATABASE_PASSWORD`.

Table definitions are SQL files in `apps/api/db/schema/`. `000_schema.sql` creates the Postgres schema, and the other files create the tables in it. `npm run db:migrate` (`apps/api/src/migrate.ts`) runs them in filename order, each in its own transaction, and records each one in `schema_migrations` so it runs only once. Each file creates one feature's tables in their current form. To change a table, add a new file; never edit one that has been merged. If the ledger lists a file that no longer exists, the runner stops: the database was built from older files and needs a rebuild (see `docs/local.md`).

## Tests

Each test file sits next to the file it tests and ends in `.test.ts`. Shared test fakes end in `.test-helper.ts`. Neither is included in the production build.

- Service tests replace repositories and integrations with Jest mocks, so they need no database.
- Route tests build the app with `setupApp()` and send requests with `app.inject()`. They check input validation, error responses, request IDs, and Swagger, all without a database.

For building, releases, and deployment, see `README.md` and `infrastructure/README.md`.

## Skills and connection access

Skill versions store reusable instructions only. The catalog API rejects structured connection associations. Agent configurations select skill versions and connection IDs independently. The runner builds its connection list from the task's explicit configuration and checks live grants, enabled state, method/path limits, and action approvals on every call. Skill instructions and retired metadata cannot authorize tools.

Legacy skill-to-connection columns remain as immutable history, outside the skill API contract. Agent repositories report inherited-only IDs as `legacyConnectionIds` for human review, never for authorization. No grants or task pins are changed during rollout. A person explicitly reviews connection selections and migrates affected work. See [catalog compatibility](catalogs.md#moving-from-inherited-connections-ca-37).

Permanent agent deletion keeps an internal identity for historical foreign keys while removing
its current configuration and all future work. The agent repository commits the identity change,
run and schedule cancellation, wait closure, approval rejection, and grant revocation in one
transaction. Runner model and tool execution holds shared advisory locks; deletion waits on the
exclusive lock. Task and schedule triggers serialize changes against the agent row and reject
new or resumed work for deleted identities. See [permanent deletion](agents.md#permanent-deletion).

## Remote MCP connections

Connections have an immutable type: HTTP API or remote MCP server. Existing rows default to
HTTP. The connection service owns tool discovery for people; the runner discovers and executes
only tools allowed by the connection and the agent's live access. `McpClient` is an integration
interface. Plugins build `McpHttpClient` and pass it to both services. Model adapters remain
provider-neutral and never execute tools themselves.

MCP approvals use the existing durable connection-call approval workflow, with a typed request
containing the tool, arguments, and endpoint. They are separate from HTTP method approvals.
The runner checks access again after approval and refuses a changed endpoint. Unattended
calls record their start and result so restart recovery never silently repeats an action.
See [MCP connections](catalogs.md#remote-mcp-tools-ca-64) for setup, limits, and compatibility.

### Remote connection OAuth

The connection service starts and completes browser OAuth through the MCP SDK integration.
The connection service and runner each receive the encrypted OAuth session repository and OAuth client
from their plugins. They do not call another service. Session transitions hold a database
transaction lock so workers cannot rotate the same refresh token concurrently or restore
credentials after a completed disconnect. Existing catalog grants, tool allowlists, approvals,
and task history still govern all agent calls. See [OAuth setup](catalogs.md#oauth-sign-in-ca-65).

## Capability discovery and access requests (CA-38)

People mark skills and connections `discoverable`. Agents call `find_capabilities` to see those
entries (name, description, and scope only) and `request_access` to ask a person. A request is
an approval of kind `capability_access`, so it uses the same durable list, visibility rules,
decision endpoints, and recovery as call approvals. The task waits on it like any approval.

A person approves for the task (the default) or ongoing. The runner applies an approved
request on its next tick, after checking the task is still waiting and the capability is still
enabled. It records a `task_capabilities` row: the exact skill version, or the connection scope
narrowed to what the connection allows now. This adds access to the waiting task without
changing its pinned configuration version. Ongoing access also adds the item to the agent's
configuration as a new version, with its grant, through the same rules as
`POST /agents/:agentId/grants`. Each step is safe to repeat after a crash.

`loadUsableCatalog` merges the task's active capabilities with its configured skills and
connections. Task-only entries need no agent grant and end with the task. Ongoing entries also
need the agent's live grant, so removing the item from the configuration takes it away from the
task too. Added connections are limited to the overlap of the approved and current scopes, and
every call still passes enabled-state, method/path or tool, and per-call approval checks.

## Isolated execution (CA-78)

`apps/executor` is an optional, separate trusted service. The task runner reaches it as an MCP
connection, through existing grants and approvals, and supplies trusted task identity in a
transport header. Its GitHub integration resolves immutable snapshots only from an operator
repository allowlist. Commands reuse a task-scoped Docker container, created lazily on the first command, with
no network, credentials, or mounts, and explicit resource limits. The main app has no Docker
socket. The broker alone controls Docker and persists validated snapshots and execution
summaries in a separate volume. Versioned records are validated on load; corrupt or unsupported
records are quarantined with a durable per-task unavailable marker. Healthy tasks still load, and
the affected task requires operator repair or explicit discard before reuse. Explicit file edits are synchronized before the next command;
generated files and background processes stay in the live container. Containers expire after 30 idle
minutes; accepted source expires after 24 idle hours. Shutdown and restart remove containers; the
next command restores accepted source, not caches or processes. It never runs repository code in its
own process or filesystem.

The broker has its own Zod tool schemas, HTTP adapter, execution service, and GitHub/Docker
integrations. This is a third npm workspace; `npm run check` covers all three. Coding and review
examples are editable agent instructions, not privileged platform roles. See [coding](coding.md)
for trust boundaries, offline dependency images, cancellation limits, and recovery.

Connection authentication method is stored independently from enabled state. The connection
service derives a credential-free authentication summary for list/detail responses from the
stored method and encrypted OAuth session. The web interface combines enabled and authentication
state into one badge: Disabled, Authentication required, or Enabled, in that order of precedence.
It sends OAuth creation directly to consent through the
saved connection page. Failed consent retries reuse that connection. See [authentication
status](catalogs.md#authentication-choice-and-status).

## Skill and connection services

Skills and connections are shared product catalogs with separate application services in
one API process. `SkillService` owns instruction-only skills, immutable versions, discovery
settings, and enabled state. It receives a `SkillRepository`, human access checks, and a
`SkillLogger`; it has no connection, credential, MCP, OAuth, or agent dependencies.

`ConnectionService` owns connection management, authentication summaries, OAuth sign-in,
and MCP tool discovery. Its plugin provides a `ConnectionRepository`, encrypted OAuth
session storage, and the external clients. `GrantService` owns the existing grant and revoke
endpoints. It uses skill, connection, grant, and agent repositories directly to preserve
atomic agent configuration updates without calling either management service.

Each service has its own plugin and logger. Existing log event names and HTTP contracts
remain unchanged. The focused repository interfaces share `CatalogPostgresRepository` as
their SQL implementation. `CatalogRepository` combines those interfaces for task execution
and agent configuration, which need both capability types and live grants. No database
migration or separate deployment is needed for these service boundaries.
