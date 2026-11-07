// Audit v1.0: access control (C-02, C-04), validation (C-05, C-06), locking (H-04).
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, schema } from '@memento/db';
import { createProject, createTask, listGroups, seed } from '@memento/domain';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createToken, setUserPassword } from '../src/auth.ts';

async function setup(webDist = '/nonexistent') {
  const { db, sqlite } = openDb(':memory:');
  runMigrations(db);
  seed({ db, sqlite, actor: 'me' });
  await setUserPassword(db, 'owner', 'correct horse battery');
  const app = await buildApp({ db, sqlite, cookieSecure: false, webDist });
  const write = createToken(db, 'writer', 'read_write').token;
  const read = createToken(db, 'reader', 'read').token;
  const groupId = listGroups({ db, sqlite, actor: 'me' })[0].id;
  return { app, db, sqlite, write, read, groupId };
}
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

/** C-02: every spelling of a protected path, none may reach a handler without authentication. */
const ENCODED = [
  '/%61pi/v1/tasks',
  '/%41PI/v1/tasks',
  '/a%70i/v1/tasks',
  '/ap%69/v1/tasks',
  '/%61%70%69/v1/tasks',
  '/api/%76%31/tasks',
  '/api/v1/%74asks',
  '/api/v1/t%61sks',
  '/%2561pi/v1/tasks',
  '/api%2Fv1/tasks',
  '/api%2fv1%2ftasks',
  '//api/v1/tasks',
  '/./api/v1/tasks',
  '/x/../api/v1/tasks',
  '/API/v1/tasks',
  '/api/v1/tasks/',
  '/api/v1/tasks%00',
  '/api/v1/tasks;a=b',
  '/%61pi/v1/nope',
];

