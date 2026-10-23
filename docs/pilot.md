# Running the pilots (CA-2)

This is the runbook for the milestone check: the two pilots chosen on CA-3, plus the checks done by hand. Everything is set up through the normal API, as configuration. The `pilot/` folder only holds scripts that call the API, and a small test API. Nothing in it is part of the platform.

| Pilot                      | Who                                                    | What happens                                                                                                                   |
| -------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 1. Research brief          | Researcher (cheaper model), Reviewer (stronger model)  | You ask for a one-page brief. The Researcher drafts it from Wikipedia and attached documents; the Reviewer checks every claim. |
| 1. Baseline                | Solo Researcher (stronger model)                       | The same request, one agent alone, with the same tools.                                                                        |
| 2. Scheduled website check | Checker (cheaper model), Investigator (stronger model) | Every 10 minutes the Checker calls a test API, asks the Investigator about each broken endpoint, and posts a report. 20 runs.  |

## What it costs

Each pilot agent has a monthly budget, and together they can't pass **$16**. Each brief's conversation stops at $1, and each task has its own cap. The targets are lower: $0.50 per brief and $0.10 per check run. Budgets only work when the model has a price, so setup refuses to start without one.

## 1. Get ready (once)

1. Load a small prepaid credit on your OpenAI account and make an API key.
2. Pick two models: a cheaper one for the Researcher and Checker, and a stronger one for the Reviewer, Solo Researcher, and Investigator. Look up their prices on OpenAI's pricing page.
3. In `.env`, set:

   ```bash
   OPENAI_API_KEY=sk-...
   CREDENTIALS_KEY=...            # openssl rand -base64 32
   MODEL_PRICES={"<cheap model>":{"inputPerMillion":0.15,"outputPerMillion":0.6},"<strong model>":{"inputPerMillion":2.5,"outputPerMillion":10}}
   ```

   Use the real prices you looked up; the numbers above are placeholders.

4. Pick five brief topics. Copy `pilot/topics.example.json` to `pilot/topics.json` and fill them in. Attach your own notes to a topic with `documents` if you like.

## 2. Start everything

```bash
npm run up              # the platform, in Docker
npm run pilot:api       # the test API for pilot 2, on http://localhost:4100
npm run pilot:setup -- --cheap-model <cheap model> --strong-model <strong model>
```

Setup creates the agents, skills, connections, the pilot 2 conversation, and its schedule. It's safe to run again: it reuses what already exists, by name. The first check runs about two minutes later. What it made is saved in `pilot/results/state.json` (git ignores `pilot/results/`).

To try the setup without spending anything, add `--dry-run`. Agents then use the free `scripted` provider, which does no real work, and the schedule is paused. Use a fresh database for the real run afterwards (`docker compose down -v`, then start again), so the dry-run agents don't get reused.

**Running the app with `npm run dev` instead of Docker?** The platform then reaches the test API on this computer: add `--target-url http://localhost:4100`, and run the test API with `node pilot/mock-api.ts`.

## 3. Pilot 1: research briefs

For each topic, run the team and the baseline:

```bash
npm run pilot:brief -- --topic 1
npm run pilot:brief -- --topic 1 --solo
```

Each makes its own conversation. Watch it in the web interface. Step in whenever you would in real work: answer questions, ask for changes, or redirect. Time how long you spend.

When a brief is done, read it and score it in `pilot/results/scores.json` (copy `pilot/scores.example.json`). Keys are `<topic>-<mode>`, like `1-team` or `1-solo`. Record whether you'd accept it, how much editing it needs (`none`, `minor`, or `major`), how many claims are uncited or wrong, and your minutes.

Also write one brief yourself, for the human baseline, and note your time and how it compares.

## 4. Pilot 2: scheduled checks

Nothing to do: the Checker runs every 10 minutes, 20 times (about 3 hours and 20 minutes). Keep the computer awake. The test API breaks five endpoints on purpose, each in its own runs:

