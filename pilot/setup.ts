// Sets up both pilots from CA-3 through the platform's API, in one command:
//
//   npm run pilot:setup -- --cheap-model <model> --strong-model <model>
//
// It creates (or reuses, by name) the connections, skills, agents, the pilot 2 conversation, and
// the pilot 2 schedule, and starts the test API's clock. Everything is ordinary configuration:
// no pilot-specific platform code. What it made is saved in pilot/results/state.json.
//
// Add --dry-run to set everything up on the free `scripted` provider, to check the setup itself.
// See docs/pilot.md for the whole runbook.

import {
  Api,
  ApiError,
  parseArgs,
  type PilotState,
  readStateIfAny,
  saveState,
  STATE_PATH
} from './client.ts';
import { ENDPOINTS, WINDOW_COUNT } from './plan.ts';

// Per-task caps are set above the CA-3 targets, so the pilot measures overruns instead of
// cutting work off right at the target. Monthly budgets cap the whole pilot's spending.
const BUDGETS = {
  researcher: { perTask: 0.6, monthly: 4 },
  reviewer: { perTask: 0.4, monthly: 4 },
  solo: { perTask: 1, monthly: 3 },
  checker: { perTask: 0.2, monthly: 3 },
  investigator: { perTask: 0.1, monthly: 2 },
  checkConversation: 5
};

const NAMES = {
  researcher: 'Researcher',
  reviewer: 'Reviewer',
  solo: 'Solo Researcher',
  checker: 'Checker',
  investigator: 'Investigator',
  wikipedia: 'Wikipedia (read-only)',
  testApi: 'Pilot test API',
  checkConversation: 'Pilot 2: scheduled API check',
  checkResponsibility: 'Check the test API'
};

interface Named {
  id: string;
  name: string;
}

interface Responsibility {
  id: string;
  title: string;
  status: string;
}

const args = parseArgs(process.argv.slice(2));
const dryRun = args['dry-run'] === true;
const apiUrl = str(args.api) ?? process.env.PILOT_API_URL ?? 'http://localhost:3000';
// Where the platform reaches the test API. In Docker that is the pilot-api service.
const targetUrl =
  str(args['target-url']) ?? process.env.PILOT_TARGET_URL ?? 'http://pilot-api:4100';
// Where this script reaches the test API, to start its clock.
const targetAdminUrl =
  str(args['target-admin-url']) ?? process.env.PILOT_TARGET_ADMIN_URL ?? 'http://localhost:4100';
const intervalMinutes = Number(
  str(args.interval) ?? process.env.PILOT_CHECK_INTERVAL_MINUTES ?? 10
);
const provider = dryRun ? 'scripted' : (str(args.provider) ?? 'openai');
const cheapModel = dryRun
  ? 'scripted'
  : (str(args['cheap-model']) ?? process.env.PILOT_CHEAP_MODEL);
const strongModel = dryRun
  ? 'scripted'
  : (str(args['strong-model']) ?? process.env.PILOT_STRONG_MODEL);

