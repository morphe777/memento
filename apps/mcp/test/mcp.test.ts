import type { AddressInfo } from 'node:net';
import { openDb, runMigrations } from '@memento/db';
import { seed } from '@memento/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../api/src/app.ts';
import { createToken, setUserPassword } from '../../api/src/auth.ts';

let api: Awaited<ReturnType<typeof buildApp>>;
let mcpUrl = '';
let token = '';
let cookie = '';

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
  seed({ db, sqlite, actor: 'me' });
  await setUserPassword(db, 'mehdi', 'correct horse battery');
  token = createToken(db, 'claude', 'read_write').token;
  api = await buildApp({ db, sqlite, cookieSecure: false, webDist: '/nonexistent' });
  await api.listen({ port: 0, host: '127.0.0.1' });
  const login = await api.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { login: 'mehdi', password: 'correct horse battery' },
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
      'get_context',
      'create_idea',
      'create_project',
      'promote_idea',
      'create_tasks',
      'add_inbox_task',
      'get_week_plan',
      'set_week_plan_items',
      'get_report',
      'list_changes',
      'add_resource',
    ]) {
      expect(names).toContain(n);
    }
    expect(names.some((n: string) => n.startsWith('delete'))).toBe(false);
  });

  it('a task created through MCP shows in "À revoir" as ai:claude, and marking it reviewed removes it', async () => {
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

  it('business errors come back as tool errors with the readable code', async () => {
    const groups = (await api.inject({ url: '/api/v1/groups', headers: { cookie } })).json();
    const idea = (
      await rpc('tools/call', { name: 'create_idea', arguments: { title: 'Clim', groupIds: [groups[0].id] } })
    ).body;
    const id = JSON.parse(idea.result.content[0].text).id;
    await rpc('tools/call', { name: 'promote_idea', arguments: { id } });
    const res = (
      await rpc('tools/call', {
        name: 'set_project_month',
        arguments: { id, month: new Date().toISOString().slice(0, 7) },
      })
    ).body;
    expect(res.result.isError).toBe(true);
    expect(JSON.parse(res.result.content[0].text).code).toBe('MONTH_PROJECT_INCOMPLETE');
  });
});
