// Audit v1.0 Lot 2, H-14 (rest): an expired session, a session closed by a password change and a revoked token
// no longer open anything.
import { eq, openDb, runMigrations, schema } from '@memento/db';
import { seed } from '@memento/domain';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createToken, setUserPassword } from '../src/auth.ts';

async function start() {
  const { db, sqlite } = openDb(':memory:');
  runMigrations(db);
  seed({ db, sqlite, actor: 'me' });
  await setUserPassword(db, 'owner', 'correct horse battery');
  const app = await buildApp({ db, sqlite, cookieSecure: false, webDist: '/nonexistent' });
  const login = async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: 'owner', password: 'correct horse battery' },
    });
    return `memento_session=${res.cookies.find((c) => c.name === 'memento_session')!.value}`;
  };
  const get = (url: string, headers: Record<string, string>) =>
    app.inject({ method: 'GET', url: `/api/v1${url}`, headers });
  return { db, app, login, get };
}

describe('H-14 sessions and tokens end', () => {
  it('an expired session is refused and removed', async () => {
    const { db, login, get } = await start();
    const cookie = await login();
    expect((await get('/domains', { cookie })).statusCode).toBe(200);
    db.update(schema.session).set({ expiresAt: '2000-01-01T00:00:00.000Z' }).run();
    expect((await get('/domains', { cookie })).statusCode).toBe(401);
    expect(db.select().from(schema.session).all()).toHaveLength(0);
  });

  it('a password change closes the other sessions', async () => {
    const { app, login, get } = await start();
    const mine = await login();
    const other = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers: { cookie: mine },
      payload: { current: 'correct horse battery', next: 'another horse battery staple' },
    });
    expect(res.statusCode).toBe(200);
    expect((await get('/domains', { cookie: other })).statusCode).toBe(401);
    expect((await get('/domains', { cookie: mine })).statusCode).toBe(200);
  });

  it('a password reset (CLI) closes every session', async () => {
    const { db, login, get } = await start();
    const cookie = await login();
    await setUserPassword(db, 'owner', 'a brand new horse battery');
    expect((await get('/domains', { cookie })).statusCode).toBe(401);
  });

  it('a revoked token is refused at once', async () => {
    const { db, app, login, get } = await start();
    const t = createToken(db, 'claude', 'read_write');
    const auth = { authorization: `Bearer ${t.token}` };
    expect((await get('/domains', auth)).statusCode).toBe(200);
    const cookie = await login();
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/v1/tokens/${t.id}`, headers: { cookie } })).statusCode,
    ).toBe(200);
    expect((await get('/domains', auth)).statusCode).toBe(401);
    expect(
      db.select().from(schema.apiToken).where(eq(schema.apiToken.id, t.id)).get()?.revokedAt,
    ).toBeTruthy();
  });
});
