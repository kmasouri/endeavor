# Browser regression coverage

The Playwright suite runs Chromium against Vite's **production preview**, so it catches bundled
CSS ordering problems as well as interaction failures. `npm run check` starts lint, type checks,
unit/pilot tests, API/executor builds, and the web build together. Browser tests start as soon as
the web build passes. Each phase prints its runtime and saves its output in the temporary log
folder printed at startup. Any failed phase makes the command fail. `npm run check:quality`
runs the same checks without browser tests.

The CI workflow runs lint, types, builds, unit/pilot tests, and four browser shards in
one matrix with `fail-fast: true`. A failed matrix job cancels the remaining queued/running
matrix jobs in that workflow run, including quality checks and browser shards. Each CI browser
shard stops after its first failed test (`--max-failures=1`); automatic retries remain disabled.
The final `check` job requires the complete matrix to succeed. Local checks retain their existing
behavior and finish all phases so their diagnostics can be inspected together. Superseded
runs for the same PR are canceled; main pushes run independently. No database or model provider
is needed.

## Run and inspect

From the repository root:

```sh
npm ci
npm run test:e2e
npm run check
# Build and run a focused case:
npm run build --workspace=apps/web
npm run test:e2e --workspace=apps/web -- --grep 'failed reply'
# Save review images from successful cases as well as automatic failure captures:
E2E_SCREENSHOTS=1 npm run test:e2e --workspace=apps/web -- --grep 'composer.*geometry'
# Record a trace when debugging a focused failure:
npm run test:e2e --workspace=apps/web -- --grep 'failed reply' --trace=retain-on-failure
# Inspect the last report or a recorded trace:
npx playwright show-report apps/web/playwright-report
npx playwright show-trace apps/web/test-results/<case>/trace.zip
```

Use Node 26 or newer, as required by the root package. Chromium downloads on the first local run.
On Linux, `npx playwright install-deps chromium` installs missing libraries. CI browser shards
instead run through `scripts/ci-browser.sh` in the official Playwright image pinned by version
and manifest digest in `.github/ci-browser-image.txt`. It contains Node 26, browsers, and Linux
libraries; no browser/system-library installation or separate image cache is used in CI.
The image currently provides Node 26.13.0; quality checks keep `.nvmrc`'s Node 26.10.0. The wrapper
checks the Node major and pinned Playwright version before installing dependencies.

Each browser container installs only the web workspace with `npm ci --workspace=apps/web
--include-workspace-root=false`, builds the production bundle, and runs its shard. npm download
caching is retained in a mounted cache directory. Container cancellation removes the running
container, and nonzero exit status fails the matrix job. Quality checks still run on the host.
The image is already published by Microsoft; this repository does not build or publish a CI
image. Update the pinned digest when changing Playwright versions and verify the new runtime.
For local reproduction, pass a disposable checkout to the wrapper: `bash scripts/ci-browser.sh
/path/to/disposable-checkout --shard=1/4 --max-failures=1`. It replaces that checkout's
`node_modules`; `CI_BROWSER_NPM_CACHE` can select a separate npm download cache directory.

The preview owns port 5190 with `strictPort` and refuses to reuse an existing server. Wait for
another worktree's suite to finish before running; never reuse its build or stop its server.
The suite uses four workers locally and two per CI shard, no automatic retries, and a five-minute
total timeout. Use `--workers=2` on a smaller computer. API Jest tests use one worker to leave CPU
capacity for the other local checks.

Each test gets an isolated browser context and intercepted API calls. API writes update only the
fixture in that context. Fixtures abort requests to other origins and serve local app assets;
none forwards API calls to a real service. New chat tests also fail on unexpected API paths.
Keep fixture responses, dates, actor, timezone and locale explicit. The new chat tests fix the
browser date, wait for fonts, and reduce motion before geometry assertions. Controlled pending
responses exercise busy states without relying on a particular server speed. For polling and
elapsed-time tests, install `page.clock` before navigation and before a fixture fixes the date,
then advance the clock after changing fixture state. Keep assertions after each advance so
requests and rendering finish before the next transition. Do not replace polling with direct
reload calls: the test must still prove that the app's timers trigger the update.