| Failure | Endpoint             | What goes wrong                    | Runs (from 0) |
| ------- | -------------------- | ---------------------------------- | ------------- |
| F1      | `/api/products`      | Status 500                         | 2, 3          |
| F2      | `/api/orders/recent` | The `orders` field is missing      | 5, 6, 7       |
| F3      | `/api/users/me`      | Status 401                         | 9             |
| F4      | `/api/version`       | An HTML maintenance page, not JSON | 12, 13        |
| F5      | `/api/inventory`     | A negative stock count             | 15, 16, 17    |

The other runs see a healthy API, so any "BROKEN" line in them is a false alarm. The plan is in `pilot/plan.ts`. The agents can't see it: their connection only allows `/api/`.

After 20 runs, cancel the schedule: `POST /responsibilities/<id>/cancel`, or the Schedules page.

## 5. The report

```bash
npm run pilot:report
```

Run it any time. It prints the report and saves it in `pilot/results/`. It covers:

- **Pilot 1**: per brief, the time from your request to done, cost, tokens, how many messages you sent after the request, asks between participants, failed completion checks, and your scores. Then the team and the baseline against the CA-3 targets.
- **Pilot 2**: per run, which window it ran in, how many endpoints it called, what it reported, which seeded failures it caught or missed, false alarms, and cost. Then totals against the targets, plus windows with two runs or none.
- **Health**: stalled tasks, reply waits open 15+ minutes, repeated work, tasks completed without a passed completion check, blocked tasks with their reasons, model failures, and calls with no price.

The report reads the Checker's lines that start with `BROKEN: /path`. A report in another shape shows as "-": read it in the conversation and judge it yourself.

## 6. Checks done by hand

CA-2 also asks for these. Do them during the pilot, and note the result and the time in the CA-2 work log.

| Check                          | How                                                                                                                  | Expected                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Restart during work            | While a brief is in progress, run `docker compose restart app`.                                                      | The brief carries on after the restart. No step is done twice.                                          |
| Restart across a scheduled run | Run `npm run down`, wait past one check, then `npm run up`.                                                          | One missed run runs when it's back, or you're asked "run now or wait?". No run happens twice.           |
| Pause and cancel               | On a running brief's task, press Pause, then Resume. On another, press Cancel.                                       | Paused work stops and picks up again. Cancelled work stops for good.                                    |
| Cancel the schedule separately | Cancel one check run's task. Later, cancel the schedule.                                                             | Cancelling the run doesn't stop the schedule. Cancelling the schedule doesn't stop a run already going. |
| Version pinning                | While a brief is in progress, edit the Researcher's instructions.                                                    | The running task keeps its version. The next brief uses the new one.                                    |
| Revoking access                | During a brief, revoke the Researcher's Wikipedia connection on its agent page.                                      | Its next Wikipedia call is refused at once. Grant it again afterwards.                                  |
| Membership and history         | Add a second person to a brief's conversation with history "from now".                                               | They don't see messages from before they joined.                                                        |
| A bounded failure              | While a brief is in progress, set its conversation's budget to $0.01 (`PATCH /conversations/<id>` with `budgetUsd`). | The work stops with the reason, and you're told. Raising the limit and resuming lets it finish.         |
| Saved notes                    | Ask an agent to remember something, then open its page.                                                              | The note shows where it came from, and you can edit it.                                                 |
| Readable setup                 | Open each pilot agent, skill, and connection in the web interface.                                                   | A person can tell what each does and what it may access.                                                |
| Second task type               | Compare pilot 2's setup with pilot 1's.                                                                              | Pilot 2 needed only new agents, a connection, and a schedule: no platform code.                         |
| Awake and service needs        | Read `docs/local.md` "Keep it awake", and note whether the computer slept during the pilot.                          | Any sleep shows up as missed runs, handled by the missed-run rule.                                      |

## Starting over

`docker compose --profile pilot down -v` stops everything and deletes all data, including the test API's clock. Then delete `pilot/results/`, and start again from step 2.
