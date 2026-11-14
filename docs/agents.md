# Agents and model providers

An agent is a configured participant. It is not a built-in role: a QA agent and a research agent are the same kind of thing with different settings. No agent is in charge of another.

## What an agent has

- **Name and purpose.** What the agent is for, shown in the directory. Changing these doesn't create a new version.
- **Configuration (versioned).** Instructions, provider, and model. Saving any change creates a new version, and versions never change once saved. Each task records the version it started with, so editing an agent never changes work that is already running or waiting. Only new tasks use the new version.
- **Skills and connections.** Chosen independently from the shared catalogs and saved with the configuration version. Skills add instructions only. `connectionIds` explicitly selects API access; every call also needs a live grant. Skill edits and upgrades never change connection selections. Removing a choice and saving revokes its grant, including for tasks on older versions. Choosing it again restores access. An unchanged choice keeps an explicit API revocation. The version and changed grants are saved atomically; a concurrent configuration change is rejected so the person can reload.

To move open work to a newer version, a person calls `POST /tasks/:taskId/version`. It defaults to the agent's current version. The change is recorded as a `task.version.migrated` event with who did it and why. Tasks never change version on their own, including after a restart. Finished tasks aren't moved: restart them instead, and the new run uses the current version.

Configuration is the place to manage access. Revoked skills, connections, and actions are checked against the current grants on every tool call, whatever version a task runs (CA-5).