Failures retain screenshots in `apps/web/test-results/`; the HTML report is in
`apps/web/playwright-report/`. These directories are ignored. Success screenshots are opt-in
with `E2E_SCREENSHOTS=1`; the shared capture helper writes them to the current test's result
folder. Failure screenshots remain automatic. Full tracing is off by default because
`retain-on-failure` records every passing test before discarding its trace. Add
`--trace=retain-on-failure` for a focused rerun, or `--trace=on` to keep successful traces too.
Recorded traces include API traffic, DOM snapshots, screenshots, and browser errors.

## Coverage matrix

This is a behavior inventory, not a statement-coverage percentage. “Existing” means coverage
already present when CA-54 began; “Added” records the gaps filled by CA-54. Tests named below
live under `apps/web/e2e/`.

| Flow | Existing coverage | Added in CA-54 | Remaining limits |
| --- | --- | --- | --- |
| Endeavor creation | `endeavors.test.ts`: cancel/Close/Escape; focus trap and restoration; name normalization/invalid names; membership; failed save retains input; busy submission; success focuses chat | Audited and retained | No real backend membership or persistence check |
| Ordinary chat | Empty composer and draft preservation in `endeavors.test.ts`; revision failure in `agent-history.test.ts` | `chat.test.ts`: send payload and rendered message; blank validation; keyboard mention selection; multiline input; reply/cancel; reply target link; failed send retains draft, mentions and reply; busy duplicate prevention; retry | `chat-pagination.test.ts` covers 620+ messages, 50-message windows, anchored prepends, burst arrivals, unread markers and retries at desktop/phone widths; no real model execution, streaming or clipboard permissions |
| Visible tags and exact mentions | `message-format.test.ts`: longest names, punctuation, Unicode and word boundaries | `mentions.test.ts`: tool-created agent/human tags, no duplicate written tags, typed/pasted overlapping names and repeated tags | Production-preview API fixtures; no model calls |
| Mentioning a specialist | Member dialog search, history and failure in `endeavors.test.ts` | `chat.test.ts`: no matches/Escape; failed membership cannot send or alter draft; retry adds the specialist before sending the exact mention | Fixture membership, not server authorization |
| Message and output inspection | `agent-history.test.ts`: exact run, legacy message, conversation boundary, outputs/events, pagination, keyboard/Escape, loading/error/retry/empty states, revision, controls/review | Failed output inspection retries the same run and preserves the chat draft | No filesystem downloads or external source-page validation |
| Agent configuration | `agents.test.ts`: creation, selection/removal/undo, save/version migration, discard, deletion impact and confirmation; themes/phone layout | Required instructions/model validation; failed save retains provider, instructions, model, skills, connections and all limits; busy save/discard; exact retry payload; one new version; saved fields on reopening | API-level validation remains in unit/route tests; no paid provider calls |
| Action approvals | `approvals.test.ts`: Pending/History, approval success, empty/history error and responsive layout; `connections.test.ts`: exact MCP arguments | Approve **and** reject failure/retry; reason retention; busy controls; keyboard traversal; exact write; resulting History status/reason; loading and failed Pending with poll recovery | No external action execution |
| Access approvals | `access-requests.test.ts`: ongoing approval, rejection, scope, phone layout and discovery | Audited and retained | Does not test all server grant/revocation combinations in the browser |
| Shared navigation | `endeavors.test.ts`: destinations, route/selection restore, people switching, pagination, sidebar resize/collapse, touch/keyboard, responsive counts; `management.test.ts`: legacy routes | Audited and retained | Chromium only; no browser/device farm |
| Schedules | All original Schedules cases retained: one-line badges, clipping/overlap, frame, empty/loading-error, themes/widths and keyboard; later management filters | Audited and retained | Real recurrence and DST behavior use service/unit tests |
| Connection editing | `connection-edit.test.ts`: HTTP profile, endpoint, header, methods, paths and approvals; Save/Discard; failure/retry and busy state; persistence on reload; OAuth rename and explicit disconnect; authentication changes; desktop and 320px/390px phone geometry in both themes | Configuration updates send only changed fields and preserve stored credentials and MCP tool permissions | OAuth provider and persistence are mocked; live smoke checks use the running app |
| Catalogs and authentication | Creation, failure retention, configuration, credentials, MCP discovery and OAuth setup in their existing suites; connection errors stay in the failing section, with retry and shared busy controls | Refresh/disconnect busy states, unchanged-status feedback, signed-out disabling, errors/retries, failed post-disconnect reload and repeated refresh geometry/focus/opacity | OAuth redirects and external identity providers are mocked |

