# Bold Cedar 007

A starting point for a Fastify and TypeScript API. It comes with Postgres, input checks with Zod, Swagger docs, Docker, AWS hosting, and GitHub Actions.

The web interface uses Svelte 5 and Vite in `apps/web/`. It calls the API over HTTP and is served at `/app/`.

## What you get

- **Two apps, one repo:** the API in `apps/api` and the web interface in `apps/web`, as npm workspaces. Run every command from the repo root.
- **Clear layers:** `routes -> handlers -> services -> repositories`, plus `integrations` for outside systems, with a working example feature called `items`.
- **Zod schemas:** one schema per request checks the input, types the handler, and feeds the Swagger docs.
- **Checked settings:** a bad environment variable stops the app at startup, with a clear message.
- **Consistent API:** every response is `{ data }`, `{ data, page }`, or `{ error }`. Every error has its own documented code. Every request gets an ID.
- **Postgres** through `@fastify/postgres`, with tables defined in plain SQL files.
- **Swagger UI** at `/docs`.
- **Tests** with Jest that don't need a database.
- **Dockerfile** that builds a small image and doesn't run as root.
- **Terraform** for a throwaway AWS test setup: network, load balancer, image registry, and containers on ECS Fargate.
- **GitHub Actions** that run the checks on every push, and deploy when you publish a GitHub release.

## Running it

To run the whole platform on your computer with Docker, see [docs/local.md](docs/local.md):

```bash
cp .env.example .env
npm run up             # app + Postgres in Docker; open http://localhost:3000
npm run down
```

## Local development

```bash
npm install
cp .env.example .env
npm run dev
```

The `.env` file is only read when `ENVIRONMENT=local`. `.env.example` points at the local Postgres from `docker-compose.yml`. Start it and create the tables:

```bash
npm run db:up          # starts Postgres in Docker on localhost:5432
npm run db:migrate     # applies new files in apps/api/db/schema/, in filename order
npm run db:down        # stops it; the data stays in a Docker volume
```

`db:migrate` records each file it applies in `schema_migrations`, so each file runs once. In the Docker image, run `node dist/migrate.js` (the image starts in `apps/api`).

The service listens on `http://localhost:3000` by default. Swagger UI is at `http://localhost:3000/docs`.

## Environment variables

The app checks all of these at startup, in `apps/api/src/config.ts`.

| Name                 | Default                     | Description                                                                                       |
| -------------------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| `ENVIRONMENT`        | `production`                | Where the app runs. `local` reads `.env`. Tests use `test`.                                       |
| `HOST`               | `0.0.0.0`                   | Address the server listens on.                                                                    |
| `PORT`               | `3000`                      | Port the server listens on.                                                                       |
| `DATABASE_URL`       |                             | Full Postgres connection URL. If set, the other `DATABASE_*` are ignored.                         |
| `DATABASE_HOST`      | `localhost`                 | Postgres host, if `DATABASE_URL` isn't set.                                                       |
| `DATABASE_PORT`      | `5432`                      | Postgres port, if `DATABASE_URL` isn't set.                                                       |
| `DATABASE_NAME`      | `bold_cedar_007`            | Database name, if `DATABASE_URL` isn't set.                                                       |
| `DATABASE_USER`      | `bold_cedar_007`            | Username, if `DATABASE_URL` isn't set.                                                            |
| `DATABASE_PASSWORD`  | `bold_cedar_007`            | Password, if `DATABASE_URL` isn't set.                                                            |
| `LOGGER_LEVEL`       | `info`                      | How much to log. Tests use `silent`.                                                              |
| `REQUEST_ID_HEADER`  | `x-request-id`              | Header that carries the request ID, in and out.                                                   |
| `WEBHOOK_URL`        |                             | Where to send events like `item.created`. If not set, webhooks are off.                           |
| `ANTHROPIC_API_KEY`  |                             | Turns on the `anthropic` provider for agents.                                                     |
| `OPENAI_API_KEY`     |                             | Turns on the `openai` provider for agents.                                                        |
| `OPENAI_BASE_URL`    | `https://api.openai.com/v1` | OpenAI-compatible API address. It must support the Responses API.                                 |
| `RUNNER_ENABLED`     | `true`                      | Run the runner, which delivers messages and runs agents' work. Always off in tests.               |
| `RUNNER_INTERVAL_MS` | `2000`                      | How often the runner checks for work, in milliseconds.                                            |
| `WORKSPACES_DIR`     | `workspaces`                | Folder for agents' files, one subfolder per task.                                                 |
| `COMPLETION_CHECK`   | `false`                     | Check each result against its criteria with a separate model call before a task completes.        |
| `MODEL_PRICES`       |                             | Model prices as JSON: `{"model":{"inputPerMillion":0.15,"outputPerMillion":0.6}}`, in US dollars. |
| `TASK_BUDGET_USD`    | `1`                         | The most one task may spend, in US dollars, unless its agent's configuration sets `maxCostUsd`.   |
| `CREDENTIALS_KEY`    |                             | 32 random bytes (base64 or hex) that encrypt connection credentials. Needed to save a credential. |

