// A small test API for pilot 2. It serves the endpoints in plan.ts and breaks them on purpose,
// in the windows the plan says. It keeps a log of every request, so the report can check which
// endpoints each run called.
//
// Run it with `npm run pilot:api` (Docker) or `node pilot/mock-api.ts`. Plain Node, no packages.
//
// The /_pilot/ paths are for the setup and report scripts. The agents' connection only allows
// /api/, so agents can't see the plan.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import { activeFailure, SEEDED_FAILURES, WINDOW_COUNT, windowAt } from './plan.ts';

const PORT = Number(process.env.PILOT_API_PORT ?? 4100);
const HOST = process.env.PILOT_API_HOST ?? '127.0.0.1';
// The clock and the log are saved here, so they survive a restart during the pilot.
const STATE_FILE = process.env.PILOT_API_STATE_FILE ?? 'pilot/results/mock-api-state.json';

interface LoggedRequest {
  at: string;
  window: number;
  method: string;
  path: string;
  status: number;
  failureId: string | null;
}

const state = {
  startedAt: null as Date | null,
  intervalMinutes: 10,
  log: [] as LoggedRequest[]
};

function loadState(): void {
  try {
    const saved = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as {
      startedAt: string | null;
      intervalMinutes: number;
      log: LoggedRequest[];
    };
    state.startedAt = saved.startedAt ? new Date(saved.startedAt) : null;
    state.intervalMinutes = saved.intervalMinutes;
    state.log = saved.log;
  } catch {
    // No saved state yet: start fresh.
  }
}

function saveState(): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state));
}

const HEALTHY: Record<string, () => unknown> = {
  '/api/health': () => ({ status: 'ok' }),
  '/api/products': () => ({
    products: [
      { id: 1, name: 'Desk lamp', price: 39 },
      { id: 2, name: 'Notebook', price: 6 },
      { id: 3, name: 'Floor lamp', price: 89 }
    ]
  }),
  '/api/products/1': () => ({ id: 1, name: 'Desk lamp', price: 39 }),
  '/api/orders/recent': () => ({
    orders: [
      { id: 'A-1001', total: 45, status: 'shipped' },
      { id: 'A-1002', total: 89, status: 'processing' }
    ]
  }),
  '/api/users/me': () => ({ id: 7, name: 'Test User', email: 'test.user@example.com' }),
  '/api/inventory': () => ({
    items: [
      { productId: 1, stock: 14 },
      { productId: 2, stock: 230 },
      { productId: 3, stock: 0 }
    ]
  }),
  '/api/version': () => ({ version: '2.4.1' }),
  '/api/search': () => ({
    results: [
      { id: 1, name: 'Desk lamp' },
      { id: 3, name: 'Floor lamp' }
    ]
  })
};

// The broken response for each seeded failure.
const BROKEN: Record<string, (res: ServerResponse) => void> = {
  F1: (res) => send(res, 500, '<h1>Internal Server Error</h1>', 'text/html'),
  F2: (res) =>
    sendJson(res, 200, {
      data: [
        { id: 'A-1001', total: 45, status: 'shipped' },
        { id: 'A-1002', total: 89, status: 'processing' }
      ]
    }),
  F3: (res) => sendJson(res, 401, { error: 'Unauthorized' }),
  F4: (res) =>
    send(
      res,
      200,
      '<html><body><h1>Down for maintenance</h1><p>Back soon.</p></body></html>',
      'text/html'
    ),
  F5: (res) =>
    sendJson(res, 200, {
      items: [
        { productId: 1, stock: 14 },
        { productId: 2, stock: -3 },
        { productId: 3, stock: 0 }
      ]
    })
};

function currentWindow(now = new Date()): number {
  return state.startedAt ? windowAt(now, state.startedAt, state.intervalMinutes) : -1;
}

function send(res: ServerResponse, status: number, body: string, type: string): void {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  send(res, status, JSON.stringify(body), 'application/json');
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function handlePilot(req: IncomingMessage, res: ServerResponse, path: string) {
  if (req.method === 'POST' && path === '/_pilot/start') {
    const body = await readJson(req);
    const interval = Number(body.intervalMinutes);
    const startAt = new Date(String(body.startAt));
    if (!Number.isFinite(interval) || interval <= 0 || Number.isNaN(startAt.getTime())) {
      return sendJson(res, 400, { error: 'Send intervalMinutes and startAt' });
    }
    state.startedAt = startAt;
    state.intervalMinutes = interval;
    state.log = [];
    saveState();
    return sendJson(res, 200, { startedAt: startAt.toISOString(), intervalMinutes: interval });
  }
  if (req.method === 'GET' && path === '/_pilot/state') {
    const window = currentWindow();
    return sendJson(res, 200, {
      startedAt: state.startedAt?.toISOString() ?? null,
      intervalMinutes: state.intervalMinutes,
      windowCount: WINDOW_COUNT,
      window,
      active: SEEDED_FAILURES.filter((failure) => failure.windows.includes(window)).map(
        (failure) => failure.id
      )
    });
  }
  if (req.method === 'GET' && path === '/_pilot/log') {
    return sendJson(res, 200, {
      startedAt: state.startedAt?.toISOString() ?? null,
      intervalMinutes: state.intervalMinutes,
      requests: state.log
    });
  }
  return sendJson(res, 404, { error: 'Not found' });
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  if (path.startsWith('/_pilot/')) {
    handlePilot(req, res, path).catch(() => sendJson(res, 400, { error: 'Bad request' }));
    return;
  }

  const now = new Date();
  const window = currentWindow(now);
  const failure = activeFailure(path, window);
  const healthy = HEALTHY[path];
  let status: number;
  if (req.method !== 'GET') {
    status = 405;
    sendJson(res, status, { error: 'Only GET is allowed' });
  } else if (failure) {
    BROKEN[failure.id](res);
    status = res.statusCode;
  } else if (healthy) {
    status = 200;
    sendJson(res, status, healthy());
  } else {
    status = 404;
    sendJson(res, status, { error: 'Not found' });
  }

  state.log.push({
    at: now.toISOString(),
    window,
    method: req.method ?? 'GET',
    path: path + url.search,
    status,
    failureId: failure?.id ?? null
  });
  // Plenty for a pilot. Keeps memory flat if something calls it in a loop.
  if (state.log.length > 20_000) {
    state.log.splice(0, state.log.length - 20_000);
  }
  saveState();
});

loadState();

server.listen(PORT, HOST, () => {
  console.log(`Pilot test API on http://${HOST}:${PORT}`);
});