## Visual assertions and review

The suite uses geometry contracts and review screenshots, **not pixel-diff golden images**.
There are no image baselines to regenerate or silently accept. Review a changed assertion against
the approved reference first, then inspect the corresponding screenshot at each theme and width.

- Chat: [MessageBox](design/style-guide/components/MessageBox/README.md) and
  [Message](design/style-guide/components/Message/README.md) define one attach/input/send row,
  a picker above it, reply context, and hover actions. Representative light desktop and dark phone cases at 1440px and 390px
  assert control order, containment, alignment, picker visibility and option clipping, and no page
  overflow. Screenshots are `chat-mention-reply.png` in each test's result directory.
- Inspection: [agent history references](design/agent-history/README.md) define the contextual
  Details panel and exact-run selection. Tests cover a light 1440px desktop and a dark 320px phone.
- Agents, catalogs and approvals: existing cases check shared frame alignment, filters, responsive
  controls and footer placement. See [design references](design/README.md).
- Schedules: the original production badge regression asserts single-line text/icon alignment,
  clipping, overlap and centered layout. The original regression failed before PR #54's CSS fix;
  CA-54 retains it along with all later schedule cases.

When changing CSS, test the production build. A passing text assertion does not prove the control
is inside its frame or on the same line. To check a geometry assertion's sensitivity, temporarily
introduce the specific bad layout in the local stylesheet, rebuild, and run only that case. Record
the failing assertion, restore the stylesheet, rebuild and show the same case passes. Do not commit
the deliberate defect. This is a test-sensitivity experiment, not a claim that the defect shipped.

Keep user-facing behavior changes separate from fixture corrections. If a new test finds a real
bug, reproduce it before fixing it, include the regression with the fix, and verify the running
local app after merge as required by AGENTS.md. Test/documentation-only changes need no deployment.

CA-54 sensitivity check: temporarily setting `.composer { flex-direction: column; }` in the
production stylesheet made the dark 390px chat case fail with `aligned: false` and
`ordered: false`. Restoring the stylesheet and rebuilding made it pass. The experiment changed
no committed app code; it proves the new assertion detects a broken composer even when its text
and controls remain present.

Agent profile appearance tests run preview, failed-save retry, saved/reloaded colors and icons,
discard without writes, and reset without a configuration version once. They resize the editor
between 320px and 1280px for containment checks instead of replaying every write in six layouts.
Connection editing follows the same pattern at 320px and 1440px.

Participant profiles retain author-name/avatar opening, keyboard and Escape/focus restoration,
outside dismissal, directory details, deleted and unavailable authors, and member cards inside
the native members dialog. The profile layout cases use light desktop and dark 320px phone
settings. Other suites retain 390px, tablet, wide desktop, and both themes where they exercise
separate layouts.

## Test audit

The local CA-109 follow-up reduces 171 browser cases to 109. Most removed cases were cross-product
copies of the same behavior at several widths in both themes. Functional failures, retries,
authorization boundaries, payload assertions, keyboard/focus, and distinct layouts remain.
Tests cover representative desktop/phone theme pairs rather than every theme at every width.
One approval happy-path test was removed because the approval retry test already verifies the
same Pending-to-History transition and adds payload, busy-state, and failure assertions.

The API, web, executor, and pilot unit suites are retained: they run quickly and cover separate
contracts, domain rules, and failure modes. Counts are not the pruning criterion. See
[local runtime measurements](ci-performance.md) for the benchmark and per-suite changes.
