// EX-30 / D-162: the people of the souvenirs, managed in Configuration. A name typed at capture (« + quelqu'un
// d'autre ») is created « à confirmer » (CE-08): offered again next time, then filed in a group, merged or deleted.
import { asc, eq, schema } from '@memento/db';
import type { z } from 'zod';
import { audit, type Ctx, ctxNowIso, newId, tx } from '../context.ts';
import { assertFound, DomainError } from '../errors.ts';
import type { personCreate, personPatch } from '../schemas-souvenirs.ts';
import { listDomains } from './referential.ts';

const { person, souvenirPerson } = schema;
export type PersonCreate = z.infer<typeof personCreate>;
export type PersonPatch = z.infer<typeof personPatch>;

/** Colours given in turn to new people (initials avatars). */
const PALETTE = ['#D2691E', '#D4537E', '#1D9E75', '#7F77DD', '#2F6FDB', '#BA7517', '#0F8A8A', '#9C4FB8'];
const key = (name: string) => name.trim().toLocaleLowerCase('fr');

export function listPersons(ctx: Ctx) {
  return ctx.db.select().from(person).orderBy(asc(person.position), asc(person.name)).all();
}

export const getPerson = (ctx: Ctx, id: string) =>
  assertFound(ctx.db.select().from(person).where(eq(person.id, id)).get(), 'Personne', id);

export function createPerson(ctx: Ctx, input: PersonCreate & { toConfirm?: boolean }) {
  return tx(ctx, () => {
    if (
      ctx.db
        .select()
        .from(person)
        .where(eq(person.nameKey, key(input.name)))
        .get()
    )
      throw new DomainError('PERSON_EXISTS', `« ${input.name.trim()} » existe déjà.`);
    const count = ctx.db.select().from(person).all().length;
    const id = newId();
    ctx.db
      .insert(person)
      .values({
        id,
        createdBy: ctx.actor,
        name: input.name.trim(),
        nameKey: key(input.name),
        group: input.group ?? 'other',
        color: input.color ?? PALETTE[count % PALETTE.length],
        birthDate: input.birthDate ?? null,
        active: input.active ?? true,
        toConfirm: input.toConfirm ?? false,
        alertAfterDays: input.alertAfterDays ?? null,
        position: count,
      })
      .run();
    const row = getPerson(ctx, id);
    audit(ctx, 'person', id, 'create', null, row);
    return row;
  });
}

/** CE-08: a typed name is the known person of that name, or a new one « à confirmer ». */
export function personByName(ctx: Ctx, name: string) {
  return (
    ctx.db
      .select()
      .from(person)
      .where(eq(person.nameKey, key(name)))
      .get() ?? createPerson(ctx, { name, toConfirm: true })
  );
}

export function updatePerson(ctx: Ctx, id: string, patch: PersonPatch) {
  return tx(ctx, () => {
    const before = getPerson(ctx, id);
    if (patch.name !== undefined) {
      const other = ctx.db
        .select()
        .from(person)
        .where(eq(person.nameKey, key(patch.name)))
        .get();
      if (other && other.id !== id) throw new DomainError('PERSON_EXISTS', `« ${patch.name} » existe déjà.`);
    }
    // Filing a person in a group confirms it.
    const toConfirm = patch.toConfirm ?? (patch.group !== undefined ? false : undefined);
    ctx.db
      .update(person)
      .set({
        ...patch,
        ...(patch.name !== undefined ? { name: patch.name.trim(), nameKey: key(patch.name) } : {}),
        ...(toConfirm !== undefined ? { toConfirm } : {}),
        updatedAt: ctxNowIso(ctx),
      })
      .where(eq(person.id, id))
      .run();
    const after = getPerson(ctx, id);
    audit(ctx, 'person', id, 'update', before, after);
    return after;
  });
}

/** Moves the souvenirs of `id` to `intoId`, then removes `id` (a duplicate typed at capture). */
export function mergePerson(ctx: Ctx, id: string, intoId: string) {
  return tx(ctx, () => {
    if (id === intoId) throw new DomainError('SAME_PERSON', 'Choisis une autre personne.');
    const before = getPerson(ctx, id);
    getPerson(ctx, intoId);
    const links = ctx.db.select().from(souvenirPerson).where(eq(souvenirPerson.personId, id)).all();
    ctx.db.delete(souvenirPerson).where(eq(souvenirPerson.personId, id)).run();
    for (const l of links)
      ctx.db
        .insert(souvenirPerson)
        .values({ souvenirId: l.souvenirId, personId: intoId })
        .onConflictDoNothing()
        .run();
    ctx.db.delete(person).where(eq(person.id, id)).run();
    audit(ctx, 'person', id, 'merge', before, { mergedInto: intoId });
    return getPerson(ctx, intoId);
  });
}

export function deletePerson(ctx: Ctx, id: string) {
  return tx(ctx, () => {
    const before = getPerson(ctx, id);
    ctx.db.delete(souvenirPerson).where(eq(souvenirPerson.personId, id)).run();
    ctx.db.delete(person).where(eq(person.id, id)).run();
    audit(ctx, 'person', id, 'delete', before, null);
    return { ok: true as const };
  });
}

/**
 * EX-11 / D-163: the domain of a souvenir from its people: a family member → Famille; only friends → Amis &
 * Social; nobody (or others) → Loisirs & Découverte. Found by name like the guards; Famille, then none, when the
 * domain was renamed.
 */
export function domainForPeople(ctx: Ctx, personIds: string[]): string | null {
  const domains = listDomains(ctx);
  const byName = (prefix: string) => domains.find((d) => d.name.startsWith(prefix))?.id ?? null;
  const family = byName('Famille');
  const people = personIds.map((id) => getPerson(ctx, id));
  if (people.some((p) => p.group === 'family')) return family;
  if (people.length && people.every((p) => p.group === 'friends')) return byName('Amis') ?? family;
  return byName('Loisirs') ?? family;
}
