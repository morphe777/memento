// Audit v1.0 Lot 2: M-16 (REST semantics), M-17 (query booleans).
import { openDb, runMigrations } from '@memento/db';
import { recordNotification, seed } from '@memento/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { setUserPassword } from '../src/auth.ts';

let app: Awaited<ReturnType<typeof buildApp>>;
let cookie = '';
let ctx: Parameters<typeof recordNotification>[0];

beforeAll(async () => {
  const { db, sqlite } = openDb(':memory:');
  runMigrations(db);
  seed({ db, sqlite, actor: 'me' });
  ctx = { db, sqlite, actor: 'me' };
  await setUserPassword(db, 'owner', 'correct horse battery');
  app = await buildApp({ db, sqlite, cookieSecure: false, webDist: '/nonexistent' });
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { login: 'owner', password: 'correct horse battery' },
  });
  cookie = `memento_session=${res.cookies.find((c) => c.name === 'memento_session')!.value}`;
});

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { cookie }, payload });

describe('M-16 REST semantics', () => {
  it('reading a notification writes nothing; opening it (POST) marks it read', async () => {
    recordNotification(ctx, { kind: 'job', title: 'Essai', html: 'x' });
    const id = (await call('GET', '/notifications')).json().items[0].id;
    expect((await call('GET', `/notifications/${id}`)).json().readAt).toBeNull();
    expect((await call('GET', `/notifications/${id}`)).json().readAt).toBeNull();
    expect((await call('POST', `/notifications/${id}/read`)).json().readAt).toBeTruthy();
  });

  it('a duplicate name is a 409, an unknown token a 404, a malformed « since » a 400', async () => {
    const domains = (await call('GET', '/domains')).json();
    const dup = await call('PATCH', `/domains/${domains[1].id}`, { name: domains[0].name });
    expect([dup.statusCode, dup.json().code]).toEqual([409, 'ALREADY_EXISTS']);
    expect((await call('DELETE', '/tokens/00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await call('GET', '/changes?since=garbage')).statusCode).toBe(400);
    expect((await call('GET', '/changes?since=7d')).statusCode).toBe(200);
  });
});

describe('M-17 query booleans', () => {
  it('includeReviewed=false is false', async () => {
    const all = (await call('GET', '/changes?since=all&includeReviewed=true')).json();
    await call('POST', '/changes/mark-reviewed', { all: true });
    const unreviewed = (await call('GET', '/changes?since=all&includeReviewed=false')).json();
    const reviewed = (await call('GET', '/changes?since=all&includeReviewed=true')).json();
    const n = (x: unknown) => (Array.isArray(x) ? x.length : (x as { items: unknown[] }).items.length);
    expect(n(reviewed)).toBeGreaterThanOrEqual(n(all));
    expect(n(unreviewed)).toBe(0);
    expect((await call('GET', '/changes?includeReviewed=maybe')).statusCode).toBe(400);
  });
});

describe('M-18 task pages', () => {
  it('limit and offset read the same list by pages, in a stable order', async () => {
    for (let i = 0; i < 5; i++) await call('POST', '/tasks', { title: `Page ${i}`, durationMin: 15 });
    const all = (await call('GET', '/tasks?projectId=inbox')).json() as { id: string }[];
    const p1 = (await call('GET', '/tasks?projectId=inbox&limit=2')).json() as { id: string }[];
    const p2 = (await call('GET', '/tasks?projectId=inbox&limit=2&offset=2')).json() as { id: string }[];
    expect([...p1, ...p2].map((t) => t.id)).toEqual(all.slice(0, 4).map((t) => t.id));
    expect((await call('GET', '/tasks?limit=0')).statusCode).toBe(400);
  });
});

describe('H-13 OpenAPI contract', () => {
  it('declares the errors, the cookie and who may call each operation', async () => {
    const spec = (await call('GET', '/openapi.json')).json();
    expect(spec.components.schemas.Error.required).toEqual(['code', 'message']);
    expect(spec.components.securitySchemes.cookie).toMatchObject({ type: 'apiKey', in: 'cookie' });
    const promote = spec.paths['/api/v1/projects/{id}/promote'].post;
    expect(Object.keys(promote.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404', '409', '422', '429']),
    );
    expect(promote.responses['422'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/Error',
    );
    expect(promote['x-token-access']).toBe('write');
    expect(promote.security).toEqual([{ bearer: [] }, { cookie: [] }]);
    const imp = spec.paths['/api/v1/import'].post;
    expect([imp['x-token-access'], imp.security]).toEqual(['none', [{ cookie: [] }]]);
    expect(spec.paths['/api/v1/health'].get.security).toEqual([]);
    expect(spec.paths['/api/v1/tasks'].get['x-token-access']).toBe('read');
  });
});
