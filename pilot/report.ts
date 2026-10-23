// Collects the CA-3 measures for both pilots and writes a Markdown report:
//
//   npm run pilot:report
//
// It reads what setup and the brief script saved (pilot/results/state.json), the platform's
// tasks and events, the test API's request log, and your scores (pilot/results/scores.json).
// Run it as often as you like; each run writes a new file in pilot/results/.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Api, type BriefRecord, loadState, type PilotState } from './client.ts';
import {
  addUsage,
  type EventLike,
  isStalled,
  majorityWindow,
  minutesBetween,
  money,
  repeatedWork,
  staleReplyWaits,
  type TaskLike,
  taskUsage,
  type TaskUsage,
  unsupportedDone
} from './metrics.ts';
import { ENDPOINTS, parseBrokenLines, scoreRun, SEEDED_FAILURES, WINDOW_COUNT } from './plan.ts';

// CA-3 targets.
const TARGETS = {
  briefCostUsd: 0.5,
  briefMinutes: 15,
  briefsAccepted: 4,
  runCostUsd: 0.1,
  falseAlarms: 1
};

interface Message {
  id: string;
  authorType: string;
  authorId: string | null;
  body: string;
  taskId: string | null;
  createdAt: string;
}

interface Score {
  accepted?: boolean;
  edits?: 'none' | 'minor' | 'major';
  uncitedOrWrongClaims?: number;
  humanMinutes?: number;
  notes?: string;
}

interface LoggedRequest {
  at: string;
  window: number;
  path: string;
}

interface TaskReport {
  task: TaskLike;
  usage: TaskUsage;
}

const SCORES_PATH = process.env.PILOT_SCORES_FILE ?? 'pilot/results/scores.json';
const now = new Date();
const lines: string[] = [];
const out = (line = '') => lines.push(line);

