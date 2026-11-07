// H-14 (access part), H-03: every API route, generated from the routes the app registers, called without
// authentication, with a read token and with a read_write token. The expected answer comes from one list
// (TOKEN_ROUTES); a route added without thinking about tokens is closed to them.
import { openDb, runMigrations } from '@memento/db';
import { seed } from '@memento/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { TOKEN_ROUTES } from '../src/access.ts';
import { buildApp } from '../src/app.ts';
import { createToken } from '../src/auth.ts';

const PUBLIC = ['GET /api/v1/health', 'GET /api/v1/openapi.json', 'POST /api/v1/auth/login'];
const ID = '00000000-0000-4000-8000-000000000000';
const PARAMS: Record<string, string> = {
  isoWeek: '2026-W45',
  from: '2026-11-10',
  kind: 'week',
  periodKey: '2026-W40',
  month: '2026-11',
  quarter: '2026-Q4',
};
const concrete = (route: string) => route.replace(/:([a-zA-Z]+)/g, (_m, k: string) => PARAMS[k] ?? ID);

let app: Awaited<ReturnType<typeof buildApp>>;
let read: string;
let write: string;
let routes: string[];
beforeAll(async () => {
  const { db, sqlite } = openDb(':memory:');
  runMigrations(db);
  seed({ db, sqlite, actor: 'me' });
  app = await buildApp({ db, sqlite, cookieSecure: false, webDist: '/nonexistent' });
  await app.ready();
  read = createToken(db, 'reader', 'read').token;
  write = createToken(db, 'writer', 'read_write').token;
  routes = [...new Set(app.apiRoutes)].sort();
});

const call = async (route: string, token?: string) => {
  const [method, url] = route.split(' ');
  const res = await app.inject({
    method: method as 'GET',
    url: concrete(url),
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: method === 'GET' || method === 'DELETE' ? undefined : {},
  });
  return { status: res.statusCode, code: res.statusCode === 403 ? res.json().code : null };
};

describe('H-14 access matrix', () => {
  it('covers every registered API route, and the token list names only real routes', () => {
    expect(routes.length).toBeGreaterThan(100);
    for (const k of Object.keys(TOKEN_ROUTES)) expect(routes).toContain(k);
  });

  it('without authentication: 401 everywhere but the public routes', async () => {
    const wrong: string[] = [];
    for (const r of routes) {
      if (PUBLIC.includes(r)) continue;
      const { status } = await call(r);
      const expected = r === 'GET /api/v1/auth/me' ? 200 : 401; // soft answer before login
      if (status !== expected) wrong.push(`${r} → ${status}`);
    }
    expect(wrong).toEqual([]);
  });

  it('read token: only the `read` routes of the list', async () => {
    const wrong: string[] = [];
    for (const r of routes) {
      if (PUBLIC.includes(r)) continue;
      const { status, code } = await call(r, read);
      const access = TOKEN_ROUTES[r];
      const expected = !access ? 'USER_ONLY' : access === 'write' ? 'READ_ONLY_TOKEN' : null;
      if (status >= 500 || (expected ? code !== expected : status === 401 || status === 403))
        wrong.push(`${r} → ${status} ${code ?? ''}`);
    }
    expect(wrong).toEqual([]);
  });

  it('read_write token: every route of the list, nothing else', async () => {
    const wrong: string[] = [];
    for (const r of routes) {
      if (PUBLIC.includes(r)) continue;
      const { status, code } = await call(r, write);
      const listed = r in TOKEN_ROUTES;
      if (status >= 500 || (listed ? status === 401 || status === 403 : code !== 'USER_ONLY'))
        wrong.push(`${r} → ${status} ${code ?? ''}`);
    }
    expect(wrong).toEqual([]);
  });

  it('D-123: the routes closed to tokens', async () => {
    for (const r of [
      'GET /api/v1/settings',
      'POST /api/v1/changes/mark-reviewed',
      'POST /api/v1/reports/generate',
      'POST /api/v1/domains',
      'PATCH /api/v1/domains/:id',
      'POST /api/v1/domains/reorder',
      'POST /api/v1/groups',
      'PATCH /api/v1/groups/:id',
      'DELETE /api/v1/groups/:id',
      'POST /api/v1/import',
      'GET /api/v1/tokens',
      'POST /api/v1/tokens',
    ]) {
      expect(TOKEN_ROUTES[r]).toBeUndefined();
      expect((await call(r, read)).code).toBe('USER_ONLY');
      expect((await call(r, write)).code).toBe('USER_ONLY');
    }
  });
});