**Limits** (`limits` on the configuration, saved with the version): `maxModelTurns`, `maxTokens` (input plus output over the task, including completion checks), `maxCostUsd` (US dollars over the task; without it, `TASK_BUDGET_USD` applies, $1 by default), and `maxWorkingMinutes` (time spent working; waiting and paused time don't count). When a task reaches a limit, it is blocked with the reason, and the person who asked is told. To let it go on, a person raises the limit, which saves a new version, and moves the task to it with `POST /tasks/:taskId/version`.

**Costs and budgets.** Each model call's cost is worked out from `MODEL_PRICES` (US dollars per million input and output tokens, per model) and saved with the call. A model with no price has an unknown cost: its tokens are still counted, and it shows up as `unpricedCalls`, but dollar budgets can't count it.

- `GET /agents/:agentId/costs`: what the agent spent in total and this month (UTC), and its costliest tasks this month.
- `GET /conversations/:conversationId/costs`: what all agent work in a conversation spent, with an
  uncapped `agents` list containing each agent's ID, display name, cost, tokens, and unpriced calls.
- An agent's **monthly budget** (`PATCH /agents/:agentId` with `monthlyBudgetUsd`) covers all its work in a calendar month. A conversation's **budget** (`PATCH /conversations/:conversationId` with `budgetUsd`) covers all agent work in it. `null` removes a budget. Neither is versioned.
- Before each model call, the task's own cap, the agent's monthly budget, and the conversation's budget are all checked. The tightest wins. A task over any of them is blocked with the reason, and the person who asked is told. Raising the budget and resuming the task lets it go on. Budgets are checked before each call, so the last call can take spending a little over the budget.

**Who sees what:** in v1 there is one role, so every person sees every task and approval. The member rules are still in the code, switched off in `apps/api/src/services/access/access.rules.ts`: with roles on, members see only tasks, and their approvals, in conversations they belong to, plus tasks they asked for.

Any person can create or change agents. Agents can't. A disabled agent takes no new tasks, but its open tasks keep going until a human pauses or cancels them.

Older versions may report review-only `legacyConnectionIds`. These inherited selections no longer authorize calls. The configuration form and version history flag affected versions. Review explicit connections, save, and migrate open tasks yourself; existing grants and pins are preserved. See [the rollout steps](catalogs.md#moving-from-inherited-connections-ca-37).

## Example configurations

These are examples, not built-in roles. Create them with `POST /agents`.

```json
{
  "name": "QA",
  "purpose": "Tests the staging site and reports failures with steps to reproduce.",
  "instructions": "Run the checkout tests. When one fails, ask Engineering to look into it, and include the steps and logs.",
  "provider": "anthropic",
  "model": "claude-opus-5-5"
}
```

```json
{
  "name": "Researcher",
  "purpose": "Finds and summarizes sources on a question.",
  "instructions": "Answer with a short summary. Cite a source for every claim. Ask a clarifying question when the request is unclear.",
  "provider": "openai",
  "model": "<an OpenAI model>"
}
```

## Providers

`GET /providers` lists each provider and whether it is ready.

| Provider    | Ready when                 | Notes                                                                                                                                                                                       |
| ----------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `anthropic` | `ANTHROPIC_API_KEY` is set | Turns on the server-side refusal fallback for models that support it.                                                                                                                       |
| `openai`    | `OPENAI_API_KEY` is set    | Calls the Responses API. Nothing is stored at OpenAI: reasoning comes back encrypted in each turn, and we save it. `OPENAI_BASE_URL` can point at a compatible API that supports Responses. |
| `scripted`  | Always                     | A fake that answers from a script. For tests and demos; no model is called.                                                                                                                 |

`anthropic` and `openai` both go through one client, `ModelAiSdkClient`, built on the [Vercel AI SDK](https://ai-sdk.dev) (`ai`). It runs one model turn per call and returns the tool calls without running them, so the runner keeps its own loop, checks, and records (CA-29). Saved turns are in the SDK's message format, the same for every provider. Turns saved before this client, or from another provider, are shown to the model as text.

You can save an agent on a provider that isn't ready. Its `providerReady` is `false`, and its tasks can't run until the key is set.

**Local execution doesn't mean local models.** The platform and its tools run on this computer, but every model call goes over the internet to the provider.

## Adding a provider

1. Add its name to `MODEL_PROVIDERS` in `apps/api/src/shared/types.ts`.
2. Add the AI SDK's package for it (`@ai-sdk/<provider>`, pinned to an exact version), and a small `AiSdkProvider` next to `createOpenAiProvider()` in `apps/api/src/integrations/models/model-ai-sdk.client.ts`, with any provider options it needs. Build it in `buildModelClients()` in `apps/api/src/plugins/runner.ts`.
3. Add its key to `apps/api/src/config.ts`, `README.md`, and `.env.example`, and turn it on in `readyProviders()` in `apps/api/src/plugins/agent.ts`.

Nothing else changes: conversations and tasks only use the `ModelClient` interface. A provider the AI SDK doesn't cover can still get its own `ModelClient`; give it its own `transcriptFormat`.

## Agents pages (CA-57)

Agents has name search and All, Enabled, and Disabled filters. Each row shows the current model,
version, provider readiness, and this month's spending against budget. New agent is a separate
page. The Researcher and QA examples fill in that form without creating an agent.

One agent has Overview, Configuration, and Versions tabs. Overview shows its configuration,
open work, profile, spending, and saved notes. Configuration lists chosen skills and connections;
clicking or focusing the picker shows available entries before typing. Typing filters the full
catalog, with at most five matches shown. Browse opens the catalog. Removing a saved choice shows the effect on open tasks and an Undo action before save.
Discard changes returns to Overview without saving. Reopening Configuration starts from the saved
version, including its skill and connection selections and limits.
Version summaries compare saved versions in the browser. People can move open tasks from an old
version to the current one; completed and cancelled tasks are excluded.

An ongoing grant through `POST /agents/:id/grants` adds the chosen item to the current
configuration as a new version. Existing tasks keep their pin until explicitly moved. Repeated
grants for an already chosen item restore access without adding duplicate versions. Approving
an agent's access request as **Ongoing** uses the same rule; see
[discovery and access requests](catalogs.md#discovery-and-access-requests-ca-38). Per-call action
approvals still allow only the exact call shown.

## Permanent deletion

Enable/disable controls whether an agent takes new work. Permanent deletion removes the agent
from configuration, lists, the directory, and participant pickers, and cannot be undone.

Enable/Disable stays visible at the top right of the agent page. A separate **Delete agent**
section at the bottom of Overview explains the effect and opens the confirmation. The person must type the exact agent name, including capitalization, before the
permanent-delete button becomes available. Closing the confirmation clears that input. The confirmation loads
`GET /agents/:agentId/deletion-impact`, which returns `tasks` and `schedules` with their IDs,
titles, and states or statuses. Cancel and Escape make no changes. The delete button stays
unavailable until the preview loads. `DELETE /agents/:agentId` requires a human actor and returns
`{ data: { deleted: true } }`.

Deletion cancels all open tasks (including paused, waiting, and blocked work), closes their waits,
cancels schedules and missed-run questions, revokes grants, and rejects pending approvals.
It also prevents approved calls that have not started from executing. These changes commit together.
The operation uses the current work in storage, including work started after the preview loaded.

Messages, outputs, run events, pinned configuration versions, and cost records remain available.
Historical membership and agent IDs remain valid; names display as **Deleted agent**. The retained
identity has no current configuration and cannot be enabled, edited, or restored. The old name can
be used by a newly created agent, which has its own identity.

The runner holds a shared Postgres advisory lock during each model call, tool call, and approved
connection call. Deletion takes the exclusive lock before cancelling work. Calls already in progress
finish before deletion completes; no later call can begin for the deleted agent. Each held execution
lock uses one pool connection; the default runner runs at most four tasks concurrently. Database
triggers lock the agent row when tasks or schedules change, preventing concurrent starts or resumes
from escaping deletion. Apply migration 035 before running this version of the app.

## Coding and review examples (CA-78)

New agent links to editable Coding agent and Code reviewer examples. They use the existing
configuration, grants, budgets, and peer collaboration model. They do not assign roles, select
connections, or start work. See [GitHub coding and review](coding.md) for the required
connections, isolated execution, verification evidence, and human publication approvals.

## Team docs specialist (CA-73)

A specialist is an ordinary agent with instructions and explicitly selected connections.
[pilot/docs-specialist.example.json](../pilot/docs-specialist.example.json) is a complete
`POST /agents` body for the fictional Juniper Parcel docs pilot. It starts with no connection
selections and cannot retrieve the docs until access is configured. Its limits cap each task
at 20 model turns, 60,000 tokens, $0.25, and 10 working minutes. No schedule is created.

Set up its source before running it:

1. Open the existing **Juniper Parcel — Notion** connection and sign in with OAuth. Use a
   provider identity whose permissions restrict reads to the Juniper Parcel root
   `4051a83d-088f-81d9-a706-e5461045f50e` and its descendants. The shared connection acts as
   that identity for every agent granted access. Naming a root in instructions or in the
   connection description does not restrict the provider's search or page reads.
2. Discover tools and inspect their exact names, descriptions, and input schemas. Allow
   only docs search and page reads. Keep write tools excluded. Permit those verified
   read-only tools to run without individual approvals; leave all other tools unavailable.
3. Check that the root and a child page are readable and that a known page outside the
   allowed root cannot be read or found in search. If the signed-in identity cannot enforce
   that boundary, use a separate restricted identity or provider integration; leave the
   agent without access until this is resolved. OAuth sign-in alone proves no content scope.
4. Create the agent from the example with `POST /agents`, using a human `x-actor-id` header.
   In its Configuration, select only the verified docs connection and save. This creates
   the live grant as well as a new configuration version. No skill is required. For an
   existing task, explicitly migrate its version or start a new task.
5. Add the specialist to an Endeavor and address it with a question. Check task events for
   successful search and page-read results, then open the cited pages and compare each
   factual claim. A missing-source response is useful evidence of a limit, but does not
   count as a successful retrieval test.

The specialist reads source pages when invoked. It does not copy the knowledge base into
saved notes or build an index. The example rejects instructions embedded in retrieved
content, reconciles archived references, and distinguishes documented policy from current
health. These instructions guide behavior; connection policies and provider permissions
enforce access. See [catalog grants and tools](catalogs.md#remote-mcp-tools-ca-64).

The example also asks the specialist to preserve conditions that affect its advice: scope,
time windows, required inputs, exceptions, and failure or escalation steps. Evaluate those
conditions against the source, not just whether the answer has citations. Use a fresh
Endeavor with the original question and no answer-key excerpts when checking a correction.
Keep the existing task and conversation limits; record incomplete answers without silently
raising budgets or retrying them.

Juniper Parcel is synthetic. Its historical incidents and example log queries cannot prove
current production health. CA-73 covers the Notion docs specialist; CloudWatch and a real
on-call pilot are outside its current scope. The recorded pilot has explicit approval for
broader read-only provider-account visibility. Its Juniper focus is an instruction, not an
enforced page boundary. That exception does not change the restricted-identity setup above
for new deployments. The ticket's linked evaluation records the approved scope and results.

## Avatar appearance (CA-92)

Overview → Profile → Edit offers a live avatar preview, three theme-aware colors (lime, sky,
teal), and ten built-in icons. Save profile applies the choices; Discard changes makes no write.
Automatic or Reset appearance restores the ID-derived tint and profile icon. Reset takes effect
only when saved. Agent identity remains in the avatar's accessible label and tooltip, with the robot corner badge and no redundant visible agent labels.

`PATCH /agents/:agentId` accepts optional `avatarColor` (`lime`, `sky`, `teal`) and `avatarIcon`
(`agents`, `search`, `check`, `file`, `work`, `connections`, `approvals`, `catalogs`, `setup`,
`schedules`). Each field accepts `null` to restore its default; omitted fields stay unchanged.
The same fields are returned on agents, directory entries, and agent conversation members.
Appearance belongs to the profile and never creates a configuration version. Existing agents
start with null overrides. Migration 017 adds the nullable columns and allowed-value constraints.
Pictures, uploads, arbitrary colors, and object storage are outside this feature.

## Public handoff profiles (CA-98)

`POST /agents` and `PATCH /agents/:agentId` accept optional `produces` and `needs`
strings (at most 500 characters each after trimming). Produces says what the agent hands
back; Needs says what input it expects. Omission preserves a field on PATCH; null or blank
text clears it. Storage returns missing values as null. Migration 023 adds the columns and
length constraints. These are public profile descriptions, not instructions, and changes
do not create a version or change grants or task pins.

New agent and Overview → Profile → Edit use the existing profile form. Save applies
the fields; Discard leaves storage unchanged. Participant popovers show purpose, skill
names from the current configuration, Produces, Needs, and status in the current endeavor.
Busy means an open task (working, waiting, or blocked), including paused work. Work in
another endeavor does not make the agent busy here. Completed and cancelled work does
not count. Directory entries have no endeavor status.

The runner and member responses use the same public projection. It selects only identity,
purpose, handoff descriptions, skill names, and endeavor status. It never selects skill
instructions, notes, credentials, connection details, or other conversations.
