# Bold Cedar 007

A starting point for a Fastify and TypeScript API. It comes with Postgres, input checks with Zod, Swagger docs, Docker, AWS hosting, and GitHub Actions.

## What you get

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

## Local development

```bash
npm install
cp .env.example .env
npm run dev
```

The `.env` file is only read when `ENVIRONMENT=local`. `.env.example` points at the local Postgres from `docker-compose.yml`. Start it and create the tables:

```bash
npm run db:up          # starts Postgres in Docker on localhost:5432
npm run db:migrate     # applies new files in db/schema/, in filename order
npm run db:down        # stops it; the data stays in a Docker volume
```

`db:migrate` records each file it applies in `schema_migrations`, so each file runs once. In the Docker image, run `node dist/migrate.js`.

The service listens on `http://localhost:3000` by default. Swagger UI is at `http://localhost:3000/docs`.

## Environment variables

The app checks all of these at startup, in `src/config.ts`.

| Name                | Default          | Description                                                               |
| ------------------- | ---------------- | ------------------------------------------------------------------------- |
| `ENVIRONMENT`       | `production`     | Where the app runs. `local` reads `.env`. Tests use `test`.               |
| `HOST`              | `0.0.0.0`        | Address the server listens on.                                            |
| `PORT`              | `3000`           | Port the server listens on.                                               |
| `DATABASE_URL`      |                  | Full Postgres connection URL. If set, the other `DATABASE_*` are ignored. |
| `DATABASE_HOST`     | `localhost`      | Postgres host, if `DATABASE_URL` isn't set.                               |
| `DATABASE_PORT`     | `5432`           | Postgres port, if `DATABASE_URL` isn't set.                               |
| `DATABASE_NAME`     | `bold_cedar_007` | Database name, if `DATABASE_URL` isn't set.                               |
| `DATABASE_USER`     | `bold_cedar_007` | Username, if `DATABASE_URL` isn't set.                                    |
| `DATABASE_PASSWORD` | `bold_cedar_007` | Password, if `DATABASE_URL` isn't set.                                    |
| `LOGGER_LEVEL`      | `info`           | How much to log. Tests use `silent`.                                      |
| `REQUEST_ID_HEADER` | `x-request-id`   | Header that carries the request ID, in and out.                           |
| `WEBHOOK_URL`       |                  | Where to send events like `item.created`. If not set, webhooks are off.   |

## Commands

```bash
npm run dev            # runs locally with .env and restarts on changes
npm test
npm run test:coverage
npm run build          # compiles to dist/
npm run lint
npm run format
npm run check          # lint + typecheck + build + test (CI runs this)
npm run db:up          # start local Postgres
npm run db:migrate     # apply db/schema/ files
```

## Docker

```bash
docker build -t bold-cedar-007 .
docker run --rm -p 3000:3000 -e DATABASE_URL=postgres://... bold-cedar-007
```

## API

Requests that act as a person send that person's ID in the `x-actor-id` header. This is a stand-in until real sign-in. The first person added with `POST /humans` becomes an admin and needs no header.

- `GET /health`
- `GET /docs`
- `POST /humans`, `GET /humans`
- `POST /tasks`, `GET /tasks?state=&ownerAgentId=&conversationId=`
- `GET /tasks/:taskId`, `GET /tasks/:taskId/events`, `GET /tasks/:taskId/outputs`
- `POST /tasks/:taskId/pause`, `/resume`, `/cancel`, `/restart`, `/review`
- `POST /items`
- `GET /items?limit=50&offset=0`
- `GET /items/:itemId`

## Docs

- `docs/architecture.md`: how the code is set up.
- `docs/adding-a-feature.md`: step-by-step guide for a new feature.
- `docs/responses.md`: what success, list, and error responses look like.
- `docs/errors.md`: every error code the API can return.
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
