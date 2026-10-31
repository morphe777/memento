import { openDb, runMigrations, schema } from '@memento/db';
import { createObjective, createProject, listGroups, seed } from '@memento/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createToken, setUserPassword } from '../src/auth.ts';

const PASSWORD = 'correct horse battery';

async function setup() {
  const { db, sqlite } = openDb(':memory:');
  runMigrations(db);
  seed({ db, sqlite, actor: 'me' });
  await setUserPassword(db, 'mehdi', PASSWORD);
  const app = await buildApp({ db, sqlite, cookieSecure: false, webDist: '/nonexistent' });
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { login: 'mehdi', password: PASSWORD },
  });
  const cookie = `memento_session=${res.cookies.find((c) => c.name === 'memento_session')!.value}`;
  return { app, db, sqlite, cookie };
}

describe('API L0 — auth', () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    s = await setup();
  });

  it('logs in with an httpOnly SameSite=Strict cookie; password and session stored hashed', async () => {
    const res = await s.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: 'mehdi', password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const c = res.cookies.find((x) => x.name === 'memento_session')!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Strict');
    const user = s.db.select().from(schema.appUser).get()!;
    expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
    const sessions = s.db.select().from(schema.session).all();
    expect(sessions.every((x) => x.id !== c.value && x.id.length === 64)).toBe(true);
  });

  it('refuses bad credentials and rate-limits login', async () => {
    const codes = [];
    for (let i = 0; i < 6; i++) {
      const r = await s.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { login: 'mehdi', password: 'wrong' },
      });
      codes.push(r.statusCode);
    }
    expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
    expect(codes).toContain(429);
  });

  it('protects routes (401) and serves health + OpenAPI publicly', async () => {
    expect((await s.app.inject({ url: '/api/v1/domains' })).statusCode).toBe(401);
    expect((await s.app.inject({ url: '/api/v1/health' })).json()).toMatchObject({ ok: true });
    const spec = (await s.app.inject({ url: '/api/v1/openapi.json' })).json();
    expect(spec.openapi).toMatch(/^3\./);
    expect(Object.keys(spec.paths)).toContain('/api/v1/projects/{id}/promote');
  });

  it('returns the 8 domains in order to a logged-in user', async () => {
    const res = await s.app.inject({ url: '/api/v1/domains', headers: { cookie: s.cookie } });
    expect(res.json().map((d: { name: string }) => d.name)[0]).toBe('Santé');
    expect(res.json()).toHaveLength(8);
  });

  it('logout invalidates the session', async () => {
    await s.app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: s.cookie } });
    expect((await s.app.inject({ url: '/api/v1/domains', headers: { cookie: s.cookie } })).statusCode).toBe(
      401,
    );
  });
});

