# Endeavor identity and migration (CA-56)

Endeavor is the product, repository, package, and local installation name. The repository is
[kmasouri/endeavor](https://github.com/kmasouri/endeavor); the private packages are `endeavor`,
`@endeavor/api`, and `@endeavor/web`. The checkout directory is `endeavor` and the app mark is E.
CA ticket IDs, Git history, persisted record IDs, and API routes do not change.

## Current identifiers

| Surface                                                     | Identity                                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| Repository and checkout directory                           | `endeavor`                                                             |
| Root / workspace packages                                   | `endeavor`, `@endeavor/api`, `@endeavor/web`                           |
| Browser/app/onboarding/Setup and API documentation          | Endeavor / Endeavor API                                                |
| Compose project, containers, network, image                 | `endeavor`, `endeavor-*-1`, `endeavor_default`, `endeavor-app`         |
| Docker volumes                                              | `endeavor_postgres-data`, `endeavor_workspaces`, `endeavor_pilot-data` |
| Local Postgres database, role, schema, development password | `endeavor`                                                             |
| Browser selected person and startup theme                   | `endeavor.actorId`, `endeavor.theme`                                   |
| Terraform default project name and new-stack image examples | `endeavor`, `endeavor-sandbox-service`                                 |
| Hub, PRD, Architecture, current source links                | Endeavor, canonical repository URL                                     |

An endeavor is a shared work context, distinct from an agent's task or run. CA-52 separately
owns Endeavors navigation, Recent, + New, header search, and the creation dialog. The stored
conversation model and `/conversations` URLs stay unchanged. Workspace is reserved for future
team boundaries in product navigation; technical per-task filesystem workspaces keep their meaning.

## Existing installations: migrate before starting the new Compose project

Changing a project name alone creates empty volumes. Changing Postgres environment variables
alone does not rename an initialized database or role. Stop writers and migrate the data first.
Do not use `docker compose down -v` during migration.

1. Stop the previous app and pilot API, specifying the previous Compose project explicitly.
   Record the app/DB ports, volume mounts, and all table counts/content hashes. Save the existing
   `.env`, `pg_dump -Fc` database backup, and `pg_dumpall --globals-only` role backup outside the
   checkout in a private directory (`umask 077`). Keep `CREDENTIALS_KEY` and provider keys unchanged.
2. Stop Postgres cleanly. Archive each old volume with `tar` and verify the archives. Create empty
   `endeavor_postgres-data`, `endeavor_workspaces`, and `endeavor_pilot-data` volumes; copy every
   source volume while stopped, preserving ownership and permissions (`cp -a`). Refuse to overwrite
   a pre-existing destination. Custom Compose project names need their own explicit source names.
3. Start an isolated temporary Postgres container on the copied volume, with no published ports.
   Connect to the maintenance database `postgres` using the original role. Rename the application
   database, then create a temporary local superuser to rename the original role: PostgreSQL refuses
   to rename the current session user. The local default installation uses these statements:

   ```sql
   ALTER DATABASE bold_cedar_007 RENAME TO endeavor;
   CREATE ROLE endeavor_identity_migration LOGIN SUPERUSER;
   -- Reconnect locally as endeavor_identity_migration, database postgres:
   ALTER ROLE bold_cedar_007 RENAME TO endeavor;
   ALTER ROLE endeavor PASSWORD 'endeavor';
   -- Reconnect as endeavor, database postgres:
   DROP ROLE endeavor_identity_migration;
   ```

   The password above is only the disposable local development default. Preserve custom passwords
   in installations that use them. Renaming the role preserves its OID, ownership, and permissions.
   Stop and remove the temporary container before starting Compose.

4. Update only the database identity fields in the existing `.env` (and `DATABASE_URL` if set).
   Preserve its encryption key, model keys, ports, budgets, and other settings. Keep the same web
   origin so existing browsers can migrate their preferences. Start the new project with
   `docker compose --profile pilot up -d --build` if the pilot was previously enabled.
5. Rename the Postgres schema with `ALTER SCHEMA bold_cedar_007 RENAME TO endeavor`, then rebuild
   the database from the current schema files, keeping its data (see
   [Rebuilding the database](local.md#rebuilding-the-database)). The schema files (CA-70) create
   `endeavor` directly and no longer carry the rename.
6. Verify health, people/preferences, every application table's count/content hash, history,
   encrypted connection records, task files, pilot state, and volume mounts. Test restoring the
   logical backup into a disposable database and migrating it. Compare restored data as well.
7. Only after those checks pass, remove the stopped previous containers/network, old volume copies,
   and old image tag. Keep verified backups outside the checkout. Rename the checkout directory to
   `endeavor`, update shortcuts, and recreate the new project's containers from the new directory
   so Compose labels and the pilot bind mount point at the new path.

To update other checkouts:

```bash
git remote set-url origin https://github.com/kmasouri/endeavor.git
git fetch origin
# Rename the checkout directory to endeavor from its parent, if needed.
npm ci
npm run check
```

The local app still uses its configured host ports; this installation remains at port 3100.
Browser startup automatically copies existing person/theme preferences into the `endeavor.*`
keys and removes the previous keys only after saving succeeds. A newer Endeavor preference wins
if both keys exist. Blocked storage writes leave the old value available. Clearing the selected
person clears both names so an old choice cannot reappear.

## Rollback

Keep the original environment and verified logical/volume archives until the renamed installation
is accepted. Stop the new project before restoring. Recreate the old namespace's volumes from the
archives with original ownership, restore the original environment, and run the previous app
commit with the previous project name. A logical restore is also possible using the backed-up
roles and database dump. Do not restore over a running or newer database; any new writes after
migration must first be backed up and reconciled. Browser keys migrate on first load; an old app
would need its previous keys restored from `endeavor.*` for the same saved selection.

## AWS and deployment

Terraform now defaults to `project_name = "endeavor"`. An existing stack must explicitly pin its
previous `project_name` before planning; the new default can otherwise replace ALB/ECR/ECS/IAM
resources. New installations use Endeavor directly. Do not apply replacements to an existing stack
without a separate state/data/deployment migration. Repository OIDC subjects must use
`repo:kmasouri/endeavor:environment:sandbox`; update `github_repository` in existing values and
review the expected in-place trust-policy change. Preserve database access and CREDENTIALS_KEY.

No GitHub deployment environment, repository variables, local Terraform state, or AWS/Terraform
CLI were present at audit time. No cloud resources were renamed or recreated, and no cloud
verification is claimed. The full local installation has been migrated.

## Historical and migration-only names

The first CA-56 delivery (PR #57) temporarily retained local identifiers. Kayvan then requested a
full local rename; the second delivery supersedes that compatibility default. Old names remain
only where they describe migration sources, immutable SQL history, dated records, and design
provenance. The runtime migration reader must recognize the old schema and browser keys to
upgrade an existing installation; those are not active destination names.

Approved design HTML, fragments, SVGs, screenshots, and generated token metadata still record the
original board appearance. The quoted "Collaborative Agents app design" title identifies their
source. Owner-led source/export refresh is tracked separately in [CA-58](https://app.notion.com/p/4031a83d088f81968d5dd41f6581ed05).
Historical Git commits, merged PR descriptions, CA ticket IDs, and dated work logs are not rewritten.

## Verification on October 24, 2026

The first delivery passed 427 API, 29 web unit, 11 pilot, and 10 Playwright tests, clean install,
Docker startup, both-theme live browser checks, and authenticated legacy repository redirect checks.

The full local migration additionally verifies fresh/repeated/failed/ambiguous schema migrations,
legacy browser-key upgrade, newer preference precedence, blocked storage writes, and cleared
selection behavior. Every application table's before/after data hash matches, as does a restored
logical backup after migration. Task-file and pilot-state content hashes match the volume archives.
The database, role, schema, ledger, containers, network, volumes, image, and directory now use
Endeavor. Old Docker resources were retired only after backup-restore verification.