function str(value: string | true | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function fail(message: string): never {
  console.error(`\nSetup stopped: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 5) {
    fail('--interval must be a whole number of minutes, 5 or more.');
  }
  if (!cheapModel || !strongModel) {
    fail(
      'Name the two models: --cheap-model <model> --strong-model <model>, or set PILOT_CHEAP_MODEL and PILOT_STRONG_MODEL.'
    );
  }
  if (!dryRun) {
    checkPrices([cheapModel, strongModel]);
    // Setup reuses agents by name, so it would pick up the dry run's scripted agents.
    if (readStateIfAny()?.dryRun) {
      fail(
        `${STATE_PATH} is from a dry run. Start from a fresh database (docker compose down -v, then npm run up) and delete ${STATE_PATH} first.`
      );
    }
  }

  const api = new Api(apiUrl);
  await api.get('/health').catch((error: unknown) => {
    fail(`the platform isn't answering at ${apiUrl} (${String(error)}). Start it with npm run up.`);
  });
  await fetch(`${targetAdminUrl}/_pilot/state`).catch((error: unknown) => {
    fail(
      `the test API isn't answering at ${targetAdminUrl} (${String(error)}). Start it with npm run pilot:api.`
    );
  });

  console.log(`Setting up the pilots on ${apiUrl}${dryRun ? ' (dry run, scripted provider)' : ''}`);
  api.actorId = str(args.actor) ?? (await findOrCreatePerson(api));

  if (!dryRun) {
    const providers = await api.get<{ provider: string; ready: boolean }[]>('/providers');
    if (!providers.find((item) => item.provider === provider)?.ready) {
      fail(`the ${provider} provider isn't ready. Set its API key in .env and restart the app.`);
    }
  }

  // Connections. Reading needs no approval; nothing else is allowed.
  const wikipedia = await findOrCreateConnection(api, {
    name: NAMES.wikipedia,
    description: 'Read-only access to English Wikipedia: search, page summaries, and page text.',
    baseUrl: 'https://en.wikipedia.org',
    allowedMethods: ['GET'],
    allowedPathPrefixes: ['/w/api.php', '/api/rest_v1/page/'],
    approvalMethods: [],
    // Wikipedia asks API clients to name themselves.
    authHeader: 'Api-User-Agent',
    credential: 'bold-cedar-007 pilot (local test)'
  });
  const testApi = await findOrCreateConnection(api, {
    name: NAMES.testApi,
    description: 'The pilot test API. Read-only.',
    baseUrl: targetUrl,
    allowedMethods: ['GET'],
    allowedPathPrefixes: ['/api/'],
    approvalMethods: []
  });

  // Skills.
  const researchSkill = await findOrCreate<Named>(api, '/skills', {
    name: 'Research brief',
    description:
      'How to research a topic and write a one-page brief with a source for every claim.',
    instructions: RESEARCH_SKILL,
    connectionIds: [wikipedia]
  });
  const reviewSkill = await findOrCreate<Named>(api, '/skills', {
    name: 'Claim review',
    description: 'How to check a brief claim by claim against its sources.',
    instructions: REVIEW_SKILL,
    connectionIds: [wikipedia]
  });
  const checkSkill = await findOrCreate<Named>(api, '/skills', {
    name: 'API check',
    description: 'How to check the test API endpoints and report broken ones.',
    instructions: checkSkillText(),
    connectionIds: [testApi]
  });
  const diagnoseSkill = await findOrCreate<Named>(api, '/skills', {
    name: 'Failure diagnosis',
    description: 'How to find the likely cause of a broken API endpoint.',
    instructions: DIAGNOSE_SKILL,
    connectionIds: [testApi]
  });

  // Agents. Peers on different models; none is in charge of another.
  const agents = {
    researcher: await findOrCreateAgent(api, {
      name: NAMES.researcher,
      purpose: 'Researches a topic and drafts a one-page brief with sources.',
      instructions: RESEARCHER,
      model: cheapModel,
      skillIds: [researchSkill],
      budget: BUDGETS.researcher
    }),
    reviewer: await findOrCreateAgent(api, {
      name: NAMES.reviewer,
      purpose: 'Checks every claim in a brief against its source and signs off.',
      instructions: REVIEWER,
      model: strongModel,
      skillIds: [reviewSkill],
      budget: BUDGETS.reviewer
    }),
    solo: await findOrCreateAgent(api, {
      name: NAMES.solo,
      purpose: 'Baseline for pilot 1: researches and writes a brief alone, with the same tools.',
      instructions: SOLO,
      model: strongModel,
      skillIds: [researchSkill],
      budget: BUDGETS.solo
    }),
    checker: await findOrCreateAgent(api, {
      name: NAMES.checker,
      purpose: 'Checks the test API on a schedule and reports broken endpoints.',
      instructions: CHECKER,
      model: cheapModel,
      skillIds: [checkSkill],
      budget: BUDGETS.checker
    }),
    investigator: await findOrCreateAgent(api, {
      name: NAMES.investigator,
      purpose: 'Diagnoses a broken endpoint and replies with its likely cause.',
      instructions: INVESTIGATOR,
      model: strongModel,
      skillIds: [diagnoseSkill],
      budget: BUDGETS.investigator
    })
  };

  // Pilot 2: a conversation for results, and the schedule.
  const conversation = await findOrCreate<{ id: string; title: string }>(
    api,
    '/conversations',
    { title: NAMES.checkConversation, agentIds: [agents.checker, agents.investigator] },
    'title'
  );
  await api.patch(`/conversations/${conversation}`, { budgetUsd: BUDGETS.checkConversation });
  const documents = await api.get<{ title: string }[]>(`/conversations/${conversation}/documents`);
  if (!documents.some((document) => document.title === 'Test API reference')) {
    await api.post(`/conversations/${conversation}/documents`, {
      title: 'Test API reference',
      content: apiReference()
    });
  }

  const existing = (
    await api.all<Responsibility>(`/responsibilities?agentId=${agents.checker}`)
  ).find((item) => item.title === NAMES.checkResponsibility && item.status !== 'cancelled');
  // The schedule and the test API's clock start together, so run N lands in window N. The
  // clock starts a minute before the first run, so a slightly late run is still in its window.
  const firstRun = new Date(Math.ceil((Date.now() + 2 * 60_000) / 60_000) * 60_000);
  let responsibilityId: string;
  let checksStartAt: string;
  if (existing) {
    console.log(`  reused schedule "${existing.title}" (${existing.status})`);
    responsibilityId = existing.id;
    checksStartAt = readStateIfAny()?.checksStartAt ?? '';
  } else {
    const responsibility = await api.post<{ id: string }>('/responsibilities', {
      agentId: agents.checker,
      conversationId: conversation,
      title: NAMES.checkResponsibility,
      brief:
        'Check every endpoint on the test API against the check list in your API check skill. Report the result in the conversation in the required format. For each broken endpoint, ask the Investigator for the likely cause first, and include it.',
      completionCriteria:
        'Every endpoint on the check list was called once. The report has one "BROKEN:" line per broken endpoint with the Investigator\'s likely cause, or says "ALL OK".',
      intervalMinutes,
      missedRunPolicy: 'ask',
      startAt: firstRun.toISOString()
    });
    responsibilityId = responsibility.id;
    checksStartAt = firstRun.toISOString();
    console.log(
      `  created schedule "${NAMES.checkResponsibility}", every ${intervalMinutes} minutes`
    );
    await startTestApiClock(new Date(firstRun.getTime() - 60_000));
    if (dryRun) {
      // The scripted provider does no real work, so don't let it run 20 times.
      await api.post(`/responsibilities/${responsibilityId}/pause`);
      console.log('  paused the schedule (dry run)');
    }
  }

  // Keep the briefs already started, so setup can be run again safely.
  const state: PilotState = {
    apiUrl,
    actorId: api.actorId,
    dryRun,
    agents,
    skills: {
      research: researchSkill,
      review: reviewSkill,
      check: checkSkill,
      diagnose: diagnoseSkill
    },
    connections: { wikipedia, testApi },
    checkConversationId: conversation,
    responsibilityId,
    intervalMinutes,
    checksStartAt,
    targetAdminUrl,
    briefs: readStateIfAny()?.briefs ?? []
  };
  saveState(state);

  const spendCap = Object.values(BUDGETS)
    .filter((budget) => typeof budget === 'object')
    .reduce((sum, budget) => sum + budget.monthly, 0);
  console.log(`
Done. Saved to ${STATE_PATH}.
  Pilot 1: run npm run pilot:brief -- --topic 1 (and --solo for the baseline).
  Pilot 2: ${WINDOW_COUNT} checks, every ${intervalMinutes} minutes${checksStartAt ? `, from ${checksStartAt}` : ''}.
  Spending can't pass $${spendCap} a month across the pilot agents (their monthly budgets).
  Open ${apiUrl} to watch.`);
}

