// C-05 probe, run in a child process by hardening.test.ts: an invalid rule used to freeze the process.
// Prints one JSON line: the status codes observed.
import { openDb, runMigrations } from '@memento/db';
import { createTask, seed } from '@memento/domain';
import { buildApp } from '../../src/app.ts';
import { createToken } from '../../src/auth.ts';

const rules = JSON.parse(process.argv[2]) as string[];
const { db, sqlite } = openDb(':memory:');
runMigrations(db);
seed({ db, sqlite, actor: 'me' });
const app = await buildApp({ db, sqlite, cookieSecure: false, webDist: '/nonexistent' });
const headers = { authorization: `Bearer ${createToken(db, 'writer', 'read_write').token}` };
const out: Record<string, unknown> = {};
for (const rule of rules) {
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/tasks',
    headers,
    payload: { title: 'x', dueDate: '2026-11-10', recurrenceRule: rule },
  });
  // The same rule stored anyway (old data): the calendar and the completion must not freeze.
  const t = createTask(
    { db, sqlite, actor: 'me' },
    { title: 'y', dueDate: '2026-11-10', recurrenceRule: 'FREQ=WEEKLY' },
  );
  sqlite.prepare('update task set recurrence_rule = ? where id = ?').run(rule, t.id);
  const cal = await app.inject({
    method: 'GET',
    url: '/api/v1/calendar?from=2026-11-01&to=2026-12-31',
    headers,
  });
  const done = await app.inject({
    method: 'POST',
    url: `/api/v1/tasks/${t.id}/complete`,
    headers,
    payload: {},
  });
  const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
  out[rule] = {
    create: created.statusCode,
    code: created.json().code ?? null,
    calendar: cal.statusCode,
    complete: done.statusCode,
    completeCode: done.json().code ?? null,
    health: health.statusCode,
  };
}
console.log(JSON.stringify(out));
process.exit(0);