## Commands

```bash
npm run dev            # runs locally with .env and restarts on changes
npm run dev:web        # the web interface with live reload, at http://localhost:5173/app/
npm test
npm run test:coverage
npm run build          # builds the API (apps/api/dist) and the web interface (apps/web/dist)
npm run lint
npm run format
npm run check          # lint + typecheck + build + unit and browser tests (CI runs this)
npm run test:e2e       # build the web app and run its Playwright regression suite
npm run db:up          # start local Postgres
npm run db:migrate     # apply apps/api/db/schema/ files
npm run up             # run the app and Postgres in Docker
npm run logs           # follow the app's log in Docker
npm run down           # stop the Docker containers; data stays
npm run pilot:api      # the milestone pilots: see docs/pilot.md
npm run pilot:setup
npm run pilot:brief
npm run pilot:report
```

## Docker

```bash
docker build -t bold-cedar-007 .
docker run --rm -p 3000:3000 -e DATABASE_URL=postgres://... bold-cedar-007
```

## API

Requests that act as a person send that person's ID in the `x-actor-id` header. This is a stand-in until real sign-in. The first person added with `POST /humans` needs no header. For v1 there is one role: every person can do everything. Agents still can't do people-only things, like approving or granting access. Roles are switched off in `apps/api/src/shared/access.ts` (`ROLES_ENABLED`).

