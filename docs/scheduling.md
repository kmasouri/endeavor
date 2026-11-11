# Recurring responsibilities

A **responsibility** is recurring work owned by a project. Create one with
`POST /responsibilities` and send `projectId`, a title, a brief, completion criteria, and an
interval or calendar rule. Optionally set `agentId` to pin the starting agent. Set it to
`null` in a PATCH to return to automatic routing. `GET /responsibilities?projectId=<id>`
lists a project's schedules.

Each run opens a fresh endeavor in the project. The schedule's brief becomes its goal and
the completion criteria become its done criteria. The project’s default members join the
endeavor. A pinned agent starts immediately. Otherwise the decision model chooses a starting
agent from the endeavor’s available members. An uncertain decision appears in the endeavor
and waits for a person to choose an agent or end the run without assigning anyone.

Existing schedules migrate to their endeavor's project and retain their pinned agent. A
schedule with no earlier endeavor moves to the default project. Active legacy members join
the new runs alongside the project defaults. Legacy callers may still send `conversationId`
to select its project. When neither field is supplied, the schedule uses the default project.
Past tasks and links remain readable.

## The schedule is separate from its runs

| Action                                       | Effect                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Finish or cancel a run (`/tasks/:id/cancel`) | The schedule goes on.                                                                       |
| `POST /responsibilities/:id/pause`           | No new runs. A run that is already going keeps going.                                       |
| `POST /responsibilities/:id/resume`          | Intervals resume from now; calendar rules resume at the next matching source-time slot. Paused time is not missed.                            |
| `POST /responsibilities/:id/cancel`          | No more runs, ever. A run that is already going isn't stopped; cancel that task separately. |

## Missed runs

The platform runs on this computer, so it can't run anything while the computer is asleep or the service is stopped. When it comes back, each responsibility follows its `missedRunPolicy`:

- `ask` (the default): if only one run was missed and the next one isn't close, run it. If several were missed, or the next run is due within a quarter of the interval, don't run. Ask a person instead: the question appears on the Schedules page. A legacy schedule with a saved endeavor also posts the question there. `POST /responsibilities/:id/catch-up` with `{ "decision": "run" }` starts one run now; `"wait"` leaves it for the next scheduled run. Only the first answer counts. Opening the endeavor, saving the answer, and removing the question commit together. A refused or failed start leaves the question available for retry. A same-answer retry after a lost response returns the original run (or wait outcome) while the enabled schedule still has the same future next run. An opposing answer is refused. Pausing, cancelling, retiming or reaching the next slot ends that replay window. If nobody answers, the question lapses when the next run comes due, and that run happens as usual (`catchUpNotPending` after that).
- `run_once`: always start one run for the latest missed slot.
- `skip`: start no run, and wait for the next slot.

A run's brief says how many runs were missed. Either way, the next run is the first slot after now, so missed runs never pile up. For calendar rules, the interval for these thresholds is the actual UTC duration from the latest slot to the next matching slot, including weekends and clock changes. A skipped DST gap is not a missed run. A slot that is only a little late isn't missed; it simply runs, whatever the policy. "A little late" means within half the interval, and at most 15 minutes.

Each run's key is its time slot (`schedule:<id>:<slot>`, or `catchup:<id>:<slot>` for a catch-up a person asked for). The scheduled insert locks the schedule and rechecks that it is enabled and still has the slot read by the runner. A pause, cancellation, or retiming that commits first prevents that stale start. If the insert commits first, the run already exists when the schedule changes and keeps going. The run is created first and the schedule moves on after, and only one runner can move a slot on. So a slot never runs twice, and a crash between the two steps doesn't lose it.

Starts take a lock on the schedule and check for an open run, including one waiting for a routing decision or starter delivery. The next slot is skipped if the preceding run is still open. A partial unique database index also limits each responsibility to one open starter task. `lastRunAt` moves when a scheduled run opens its endeavor.

Changing `intervalMinutes` to a shorter one takes effect at once: the next run moves to one new interval after the last run, if that is sooner.

## Starting a run by hand or from an event

`POST /responsibilities/:id/runs` starts a run now without changing the schedule. Use it for outside events, such as "a deploy finished". `note` adds details to the opening message and task brief, and sending the same `runKey` again returns the same run. If a different run is still going, it is refused with `responsibilityRunOpen`. This is the supported event trigger for now: watching connections for events on their own is future work (CA-22).

