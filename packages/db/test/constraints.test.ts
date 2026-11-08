// Audit v1.0 Lot 2, M-19 (D-145): the database refuses an unknown status and an impossible day, whatever writes.
import { describe, expect, it } from 'vitest';
import { openDb, runMigrations } from '../src/client.ts';

function fresh() {
  const { db, sqlite } = openDb(':memory:');
  runMigrations(db);
  return sqlite;
}

describe('M-19 checks in the database', () => {
  it('a task status outside the list and a day that does not exist are refused, on insert and update', () => {
    const sqlite = fresh();
    const ins = (status: string, due: string | null) =>
      sqlite
        .prepare(`insert into task (id, title, status, due_date, created_by) values (?, 't', ?, ?, 'me')`)
        .run(crypto.randomUUID(), status, due);
    expect(() => ins('todo', '2026-02-28')).not.toThrow();
    expect(() => ins('todo', null)).not.toThrow();
    expect(() => ins('finished', null)).toThrow(/CHECK task.status/);
    for (const bad of ['2026-02-30', '2026-13-01', '2026-2-3', '28/02/2026'])
      expect(() => ins('todo', bad)).toThrow(/CHECK task.due_date/);
    expect(() => sqlite.prepare(`update task set status = 'late'`).run()).toThrow(/CHECK task.status/);
    expect(() => sqlite.prepare(`update task set due_date = '2027-02-29'`).run()).toThrow(/not a real day/);
    expect(() => sqlite.prepare(`update task set due_date = '2028-02-29'`).run()).not.toThrow();
  });

  it('the filtered columns have an index', () => {
    const sqlite = fresh();
    const plan = (q: string) =>
      (sqlite.prepare(`explain query plan ${q}`).all() as { detail: string }[])
        .map((r) => r.detail)
        .join(' ');
    expect(plan(`select * from week_plan_item where task_id = 'x'`)).toMatch(/USING INDEX/);
    expect(plan(`select * from task where done_at >= '2026-11-01'`)).toMatch(/USING INDEX/);
    expect(plan(`select * from audit_log where reviewed_at is null`)).toMatch(/USING INDEX/);
  });
});