- `GET /health`
- `GET /docs`
- `POST /humans`, `GET /humans`, `PATCH /humans/me` — update your display name (1–100 characters) and personal theme/time format; see [person profiles](docs/responses.md#person-profiles).
- `GET /providers`, `GET /directory`
- `POST /skills`, `GET /skills`, `GET /skills/:skillId`, `POST /skills/:skillId/versions`, `/disable`, `/enable`
- `POST /connections`, `GET /connections`, `PATCH /connections/:connectionId`, `/disable`, `/enable`
- `GET /agents/:agentId/grants`, `POST /agents/:agentId/grants`, `DELETE /agents/:agentId/grants/:type/:targetId`
- `POST /agents`, `GET /agents`, `GET /agents/:agentId`, `PATCH /agents/:agentId`
- `POST /agents/:agentId/config`, `GET /agents/:agentId/versions`, `POST /agents/:agentId/disable`, `/enable`
- `POST /conversations`, `GET /conversations`, `GET /conversations/:conversationId`, `PATCH /conversations/:conversationId`
- `GET /agents/:agentId/costs`, `GET /conversations/:conversationId/costs`
- `POST /conversations/:conversationId/members`
- `POST /conversations/:conversationId/messages`, `GET /conversations/:conversationId/messages`
- `POST /conversations/:conversationId/documents`, `GET .../documents`, `DELETE .../documents/:documentId`
- `GET /agents/:agentId/notes`, `PATCH /agents/:agentId/notes/:noteId`, `DELETE /agents/:agentId/notes/:noteId`
- `POST /tasks`, `GET /tasks?state=&ownerAgentId=&conversationId=`
- `GET /tasks/:taskId`, `GET /tasks/:taskId/events`, `GET /tasks/:taskId/outputs`, `GET /conversations/:conversationId/outputs`
- `POST /tasks/:taskId/pause`, `/resume`, `/cancel`, `/restart`, `/review`, `/version`
- `POST /responsibilities`, `GET /responsibilities`, `PATCH /responsibilities/:id`, `/pause`, `/resume`, `/cancel`, `GET|POST /responsibilities/:id/runs`
- `GET /approvals?status=pending`, `GET /approvals/:approvalId`, `POST /approvals/:approvalId/approve`, `/reject`
- `POST /items`
- `GET /items?limit=50&offset=0`
- `GET /items/:itemId`

## Docs

- `docs/architecture.md`: how the code is set up.
- `docs/adding-a-feature.md`: step-by-step guide for a new feature.
- `docs/responses.md`: what success, list, and error responses look like.
- `docs/errors.md`: every error code the API can return.
- `docs/local.md`: running the platform on your computer, and what agents' tools can touch.
- `docs/pilot.md`: running the two milestone pilots and collecting their measures.
- `docs/design/`: the web app's design: every screen as a page and a picture, and the style guide with its tokens.
- `AGENTS.md`: the rules every change must follow. Written for AI agents, but they apply to everyone.

## Infrastructure

`infrastructure/` has Terraform for a throwaway AWS test setup: a network, a load balancer, an image registry, and the app running on ECS Fargate. See [infrastructure/README.md](infrastructure/README.md).

## Releases and deployment

To release and deploy a new version:

1. In GitHub, go to **Releases** and click **Draft a new release**.
2. Create a new tag such as `v1.2.0`. Click **Generate release notes** if you want GitHub to list the merged pull requests.
3. Click **Publish release**.

Publishing starts the `release` workflow. It builds the Docker image, tags it with the version (`1.2.0`) and `latest`, and deploys it to the `sandbox` environment.

Set these in the GitHub `sandbox` environment:

| Name                 | Kind     | Description                                                    |
| -------------------- | -------- | -------------------------------------------------------------- |
| `AWS_ROLE_TO_ASSUME` | secret   | The AWS role GitHub Actions logs in as.                        |
| `AWS_REGION`         | variable | The AWS region the app runs in.                                |
| `ECR_REPOSITORY`     | variable | ECR repository name, such as `bold-cedar-007-sandbox-service`. |
| `ECS_CLUSTER`        | variable | ECS cluster name, such as `bold-cedar-007-sandbox-cluster`.    |
| `ECS_SERVICE`        | variable | ECS service name, such as `bold-cedar-007-sandbox-service`.    |

To redeploy an image that's already built, run the `deploy` workflow by hand. It doesn't make a new release.

## Browser regression tests

`npm run check` includes the committed Playwright suite in `apps/web/e2e/`. It launches Vite's
preview server against the production build, so browser checks use the same bundled CSS order as
the served app. The suite mocks the HTTP API; it needs no database, Docker app, provider keys, or
model calls, and it never changes real schedules or runs.

Run `npm run test:e2e` for browser tests alone. Chromium downloads on the first run. In CI the
runner also installs Chromium's system libraries; the existing CI workflow runs these tests through
`npm run check`. No deployment workflow changes are needed. On a new Linux workstation, install
missing system libraries with `npx playwright install-deps chromium` from `apps/web/` if needed.

The initial suite covers enabled/paused/cancelled badges on one line without clipping or overlaps,
production CSS, both themes, desktop/phone widths, the shared centered frame, empty-state action
alignment, keyboard navigation, and API failure handling. Future UI regressions should add cases
here. These checks cover selected browser behavior; the other feature pages still need broader
coverage. Failed runs retain a screenshot and trace under `apps/web/test-results/`, with an HTML
report in `apps/web/playwright-report/`. Both directories are ignored by git. To inspect a local
report, run `npx playwright show-report` from `apps/web/`.
