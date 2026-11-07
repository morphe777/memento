// C-05, C-06: finds the impossible dates and the unreadable recurrence rules already stored (written before the
// validation existed, or imported). Read only: it reports, the owner corrects by hand.
import type { SqliteDatabase } from '@memento/db';
import { isValidRecurrenceRule } from '../rules/recurrence.ts';
import { isValidDate } from '../time.ts';

export interface InvalidValue {
  table: string;
  id: string;
  column: string;
  value: string;
}

const DATE_COLUMNS: [table: string, column: string][] = [
  ['task', 'due_date'],
  ['project', 'start_date'],
  ['project', 'due_date'],
  ['objective', 'deadline'],
  ['meta_objective', 'horizon_date'],
];

export function findInvalidData(sqlite: SqliteDatabase): InvalidValue[] {
  const out: InvalidValue[] = [];
  for (const [table, column] of DATE_COLUMNS) {
    const rows = sqlite
      .prepare(`select id, ${column} as v from ${table} where ${column} is not null`)
      .all() as {
      id: string;
      v: string;
    }[];
    for (const r of rows) if (!isValidDate(r.v)) out.push({ table, id: r.id, column, value: r.v });
  }
  const rules = sqlite
    .prepare('select id, recurrence_rule as v from task where recurrence_rule is not null')
    .all() as { id: string; v: string }[];
  for (const r of rules)
    if (!isValidRecurrenceRule(r.v))
      out.push({ table: 'task', id: r.id, column: 'recurrence_rule', value: r.v });
  const vac = sqlite.prepare("select value from setting where key = 'notify.vacations'").get() as
    | { value: string }
    | undefined;
  if (vac) {
    let list: unknown;
    try {
      list = JSON.parse(vac.value);
    } catch {
      list = null;
    }
    if (!Array.isArray(list))
      out.push({ table: 'setting', id: 'notify.vacations', column: 'value', value: vac.value });
    else
      list.forEach((v: { from?: unknown; to?: unknown }, i) => {
        for (const k of ['from', 'to'] as const)
          if (typeof v?.[k] !== 'string' || !isValidDate(v[k] as string))
            out.push({ table: 'setting', id: `notify.vacations[${i}]`, column: k, value: String(v?.[k]) });
      });
  }
  return out;
}