describe('API — own account (Configuration › Compte)', () => {
  it('renames the login and changes the password (current required, other sessions closed)', async () => {
    const s = await setup();
    const other = await s.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: 'mehdi', password: PASSWORD },
    });
    const otherCookie = `memento_session=${other.cookies.find((c) => c.name === 'memento_session')!.value}`;
    const h = { cookie: s.cookie };
    const ren = await s.app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/account',
      headers: h,
      payload: { login: 'mk' },
    });
    expect(ren.json()).toEqual({ login: 'mk' });
    expect((await s.app.inject({ url: '/api/v1/auth/me', headers: h })).json().login).toBe('mk');
    const bad = await s.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers: h,
      payload: { current: 'wrong', next: 'a brand new passphrase' },
    });
    expect(bad.statusCode).toBe(422);
    const short = await s.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers: h,
      payload: { current: PASSWORD, next: 'short' },
    });
    expect(short.json().code).toBe('PASSWORD_TOO_SHORT');
    const ok = await s.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers: h,
      payload: { current: PASSWORD, next: 'a brand new passphrase' },
    });
    expect(ok.statusCode).toBe(200);
    expect((await s.app.inject({ url: '/api/v1/domains', headers: h })).statusCode).toBe(200);
    expect(
      (await s.app.inject({ url: '/api/v1/domains', headers: { cookie: otherCookie } })).statusCode,
    ).toBe(401);
    const relog = await s.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: 'mk', password: 'a brand new passphrase' },
    });
    expect(relog.statusCode).toBe(200);
  });

  it('refuses account changes from an API token', async () => {
    const s = await setup();
    const t = createToken(s.db, 'bot', 'read_write');
    const r = await s.app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/account',
      headers: { authorization: `Bearer ${t.token}` },
      payload: { login: 'hacked' },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe('API — export (D-45)', () => {
  it('exports all data as a JSON attachment, without secrets, for the web user only', async () => {
    const s = await setup();
    const res = await s.app.inject({ url: '/api/v1/export', headers: { cookie: s.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="memento-export-/);
    const body = res.json();
    expect(body.tables.domain).toHaveLength(8);
    const text = res.body;
    expect(text).not.toMatch(/argon2|passwordHash|tokenHash/);
    expect(body.tables.session).toBeUndefined();
    const t = createToken(s.db, 'bot', 'read');
    const denied = await s.app.inject({
      url: '/api/v1/export',
      headers: { authorization: `Bearer ${t.token}` },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('D-50: re-importing an export restores the data, refuses foreign files, keeps the login', async () => {
    const s = await setup();
    const h = { cookie: s.cookie };
    const groups = (await s.app.inject({ url: '/api/v1/groups', headers: h })).json();
    await s.app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: h,
      payload: { title: 'Gardé', groupIds: [groups[0].id] },
    });
    const dump = (await s.app.inject({ url: '/api/v1/export', headers: h })).json();
    await s.app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: h,
      payload: { title: 'Perdu', groupIds: [groups[0].id] },
    });
    const bad = await s.app.inject({
      method: 'POST',
      url: '/api/v1/import',
      headers: h,
      payload: { foo: 1 },
    });
    expect(bad.json().code).toBe('INVALID_EXPORT');
    const ok = await s.app.inject({ method: 'POST', url: '/api/v1/import', headers: h, payload: dump });
    expect(ok.statusCode).toBe(200);
    const titles = (await s.app.inject({ url: '/api/v1/projects', headers: h }))
      .json()
      .map((p: { title: string }) => p.title);
    expect(titles).toEqual(['Gardé']);
  });
});

describe('API — purge (D-57)', () => {
  it('needs the confirmation word, is refused to tokens, and keeps domains and groups', async () => {
    const s = await setup();
    const h = { cookie: s.cookie };
    const groups = (await s.app.inject({ url: '/api/v1/groups', headers: h })).json();
    await s.app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: h,
      payload: { title: 'Test', groupIds: [groups[0].id] },
    });
    const noWord = await s.app.inject({ method: 'POST', url: '/api/v1/purge', headers: h, payload: {} });
    expect(noWord.statusCode).toBe(400);
    const t = createToken(s.db, 'bot', 'read_write');
    const denied = await s.app.inject({
      method: 'POST',
      url: '/api/v1/purge',
      headers: { authorization: `Bearer ${t.token}` },
      payload: { confirm: 'SUPPRIMER' },
    });
    expect(denied.statusCode).toBe(403);
    const ok = await s.app.inject({
      method: 'POST',
      url: '/api/v1/purge',
      headers: h,
      payload: { confirm: 'SUPPRIMER' },
    });
    expect(ok.json().counts.project).toBe(1);
    expect((await s.app.inject({ url: '/api/v1/projects', headers: h })).json()).toEqual([]);
    expect((await s.app.inject({ url: '/api/v1/groups', headers: h })).json()).toHaveLength(groups.length);
  });
});

describe('API — Compléter avec l’IA (D-97)', () => {
  it('returns alternative titles and the wanted fields, without saving anything', async () => {
    const { db, sqlite } = openDb(':memory:');
    runMigrations(db);
    seed({ db, sqlite, actor: 'me' });
    await setUserPassword(db, 'mehdi', PASSWORD);
    let asked = '';
    const llm = async (r: { user: string }) => {
      asked = r.user;
      return {
        text: '{"titles":["Dormir 7 h par nuit.","Sommeil","Des nuits réparatrices"],"fields":{"description":"## Pourquoi\\nMieux récupérer.","smartIndicator":"Nuits ≥ 7 h","smartTarget":"20","successCriterion":"ignoré"},"comment":"Ok."}',
        model: 'fake',
      };
    };
    const app = await buildApp({ db, sqlite, cookieSecure: false, webDist: '/nonexistent', llm });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: 'mehdi', password: PASSWORD },
    });
    const h = { cookie: `memento_session=${login.cookies.find((c) => c.name === 'memento_session')!.value}` };
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/fill',
      headers: h,
      payload: { kind: 'objective', values: { title: 'Sommeil' } },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      titles: ['Dormir 7 h par nuit', 'Des nuits réparatrices'],
      fields: {
        description: '## Pourquoi\nMieux récupérer.',
        smartIndicator: 'Nuits ≥ 7 h',
        smartTarget: '20',
      },
      comment: 'Ok.',
    });
    expect(r.json().fields.successCriterion).toBeUndefined();
    expect(asked).toMatch(/smartIndicator/);
    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/fill',
      headers: h,
      payload: { kind: 'project', values: { title: ' ' } },
    });
    expect(empty.statusCode).toBe(400);
  });
});

