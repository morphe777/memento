import type { AddressInfo } from 'node:net';
import { openDb, runMigrations } from '@memento/db';
import { parisDate, seed } from '@memento/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../api/src/app.ts';
import { createToken, setUserPassword } from '../../api/src/auth.ts';

let api: Awaited<ReturnType<typeof buildApp>>;
let mcpUrl = '';
let token = '';
let cookie = '';
let testDb: ReturnType<typeof openDb>['db'];

async function rpc(method: string, params: unknown, auth = token) {
  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
}

beforeAll(async () => {
  const { db, sqlite } = openDb(':memory:');
  runMigrations(db);
  testDb = db;
  seed({ db, sqlite, actor: 'me' });
  await setUserPassword(db, 'owner', 'correct horse battery');
  token = createToken(db, 'claude', 'read_write').token;
  api = await buildApp({ db, sqlite, cookieSecure: false, webDist: '/nonexistent' });
  await api.listen({ port: 0, host: '127.0.0.1' });
  const login = await api.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { login: 'owner', password: 'correct horse battery' },
  });
  cookie = `memento_session=${login.cookies[0].value}`;
  process.env.MEMENTO_API_URL = `http://127.0.0.1:${(api.server.address() as AddressInfo).port}/api/v1`;
  process.env.MEMENTO_MCP_NO_LISTEN = '1';
  const { http } = await import('../src/index.ts');
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', () => r()));
  mcpUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
});

afterAll(async () => {
  await api.close();
});