// Dollar budgets only stop spending when the model has a price. Refuse to start without one.
function checkPrices(models: string[]): void {
  let prices: Record<string, unknown> = {};
  try {
    prices = JSON.parse(process.env.MODEL_PRICES ?? '{}') as Record<string, unknown>;
  } catch {
    fail('MODEL_PRICES in .env is not valid JSON.');
  }
  const missing = models.filter((model) => !prices[model]);
  if (missing.length > 0) {
    fail(
      `MODEL_PRICES in .env has no price for ${missing.join(' and ')}. Without one, budgets can't stop spending. Add it, restart the app, and run setup again.`
    );
  }
}

async function startTestApiClock(startAt: Date): Promise<void> {
  const response = await fetch(`${targetAdminUrl}/_pilot/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intervalMinutes, startAt: startAt.toISOString() })
  });
  if (!response.ok) {
    fail(`the test API didn't start its clock (${response.status}).`);
  }
  console.log(`  started the test API clock at ${startAt.toISOString()}`);
}

async function findOrCreatePerson(api: Api): Promise<string> {
  const people = await api.get<Named[]>('/humans');
  if (people.length > 0) {
    return people[0].id;
  }
  const person = await api.post<Named>('/humans', { name: 'Kayvan', role: 'admin' });
  console.log(`  created person ${person.name}`);
  return person.id;
}

// Finds an item by name (or title) in a list, or creates it. Returns its id.
async function findOrCreate<T extends { id: string }>(
  api: Api,
  path: string,
  body: Record<string, unknown>,
  key: 'name' | 'title' = 'name',
  listPath: string = path
): Promise<string> {
  const items = await api.all<T & Record<string, unknown>>(listPath);
  const found = items.find((item) => item[key] === body[key]);
  if (found) {
    console.log(`  reused ${path.slice(1)} "${String(body[key])}"`);
    return found.id;
  }
  const created = await api.post<T>(path, body);
  console.log(`  created ${path.slice(1)} "${String(body[key])}"`);
  return created.id;
}

async function findOrCreateConnection(api: Api, body: Record<string, unknown>): Promise<string> {
  try {
    return await findOrCreate<Named>(api, '/connections', body);
  } catch (error) {
    // Without CREDENTIALS_KEY the platform can't store a header value. Go on without it.
    const name = (error as ApiError).body as { error?: { name?: string } } | undefined;
    if (body.credential && name?.error?.name === 'credentialsKeyMissing') {
      const { authHeader: _header, credential: _credential, ...rest } = body;
      return findOrCreate<Named>(api, '/connections', rest);
    }
    throw error;
  }
}