async function main(): Promise<void> {
  const state = loadState();
  const api = new Api(state.apiUrl, state.actorId);
  const scores = readScores();
  const allTasks: TaskReport[] = [];

  out(`# Pilot report, ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  out();
  if (state.dryRun) {
    out('> Dry run: agents ran on the scripted provider, so these numbers only test the setup.');
    out();
  }

  allTasks.push(...(await reportBriefs(api, state, scores)));
  allTasks.push(...(await reportChecks(api, state)));
  reportHealth(allTasks);
  reportManualChecks();

  mkdirSync('pilot/results', { recursive: true });
  const path = `pilot/results/report-${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.md`;
  writeFileSync(path, lines.join('\n') + '\n');
  console.log(lines.join('\n'));
  console.log(`\nSaved to ${path}`);
}

// Pilot 1: research briefs

async function reportBriefs(
  api: Api,
  state: PilotState,
  scores: Record<string, Score>
): Promise<TaskReport[]> {
  out('## Pilot 1: research briefs');
  out();
  if (state.briefs.length === 0) {
    out('No briefs yet. Start one with `npm run pilot:brief -- --topic 1`.');
    out();
    return [];
  }

  const writers = new Set([state.agents.researcher, state.agents.solo]);
  const rows: string[] = [];
  const results: { brief: BriefRecord; minutes: number | null; cost: number; score: Score }[] = [];
  const reports: TaskReport[] = [];

  for (const brief of state.briefs) {
    const tasks = await loadTasks(api, `/tasks?conversationId=${brief.conversationId}`);
    reports.push(...tasks);
    const messages = await api.all<Message>(`/conversations/${brief.conversationId}/messages`);
    const writer = tasks.find(
      (item) =>
        writers.has(item.task.ownerAgentId) && item.task.requestMessageId === brief.messageId
    );
    const usage = tasks.reduce((sum, item) => addUsage(sum, item.usage), emptyUsage());
    const doneAt = writer?.task.state === 'completed' ? writer.task.finishedAt : null;
    const minutes = doneAt ? minutesBetween(brief.startedAt, doneAt) : null;
    const steering = messages.filter(
      (message) => message.authorType === 'human' && message.id !== brief.messageId
    ).length;
    const key = `${brief.topicNumber}-${brief.mode}`;
    const score = scores[key] ?? {};
    results.push({ brief, minutes, cost: usage.costUsd, score });
    rows.push(
      row([
        `${brief.topicNumber}`,
        brief.mode,
        writer ? describe(writer.task) : 'not started',
        minutes === null ? '-' : minutes.toFixed(1),
        money(usage.costUsd) + (usage.unpricedCalls ? ` (+${usage.unpricedCalls} unpriced)` : ''),
        `${usage.tokens}`,
        `${steering}`,
        `${usage.asks}`,
        `${usage.checksFailed}`,
        score.accepted === undefined ? '?' : score.accepted ? 'yes' : 'no',
        score.edits ?? '?',
        score.uncitedOrWrongClaims === undefined ? '?' : `${score.uncitedOrWrongClaims}`,
        score.humanMinutes === undefined ? '?' : `${score.humanMinutes}`
      ])
    );
  }

  out(
    row([
      'Topic',
      'Mode',
      'Writer task',
      'Minutes to done',
      'Cost',
      'Tokens',
      'Person messages after the request',
      'Asks between participants',
      'Failed completion checks',
      'Accepted',
      'Edits',
      'Uncited or wrong claims',
      'Your minutes'
    ])
  );
  out(row(Array(13).fill('---')));
  rows.forEach((line) => out(line));
  out();
  out(`"?" means no score yet: fill in ${SCORES_PATH} (see pilot/scores.example.json).`);
  out();

  for (const mode of ['team', 'solo'] as const) {
    const set = results.filter((result) => result.brief.mode === mode);
    if (set.length === 0) continue;
    const accepted = set.filter(
      (result) => result.score.accepted && result.score.edits !== 'major'
    ).length;
    const finished = set.filter((result) => result.minutes !== null);
    const avgMinutes = finished.length
      ? finished.reduce((sum, result) => sum + (result.minutes ?? 0), 0) / finished.length
      : null;
    const avgCost = set.reduce((sum, result) => sum + result.cost, 0) / set.length;
    const wrongClaims = set.reduce(
      (sum, result) => sum + (result.score.accepted ? (result.score.uncitedOrWrongClaims ?? 0) : 0),
      0
    );
    out(`**${mode === 'team' ? 'Team (Researcher + Reviewer)' : 'Baseline (one agent alone)'}**`);
    out();
    out(
      `- Accepted with only minor edits: ${accepted} of ${set.length}${mode === 'team' ? ` (target: ${TARGETS.briefsAccepted} of 5)` : ''}`
    );
    out(`- Uncited or wrong claims in accepted briefs: ${wrongClaims} (target: 0)`);
    out(
      `- Average cost: ${money(avgCost)}; over ${money(TARGETS.briefCostUsd)}: ${set.filter((result) => result.cost > TARGETS.briefCostUsd).length}`
    );
    out(
      `- Average minutes to done: ${avgMinutes === null ? '-' : avgMinutes.toFixed(1)}; over ${TARGETS.briefMinutes}: ${finished.filter((result) => (result.minutes ?? 0) > TARGETS.briefMinutes).length}; not finished: ${set.length - finished.length}`
    );
    out();
  }
  return reports;
}

// Pilot 2: scheduled checks

async function reportChecks(api: Api, state: PilotState): Promise<TaskReport[]> {
  out('## Pilot 2: scheduled API check');
  out();
  const runs = await api.all<TaskLike>(`/responsibilities/${state.responsibilityId}/runs`);
  const conversationTasks = await loadTasks(
    api,
    `/tasks?conversationId=${state.checkConversationId}`
  );
  const messages = await api.all<Message>(`/conversations/${state.checkConversationId}/messages`);
  const log = await fetch(`${state.targetAdminUrl}/_pilot/log`)
    .then((response) => response.json() as Promise<{ requests: LoggedRequest[] }>)
    .catch(() => null);
  const mockState = await fetch(`${state.targetAdminUrl}/_pilot/state`)
    .then((response) => response.json() as Promise<{ window: number }>)
    .catch(() => null);
  if (!log) {
    out(`> The test API at ${state.targetAdminUrl} didn't answer, so windows can't be scored.`);
    out();
  }

  const byId = new Map(conversationTasks.map((item) => [item.task.id, item]));
  const investigatorTasks = conversationTasks.filter(
    (item) => item.task.ownerAgentId === state.agents.investigator
  );
  const ordered = [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const windowsSeen = new Map<number, number>();
  const caught = new Set<string>();
  let falseAlarms = 0;
  const runCosts: number[] = [];

  out(
    row([
      'Run',
      'Window',
      'Started (UTC)',
      'State',
      'Endpoints called',
      'Reported broken',
      'Seeded failures active',
      'Caught',
      'Missed',
      'False alarms',
      'Cost'
    ])
  );
  out(row(Array(11).fill('---')));

  for (const [index, run] of ordered.entries()) {
    const end = run.finishedAt ?? now.toISOString();
    const requests = (log?.requests ?? []).filter(
      (request) => request.at >= run.createdAt && request.at <= end
    );
    const window = majorityWindow(requests.map((request) => request.window));
    if (window !== null) windowsSeen.set(window, (windowsSeen.get(window) ?? 0) + 1);
    const called = new Set(requests.map((request) => request.path.split('?')[0]));
    const report = messages
      .filter((message) => message.taskId === run.id && message.authorId === state.agents.checker)
      .map((message) => message.body)
      .join('\n');
    const reported = parseBrokenLines(report);
    const score = window === null ? null : scoreRun(window, reported);
    score?.caught.forEach((failure) => caught.add(failure.id));
    falseAlarms += score?.falseAlarms.length ?? 0;

    const investigatorUsage = investigatorTasks
      .filter((item) => item.task.createdAt >= run.createdAt && item.task.createdAt <= end)
      .reduce((sum, item) => addUsage(sum, item.usage), emptyUsage());
    const runUsage = byId.get(run.id)?.usage ?? emptyUsage();
    const cost = runUsage.costUsd + investigatorUsage.costUsd;
    runCosts.push(cost);

    out(
      row([
        `${index + 1}`,
        window === null ? '-' : `${window}`,
        run.createdAt.slice(0, 16).replace('T', ' '),
        describe(run),
        `${ENDPOINTS.filter((endpoint) => called.has(endpoint.path.split('?')[0])).length} of ${ENDPOINTS.length}`,
        reported.join(', ') || (/ALL OK/i.test(report) ? 'ALL OK' : '-'),
        score
          ? SEEDED_FAILURES.filter((f) => f.windows.includes(score.window))
              .map((f) => f.id)
              .join(', ') || '-'
          : '-',
        score?.caught.map((failure) => failure.id).join(', ') || '-',
        score?.missed.map((failure) => failure.id).join(', ') || '-',
        score?.falseAlarms.join(', ') || '-',
        money(cost)
      ])
    );
  }
  out();

  const duplicates = [...windowsSeen.values()].filter((count) => count > 1).length;
  const lastWindow = Math.min(mockState?.window ?? -1, WINDOW_COUNT - 1);
  const missedWindows: number[] = [];
  for (let window = 0; window < lastWindow; window++) {
    if (!windowsSeen.has(window)) missedWindows.push(window);
  }
  const maxCost = runCosts.length ? Math.max(...runCosts) : 0;
  const avgCost = runCosts.length ? runCosts.reduce((a, b) => a + b, 0) / runCosts.length : 0;

  out(`- Runs so far: ${runs.length} of ${WINDOW_COUNT}`);
  out(
    `- Seeded failures caught: ${caught.size} of ${SEEDED_FAILURES.length} (target: all ${SEEDED_FAILURES.length})${
      caught.size < SEEDED_FAILURES.length
        ? `; not yet: ${SEEDED_FAILURES.filter((f) => !caught.has(f.id))
            .map((f) => `${f.id} ${f.path} (windows ${f.windows.join(', ')})`)
            .join('; ')}`
        : ''
    }`
  );
  out(
    `- False alarms: ${falseAlarms} (target: at most ${TARGETS.falseAlarms} in ${WINDOW_COUNT} runs)`
  );
  out(
    `- Windows with more than one run: ${duplicates}. Past windows with no run: ${missedWindows.length ? missedWindows.join(', ') : 'none'} (target: none of either)`
  );
  out(
    `- Cost per run: average ${money(avgCost)}, highest ${money(maxCost)} (target: at most ${money(TARGETS.runCostUsd)})`
  );
  out();
  return conversationTasks;
}

// Health across every pilot task

function reportHealth(tasks: TaskReport[]): void {
  out('## Health across all pilot tasks');
  out();
  const unique = [...new Map(tasks.map((item) => [item.task.id, item])).values()];
  const stalled = unique.filter((item) => isStalled(item.task, now));
  const staleWaits = unique.filter((item) => staleReplyWaits(item.task, now).length > 0);
  const unsupported = unique.filter((item) => unsupportedDone(item.task, item.usage));
  const blocked = unique.filter((item) => item.task.state === 'blocked');
  const unpriced = unique.reduce((sum, item) => sum + item.usage.unpricedCalls, 0);

  out(`- Tasks: ${unique.length}`);
  out(`- Stalled (working, no change for 15+ minutes): ${list(stalled)}`);
  out(`- Reply waits open for 15+ minutes (missed replies?): ${list(staleWaits)}`);
  out(
    `- Repeated work (two tasks for one request): ${repeatedWork(unique.map((item) => item.task))}`
  );
  out(
    `- Completed without a passed completion check: ${list(unsupported)}${unsupported.length ? ' (expected if COMPLETION_CHECK=false)' : ''}`
  );
  out(`- Blocked: ${blocked.length ? '' : 'none'}`);
  for (const item of blocked) {
    out(`  - ${item.task.id}: ${item.task.stateReason ?? 'no reason given'}`);
  }
  out(
    `- Model failures: ${unique.reduce((sum, item) => sum + item.usage.modelFailures, 0)}. Nudges: ${unique.reduce((sum, item) => sum + item.usage.nudges, 0)}.`
  );
  if (unpriced > 0) {
    out(
      `- **${unpriced} model calls had no price**, so the dollar figures above are too low. Set MODEL_PRICES.`
    );
  }
  out();
}

function reportManualChecks(): void {
  out('## Checks done by hand');
  out();
  out(
    'Record these in the CA-2 work log, as docs/pilot.md describes: restart recovery, pause and cancel, cancelling the schedule separately, version pinning, revoking a connection, membership history, a bounded failure, and the web interface.'
  );
}

// Helpers

async function loadTasks(api: Api, path: string): Promise<TaskReport[]> {
  const tasks = await api.all<TaskLike>(path);
  return Promise.all(
    tasks.map(async (task) => {
      const details = await api.get<TaskLike>(`/tasks/${task.id}`);
      return { task: details, usage: taskUsage(await loadEvents(api, task.id)) };
    })
  );
}

async function loadEvents(api: Api, taskId: string): Promise<EventLike[]> {
  const events: (EventLike & { id: number })[] = [];
  for (let afterId = 0; ;) {
    const page = await api.get<(EventLike & { id: number })[]>(
      `/tasks/${taskId}/events?afterId=${afterId}&limit=500`
    );
    events.push(...page);
    if (page.length < 500) return events;
    afterId = page[page.length - 1].id;
  }
}

function readScores(): Record<string, Score> {
  try {
    return (JSON.parse(readFileSync(SCORES_PATH, 'utf8')) as { briefs: Record<string, Score> })
      .briefs;
  } catch {
    return {};
  }
}

function emptyUsage(): TaskUsage {
  return taskUsage([]);
}

function describe(task: TaskLike): string {
  return task.pausedAt ? `${task.state} (paused)` : task.state;
}

function list(items: TaskReport[]): string {
  return items.length
    ? `${items.length} (${items.map((item) => item.task.id).join(', ')})`
    : 'none';
}

function row(cells: string[]): string {
  return `| ${cells.map((cell) => cell.replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
