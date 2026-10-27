# Browser regression coverage

The Playwright suite runs Chromium against Vite's **production preview**, so it catches bundled
CSS ordering problems as well as interaction failures. `npm run check` runs lint, type checks,
builds, unit tests and this suite in CI. No database or model provider is needed.

## Run and inspect

From the repository root:

```sh
npm ci
npm run test:e2e
npm run check
# Build and run a focused case:
npm run build --workspace=apps/web
npm run test:e2e --workspace=apps/web -- --grep 'failed reply'
# Inspect the last report or a failed test's trace:
npx playwright show-report apps/web/playwright-report
npx playwright show-trace apps/web/test-results/<case>/trace.zip
```

Use Node 26 or newer, as required by the root package. Chromium downloads on the first run;
CI also installs its system libraries. On Linux, `npx playwright install-deps chromium` installs
missing libraries. The preview owns port 5190 with `strictPort` and refuses to reuse an existing
server. Wait for another worktree's suite to finish before running; never reuse its build or stop
its server. The suite uses two workers, no automatic retries, and a three-minute total timeout.

Each test gets an isolated browser context and intercepted API calls. API writes update only the
fixture in that context. Fixtures abort requests to other origins and serve local app assets;
none forwards API calls to a real service. New chat tests also fail on unexpected API paths.
Keep fixture responses, dates, actor, timezone and locale explicit. The new chat tests fix the
browser date, wait for fonts, and reduce motion before geometry assertions. Controlled pending
responses exercise busy states without relying on a particular server speed.

Failures retain screenshots and traces in `apps/web/test-results/`; the HTML report is in
`apps/web/playwright-report/`. These directories are ignored. Geometry cases also save named
screenshots through `testInfo.outputPath`, alongside their test results. Open the report to see
assertions, API traffic, DOM snapshots, screenshots and browser errors.

## Coverage matrix

This is a behavior inventory, not a statement-coverage percentage. “Existing” means coverage
already present when CA-54 began; “Added” records the gaps filled by CA-54. Tests named below
live under `apps/web/e2e/`.

| Flow | Existing coverage | Added in CA-54 | Remaining limits |
| --- | --- | --- | --- |
| Endeavor creation | `endeavors.test.ts`: cancel/Close/Escape; focus trap and restoration; name normalization/invalid names; membership; failed save retains input; busy submission; success focuses chat | Audited and retained | No real backend membership or persistence check |
| Ordinary chat | Empty composer and draft preservation in `endeavors.test.ts`; revision failure in `agent-history.test.ts` | `chat.test.ts`: send payload and rendered message; blank validation; keyboard mention selection; multiline input; reply/cancel; reply target link; failed send retains draft, mentions and reply; busy duplicate prevention; retry | No real model execution, streaming, clipboard permissions or large-history pagination |
| Mentioning a specialist | Member dialog search, history and failure in `endeavors.test.ts` | `chat.test.ts`: no matches/Escape; failed membership cannot send or alter draft; retry adds the specialist before sending the exact mention | Fixture membership, not server authorization |
| Message and output inspection | `agent-history.test.ts`: exact run, legacy message, conversation boundary, outputs/events, pagination, keyboard/Escape, loading/error/retry/empty states, revision, controls/review | Failed output inspection retries the same run and preserves the chat draft | No filesystem downloads or external source-page validation |
| Agent configuration | `agents.test.ts`: creation, selection/removal/undo, save/version migration, discard, deletion impact and confirmation; themes/phone layout | Required instructions/model validation; failed save retains provider, instructions, model, skills, connections and all limits; busy save/discard; exact retry payload; one new version; saved fields on reopening | API-level validation remains in unit/route tests; no paid provider calls |
| Action approvals | `approvals.test.ts`: Pending/History, approval success, empty/history error and responsive layout; `connections.test.ts`: exact MCP arguments | Approve **and** reject failure/retry; reason retention; busy controls; keyboard traversal; exact write; resulting History status/reason; loading and failed Pending with poll recovery | No external action execution |
| Access approvals | `access-requests.test.ts`: ongoing approval, rejection, scope, phone layout and discovery | Audited and retained | Does not test all server grant/revocation combinations in the browser |
| Shared navigation | `endeavors.test.ts`: destinations, route/selection restore, people switching, pagination, sidebar resize/collapse, touch/keyboard, responsive counts; `management.test.ts`: legacy routes | Audited and retained | Chromium only; no browser/device farm |
| Schedules | All original Schedules cases retained: one-line badges, clipping/overlap, frame, empty/loading-error, themes/widths and keyboard; later management filters | Audited and retained | Real recurrence and DST behavior use service/unit tests |
| Catalogs and authentication | Creation, failure retention, configuration, credentials, MCP discovery and OAuth setup in their existing suites | Audited and retained | OAuth redirects and external identity providers are mocked |

## Visual assertions and review

The suite uses geometry contracts and review screenshots, **not pixel-diff golden images**.
There are no image baselines to regenerate or silently accept. Review a changed assertion against
the approved reference first, then inspect the corresponding screenshot at each theme and width.

- Chat: [MessageBox](design/style-guide/components/MessageBox/README.md) and
  [Message](design/style-guide/components/Message/README.md) define one attach/input/send row,
  a picker above it, reply context, and hover actions. New dark/light cases at 1440px and 390px
  assert control order, containment, alignment, picker visibility and option clipping, and no page
  overflow. Screenshots are `chat-mention-reply.png` in each test's result directory.
- Inspection: [agent history references](design/agent-history/README.md) define the contextual
  Details panel and exact-run selection. Existing tests cover 1440px/390px in both themes.
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