async function findOrCreateAgent(
  api: Api,
  input: {
    name: string;
    purpose: string;
    instructions: string;
    model: string;
    skillIds: string[];
    budget: { perTask: number; monthly: number };
  }
): Promise<string> {
  const id = await findOrCreate<Named>(
    api,
    '/agents',
    {
      name: input.name,
      purpose: input.purpose,
      instructions: input.instructions,
      provider,
      model: input.model,
      skillIds: input.skillIds,
      limits: { maxCostUsd: input.budget.perTask, maxWorkingMinutes: 30, maxModelTurns: 40 }
    },
    'name',
    '/agents?includeDisabled=true'
  );
  await api.patch(`/agents/${id}`, { monthlyBudgetUsd: input.budget.monthly });
  return id;
}

function checkSkillText(): string {
  const list = ENDPOINTS.map((endpoint) => `- GET ${endpoint.path}: ${endpoint.expect}`).join('\n');
  return `Use the "${NAMES.testApi}" connection. Call each endpoint below once with GET, and compare the response with what a healthy one looks like.

${list}

An endpoint is broken when its status or body doesn't match. Report in the conversation, one line per broken endpoint, exactly like this:

BROKEN: /api/example - what is wrong - likely cause from the Investigator

If nothing is broken, report "ALL OK". Don't write "BROKEN:" for an endpoint that is fine. Use the path without its query string.`;
}

function apiReference(): string {
  const list = ENDPOINTS.map((endpoint) => `- GET ${endpoint.path}: ${endpoint.expect}`).join('\n');
  return `# Test API reference

A small shop API used for the scheduled check pilot. Every endpoint is read-only.

${list}

Common causes of failures:
- 5xx errors: the server or its database is down or erroring.
- 401 or 403: sign-in or a token changed or expired.
- A missing or renamed field: the response format changed in a deploy.
- HTML instead of JSON: a maintenance page or proxy error page is being served.
- Values out of range, such as negative stock: a data or sync bug.`;
}

const RESEARCH_SKILL = `Gather facts from the documents in the conversation, and from Wikipedia through the "${NAMES.wikipedia}" connection with http_request:
- Search: GET /w/api.php?action=query&list=search&srsearch=<words>&format=json&srlimit=5
- Summary of a page: GET /api/rest_v1/page/summary/<Page_Title>
- Plain text of a page: GET /w/api.php?action=query&prop=extracts&explaintext=1&format=json&titles=<Page_Title>

Write the brief in at most about 400 words. Mark each claim with a source number like [1], and end with a numbered source list. A source is a conversation document's title, or a page URL like https://en.wikipedia.org/wiki/<Page_Title>. Leave out any claim you can't source.`;

const REVIEW_SKILL = `Check the brief claim by claim. For each claim, open its cited source (a conversation document, or the Wikipedia page through the "${NAMES.wikipedia}" connection) and confirm it says what the claim says. Flag claims with no source, a wrong source, or wording that goes beyond the source. Also check that the brief is one page or less (about 400 words).`;

const DIAGNOSE_SKILL = `Call the broken endpoint yourself through the "${NAMES.testApi}" connection, and compare the response with the "Test API reference" document in the conversation. Give the most likely cause in one or two sentences, and say how sure you are. Don't guess beyond what the response shows.`;

const RESEARCHER = `You write one-page research briefs when a person asks for one.
1. Research the topic and draft the brief, following your Research brief skill.
2. Ask the ${NAMES.reviewer} to check the draft: use ask, and include the full draft.
3. Fix what the ${NAMES.reviewer} finds, and answer its questions. Ask it again until it signs off.
4. Save the final brief with save_output, then finish with complete_task.
If the request is unclear, ask the person who asked before you start.`;

const REVIEWER = `You check research briefs that others ask you to review, following your Claim review skill.
Reply to the one who asked: either "Signed off", or a numbered list of problems to fix. Ask a follow-up question if a claim's source is unclear. Don't rewrite the brief yourself.`;

const SOLO = `You write one-page research briefs when a person asks for one. You work alone.
Research the topic and write the brief, following your Research brief skill. Before you finish, check every claim against its source yourself. Save the final brief with save_output, then finish with complete_task.
If the request is unclear, ask the person who asked before you start.`;

const CHECKER = `You check the test API when your schedule runs, following your API check skill.
For each broken endpoint, ask the ${NAMES.investigator} for the likely cause (use ask, and include the path, the status, and what was wrong). Then post one report in the conversation in the required format, and finish with complete_task.`;

const INVESTIGATOR = `When someone asks you about a broken endpoint, find its likely cause, following your Failure diagnosis skill. Reply to the one who asked with the cause and how sure you are.`;

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