describe('MCP L6', () => {
  it('requires a bearer token', async () => {
    expect((await rpc('tools/list', {}, '')).status).toBe(401);
  });

  it('exposes the §9 tools', async () => {
    await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    const { body } = await rpc('tools/list', {});
    const names = body.result.tools.map((t: { name: string }) => t.name);
    for (const n of [
      'search',
      'get_guide',
      'get_experiences',
      'get_context',
      'create_idea',
      'create_project',
      'promote_idea',
      'duplicate_project',
      'duplicate_objective',
      'get_calendar',
      'parse_task',
      'create_tasks',
      'add_inbox_task',
      'get_week_plan',
      'set_week_plan_items',
      'get_report',
      'list_changes',
      'add_resource',
      'list_meta_objectives',
      'get_meta_objective',
      'create_meta_objective',
      'update_meta_objective',
      'set_objective_meta',
      'set_project_dependencies',
      'add_project_dependency',
      'remove_project_dependency',
      'get_plan_graph',
      'preview_plan_changes',
      'apply_plan_changes',
      'reorder_objectives',
    ]) {
      expect(names).toContain(n);
    }
    // D-60: deletion tools exist, for explicit requests only (said in their description).
    for (const n of ['delete_task', 'delete_project', 'delete_objective', 'delete_meta_objective'])
      expect(names).toContain(n);
  });

  it('D-60: deletes a task through MCP, journaled as ai:claude', async () => {
    const created = await rpc('tools/call', {
      name: 'add_inbox_task',
      arguments: { title: 'À supprimer', durationMin: 30 },
    });
    const id = JSON.parse(created.body.result.content[0].text).id;
    const { body } = await rpc('tools/call', { name: 'delete_task', arguments: { id } });
    expect(body.result.isError).toBeFalsy();
    const changes = (await api.inject({ url: '/api/v1/changes?actor=ai', headers: { cookie } })).json();
    expect(
      changes.some(
        (c: { action: string; title: string }) => c.action === 'delete' && c.title === 'À supprimer',
      ),
    ).toBe(true);
    await api.inject({
      method: 'POST',
      url: '/api/v1/changes/mark-reviewed',
      headers: { cookie },
      payload: { ids: changes.map((c: { id: string }) => c.id) },
    });
  });

  it('a task created through MCP shows in "À revoir" as ai:claude, and marking it reviewed removes it', async () => {
    // H-15: the database is shared by the file's tests; start from an empty « À revoir », whatever ran before.
    const pending = (await api.inject({ url: '/api/v1/changes?actor=ai', headers: { cookie } })).json();
    await api.inject({
      method: 'POST',
      url: '/api/v1/changes/mark-reviewed',
      headers: { cookie },
      payload: { ids: pending.map((c: { id: string }) => c.id) },
    });
    const { body } = await rpc('tools/call', {
      name: 'add_inbox_task',
      arguments: { title: 'Rappeler le garage', durationMin: 30 },
    });
    expect(body.result.isError).toBeFalsy();
    const changes = (await api.inject({ url: '/api/v1/changes?actor=ai', headers: { cookie } })).json();
    expect(changes[0]).toMatchObject({ actor: 'ai:claude', title: 'Rappeler le garage', action: 'create' });
    await api.inject({
      method: 'POST',
      url: '/api/v1/changes/mark-reviewed',
      headers: { cookie },
      payload: { ids: [changes[0].id] },
    });
    expect((await api.inject({ url: '/api/v1/changes?actor=ai', headers: { cookie } })).json()).toHaveLength(
      0,
    );
  });

  it('get_guide returns the AI guide as Markdown', async () => {
    const res = (await rpc('tools/call', { name: 'get_guide', arguments: {} })).body;
    expect(res.result.content[0].text).toMatch(/^# Mémento — guide de l'API pour une IA/);
  });

  it('business errors come back as tool errors with the readable code', async () => {
    const groups = (await api.inject({ url: '/api/v1/groups', headers: { cookie } })).json();
    const idea = (
      await rpc('tools/call', {
        name: 'create_idea',
        arguments: { title: 'Peinture', groupIds: [groups[0].id] },
      })
    ).body;
    const id = JSON.parse(idea.result.content[0].text).id;
    await rpc('tools/call', { name: 'promote_idea', arguments: { id } });
    const res = (
      await rpc('tools/call', {
        name: 'set_project_month',
        arguments: { id, month: parisDate().slice(0, 7) }, // H-15: the app's month (Paris), not UTC's
      })
    ).body;
    expect(res.result.isError).toBe(true);
    expect(JSON.parse(res.result.content[0].text).code).toBe('MONTH_PROJECT_INCOMPLETE');
  });

  it('Vue Plan: get_plan_graph returns the graph', async () => {
    const res = (await rpc('tools/call', { name: 'get_plan_graph', arguments: { includeReserve: true } }))
      .body;
    expect(res.result.isError).toBeFalsy();
    const graph = JSON.parse(res.result.content[0].text);
    expect(graph.version).toBeTypeOf('string');
    expect(Array.isArray(graph.objectives)).toBe(true);
  });

  it('Vue Plan: a self dependency is refused with DEPENDENCY_SELF', async () => {
    const groups = (await api.inject({ url: '/api/v1/groups', headers: { cookie } })).json();
    const idea = (
      await rpc('tools/call', {
        name: 'create_idea',
        arguments: { title: 'Dépendance', groupIds: [groups[0].id] },
      })
    ).body;
    const id = JSON.parse(idea.result.content[0].text).id;
    const res = (
      await rpc('tools/call', { name: 'set_project_dependencies', arguments: { id, dependsOn: [id] } })
    ).body;
    expect(res.result.isError).toBe(true);
    expect(JSON.parse(res.result.content[0].text).code).toBe('DEPENDENCY_SELF');
  });

  it('Vue Plan: a read-only token previews but cannot apply', async () => {
    const ro = createToken(testDb, 'lecteur', 'read').token;
    const ops = [
      { op: 'reorderObjectives', quarter: '2026-Q4', ids: ['00000000-0000-4000-8000-000000000001'] },
    ];
    const prev = (await rpc('tools/call', { name: 'preview_plan_changes', arguments: { ops } }, ro)).body;
    expect(JSON.parse(prev.result.content[0].text).code).not.toBe('READ_ONLY_TOKEN');
    const res = (await rpc('tools/call', { name: 'apply_plan_changes', arguments: { ops } }, ro)).body;
    expect(res.result.isError).toBe(true);
    expect(JSON.parse(res.result.content[0].text).code).toBe('READ_ONLY_TOKEN');
  });
});

describe('C-03 a tool only reaches its own route', () => {
  const addTask = async (title: string) =>
    JSON.parse(
      (await rpc('tools/call', { name: 'add_inbox_task', arguments: { title, durationMin: 30 } })).body.result
        .content[0].text,
    ).id as string;
  const exists = async (id: string) =>
    (await api.inject({ url: `/api/v1/tasks/${id}`, headers: { cookie } })).statusCode === 200;

  it.each([
    (id: string) => `../tasks/${id}`,
    (id: string) => `..%2Ftasks%2F${id}`,
    (id: string) => `%2e%2e/tasks/${id}`,
    () => '..',
    () => '',
  ])('remove_vacation with a path in « from » is refused and the task stays', async (from) => {
    const id = await addTask('Ne pas supprimer');
    const res = (await rpc('tools/call', { name: 'remove_vacation', arguments: { from: from(id) } })).body;
    expect(res.result?.isError ?? !!res.error).toBe(true);
    expect(await exists(id)).toBe(true);
  });

  it('path parameters are encoded segments: `..` and empty values are refused', async () => {
    const { p } = await import('../src/index.ts');
    expect(p`/vacations/${'2026-11-10'}`).toBe('/vacations/2026-11-10');
    expect(p`/reports/by-period/${'week'}/${'a/b?c'}`).toBe('/reports/by-period/week/a%2Fb%3Fc');
    expect(() => p`/vacations/${'..'}`).toThrow();
    expect(() => p`/vacations/${'.'}`).toThrow();
    expect(() => p`/reports/by-period/${undefined}/${'2026-W45'}`).toThrow();
  });

  it('week, date and period parameters follow the domain schemas', async () => {
    for (const [name, args] of [
      ['get_week_plan', { isoWeek: '../tasks' }],
      ['propose_week_plan', { isoWeek: '2026-45' }],
      ['get_report', { kind: 'week', periodKey: '../../tasks' }],
      ['get_daily_recap', { date: '2026-13-45' }],
      ['add_vacation', { from: '2026-10-45', to: '2026-10-46' }],
    ] as const) {
      const res = (await rpc('tools/call', { name, arguments: args })).body;
      expect([name, res.result?.isError ?? !!res.error]).toEqual([name, true]);
    }
  });
});

describe('C-05 the MCP refuses an invalid recurrence rule', () => {
  it.each(['FREQ=DAILY;INTERVAL=abc', 'FREQ=NOPE', 'FREQ=WEEKLY;BYDAY=XX', 'FREQ=DAILY;INTERVAL=0'])(
    'update_task %s: tool error INVALID_RECURRENCE, the API still answers',
    async (rule) => {
      const created = (
        await rpc('tools/call', { name: 'add_inbox_task', arguments: { title: 'Arroser', durationMin: 5 } })
      ).body;
      const id = JSON.parse(created.result.content[0].text).id;
      const res = (await rpc('tools/call', { name: 'update_task', arguments: { id, recurrenceRule: rule } }))
        .body;
      expect(res.result.isError).toBe(true);
      expect(JSON.parse(res.result.content[0].text).code).toBe('INVALID_RECURRENCE');
      expect((await api.inject({ url: '/api/v1/health' })).statusCode).toBe(200);
    },
  );
});
