// The test API for pilot 2 (the scheduled website/API check), and the failures seeded into it.
// The mock API serves these endpoints, and the report scores the Checker against the same plan.
//
// Time is cut into windows, one per scheduled run. The setup script starts the mock's clock and
// the Checker's schedule together, so run N lands in window N. Each failure is switched on for a
// few windows, so most runs see a healthy API and could raise a false alarm.

export interface Endpoint {
  path: string;
  // What a healthy response looks like. The Checker gets this list as its check list.
  expect: string;
}

export interface SeededFailure {
  id: string;
  path: string;
  // What goes wrong, in words. The report shows it next to what the Checker said.
  what: string;
  // Windows (0-based run numbers) in which the failure is switched on.
  windows: number[];
}

export const WINDOW_COUNT = 20;

export const ENDPOINTS: Endpoint[] = [
  { path: '/api/health', expect: 'Status 200. JSON with status equal to "ok".' },
  {
    path: '/api/products',
    expect: 'Status 200. JSON with a "products" list of 3 items, each with id, name, and price.'
  },
  {
    path: '/api/products/1',
    expect: 'Status 200. JSON product with id 1, a name, and a price above 0.'
  },
  {
    path: '/api/orders/recent',
    expect: 'Status 200. JSON with an "orders" list. Each order has id, total, and status.'
  },
  {
    path: '/api/users/me',
    expect: 'Status 200. JSON with id, name, and email. No sign-in is needed on this test API.'
  },
  {
    path: '/api/inventory',
    expect: 'Status 200. JSON with an "items" list. Every "stock" count is 0 or more.'
  },
  {
    path: '/api/version',
    expect: 'Status 200. JSON (not HTML) with a "version" string like "2.4.1".'
  },
  {
    path: '/api/search?q=lamp',
    expect: 'Status 200. JSON with a "results" list. Every result name contains "lamp".'
  }
];

export const SEEDED_FAILURES: SeededFailure[] = [
  {
    id: 'F1',
    path: '/api/products',
    what: 'Status 500 with an error page',
    windows: [2, 3]
  },
  {
    id: 'F2',
    path: '/api/orders/recent',
    what: 'Status 200, but the "orders" field is missing (renamed to "data")',
    windows: [5, 6, 7]
  },
  {
    id: 'F3',
    path: '/api/users/me',
    what: 'Status 401 Unauthorized',
    windows: [9]
  },
  {
    id: 'F4',
    path: '/api/version',
    what: 'Status 200, but the body is an HTML maintenance page, not JSON',
    windows: [12, 13]
  },
  {
    id: 'F5',
    path: '/api/inventory',
    what: 'Status 200, but one item has a negative stock count',
    windows: [15, 16, 17]
  }
];

// The failure switched on for this path in this window, if any.
export function activeFailure(path: string, window: number): SeededFailure | null {
  const bare = path.split('?')[0];
  return (
    SEEDED_FAILURES.find(
      (failure) => failure.path.split('?')[0] === bare && failure.windows.includes(window)
    ) ?? null
  );
}

function failuresIn(window: number): SeededFailure[] {
  return SEEDED_FAILURES.filter((failure) => failure.windows.includes(window));
}

// Which window a moment falls in, given when window 0 started. Negative before the start.
export function windowAt(at: Date, startedAt: Date, intervalMinutes: number): number {
  return Math.floor((at.getTime() - startedAt.getTime()) / (intervalMinutes * 60_000));
}

// The Checker reports one line per broken endpoint: "BROKEN: <path> - <what is wrong>".
// Returns the paths it named, without query strings or trailing punctuation. Only the exact
// uppercase "BROKEN:" counts, so a question like "Broken: /api/x?" isn't read as a report.
export function parseBrokenLines(text: string): string[] {
  const paths = new Set<string>();
  for (const match of text.matchAll(/^\s*[-*]?\s*\**BROKEN:\**\s*`?(\/[^\s`?]*)/gm)) {
    paths.add(match[1].replace(/[.,;:)]+$/, ''));
  }
  return [...paths];
}

export interface RunScore {
  window: number;
  caught: SeededFailure[];
  missed: SeededFailure[];
  falseAlarms: string[];
}

// Scores one run: which active failures it named, which it missed, and which healthy paths it
// called broken.
export function scoreRun(window: number, reportedPaths: string[]): RunScore {
  const active = failuresIn(window);
  const caught = active.filter((failure) => reportedPaths.includes(failure.path.split('?')[0]));
  const missed = active.filter((failure) => !caught.includes(failure));
  const falseAlarms = reportedPaths.filter((path) => !activeFailure(path, window));
  return { window, caught, missed, falseAlarms };
}