describe('C-02 authentication follows the route, not the raw URL', () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    s = await setup();
  });

  it.each(ENCODED)('GET %s without authentication gives neither data nor a 500', async (url) => {
    const res = await s.app.inject({ method: 'GET', url });
    expect([400, 401, 404]).toContain(res.statusCode);
  });

  it('POST /%61pi/v1/tasks without authentication is refused and writes nothing', async () => {
    const res = await s.app.inject({ method: 'POST', url: '/%61pi/v1/tasks', payload: { title: 'x' } });
    expect(res.statusCode).toBe(401);
    expect(s.db.select().from(schema.task).all()).toHaveLength(0);
  });

  it('an encoded path still works with a valid token', async () => {
    const res = await s.app.inject({ method: 'GET', url: '/%61pi/v1/tasks', headers: bearer(s.write) });
    expect(res.statusCode).toBe(200);
  });

  it('public routes stay public, including through an encoded path', async () => {
    for (const url of ['/api/v1/health', '/%61pi/v1/health', '/api/v1/openapi.json']) {
      expect((await s.app.inject({ method: 'GET', url })).statusCode).toBe(200);
    }
    const me = await s.app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ authenticated: false });
    const login = await s.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: 'owner', password: 'correct horse battery' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('a read token stays read-only through an encoded path', async () => {
    const res = await s.app.inject({
      method: 'POST',
      url: '/%61pi/v1/tasks',
      headers: bearer(s.read),
      payload: { title: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('an unknown API path is a 404 once authenticated, 404 or 401 without', async () => {
    const auth = await s.app.inject({ method: 'GET', url: '/api/v1/nope', headers: bearer(s.write) });
    expect(auth.statusCode).toBe(404);
    const anon = await s.app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect([401, 404]).toContain(anon.statusCode);
  });

  it('the static front still serves its pages and client-side routes', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'memento-web-'));
    try {
      mkdirSync(join(dist, 'assets'));
      writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Mémento</title>');
      writeFileSync(join(dist, 'assets', 'a.js'), 'console.log(1)');
      const w = await setup(dist);
      expect((await w.app.inject({ method: 'GET', url: '/' })).statusCode).toBe(200);
      expect((await w.app.inject({ method: 'GET', url: '/semaine' })).body).toContain('Mémento');
      expect((await w.app.inject({ method: 'GET', url: '/assets/a.js' })).statusCode).toBe(200);
      expect((await w.app.inject({ method: 'GET', url: '/api/v1/tasks' })).statusCode).toBe(401);
      const encoded = await w.app.inject({ method: 'GET', url: '/%61pi/v1/tasks' });
      expect(encoded.statusCode).toBe(401);
      expect((await w.app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
});

describe('C-04 the AI cannot erase its traces', () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    s = await setup();
  });

  it('mark-reviewed is reserved to the session', async () => {
    const res = await s.app.inject({
      method: 'POST',
      url: '/api/v1/changes/mark-reviewed',
      headers: bearer(s.write),
      payload: { all: true },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('USER_ONLY');
  });

  it('deleting a project logs the content of each deleted task', async () => {
    const ctx = { db: s.db, sqlite: s.sqlite, actor: 'me' as const };
    const p = createProject(ctx, { title: 'Garage', groupIds: [s.groupId] });
    createTask(ctx, { projectId: p.id, title: 'Trier les cartons', description: 'Note A' });
    createTask(ctx, { projectId: p.id, title: 'Poser les étagères' });
    const res = await s.app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${p.id}`,
      headers: bearer(s.write),
    });
    expect(res.statusCode).toBe(200);
    const row = s.db
      .select()
      .from(schema.auditLog)
      .all()
      .find((r) => r.entityType === 'project' && r.action === 'delete')!;
    const log = JSON.stringify(row.diff);
    expect(log).toContain('Trier les cartons');
    expect(log).toContain('Note A');
    expect(log).toContain('Poser les étagères');
  });
});

const INVALID_RULES = [
  'FREQ=DAILY;INTERVAL=abc',
  'FREQ=NOPE',
  'FREQ=WEEKLY;BYDAY=XX',
  'FREQ=DAILY;INTERVAL=0',
  'FREQ=DAILY;INTERVAL=-1',
  'FREQ=DAILY;FOO=1',
  'FREQ=HOURLY',
  'INTERVAL=2',
  'FREQ=MONTHLY;BYMONTHDAY=40',
  'FREQ=YEARLY;BYMONTH=13',
  'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=31',
  'FREQ=DAILY;COUNT=2',
];

/** Runs the probe in a child process: a freeze shows as a timeout instead of blocking the test runner. */
function probe(rules: string[]): Promise<Record<string, Record<string, unknown>>> {
  return new Promise((resolveProbe, reject) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', join(import.meta.dirname, 'fixtures/recurrence-probe.ts'), JSON.stringify(rules)],
      { timeout: 30_000, cwd: join(import.meta.dirname, '..') },
      (err, stdout) => {
        if (err) return reject(new Error(err.killed ? 'probe frozen (timeout)' : err.message));
        resolveProbe(JSON.parse(stdout.trim().split('\n').pop()!));
      },
    );
  });
}

describe('C-05 invalid recurrence rules are refused and never freeze the API', () => {
  it('each rule: 422 at creation; stored anyway, the calendar answers and the completion is a 422', async () => {
    const out = await probe(INVALID_RULES);
    for (const rule of INVALID_RULES)
      expect([rule, out[rule]]).toEqual([
        rule,
        {
          create: 422,
          code: 'INVALID_RECURRENCE',
          calendar: 200,
          // A stored rule that reads but never occurs (31 February) completes without a next occurrence.
          complete: rule === 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=31' ? 200 : 422,
          completeCode: rule === 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=31' ? null : 'INVALID_RECURRENCE',
          health: 200,
        },
      ]);
  }, 40_000);

  it('the rules of the interface and of the natural-language parser stay valid', async () => {
    const valid = [
      'FREQ=WEEKLY',
      'FREQ=MONTHLY',
      'FREQ=MONTHLY;INTERVAL=3',
      'FREQ=YEARLY',
      'FREQ=DAILY;INTERVAL=2',
      'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU',
      'FREQ=MONTHLY;BYMONTHDAY=5',
      'FREQ=MONTHLY;BYDAY=1MO',
      'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29',
      'RRULE:FREQ=YEARLY;BYMONTH=5;BYMONTHDAY=14',
    ];
    const out = await probe(valid);
    for (const rule of valid) expect([rule, out[rule].create, out[rule].complete]).toEqual([rule, 200, 200]);
  }, 40_000);
});

describe('C-06 impossible dates are refused', () => {
  let s: Awaited<ReturnType<typeof setup>>;
  const BAD = ['2026-10-45', '2026-13-45', '2026-02-30', '2026-1-1', 'demain'];
  beforeEach(async () => {
    s = await setup();
  });
  const call = (method: 'POST' | 'PATCH' | 'GET', url: string, payload?: object) =>
    s.app.inject({ method, url: `/api/v1${url}`, headers: bearer(s.write), payload });

  it.each(BAD)('%s: 422 on projects, tasks, objectives, meta-objectives, vacations', async (d) => {
    const ctx = { db: s.db, sqlite: s.sqlite, actor: 'me' as const };
    const p = createProject(ctx, { title: 'P', groupIds: [s.groupId] });
    const attempts = [
      await call('PATCH', `/projects/${p.id}`, { startDate: d }),
      await call('PATCH', `/projects/${p.id}`, { dueDate: d }),
      await call('POST', '/projects', { title: 'Q', groupIds: [s.groupId], dueDate: d }),
      await call('POST', '/tasks', { title: 'T', dueDate: d }),
      await call('POST', '/objectives', { title: 'O', deadline: d }),
      await call('POST', '/meta-objectives', { title: 'M', horizonDate: d }),
      await call('POST', '/vacations', { from: d, to: d }),
      await call('GET', `/calendar?from=${d}&to=2026-11-30`),
      await call('GET', `/daily-recap?date=${d}`),
    ];
    expect(attempts.map((r) => r.statusCode)).toEqual(attempts.map(() => 422));
    expect(attempts[0].json().code).toBe('INVALID_DATE');
  });

  it('the settings path cannot store an impossible holiday (session only)', async () => {
    await s.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: 'owner', password: 'correct horse battery' },
    });
    const login = await s.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: 'owner', password: 'correct horse battery' },
    });
    const cookie = `memento_session=${login.cookies.find((c) => c.name === 'memento_session')!.value}`;
    const res = await s.app.inject({
      method: 'PATCH',
      url: '/api/v1/settings',
      headers: { cookie },
      payload: { 'notify.vacations': [{ from: '2026-13-45', to: '2026-13-46' }] },
    });
    expect([400, 422]).toContain(res.statusCode);
  });

  it('a valid date still passes', async () => {
    const res = await call('POST', '/tasks', { title: 'T', dueDate: '2028-02-29' });
    expect(res.statusCode).toBe(200);
  });
});

describe('H-04 a write waits for a short lock instead of failing', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('POST /tasks succeeds while another process holds the write lock for 500 ms', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'memento-lock-'));
    dirs.push(dir);
    const file = join(dir, 'memento.db');
    const { db, sqlite } = openDb(file);
    runMigrations(db);
    seed({ db, sqlite, actor: 'me' });
    const app = await buildApp({ db, sqlite, cookieSecure: false, webDist: '/nonexistent' });
    const token = createToken(db, 'writer', 'read_write').token;
    // Another process takes the write lock, says so, and releases it 500 ms later.
    const holder = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { createRequire } from 'node:module';
         const require = createRequire(${JSON.stringify(`${process.cwd()}/packages/db/package.json`)});
         const D = require('better-sqlite3');
         const c = new D(${JSON.stringify(file)});
         c.exec('BEGIN IMMEDIATE');
         console.log('locked');
         setTimeout(() => { c.exec('COMMIT'); c.close(); }, 500);`,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    await new Promise<void>((res) => holder.stdout.once('data', () => res()));
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: bearer(token),
      payload: { title: 'Sous verrou' },
    });
    expect(r.statusCode).toBe(200);
    await new Promise((res) => holder.once('exit', res));
    sqlite.close();
  });
});
