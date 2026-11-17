// D-157: every lived experience has its souvenir. Called by the task services (no import of them here, so the
// task code can call it): a done experience task gets its souvenir; a deleted task takes its souvenir along.
import { eq, inArray, schema } from '@memento/db';
import { type Ctx, newId } from '../context.ts';

const { souvenir, souvenirPerson, photo, task } = schema;

/** A done experience task without souvenir gets one (saved, nothing else filled). */
export function ensureSouvenir(ctx: Ctx, taskId: string) {
  const t = ctx.db.select().from(task).where(eq(task.id, taskId)).get();
  if (!t?.isExperience || t.status !== 'done') return;
  if (ctx.db.select().from(souvenir).where(eq(souvenir.taskId, taskId)).get()) return;
  ctx.db.insert(souvenir).values({ id: newId(), createdBy: ctx.actor, taskId, status: 'saved' }).run();
}

/** Rows of the souvenirs of these tasks removed (people, photos); returns the photo ids (files to remove). */
export function removeSouvenirsOfTasks(ctx: Ctx, taskIds: string[]): string[] {
  if (!taskIds.length) return [];
  const rows = ctx.db.select().from(souvenir).where(inArray(souvenir.taskId, taskIds)).all();
  const ids = rows.map((r) => r.id);
  const photoIds = ids.length
    ? ctx.db
        .select({ id: photo.id })
        .from(photo)
        .where(inArray(photo.souvenirId, ids))
        .all()
        .map((p) => p.id)
    : [];
  if (ids.length) {
    ctx.db.delete(souvenirPerson).where(inArray(souvenirPerson.souvenirId, ids)).run();
    ctx.db.delete(photo).where(inArray(photo.souvenirId, ids)).run();
    ctx.db.delete(souvenir).where(inArray(souvenir.id, ids)).run();
  }
  return photoIds;
}

/** The souvenir of a task, if any. */
export const souvenirOfTask = (ctx: Ctx, taskId: string) =>
  ctx.db.select().from(souvenir).where(eq(souvenir.taskId, taskId)).get() ?? null;
