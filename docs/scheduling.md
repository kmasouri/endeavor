# Recurring responsibilities

A **responsibility** is work an agent does on a schedule with nobody asking each time, such as "test the checkout flow every hour". Admins set them up with `POST /responsibilities`: agent, title, brief, completion criteria, `intervalMinutes` (5 or more), an optional `conversationId` for results, an optional `startAt`, and a `missedRunPolicy`.

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

- `run_once` (the default): start one run for the latest missed slot. The run's brief says how many runs were missed.
- `skip`: start no run, and wait for the next slot.

Either way, the next run is the first slot after now, so missed runs never pile up. A run less than one interval late isn't missed; it simply runs. Each run's key is its time slot (`schedule:<id>:<slot>`), and only the runner that moves the schedule on starts the run. So a slot never runs twice, even with several runners or after a crash.

## Starting a run by hand or from an event

`POST /responsibilities/:id/runs` starts a run now without changing the schedule. Use it for outside events, such as "a deploy finished". `note` adds details to the run's brief, and sending the same `runKey` again returns the same run. This is the supported event trigger for now: watching connections for events on their own is future work (CA-22).

`GET /responsibilities/:id/runs` is the run history.