describe('API — Proposer avec l’IA (D-58)', () => {
  it('reports the status, refuses tokens and returns a proposal through the configured model', async () => {
    const { db, sqlite } = openDb(':memory:');
    runMigrations(db);
    seed({ db, sqlite, actor: 'me' });
    await setUserPassword(db, 'mehdi', PASSWORD);
    const llm = async () => ({ text: '{"summary":"Rien à changer.","objectives":[]}', model: 'fake' });
    const app = await buildApp({ db, sqlite, cookieSecure: false, webDist: '/nonexistent', llm });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: 'mehdi', password: PASSWORD },
    });
    const h = { cookie: `memento_session=${login.cookies.find((c) => c.name === 'memento_session')!.value}` };
    const st = (await app.inject({ url: '/api/v1/ai/status', headers: h })).json();
    expect(st.configured).toBe(false);
    expect(st.defaultPrompts.week).toMatch(/semaine/);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/propose',
      headers: h,
      payload: { scope: 'quarter', period: '2026-Q4' },
    });
    expect(r.json()).toMatchObject({ summary: 'Rien à changer.', model: 'fake', changes: [] });
    const t = createToken(db, 'bot', 'read_write');
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/propose',
      headers: { authorization: `Bearer ${t.token}` },
      payload: { scope: 'quarter', period: '2026-Q4' },
    });
    expect(denied.statusCode).toBe(403);
    // D-66: the key is written through the interface, never read back, refused to tokens.
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/ai/key',
      headers: h,
      payload: { provider: 'openrouter', key: 'sk-or-v1-secret-1234' },
    });
    expect(put.statusCode).toBe(200);
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/settings',
      headers: h,
      payload: { 'ai.provider': 'openrouter', 'ai.model': 'openai/gpt-5.2' },
    });
    const st2 = await app.inject({ url: '/api/v1/ai/status', headers: h });
    expect(st2.json()).toMatchObject({ configured: true, keySource: 'saisie', keyHint: '…1234' });
    expect(st2.body).not.toContain('secret-1234');
    const settings = await app.inject({ url: '/api/v1/settings', headers: h });
    expect(settings.body).not.toContain('secret-1234');
    const tokenPut = await app.inject({
      method: 'PUT',
      url: '/api/v1/ai/key',
      headers: { authorization: `Bearer ${t.token}` },
      payload: { provider: 'openrouter', key: 'x' },
    });
    expect(tokenPut.statusCode).toBe(403);
  });
});

describe('API — tokens (AI / robots)', () => {
  it('bearer token acts as ai:<name>; read-only tokens cannot write; revoked tokens are refused', async () => {
    const s = await setup();
    const rw = createToken(s.db, 'claude', 'read_write');
    const ro = createToken(s.db, 'n8n', 'read');
    expect(
      s.db
        .select()
        .from(schema.apiToken)
        .all()
        .every((t) => !t.tokenHash.includes(rw.token)),
    ).toBe(true);
    const auth = (t: string) => ({ authorization: `Bearer ${t}` });
    const created = await s.app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: auth(rw.token),
      payload: { title: 'Capture IA', durationMin: 30 },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().createdBy).toBe('ai:claude');
    const changes = await s.app.inject({ url: '/api/v1/changes?actor=ai', headers: { cookie: s.cookie } });
    expect(changes.json()[0]).toMatchObject({ actor: 'ai:claude', title: 'Capture IA' });
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: '/api/v1/tasks',
          headers: auth(ro.token),
          payload: { title: 'x' },
        })
      ).statusCode,
    ).toBe(403);
    expect((await s.app.inject({ url: '/api/v1/tasks', headers: auth(ro.token) })).statusCode).toBe(200);
    // Tokens cannot manage tokens or settings (interface only).
    expect((await s.app.inject({ url: '/api/v1/tokens', headers: auth(rw.token) })).statusCode).toBe(403);
    expect(
      (await s.app.inject({ method: 'PATCH', url: '/api/v1/settings', headers: auth(rw.token), payload: {} }))
        .statusCode,
    ).toBe(403);
    await s.app.inject({ method: 'DELETE', url: `/api/v1/tokens/${rw.id}`, headers: { cookie: s.cookie } });
    expect((await s.app.inject({ url: '/api/v1/tasks', headers: auth(rw.token) })).statusCode).toBe(401);
  });
});