`GET /responsibilities/:id/runs` returns run history, including endeavors awaiting routing. Open a run using its `conversationId`; use `taskId` to inspect the assigned task when present.

## Calendar recurrence

Send either `intervalMinutes` or `recurrence` when creating a responsibility. For example:

```json
{
  "projectId": "00000000-0000-4000-8000-000000000001",
  "agentId": null,
  "title": "Review research",
  "brief": "Review the latest research and report findings.",
  "completionCriteria": "Post findings in the run endeavor.",
  "recurrence": {
    "frequency": "weekly",
    "days": [1, 3, 5],
    "time": "09:00",
    "timeZone": "America/New_York"
  },
  "missedRunPolicy": "ask"
}
```

`frequency` is `daily`, `weekdays` (Monday to Friday), or `weekly`. Weekly rules require
1–7 unique ISO weekdays (`1` is Monday, `7` is Sunday). Other frequencies omit `days`.
`time` is a 24-hour `HH:mm` string; `timeZone` is a named IANA timezone. Unknown fields,
invalid zones or times, empty/duplicate weekday selections, and mixed interval/calendar input
return `validationError`. Calendar creation rejects `startAt`; the first slot is computed
strictly after creation. Calendar updates reject `nextRunAt`, including when a request keeps an
existing calendar rule. PATCH with `recurrence` replaces the whole rule; PATCH with
`intervalMinutes` switches back to intervals. New rules compute new future slots, and changing
only the brief or missed-run policy keeps the existing slot.

Calendar rules store their source timezone and wall-clock rule as JSON alongside durable UTC
`nextRunAt` and `lastRunAt` instants. A daily 9 AM New York rule stays 9 AM in New York across DST;
its UTC time changes. No calendar rule is simulated with an interval. `intervalMinutes` is null
for calendar schedules, and `recurrence` is null for interval schedules.

A nonexistent local time during a forward clock change is skipped. A repeated local time during
a backward change runs once at the earlier instant. The second occurrence is never another
slot, including after a restart between the two occurrences. Run keys use that chosen UTC
instant. These defaults are recorded on CA-39 in Questions for Kayvan. Half-hour transitions and
non-hour offsets follow the same rules.

Pause and cancel clear any pending catch-up question. Retiming clears it too. Catch-up answers
are accepted only while the schedule is enabled and its next slot is still in the future.
Manual runs of enabled or paused schedules leave recurrence and its next slot unchanged.
Cancelled schedules cannot be resumed or started manually. None of these actions stop an active task.

A schedule has either an interval or a calendar rule, never both; a database check enforces this.
A run key identifies the endeavor across retries and restarts.

## Web interface

Schedules uses the approved list, detail, and full-width creation screens in `docs/design/schedules/`.
The approved `docs/design/schedules-centered/` follow-up puts the heading, actions, list, and
notices in one centered frame capped at 1,220px. Rows keep next-run and status columns aligned,
then reflow to fit narrow page widths. The form detects the creator's device timezone
without a picker, previews the source rule, and keeps missed-run handling visible. The interval form sets
its first slot one interval in the future; legacy API interval creation still defaults to now.
The local computer must be awake and the service running.

The source rule always names its timezone and retains its source weekdays. Actual next-run and
history instants use the viewer's device timezone and saved 12/24-hour preference. For example,
Monday October 26, 2026 at 00:30 in New York is Sunday October 25 at 21:30 in Los Angeles; both
refer to `2026-10-26T04:30:00Z`. The source rule still says Monday in New York for both viewers.

Schedule layout regressions are covered by the committed Playwright suite in `apps/web/e2e/`,
run by `npm run check`. Tests exercise the production CSS bundle, including expanded cancelled
rows, one-line badges in both themes at desktop and phone widths, alignment, and empty states.

## Managing schedules in the web interface

The Schedules list follows the Agents page layout. Search titles, project names, agent names, and recurrence
summaries, or filter by All, Active, Paused, and Cancelled. All includes cancelled schedules;
they remain available for inspecting past runs. The count reflects the current search and
status filter. Create schedule stays in the page header, including when no schedules exist.
Opening a row shows its full-width details and existing run, pause, resume, and cancel actions.
