# Architecture

A request passes through these layers, in this order:

```text
routes -> handlers -> services -> repositories -> data stores
                               -> integrations -> outside systems
```

Each layer has one job. Because of this split, you can test the business logic without starting a server or a database.

## Where things live

```text
src/
  index.ts                 starts the server
  app.ts                   builds the app: plugins, error handler, routes
  config.ts                reads and checks environment variables

  routes/<feature>/        URLs: which method and path run which handler
  schemas/<feature>/       Zod schemas for request input, and their types
  handlers/<feature>/      read the request, call a service, send the response
  services/<feature>/      business logic, errors, logging
  data/<feature>/          repositories: read and write data
  integrations/<feature>/  call outside systems, like another company's API
  plugins/                 build each feature's service at startup
  observability/loggers/   one logger per feature, one method per event
  shared/                  types, response helpers, the error catalog

db/schema/                 SQL files that create the tables
docs/                      how the code works, and what the API returns
infrastructure/            Terraform for AWS
```

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
services     -> data, integrations, observability (never other services)
data         -> (nothing but shared)
integrations -> (nothing but shared)
schemas      -> (nothing but shared)
everything   -> shared
```

`plugins/` is the one place that imports repositories, integrations, loggers, and services together, because its job is to connect them.

These rules keep each layer easy to change without breaking the ones above it. Lint enforces the important ones:

- Routes and handlers can't import from `data/` or `integrations/`. Only services use them.
- Services can't import other services.
- Repositories and integrations can only import from `shared/`.
- Handlers can't import from `routes/`.
- Schemas can't import from any other layer.

## Checking input with Zod

Zod checks all request input. It replaces Ajv, the checker Fastify uses by default. `src/app.ts` sets this up once:

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

A service never imports another service. If two services need the same thing, put it in a repository or integration, and give it to both. This keeps services free of import loops, and keeps each service's tests small.

## Plugins

Plugins create each feature's objects when the app starts and attach them to the Fastify app. For example, `itemPlugin` creates `ItemPostgresRepository`, `WebhookHttpClient`, and `ItemLogger`, passes them to `ItemService`, and attaches only `itemService`.

Only services use repositories. Routes and handlers never touch them, and lint fails if they try to import from `src/data`. If a service needs another feature's data, the plugin passes it that feature's repository too. The same goes for integrations.

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

Every log line still gets the request ID. The `@fastify/request-context` plugin remembers which request is running, and `currentLogger()` in `src/observability/loggers/request-logger.ts` picks up that request's logger. Outside a request, such as at startup, it uses the app logger instead.

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

Handlers use `success(data)` or `paged(items, { limit, offset, total })` from `src/shared/response.ts`. Error responses are built only by the error handler in `src/app.ts`.

Every error has its own `code` and `name`. The full list, with what each one means, is in `docs/errors.md`. The list itself lives in `src/shared/errors.ts`.

Services throw errors by name from that list:

```ts
throw new AppError('itemNotFound', `Item ${itemId} was not found`);
```

Fastify catches any error thrown in a handler or service and passes it to the error handler in `src/app.ts`, which turns it into the error response above. It also handles errors that don't come from our code:

- Bad request input from Zod becomes `validationError`.
- Fastify's own request errors become `invalidRequest`, `payloadTooLarge`, or `unsupportedMediaType`.
- An unknown URL becomes `routeNotFound`.
- Anything else becomes `internalError`. The client only sees "Unexpected server error". The real error goes to the log, with the request ID.

Handlers should not catch errors just to format them.

Every response includes the request ID in a header. The header name comes from `REQUEST_ID_HEADER` and is `x-request-id` by default. If the caller sends an ID, the app uses it. If not, the app makes a new one.

## Configuration

Every environment variable is listed in one Zod schema in `src/config.ts`. The rest of the code reads settings from the `config` object it exports. If a value is wrong, the app stops at startup and names the bad variable.

The `.env` file is loaded only when `ENVIRONMENT=local`. Everywhere else, settings come from real environment variables.

## Database

The app uses Postgres through `@fastify/postgres`. It only connects when the first query runs, so the app and its tests can start without a database.

If `DATABASE_URL` is set, the app uses it and ignores `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, and `DATABASE_PASSWORD`.

Table definitions are SQL files in `db/schema/`. `000_schema.sql` creates the Postgres schema, and the other files create the tables in it. Run them in filename order. Running them again is safe, because each one uses `IF NOT EXISTS`.

## Tests

Each test file sits next to the file it tests and ends in `.test.ts`. Shared test fakes end in `.test-helper.ts`. Neither is included in the production build.

- Service tests replace repositories and integrations with Jest mocks, so they need no database.
- Route tests build the app with `setupApp()` and send requests with `app.inject()`. They check input validation, error responses, request IDs, and Swagger, all without a database.

For building, releases, and deployment, see `README.md` and `infrastructure/README.md`.
