# Local check runtime and test audit

CA-109 follow-up, 2026-11-04. This document records the local audit and benchmarks collected
before publishing the changes. Hosted CI results are recorded on the pull request and ticket.

## Measurements

Measured on the same eight-core ARM64 computer (32 GiB RAM), Node v26.10.0, with npm dependencies
and Chromium already installed. Both the baseline and new checks include lint, type checks,
every workspace build, 831 unit/pilot tests, and the full selected browser suite. These are
local wall times, not estimates for GitHub runners. A fresh dependency installation is excluded
from both measurements.

| Configuration | Browser cases | Full check |
| --- | ---: | ---: |
| Existing main: sequential checks, two browser workers, traces on | 171 | 186.8s |
| Lean suite: parallel checks, four browser workers, traces on | 109 | 76.3s |
| Lean suite: same parallel checks, traces opt-in | 109 | 61.2s |
| Current worker budget: one API worker, four browser workers | 109 | 60.5s |
| Repeat of the current configuration | 109 | 59.8s |

The first draft had a stale screenshot condition caught by type checking. It is excluded from
passing benchmark results. Increasing overlap alone did not improve performance: browser work
competed with compilers. Disabling automatic full-trace recording removed a measured overhead.
Small differences between runs should be treated as runtime variance. The final configuration
passed twice at 60.5s and 59.8s, about 68% less wall time than the 186.8s baseline.

## What was removed

The browser suite drops from 171 cases to 109 (62 fewer, about 36%). The removed copies replayed
the same functional flow at every theme/width combination. Representative desktop and phone
cases cover both themes across the suite. Schedules retain wide, tablet, and phone layouts.
Appearance and connection editing perform writes/retries/discard once, then resize the existing
form for desktop/phone containment checks. The single removed approval happy-path test was
already covered by the more thorough approval retry case.

| Browser suite | Before | After |
| --- | ---: | ---: |
| access-requests.test.ts | 4 | 4 |
| agent-history.test.ts | 21 | 15 |
| agents.test.ts | 24 | 15 |
| approvals.test.ts | 9 | 6 |
| catalog-creation.test.ts | 8 | 5 |
| chat-pagination.test.ts | 6 | 6 |
| chat.test.ts | 17 | 11 |
| composer-send.test.ts | 4 | 4 |
| connection-edit.test.ts | 8 | 3 |
| connection-oauth.test.ts | 21 | 11 |
| connections.test.ts | 2 | 2 |
| endeavors.test.ts | 24 | 13 |
| management.test.ts | 7 | 5 |
| mentions.test.ts | 5 | 2 |
| schedules.test.ts | 11 | 7 |

Distinct failure/retry, busy state, keyboard/focus, exact payloads, history isolation, lost-send
responses, cancellation, read markers, and authorization-related browser assertions remain.
The 764 API, 39 web, 17 executor, and 11 pilot tests are retained because they cover separate
contracts and rules and are inexpensive compared with browser instrumentation.

Success screenshots are no longer captured by default. `E2E_SCREENSHOTS=1` restores review
images and puts them in each test's own result directory instead of shared `/tmp` paths.
Failure screenshots remain automatic. Detailed traces are opt-in with
`--trace=retain-on-failure` or `--trace=on`; the default records no full trace for passing tests.

## Parallel execution

`npm run check` runs lint, type checks, unit/pilot tests, API/executor builds, and the web build
concurrently. Browser tests wait only for the web build. API Jest uses one worker; local
Playwright uses four. All phase results are awaited and any failure makes the command fail.
The runner prints phase times and a temporary directory containing separate logs and
`results.json`. It forwards interruption signals to the process groups it starts.

`npm run check:quality` runs the same quality checks locally without starting browsers. The
CI workflow runs lint, types, builds, unit/pilot tests, and four browser shards in one
matrix with `fail-fast: true`, with two browser workers per shard. Putting all heavy checks in
one matrix makes cancellation apply across quality checks and browser shards. Each browser
shard uses `--max-failures=1`; local browser defaults and the local check runner are unchanged. Offline
shard enumeration yields 28/27/27/27 cases: all 109 appear exactly once. The existing aggregate
`check` job requires the complete validation matrix to pass. A failure cancels remaining queued
or running matrix jobs in the same workflow run; it does not cancel other PRs' workflow runs.

