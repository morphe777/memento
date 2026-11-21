// v1.2 routes: done time (D-152), lived experience (D-153), « Compléter le budget » (D-155).
import { openDb, runMigrations } from '@memento/db';
import { seed } from '@memento/domain';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createToken, setUserPassword } from '../src/auth.ts';

const PASSWORD = 'correct horse battery';

async function setup(llm?: () => Promise<{ text: string; model: string }>) {
  const { db, sqlite } = openDb(':memory:');
  runMigrations(db);
  seed({ db, sqlite, actor: 'me' });
  await setUserPassword(db, 'owner', PASSWORD);
  const app = await buildApp({ db, sqlite, cookieSecure: false, webDist: '/nonexistent', llm });
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { login: 'owner', password: PASSWORD },
  });
  const h = { cookie: `memento_session=${login.cookies.find((c) => c.name === 'memento_session')!.value}` };
  return { app, db, h };
}

describe('API v1.2', () => {
  it('records a lived experience (also with a token) and edits a done time, Paris time, never ahead', async () => {
    const { app, db, h } = await setup();
    const lived = await app.inject({
      method: 'POST',
      url: '/api/v1/experiences/lived',
      headers: h,
      payload: { title: 'Pique-nique', doneAt: '2026-01-10T12:30' },
    });
    expect(lived.statusCode).toBe(200);
    expect(lived.json()).toMatchObject({
      status: 'done',
      isExperience: true,
      doneAt: '2026-01-10T11:30:00.000Z',
    });
    const t = createToken(db, 'bot', 'read_write');
    const bot = await app.inject({
      method: 'POST',
      url: '/api/v1/experiences/lived',
      headers: { authorization: `Bearer ${t.token}` },
      payload: { title: 'Concert' },
    });
    expect(bot.statusCode).toBe(200);
    const future = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${lived.json().id}`,
      headers: h,
      payload: { doneAt: '2999-01-01T10:00' },
    });
    expect(future.json()).toMatchObject({ code: 'DONE_IN_FUTURE' });
    const badDay = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${lived.json().id}`,
      headers: h,
      payload: { doneAt: '2026-02-30T10:00' },
    });
    expect(badDay.statusCode).toBe(422);
    expect(badDay.json().code).toBe('INVALID_DATE');
  });

  it('« Compléter le budget » answers through the configured model and is refused to tokens', async () => {
    const llm = async () => ({ text: '{"summary":"Rien à ajouter.","items":[]}', model: 'fake' });
    const { app, db, h } = await setup(llm);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/fill-week',
      headers: h,
      payload: { isoWeek: '2026-W47' },
    });
    expect(r.json()).toMatchObject({ summary: 'Rien à ajouter.', items: [], model: 'fake' });
    const t = createToken(db, 'bot', 'read_write');
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/fill-week',
      headers: { authorization: `Bearer ${t.token}` },
      payload: { isoWeek: '2026-W47' },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('D-175: Cap de la semaine read and written by hand with a token; ↻ (AI) for the interface only', async () => {
    const llm = async () => ({ text: '{"items":[]}', model: 'fake' });
    const { app, db, h } = await setup(llm);
    const t = createToken(db, 'bot', 'read_write');
    const bot = { authorization: `Bearer ${t.token}` };
    const url = '/api/v1/week-plans/2026-W47/focus';
    expect((await app.inject({ method: 'GET', url, headers: bot })).json()).toEqual({ focus: null });
    const put = await app.inject({
      method: 'PUT',
      url,
      headers: bot,
      payload: { items: ['Poser le **carrelage**'] },
    });
    expect(put.json()).toMatchObject({
      focus: { source: 'me', items: [{ text: 'Poser le **carrelage**' }] },
    });
    expect((await app.inject({ method: 'POST', url: `${url}/refresh`, headers: bot })).statusCode).toBe(403);
    const refresh = await app.inject({ method: 'POST', url: `${url}/refresh`, headers: h });
    expect(refresh.json()).toMatchObject({ focus: { source: 'plain', items: [] } }); // nothing planned
  });
});
