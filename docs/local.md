# Running the platform on your computer

The whole platform runs on one computer: the API, the runner that does agents' work, the scheduler, the database, and agents' tools. Only the AI models run elsewhere. Agents call them over the internet, using your API key.

## What you need

- **Docker Desktop** (Mac or Windows) or **Docker Engine with Compose** (Linux). That's all you need to run it.
- **An OpenAI API key**, so agents can think. Without one, only the built-in `scripted` test agent works.
- **For development only:** Node 26 and npm.

It runs anywhere Docker runs. It was tested on Linux. Mac and Windows use the same containers, through Docker Desktop. On Windows, Docker Desktop needs WSL 2 turned on; its installer offers to do that.

## Start, stop, and watch it

```bash
cp .env.example .env     # then set OPENAI_API_KEY and CREDENTIALS_KEY in .env
npm run up               # builds and starts the app and Postgres in Docker
npm run logs             # follow the app's log
npm run down             # stops everything; your data stays
```

Without npm, use `docker compose up -d --build`, `docker compose logs -f app`, and `docker compose down`.

When it's up, open `http://localhost:3000` for the web interface. The API is at the same address, and Swagger is at `http://localhost:3000/docs`. If port 3000 is already taken on your computer, set `APP_PORT` in `.env`, such as `APP_PORT=3100`, and use that port instead. If Postgres's port 5432 is taken, set `DB_PORT` the same way. Only this computer can reach it. Nobody signs in yet, so anyone who could reach the API could act as anyone.

`npm run up` applies new database changes (`apps/api/db/schema/`) before the server starts.

## Keep it awake

Agents only make progress while the platform is running.

- The computer must be on and awake. Sleep pauses everything. Set your computer not to sleep while plugged in if agents have scheduled work.
- Docker must be running. Both containers start again on their own after a crash, a reboot, or a Docker restart, until you run `npm run down`.
- Closing the browser doesn't stop anything. Work runs in the backend, not in a browser tab.

## What happens after a stop or restart

Nothing is lost. Everything that matters is in Postgres, and agents' files are in a Docker volume.

- **Work in progress** picks up where it left off. The runner leases each task for a short time. After a restart, the lease runs out and the task is claimed again. Tool calls that already finished are in the task's history, so they aren't run twice.
- **Waiting tasks** keep waiting for their reply or approval. Messages saved before the stop but not yet delivered are delivered on the next tick.
- **Scheduled runs** missed while it was off follow each responsibility's missed-run policy. See `docs/scheduling.md`.

## Where things are kept

| What                            | Where                                               |
| ------------------------------- | --------------------------------------------------- |
| Conversations, tasks, history   | Postgres, in the `postgres-data` Docker volume      |
| Agents' files (task workspaces) | The `workspaces` Docker volume, one folder per task |
| API keys and settings           | `.env` on your computer. It's never committed.      |
| Connection credentials          | Postgres, encrypted with `CREDENTIALS_KEY`          |

`docker compose down -v` deletes the volumes, and with them all data. Plain `npm run down` keeps them.

## What agents' tools can touch

Each tool is walled off in a way that matches what it can do.

- **Files** (`list_files`, `read_file`, `write_file`): each task gets its own folder, its workspace. Paths can't leave it: `..`, absolute paths, and links that point outside are refused. Files are at most 1 MB to write, and reads are cut off at 100,000 characters. In Docker, the folder is inside the app's container, so agents can't reach the rest of your computer at all. Workspaces aren't deleted yet when a task finishes.
- **Outside APIs** (`http_request`): only through connections a person set up and granted to the agent. Each call is checked against the connection's allowed methods and paths, and some methods wait for a person's approval. See `docs/catalogs.md`.
- **Running code and using a browser**: not available yet. These need stronger walls, such as a separate container per task, before agents can use them.

The app runs as a normal user (`node`) in its container, not as root.

## Developing without Docker for the app

To change the code with live reload, run only Postgres in Docker and the app with Node:

```bash
npm install
cp .env.example .env
npm run db:up            # Postgres only, on localhost:5432
npm run db:migrate
npm run dev              # the app, restarting when you save a file
```

Here, agents' workspaces go in `apps/api/workspaces/`, which git ignores. Set `WORKSPACES_DIR` to put them somewhere else.

For the web interface with live reload, also run `npm run dev:web` and open `http://localhost:5173/app/`. It sends API calls to `npm run dev` on port 3000. Without it, `npm run build` puts the interface in `apps/web/dist`, and the server serves it at `/app/`.

Don't run `npm run up` and `npm run dev` at the same time: both use port 3000.
