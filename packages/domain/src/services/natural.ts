// D-115: a task typed in plain French, read against today (Paris) and the domains. Writes nothing.
import { type Ctx, ctxNow } from '../context.ts';
import { type NaturalKind, parseTaskText } from '../rules/natural.ts';
import { currentWeek, parisDate } from '../time.ts';
import { listDomains } from './referential.ts';

export function parseTask(ctx: Ctx, input: { text: string; inbox?: boolean; ignore?: NaturalKind[] }) {
  const now = ctxNow(ctx);
  const r = parseTaskText(input.text, {
    today: parisDate(now),
    domains: listDomains(ctx, false).map((d) => ({ id: d.id, name: d.name })),
    inbox: input.inbox ?? true,
    ignore: input.ignore,
  });
  return { ...r, isoWeek: r.week ? currentWeek(now) : null };
}