## Validation and reproduction

```sh
npm run check
npm run check:quality
# Use the production bundle for a focused browser run:
npm run build --workspace=apps/web
E2E_SCREENSHOTS=1 npm run test:e2e --workspace=apps/web -- --grep 'composer.*geometry' --trace=on
```

Local runner probes verify successful execution, nonzero exit on type-check failure, browser
suppression after a failed web build, and quality-only execution without browsers. The actual
full checks also verify all task commands and the production-preview browser path. A focused
three-case run verifies opt-in page/element screenshots and retained traces. Workflow YAML is
validated locally; actual hosted CI timing remains tracked separately on the pull request.

## GitHub-only failure cancellation follow-up

The eight CI checks now share one matrix: lint, types, build, unit/pilot tests, and four browser
shards. `strategy.fail-fast: true` cancels queued/running siblings after any matrix job fails.
The browser commands use `--max-failures=1` so a shard reports failure after its first failed
test instead of completing all remaining cases. Automatic browser retries remain disabled.
Other PRs' workflow runs are unaffected. The aggregate `check` gate still rejects any
non-success matrix result.

This follow-up leaves the local check runner and local Playwright defaults unchanged. Validation:
parsed and checked all eight matrix rows and the aggregate gate, verified the installed
Playwright CLI stops after an injected first failure without executing a second test, and
passed the complete local check again in 61.6 seconds. Actual GitHub cancellation remains
a hosted-workflow check; the local probes do not establish GitHub cancellation behavior.

## Container-based browser jobs

The browser matrix rows now run `scripts/ci-browser.sh` using the public Microsoft image in
`.github/ci-browser-image.txt`, pinned by version and immutable multi-platform manifest digest.
The image already provides Node 26.13.0, Playwright browsers, and Linux libraries. Quality jobs
continue to use `.nvmrc`'s Node 26.10.0 on the host. The wrapper checks that the image Node major
matches `.nvmrc` and that the pinned Playwright version matches the web package before installing
anything. A Node-major or Playwright mismatch was deliberately tested and rejected.

No custom CI image is built or published, and no separate image archive cache is added. Each
fresh runner pulls the published image. npm download caching remains, mounted into the container.
The browser container installs only the web workspace (160 packages rather than all 545), builds
the production bundle, and runs its shard. Host Node setup, host npm install, browser downloads,
and apt library installation are removed from browser jobs. Quality commands are unchanged.

Measured locally on ARM64:

| Operation | Observed time | Scope |
| --- | ---: | --- |
| First image pull | 31.8s | Image absent locally; download and unpack included |
| Full 109-case container run | 60.7s | Image already pulled; initially empty npm cache; install, build, and two-worker tests included |
| One exact CI shard, 28 cases | 24.5s | Image already pulled and npm downloads cached; install and build included |

The full browser run passed all 109 cases; the shard passed all 28 selected cases. Dependency
installation took about 5 seconds with an empty npm cache and 3 seconds with it warm. These are
local measurements, not hosted CI timing. A fresh GitHub runner still pays the image pull cost;
the 24.5-second shard figure must not be presented as its total cold runtime. The downloaded
ARM64 image occupies about 2.50 GB uncompressed and includes browsers beyond Chromium.

The wrapper propagates a failing container exit status and removes its container on normal
completion or interruption. Cancellation uses an interruptible background-process wait so the
shell can run cleanup promptly. Controlled Docker-client probes verified success, preservation
of exit code 37, and SIGTERM exit 143 with cleanup and no surviving client. Matrix/YAML checks
verify all eight jobs still share fail-fast cancellation and the aggregate gate.

The host full check encountered another worktree using port 5190; that run was left undisturbed.
The final full `npm run check` passed in 66.9 seconds in an isolated container using the host
Node 26.10.0 installation mounted read-only and a disposable source copy. This run included
all lint/type/build phases, 831 unit/pilot tests, and 109 browser tests. It is a validation run
on a shared machine, not a replacement for the earlier local baseline comparison. No running
app or shared checkout was modified during local verification. The CI image is public and
requires no repository-owned image publication.
