# GitHub coding and review (CA-78)

Coding and review use ordinary agents, the GitHub MCP connection, and an optional execution
connection. There is no built-in engineering role or agent supervisor. People select each
agent's connections and add participants to an endeavor.

## Start work in an endeavor

Open an endeavor and add Coding agent and Code reviewer as participants. Explicitly
@mention the agent you want to start work. Messages, approvals, run steps, and outputs
then stay with that endeavor. Standalone Work tasks do not appear as runs inside an
endeavor.

## Connect GitHub

Open Connections, create a connection, and choose the GitHub MCP example. Its endpoint is
`https://api.githubcopilot.com/mcp/`. Save a GitHub personal access token as `Bearer …` in the
credential field. Prefer a fine-grained token restricted to the repositories and permissions
needed. The token account determines repository access; a tool allowlist does not restrict
repositories. GitHub's hosted MCP server does not support dynamic client registration, so
Endeavor's generic OAuth sign-in cannot connect it. A registered GitHub App flow is separate
future work. See [GitHub's host guide](https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md).

After saving, discover tools. Allow repository reading, PR inspection, and the specific write
tools needed for the workflow. Leave writes requiring approval. A tool can have both read and
write operations; inspect its schema before permitting it unattended. Never infer policy from
a tool's name or annotations. Do not allow merge, branch deletion, or administrative tools for
these examples. The default endpoint supplies repository, issue, and PR tools; GitHub also
offers [toolset endpoints](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md).

Select the connection explicitly in the agent configuration. Saving a connection, discovering
tools, and filling an example grant no access on their own.

## Start isolated execution

The optional `apps/executor` service is a trusted broker. It holds a read-only GitHub snapshot
credential and controls Docker. Only this service receives the Docker socket. Run one broker
per Docker daemon: startup removes containers with its dedicated executor label. Do not run
multiple brokers against the same daemon.

Set `EXECUTOR_TOKEN` to at least 32 random characters, `EXECUTOR_REPOSITORIES` to a comma-separated
allowlist such as `owner/repo`, and optionally `EXECUTOR_GITHUB_TOKEN` for private repositories.
Use a separate token with Contents read permission. Keep the broker on the private Compose
network; it exposes no host port. The trusted app supplies both its connection credential and
the task identity. Anyone who can access the broker credential can impersonate a task, so do
not distribute it to agents, source files, or untrusted clients.

Build the base sandbox image, then start the broker alongside the existing Compose project:

```bash
docker build -f apps/executor/sandbox/Dockerfile -t endeavor-sandbox:local .
docker compose -f docker-compose.yml -f compose.coding.yml --profile coding up -d --build executor
```

The base image has Node and npm. Commands run offline and inherit one CPU of affinity, so test runners size
their worker pools to the execution budget. Large projects may still need serial workers
(for Endeavor, `npm test --workspace apps/api -- --runInBand`). Browser binaries and system
libraries must be installed in the image; runtime installation cannot use root or the network. For a project needing installed packages,
build an operator-controlled image containing its dependencies in `/opt/node_modules`, retain
the worker entrypoint and the taskset utility, and set `EXECUTOR_IMAGE` to that image. The worker links these read-only
packages into a fresh writable node_modules directory, so tool caches stay local to the run. Image builds happen outside agent execution. Use the
repository's lockfile, avoid embedding credentials or private registry configuration, and rebuild
the image when dependencies change. The broker never pulls images during a task. A missing image
fails the execution. Projects needing another toolchain can provide it in the configured image.

The included `apps/executor/sandbox/Dockerfile.endeavor` builds Endeavor's Node dependencies and
browser test runtime. With PLAYWRIGHT_BROWSERS_PATH set by the image, the test wrapper uses
the installed browsers without attempting downloads or root package installation. It is an example of a project image, not an automatic dependency installer.

Create a connection using the Isolated execution example: `http://executor:3200/mcp`, with
`Bearer <EXECUTOR_TOKEN>`. Discover its tools and choose approvals deliberately. Reading and
polling tools can run unattended. Checkout, file mutation, commands, cancellation, and discard
remain approval-gated until a person explicitly permits them. Select it on each agent that
needs execution. The main app still has no shell or Docker socket.

## Agent examples and workflow

The New agent form links to Coding agent and Code reviewer examples. Both fill editable
instructions only. Choose a model and provider, select connections, save, and add the agents
to the endeavor. No example starts work or spends model budget.

1. Give the coding agent a repository, base ref, scoped change, and completion criteria.
2. It checks out an immutable commit, reads and edits its task checkout, and starts commands.
   Commands return execution IDs immediately; `get_execution` reports status and bounded logs.
   `list_executions` recovers IDs if a response is lost. Status reads wait up to 20 seconds
   outside the task lock, reducing model polling without delaying cancellation.
3. It compares `repository_changes` with the intended change. These are changed paths and
   hashes, not an automatic publication. Read file content before using GitHub write tools.
4. A completed command has an exit code. Only exit zero with `verifiedRevision` equal to
   `currentRevision` verifies the current files. If the command modified files, inspect them
   and repeat verification. Later edits invalidate that evidence. Save the command, commit,
   revision, execution ID, and relevant log with `save_output`.
5. GitHub tools create a task branch and draft PR through their configured approval policy.
   They do not share a filesystem with the broker. Publish only intended files. Re-check out
   the published commit and run checks again against that exact commit.
6. A reviewer reads the PR diff, relevant source, and CI. It can check out the exact head in
   its own task to reproduce a finding. The agents can ask each other questions when both are
   participants. External reviews require the requested publication and configured approvals.
   Humans retain merge authority.

Files and changes can be read in pages using the returned offsets.

Binary source is preserved in snapshots but text editing and publishing examples do not handle
binary changes. Symlinks, submodules, vendored node_modules, and special files are unsupported. A failed export never
silently drops them: it leaves the preceding checkout intact and reports failure. Repositories
are limited to 2,500 files and 20 MB of exported content, with a 2 MB limit per file. GitHub
archive downloads have a separate 20 MB cap. `list_repository_files` is paginated.

## Isolation, lifecycle, and recovery

Each command receives a serialized snapshot in a fresh container. No host checkout, workspace
volume, Docker socket, provider credential, platform environment, or other task's files are
mounted or passed to it. The container has no network, a read-only root, user 1000, no Linux
capabilities, no new privileges, bounded tmpfs space, one CPU, 2 GiB memory, processes, file size, and
open files. An init process reaps command descendants. The broker fixes the image and limits; tool arguments cannot change them.
These controls are defense in depth around the shared host kernel, not a virtual machine.
See [Docker security](https://docs.docker.com/engine/security/) and
[resource limits](https://docs.docker.com/engine/containers/resource_constraints/).

Commands have a ten-minute outer deadline and an independent worker deadline. The broker runs
at most two executions and keeps at most four task checkouts. Each task is serialized: edits,
checkout replacement, and discard wait until the current execution ends or is cancelled.
`cancel_execution` stops the container and discards its changes. A platform task cancellation
does not send a broker cancellation automatically; an existing command ends at its deadline
at the latest. Revocation prevents subsequent MCP calls but likewise does not undo a command
already started. Container commands cannot publish externally because they have no network.

Each run starts from the recorded source. Create new source files with `write_repository_file`.
Commands may modify or remove existing source files; new generated files and directories are
ephemeral and are discarded after the run. Build and test in the same command when tests need
build output. This keeps caches, reports, and timestamps out of source revisions. Only a complete,
validated source snapshot is imported. A nonzero test exit is recorded as a finished,
failing check; container failure, timeout, invalid export, or cancellation preserves the preceding
checkout. Command logs are capped at 16,000 characters. The existing platform MCP result cap may
truncate a long result further. Source code and logs are task evidence, so never put secrets in
them. Platform and provider secrets are not injected into the command environment.

State is saved atomically in the `execution-data` volume. A broker restart removes labelled
leftover containers, marks running jobs interrupted with unknown outcome, and never replays
commands. Poll the recovered execution and verify again. The broker keeps 20 execution summaries
per task. Inactive checkouts are removed after 24 hours; discard can remove them earlier. The agent examples release finished checkouts after saving evidence. Read-only probes do not
reserve a workspace. Saved platform outputs and history remain. Broker shutdown cancels active work. Preserve the volume
and the Compose project when refreshing the app.

## Verification

`npm run check` includes broker validation, MCP authentication and task ownership, file safety,
failing checks, cancellation, revision invalidation, restart recovery, and browser setup tests.
These tests need no database or Docker daemon. The explicit Docker smoke check exercises the
real container boundary without an account or model:

```bash
docker build -f apps/executor/sandbox/Dockerfile -t endeavor-sandbox:local .
npm run verify:sandbox --workspace apps/executor
```

Real GitHub discovery and private snapshots require a token. A complete live coding/review run
also needs configured agent models, selected connections, an appropriate execution image, and
human approvals for external writes. Do not mark this workflow verified solely from mocked tests.