describe('API L1 — business errors', () => {
  it('promoting an idea without task returns 422 with the list of gaps', async () => {
    const s = await setup();
    const groups = (await s.app.inject({ url: '/api/v1/groups', headers: { cookie: s.cookie } })).json();
    const idea = (
      await s.app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: { cookie: s.cookie },
        payload: { title: 'Clim', groupIds: [groups[0].id] },
      })
    ).json();
    const promoted = await s.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${idea.id}/promote`,
      headers: { cookie: s.cookie },
    });
    expect(promoted.json()).toMatchObject({
      status: 'ready',
      gaps: ['SUCCESS_CRITERION_MISSING', 'TASK_MISSING'],
    });
    const res = await s.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${idea.id}/month`,
      headers: { cookie: s.cookie },
      payload: { month: new Date().toISOString().slice(0, 7) },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('MONTH_PROJECT_INCOMPLETE');
    expect(res.json().details.map((d: { code: string }) => d.code)).toContain('TASK_MISSING');
  });

  it('validation errors are 400, unknown ids 404', async () => {
    const s = await setup();
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: '/api/v1/tasks',
          headers: { cookie: s.cookie },
          payload: { title: '' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await s.app.inject({
          url: '/api/v1/projects/00000000-0000-4000-8000-000000000000',
          headers: { cookie: s.cookie },
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('API Vue Plan (CA-12, CA-13)', () => {
  const post = (s: Awaited<ReturnType<typeof setup>>, url: string, payload: Record<string, unknown>) =>
    s.app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie: s.cookie }, payload });

  async function fixture() {
    const s = await setup();
    const ctx = { db: s.db, sqlite: s.sqlite, actor: 'me' as const };
    const o = createObjective(ctx, { title: 'Obj', deadline: '2026-12-20' });
    const groupIds = [listGroups(ctx)[0].id];
    const a = createProject(ctx, { title: 'A', groupIds, objectiveId: o.id, dependsOn: [] });
    const b = createProject(ctx, { title: 'B', groupIds, objectiveId: o.id, dependsOn: [] });
    const deps = () => s.db.select().from(schema.projectDependency).all();
    const audits = () => s.db.select().from(schema.auditLog).all().length;
    return { s, a, b, deps, audits };
  }

  it('CA-12 /plan/apply with an invalid op applies nothing and answers a French 422', async () => {
    const { s, a, b, deps } = await fixture();
    const res = await post(s, '/plan/apply', {
      ops: [
        { op: 'setDependencies', projectId: b.id, dependsOn: [a.id] }, // valid
        { op: 'setDependencies', projectId: a.id, dependsOn: [b.id] }, // loop
      ],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('DEPENDENCY_CYCLE');
    expect(res.json().message).toMatch(/[a-zé]+ /i);
    expect(res.json().message).not.toMatch(/^[A-Z_]+$/);
    expect(deps()).toHaveLength(0);
    const ok = await post(s, '/plan/apply', {
      ops: [{ op: 'setDependencies', projectId: b.id, dependsOn: [a.id] }],
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().applied).toBe(1);
    expect(deps()).toHaveLength(1);
  });

  it('CA-12 a stale baseVersion is 409 PLAN_APPLY_CONFLICT and writes nothing', async () => {
    const { s, a, b, deps } = await fixture();
    const graph = await s.app.inject({ url: '/api/v1/plan-graph', headers: { cookie: s.cookie } });
    const { version } = graph.json();
    await post(s, '/plan/apply', {
      ops: [{ op: 'setDependencies', projectId: b.id, dependsOn: [a.id] }],
      baseVersion: version,
    });
    const before = deps().length;
    const stale = await post(s, '/plan/apply', {
      ops: [{ op: 'setDependencies', projectId: b.id, dependsOn: [] }],
      baseVersion: version,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('PLAN_APPLY_CONFLICT');
    expect(deps()).toHaveLength(before);
  });

  it('CA-13 /plan/preview recomputes capacity and alerts without writing anything', async () => {
    const { s, a, b, deps, audits } = await fixture();
    const n = audits();
    const res = await post(s, '/plan/preview', {
      ops: [{ op: 'setDependencies', projectId: b.id, dependsOn: [a.id] }],
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.capacity)).toBe(true);
    expect(Array.isArray(body.alerts)).toBe(true);
    expect(body.objectives[0]).toMatchObject({ pathMonths: 2 }); // the draft chain A → B is counted
    expect(audits()).toBe(n);
    expect(deps()).toHaveLength(0);
    const bad = await post(s, '/plan/preview', {
      ops: [{ op: 'setDependencies', projectId: a.id, dependsOn: [a.id] }],
    });
    expect(bad.statusCode).toBe(422);
    expect(audits()).toBe(n);
  });
});
