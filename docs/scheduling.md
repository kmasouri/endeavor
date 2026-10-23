# Recurring responsibilities

A **responsibility** is work an agent does on a schedule with nobody asking each time, such as "test the checkout flow every hour". People set them up with `POST /responsibilities`: agent, title, brief, completion criteria, `intervalMinutes` (5 or more), an optional `conversationId` for results, an optional `startAt`, and a `missedRunPolicy`.

Each run is an ordinary task with `responsibilityId` set, so everything about tasks applies: it pins the agent's configuration version, can wait, can need approval, has limits, and can be paused or cancelled. If the responsibility has a conversation, the run's result is posted there. The agent must already be a member of that conversation.

## The schedule is separate from its runs

| Action                                       | Effect                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Finish or cancel a run (`/tasks/:id/cancel`) | The schedule goes on.                                                                       |
| `POST /responsibilities/:id/pause`           | No new runs. A run that is already going keeps going.                                       |
| `POST /responsibilities/:id/resume`          | Runs start again, from now. Paused time doesn't count as missed.                            |
| `POST /responsibilities/:id/cancel`          | No more runs, ever. A run that is already going isn't stopped; cancel that task separately. |

## Missed runs

The platform runs on this computer, so it can't run anything while the computer is asleep or the service is stopped. When it comes back, each responsibility follows its `missedRunPolicy`:

- `ask` (the default): if only one run was missed and the next one isn't close, run it. If several were missed, or the next run is due within a quarter of the interval, don't run. Ask a person instead: the question is posted in the responsibility's conversation, mentioning its people, and shows on the Schedules page. `POST /responsibilities/:id/catch-up` with `{ "decision": "run" }` starts one run now; `"wait"` leaves it for the next scheduled run. Only the first answer counts. If nobody answers, the question lapses when the next run comes due, and that run happens as usual (`catchUpNotPending` after that).
- `run_once`: always start one run for the latest missed slot.
- `skip`: start no run, and wait for the next slot.

A run's brief says how many runs were missed. Either way, the next run is the first slot after now, so missed runs never pile up. A slot that is only a little late isn't missed; it simply runs, whatever the policy. "A little late" means within half the interval, and at most 15 minutes.

Each run's key is its time slot (`schedule:<id>:<slot>`, or `catchup:<id>:<slot>` for a catch-up a person asked for). The run is created first and the schedule moves on after, and only one runner can move a slot on. So a slot never runs twice, and a crash between the two steps doesn't lose it.

Only one run of a responsibility is open at a time. If the last run is still working, waiting, or blocked when the next slot comes, that slot is skipped and logged. `lastRunAt` only moves when a run really starts.

Changing `intervalMinutes` to a shorter one takes effect at once: the next run moves to one new interval after the last run, if that is sooner.

## Starting a run by hand or from an event

`POST /responsibilities/:id/runs` starts a run now without changing the schedule. Use it for outside events, such as "a deploy finished". `note` adds details to the run's brief, and sending the same `runKey` again returns the same run. If a different run is still going, it is refused with `responsibilityRunOpen`. This is the supported event trigger for now: watching connections for events on their own is future work (CA-22).

`GET /responsibilities/:id/runs` is the run history.
