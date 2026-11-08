// Audit v1.0 Lot 2, M-20: /health checks the database, failed logins are logged, search words never are.
import { Writable } from 'node:stream';
import { openDb, runMigrations } from '@memento/db';
import { seed } from '@memento/domain';
import { describe, expect, it } from 'vitest';
import { buildApp, maskQuery } from '../src/app.ts';
import { setUserPassword } from '../src/auth.ts';

async function start() {
  const { db, sqlite } = openDb(':memory:');
  runMigrations(db);
  seed({ db, sqlite, actor: 'me' });
  await setUserPassword(db, 'owner', 'correct horse battery');
  const lines: Record<string, unknown>[] = [];
  const logStream = new Writable({
    write(chunk, _enc, done) {
      for (const l of String(chunk).split('\n').filter(Boolean)) lines.push(JSON.parse(l));
      done();
    },
  });
  const app = await buildApp({ db, sqlite, cookieSecure: false, webDist: '/nonexistent', logStream });
  return { app, sqlite, lines };
}

describe('M-20 observability', () => {
  it('/health answers 503 when the database cannot be read', async () => {
    const { app, sqlite } = await start();
    const ok = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect([ok.statusCode, ok.json().db]).toEqual([200, true]);
    sqlite.close();
    const down = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect([down.statusCode, down.json().ok]).toEqual([503, false]);
  });

  it('a failed login is logged (without the password), a search never shows its words', async () => {
    const { app, lines } = await start();
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: 'owner', password: 'wrong password' },
    });
    await app.inject({ method: 'GET', url: '/api/v1/search?q=mot-secret&limit=5' });
    const text = JSON.stringify(lines);
    expect(lines.some((l) => l.msg === 'login failed')).toBe(true);
    expect(text).not.toContain('wrong password');
    expect(text).not.toContain('mot-secret');
    expect(maskQuery('/api/v1/search?limit=5&q=a%20b')).toBe('/api/v1/search?limit=5&q=***');
  });
});
