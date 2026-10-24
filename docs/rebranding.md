# Endeavor identity and compatibility (CA-56)

Endeavor is the product name. The repository is [kmasouri/endeavor](https://github.com/kmasouri/endeavor),
the root npm package is `endeavor`, and the private workspaces are `@endeavor/api` and
`@endeavor/web`. These names replace Bold Cedar 007, bold-cedar-007, and Collaborative Agents
as active product branding. The app mark is E. Package versions and ticket IDs are unchanged.

## Surfaces and replacement map

| Surface                                                               | Current identity or treatment                                                                   |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| GitHub repository, clone instructions, origin                         | `kmasouri/endeavor`                                                                             |
| Root/workspace manifests and lockfile                                 | `endeavor`, `@endeavor/api`, `@endeavor/web`                                                    |
| Browser title, app header, error heading, onboarding                  | Endeavor                                                                                        |
| OpenAPI title and static web test fixture                             | Endeavor API / Endeavor                                                                         |
| Disposable manual Docker image examples                               | `endeavor`                                                                                      |
| New Terraform stack example                                           | `project_name = "endeavor"`; image `endeavor-sandbox-service`                                   |
| Project Hub, PRD, Architecture, coverage, active ticket references    | Endeavor; canonical repository links                                                            |
| Conversation-first UI wording and navigation                          | Audited; CA-52 owns the coordinated Endeavors, Recent, + New, search, and dialog implementation |
| Existing exports, screenshots, board titles, generated token metadata | Retained approved source/provenance; see below                                                  |

An endeavor is a shared work context, distinct from an agent's task or run. Workspace is reserved
for future team boundaries in product navigation. Technical per-task filesystem workspaces keep
their established meaning. The stored conversation model and `/conversations` URLs stay in place.
CA-52 remains open; this branding change does not ship its navigation or creation behavior.

## Existing checkouts

GitHub redirects old repository, issue, and pull-request links after a rename. Use the canonical
URL for new references, and do not recreate a repository at the old name while redirects are needed.
The working directory does not need to be renamed. Update each checkout separately:

```bash
git remote set-url origin https://github.com/kmasouri/endeavor.git
git fetch origin
npm ci
npm run check
```

The `ca-` branch convention and CA ticket IDs are project history, not a product brand mark.
Old commits, merged PR descriptions, ticket titles describing the rebrand, and dated work logs
retain their original wording. No releases or Git tags are rewritten.

## Local data and browser preferences

The Compose project name is explicitly pinned to `bold-cedar-007`, the namespace used by the
existing installation. This keeps the same network, service containers, generated app image name,
and `bold-cedar-007_postgres-data`, `bold-cedar-007_workspaces`, and
`bold-cedar-007_pilot-data` volumes even if a new checkout is named `endeavor`.
If an installation already uses a custom `-p` or `COMPOSE_PROJECT_NAME`, continue using that same
value. Check `docker compose ls`, `docker compose config --volumes`, and `docker volume ls`
before starting from a renamed folder. Never run `down -v` as part of a rebrand.

The SQL schema, migration ledger, local database name, database user, and local development
password retain `bold_cedar_007`. This includes config defaults, `.env.example`, Compose,
repositories, and already-shipped numbered SQL files. Changing POSTGRES_USER/POSTGRES_DB on an
initialized volume does not rename its contents. Keep existing DATABASE_URL settings and
CREDENTIALS_KEY; credentials must remain decryptable with their original key.

The browser keys `collaborative-agents.actorId` and `collaborative-agents.theme` are compatibility
identifiers. Keeping them preserves the selected person and startup theme. Person preferences
still come from Postgres. Keep the same app origin (host and port) to retain browser storage.
All conversation IDs, message history, tasks/runs, schedules, grants, task folders, and API routes
are unchanged. No SQL migration, record rewrite, or credential rotation is needed.

To update the local app, run `npm run up` with the original `.env` and project namespace. Check
`/health`, `/app/`, `/docs/json`, the same people/history, and the same volume mounts after startup.

## AWS and deployment

The Terraform `project_name` default intentionally remains `bold-cedar-007` for existing state.
New stacks explicitly choose `endeavor` in `terraform.tfvars.example`. Do not copy new-stack
examples over an existing installation's resource names, image URI, or environment settings.
Changing a name used by ALB, ECR, ECS, or IAM can replace resources; a brand change does not
justify that. Preserve the current ECR_REPOSITORY, ECS_CLUSTER, ECS_SERVICE, AWS role ARN,
database settings, and credential key in GitHub's deployment environment.

Repository identity is different: GitHub OIDC subjects include the repository name. For an existing
AWS deployment, first allow `repo:kmasouri/endeavor:environment:sandbox` in the deployment role's
trust policy alongside the previous subject. After the rename, set
`github_repository = "kmasouri/endeavor"` in the existing Terraform values, review a plan, and
apply only the expected in-place trust-policy update. Verify a deployment using the existing
image repository, service, and database; then remove the old subject. Do not apply resource
replacements or create a second stack. GitHub environment settings follow the repository rename;
the AWS trust policy does not.

This checkout has a local Compose installation. At audit time GitHub had no deployment
environments or repository variables, no separate repository Projects feature, no Terraform state
files in the checkout, and no AWS/Terraform CLI available. No AWS resources were renamed or
recreated, and no cloud deployment is claimed as verified. The templates and migration sequence
above cover future/external installations.

## Approved design references

The design READMEs describe Endeavor as the current product. The quoted
"Collaborative Agents app design" board title identifies the source of existing exports.
HTML, editable fragments, screenshots, SVGs, `style-guide/tokens.json`, generated token CSS,
and the app's matching token copy remain untouched: these are approved design artifacts,
not text to replace globally. Their CA marks and old headings record the approved pre-rebrand
appearance. A board-owner refresh must change the original source and export matching HTML,
source, tokens, and screenshots together. The implemented app uses Endeavor now; unchanged
archives do not override that approved product name. The remaining board refresh is tracked in [CA-58](https://app.notion.com/p/4031a83d088f81968d5dd41f6581ed05),
split from CA-56 with the source-owner workflow requirement recorded on both tickets.

## Verification on October 24, 2026

- `npm ci` and `npm run check` passed under Node 26: 427 API tests, 29 web unit tests,
  11 pilot tests, and 10 Playwright tests. No dependencies were upgraded.
- Browser checks exercised the production bundle in both themes, branding, navigation, reload,
  the existing selected-person key, and narrow layouts. A read-only local Docker smoke check
  also verified onboarding, Setup/Schedules navigation, both themes, `/health`, and the
  `Endeavor API` OpenAPI title at the existing local origin.
- Rebuilt and restarted only the existing Compose app. Postgres and the pilot API stayed running.
  Before/after row counts and content hashes matched for people/preferences (1), conversations
  (12), messages (65), responsibilities (2), grants (10), and encrypted connection records (2).
  After restart the existing task history remained readable: 32 tasks, 576 events, 41 outputs.
- Authenticated Git access through the former repository URL returned the same HEAD, and the
  former PR API URL resolved to the renamed repository. This private repository returns 404
  to unauthenticated web requests; public redirect access is not implied.
- Active-reference sweep retained only the compatibility and provenance exceptions above.
  CA-58 owns the remaining source-board and export refresh; CA-52 owns the new navigation.
