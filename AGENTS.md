# AGENTS.md

Rules for AI coding agents working in this repo. They apply to people too.

This file says what to do and what not to do. For how things work and why, read:

- `docs/architecture.md`: how the code is set up.
- `docs/adding-a-feature.md`: step-by-step guide for a new feature.
- `docs/responses.md` and `docs/errors.md`: what the API sends back.
- `docs/agents.md`: agents, configuration versions, and model providers.
- `docs/conversations.md`: how messages become work, agent tools, and the runner.
- `docs/catalogs.md`: skills, connections, credentials, and grants.
- `docs/notes.md`: context, saved notes, and knowledge sources.
- `docs/scheduling.md`: recurring responsibilities, missed runs, and event starts.
- `docs/local.md`: running everything on one computer with Docker, workspaces, and tool isolation.

## Source of truth

This repo builds the Collaborative Agents platform. The Notion project hub is the source of truth for what to build and why:

- [Project Hub](https://app.notion.com/p/4011a83d088f8182b29ed57ace67d81b): start here. It links everything below.
- [PRD](https://app.notion.com/p/4011a83d088f81918f3ff1d468dc962e): the product, agreed behavior, MVP scope, and open decisions.
- [Project Backlog](https://app.notion.com/p/4bf42f543b0741fda0c67e6302aafd0a): the tickets, with acceptance criteria and dependencies.
- [PRD-to-Backlog Coverage](https://app.notion.com/p/4011a83d088f81db842bf362b817b26d): which ticket covers each PRD requirement.
- [Questions for Kayvan](https://app.notion.com/p/d3fc8fa27ec04f2dad936ea6eaeccb03): decisions and questions waiting on a human.
- [Architecture](https://app.notion.com/p/4011a83d088f815ba963fc1b87e5459d): the system design and diagrams, linked from the Project Hub.

If the code and Notion disagree on product behavior, Notion wins. Raise the conflict; don't guess.

## Ticket workflow

Every change starts from a ticket in the Project Backlog and ends with the ticket updated. Follow these steps every time.

1. **Pick a ticket.** Choose the highest-priority ticket whose `Blocked By` tickets are done, or that can go ahead on a recorded default (step 3). Skip any ticket with `Agent` set; someone else has it. Read the ticket and the PRD sections it covers.
2. **Claim and start it.** Set `Agent` to who you are, set `Claimed At` to now, set `Status` to `In Progress`, and set `Branch`. Name the branch `ca-<ticket number>-<short-name>`, like `ca-7-persistence`, and create it in its own worktree (see "Worktrees" below). Then fetch the ticket again: if `Agent` now shows someone else, they claimed it first. Clear nothing of theirs, and pick another ticket. See "Working in parallel" below.
3. **Don't block on a human.** If you need a decision, add a row to Questions for Kayvan. Give the options, your recommendation, and the default you will use until it is answered. Link the row to the ticket and tick `Needs Input` on the ticket. Then keep working on that default. Pick a default that is easy to change later. Never pick one that is hard to undo, like deleting data or spending money. Before starting a ticket, check Questions for Kayvan for answers and apply them. Set an applied answer's `Status` to `Applied`.
4. **Open a PR.** Use one PR per ticket, or several small PRs for a big ticket. Put the ticket ID and title in the PR title, like `CA-7: Persist tasks, messages, and agent context`. In the PR body, link the ticket, list which acceptance criteria the PR meets, and list any that are still open. `npm run check` must pass.
5. **Review it.** Read the whole diff as a reviewer would: check correctness, the layer rules in this file, tests, and docs. Fix what you find, then post a short summary of the review on the PR.
6. **Merge it.** Squash-merge once checks pass, then delete the branch. CI can take a few seconds to register on a new push, and `gh pr checks <n> --watch` reports "no checks reported" until it does. Wait until a check shows up and passes. Then merge.

   Before you commit, check that you are in the ticket's worktree and on its branch (`git branch --show-current`), not `main`.

7. **Update the ticket.** Set `PR` to the PR link and write one line in `Last Update`. Add a `## Work log` entry to the ticket page with the date, the PR link, what was built, the decisions made and why, and what is left. Set `Status` to `Done` only when every acceptance criterion is met. If some are left, keep it `In Progress`, or set `Blocked` and give the reason. When you stop working on the ticket (done, blocked, or handing it off), clear `Agent` and `Claimed At`.
8. **Keep Notion current.** If the design changed, update the Architecture page. If you found new work, add a ticket with acceptance criteria, `Priority`, `Scope`, and `Blocked By`.

Backlog fields: `Ticket ID` (CA-n), `Status` (Backlog, Blocked, In Progress, In Review, Done), `Agent` and `Claimed At` (who is working on it now, and since when), `Priority`, `Scope`, `Blocked By` and `Blocks`, `Branch`, `PR`, `Needs Input`, `Last Update`, and `Questions`, which links to rows in Questions for Kayvan.

### Working in parallel

Several agents can work at once. The `Agent` field on the backlog keeps them out of each other's way.

- **Who you are.** A Claude Code session uses its session ID (`session_...`, from the `get_session` tool). A person uses their name.
- **One ticket at a time.** Hold at most one claimed ticket. Finish, block, or hand it off, and clear `Agent`, before you claim another.
- **Never work on a ticket someone else has claimed**, and never change their branch.
- **Keep the claim fresh.** Update `Claimed At` and `Last Update` when you push or reach a new step.
- **Stale claims.** A claim is stale when `Claimed At` is more than 24 hours old and its branch has had no new commits in that time. You may take over a stale claim. Say so in the ticket's work log, then claim it as usual. Continue from its branch rather than starting over.
- **Your own worktree.** Every agent works in its own git worktree, never in the main checkout. See "Worktrees" below.
- **Shared files.** Before you push, merge `main` into your branch so you pick up the other agent's work. Each agent numbers its own new `db/schema/` file. If two branches use the same number, the one that merges second renames its file to the next free number.

### Worktrees

Every agent works in its own [git worktree](https://git-scm.com/docs/git-worktree): a separate folder with its own branch, sharing one repo. Agents never switch branches in the main checkout, so one agent's work can't land on another's branch.

- **The main checkout stays on `main`.** Use it only to pull and to add or remove worktrees. Never edit or commit there.
- **One worktree per ticket.** Put worktrees next to the repo, in `../bold-cedar-007-worktrees/`, named after the branch. Don't put them inside the repo, because lint and tests would pick them up.

  ```bash
  git -C <main checkout> pull origin main
  git -C <main checkout> worktree add ../bold-cedar-007-worktrees/ca-7-persistence -b ca-7-persistence main
  cd ../bold-cedar-007-worktrees/ca-7-persistence
  npm install
  cp ../../bold-cedar-007/.env .env   # .env isn't in git
  ```

  To continue a branch that already exists, such as a stale claim you're taking over, leave out `-b`: `git worktree add <path> <branch>`.

- **Work, test, and commit only inside your worktree.** Run every command from there.
- **Shared on this computer:** the local Postgres and port 3000. Tests need neither. Only one worktree at a time should run `npm run dev` or `docker compose up`. `npm run db:migrate` is safe from any worktree.
- **Clean up after merging.** From the main checkout, run `git worktree remove ../bold-cedar-007-worktrees/<branch>` and `git branch -D <branch>`, then pull `main`.

Put design notes, diagrams, and decision records in Notion under the Project Hub, and link them from the ticket. Keep repo docs (`docs/`) about how the code works. If the PRD changes, update the affected tickets and the coverage page.

## Commands

```bash
npm install
npm run dev            # runs locally with .env and restarts on changes
npm run lint
npm run typecheck
npm run build          # compiles src/ to dist/
npm test               # no database needed
npm run check          # lint + typecheck + build + test
npm run db:up          # start local Postgres (Docker)
npm run db:migrate     # apply new db/schema/ files
npm run up             # run the app and Postgres in Docker (see docs/local.md)
npm run down           # stop them
```

Run `npm run check` before you finish any change. Never call work done while it fails.

## Layers

A request goes `routes -> handlers -> services -> repositories`. Services can also call integrations, which are outside systems like another company's API. Each layer only calls the one right below it. Routes and handlers both use `src/schemas/`, which imports nothing from the other layers.

Put new code in the folder for its layer, then in a folder for its feature. The full folder map, who can import what, and why, are in the "Where things live" and "Who can import what" sections of `docs/architecture.md`. Lint enforces the import rules; don't turn them off.

| Layer       | Folder                        | Does                                                                           | Never                                                        |
| ----------- | ----------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Route       | `src/routes/<feature>/`       | URL, method, which schema and handler to use, Swagger `description` and `tags` | Contain logic                                                |
| Schema      | `src/schemas/<feature>/`      | Zod schemas for request input, and their types                                 | Import from any layer but `shared`                           |
| Handler     | `src/handlers/<feature>/`     | Read the request, call one service, send the response                          | Make business decisions, use a repository, catch errors      |
| Service     | `src/services/<feature>/`     | Business logic, logging, throwing errors                                       | Use Fastify request or reply objects, import another service |
| Repository  | `src/data/<feature>/`         | Read and write data (SQL, cache, other stores)                                 | Make business decisions                                      |
| Integration | `src/integrations/<feature>/` | Call an outside system (APIs, LLMs, email, payments, anything else)            | Make business decisions                                      |
| Plugin      | `src/plugins/<feature>.ts`    | Build the repositories, integrations, logger, and service at startup           | Attach anything but the service to Fastify                   |
| Logger      | `src/observability/loggers/`  | One method per event, called by services                                       | Be called from handlers, repositories, or integrations       |
| Shared      | `src/shared/`                 | Types, response helpers, the error catalog                                     | Import from any other layer                                  |

## Hard rules

- **Only services use repositories.** A plugin builds the repository and passes it to the service's constructor. Never attach a repository to Fastify, and never use one in a route or handler. Lint fails if a route or handler imports from `src/data`. If a service needs another feature's data, give it that feature's repository in its constructor.
- **Only services use integrations.** An integration wraps one outside system, like the OpenAI API. It goes in `src/integrations/<feature>/`, not in `src/data`, and follows the same rules as a repository: the plugin builds it and passes it to the service's constructor. Settings like API keys are passed into its constructor too; the plugin reads them from `config`. Never attach it to Fastify. Lint fails if a route or handler imports from `src/integrations`.
- **Services never import other services.** If two services need the same thing, put it in a repository or integration and give it to both. Lint enforces this, so services never import each other in a loop.
- **Handlers get services from `request.server`**, like `request.server.itemService`. Never import a service class into a handler.
- **Zod is the only way to check input.** Schemas go in `src/schemas/<feature>/<feature>.schemas.ts`, with the `z.infer` type right below each one. Routes use the schemas, and handlers use the types. Never import from `src/routes` in a handler. Never write a request type by hand, and never write raw JSON Schema.
- **Request bodies use `z.strictObject`**, so unknown fields are rejected.
- **Numbers in the query string or URL use `z.coerce.number()`.** They arrive as strings.
- **Errors come from the catalog.** Every error has its own entry in `ERRORS` in `src/shared/errors.ts`, with a unique code: `10xxx` for general errors, and a new range per feature. Names are camelCase. Services throw `new AppError('itemNotFound', message)`. Add every new error to `docs/errors.md` too; a test checks this. Never change or reuse a code that has shipped.
- **Don't catch errors in handlers** just to build an error response. The error handler in `src/app.ts` does that.
- **Responses use the helpers** in `src/shared/response.ts`: `success(data)` for one thing, `paged(items, { limit, offset, total })` for lists. Creates return `201`. If you change the response shape, update `docs/responses.md`.
- **Services log through their feature's logger**, passed in the constructor. Add one method per event. Event names are lowercase with dots, feature first (`item.created`). Method names look like `onItemCreated`.
- **SQL uses parameters** (`$1`, `$2`), never values pasted into the query string. Tables live in the Postgres schema from `db/schema/000_schema.sql`. Each new table or change gets a new numbered file in `db/schema/`. Never edit a file that has been merged; `npm run db:migrate` runs each file once.
- **Every environment variable** goes in the Zod schema in `src/config.ts`, in the table in `README.md`, and in `.env.example`. Read settings only from the exported `config` object.
- **Import from the layer's root `index.ts`**, like `from '../../data'`, not from a feature folder inside it. Every feature folder has an `index.ts`, and the layer's root `index.ts` re-exports it.
- **Tests sit next to the file they test** and end in `.test.ts`. Service tests mock repositories and integrations with `jest.fn()`. Route tests use `app.inject`. Tests never need a database.
- **Write docs and comments in plain language.** Short sentences, everyday words.

## Naming

```text
src/routes/<feature>/<feature>.ts                       -> <feature>Router
src/schemas/<feature>/<feature>.schemas.ts              -> <thing>Schema + its type
src/handlers/<feature>/<feature>.ts                     -> <action><Thing>Handler
src/services/<feature>/<domain>.service.ts              -> <Domain>Service
src/data/<feature>/<domain>.repository.ts               -> <Domain>Repository (interface)
src/data/<feature>/<domain>-postgres.repository.ts      -> <Domain>PostgresRepository
src/integrations/<feature>/<name>.client.ts            -> <Name>Client (interface)
src/integrations/<feature>/<name>-<how>.client.ts      -> <Name><How>Client, like WebhookHttpClient
src/observability/loggers/<feature>/<domain>.logger.ts  -> <Domain>Logger
src/plugins/<domain>.ts                                 -> default export fp(<domain>Plugin, { name: '<domain>' })
```

Feature folders are plural (`items`). File names inside them are singular (`item.service.ts`).

## Don't

- Add a validation library other than Zod, or use Ajv schemas.
- Add a package without a clear need. Use what's already installed first.
- Edit `infrastructure/` or `.github/workflows/` unless the task is about deployment.
- Upgrade TypeScript to 7 until `ts-jest` and `typescript-eslint` support it. Both stop below 7 today.
- Remove `NODE_OPTIONS=--experimental-vm-modules` from the test scripts. Jest needs it to load packages that `@fastify/swagger-ui` 6 depends on.
