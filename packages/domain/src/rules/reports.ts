// Weekly report indicators (dossier de dev §7, Specs §5b). Pure functions over a data snapshot.
import { fmtMin } from '../time.ts';

export type Focus = 'Cap tenu' | 'Semaine Inbox' | 'Dispersé' | 'Mixte' | 'Rien de fait';
export type Rhythm = 'Sous-productif' | 'OK' | 'Surproductif';
export type Light = 'green' | 'orange' | 'red';

export interface DoneTask {
  id: string;
  title: string;
  /** Time spent: the actual time when entered (D-61), otherwise the estimate. */
  durationMin: number;
  /** The estimate (RB-03 duration), to compare with the time spent. */
  estimateMin: number;
  /** True when the actual time was entered. */
  measured: boolean;
  isExperience: boolean;
  isBonus: boolean;
  /** 'objective' = project linked to an active objective; 'inbox'; 'none' = project without active objective. */
  bucket: 'objective' | 'inbox' | 'none';
  domainIds: string[]; // domains served (DM-84); [] = Inbox without domain
}

/** R-04: share of hours (experiences excluded) → palier, never a percentage. */
export function focusOf(tasks: DoneTask[]): Focus {
  const work = tasks.filter((t) => !t.isExperience);
  const total = work.reduce((s, t) => s + t.durationMin, 0);
  if (total === 0) return 'Rien de fait';
  const share = (b: DoneTask['bucket']) =>
    work.filter((t) => t.bucket === b).reduce((s, t) => s + t.durationMin, 0) / total;
  if (share('objective') >= 0.5) return 'Cap tenu';
  if (share('inbox') >= 0.5) return 'Semaine Inbox';
  if (share('none') >= 0.5) return 'Dispersé';
  return 'Mixte';
}

/** R-05: done hours ÷ budget; < low % under, low–high OK, > high over. Bonus counted (Q-27), experiences not (RB-09). */
export function rhythmOf(doneMin: number, budgetMin: number, lowPct = 80, highPct = 110): Rhythm {
  if (budgetMin <= 0) return doneMin > 0 ? 'Surproductif' : 'OK';
  const pct = (doneMin / budgetMin) * 100;
  if (pct < lowPct) return 'Sous-productif';
  if (pct > highPct) return 'Surproductif';
  return 'OK';
}

/** Minutes per domain served (DM-84: hours count for each domain served), experiences included. */
export function minutesByDomain(tasks: DoneTask[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tasks) {
    const keys = t.domainIds.length ? t.domainIds : ['inbox'];
    for (const k of keys) out[k] = (out[k] ?? 0) + t.durationMin;
  }
  return out;
}

export interface GlobalInput {
  experiencesWindow: number;
  experienceTarget: number;
  healthMin: number;
  familyMin: number;
  rhythm: Rhythm;
  focus: Focus;
}

/** R-01: red if 0 experience AND 0 h Santé; green if all good; orange otherwise. */
export function globalIndicator(i: GlobalInput): { light: Light; title: string; sentence: string } {
  if (i.experiencesWindow === 0 && i.healthMin === 0) {
    return {
      light: 'red',
      title: 'Semaine à revoir',
      sentence: 'Rien pour la santé et aucune expérience sur la période.',
    };
  }
  const good: string[] = [];
  const bad: string[] = [];
  (i.focus === 'Cap tenu' ? good : bad).push(
    i.focus === 'Cap tenu' ? 'cap tenu' : `focus ${i.focus.toLowerCase()}`,
  );
  (i.rhythm === 'OK' ? good : bad).push(i.rhythm === 'OK' ? 'rythme OK' : `rythme ${i.rhythm.toLowerCase()}`);
  if (i.experiencesWindow >= i.experienceTarget) good.push('expériences au rendez-vous');
  else
    bad.push(
      i.experiencesWindow === 0
        ? 'aucune expérience sur la période'
        : `${i.experiencesWindow} / ${i.experienceTarget} expériences`,
    );
  if (i.healthMin > 0) good.push('santé présente');
  else bad.push('rien pour la santé');
  if (i.familyMin > 0) good.push('famille présente');
  else bad.push('rien pour la famille');
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (bad.length === 0)
    return { light: 'green', title: 'Bonne semaine', sentence: `${cap(good.join(', '))}.` };
  const sentence = good.length
    ? `${cap(good.slice(0, 2).join(' et '))}, mais ${bad.join(', ')}.`
    : `${cap(bad.join(', '))}.`;
  return { light: 'orange', title: 'Semaine correcte', sentence };
}

export interface DelayBar {
  projectId: string;
  title: string;
  domainId: string | null;
  deltaMin: number; // > 0 ahead, < 0 late
}

/** DelayBar geometry shared by Ma semaine and reports (mockups: ±4 h fills half the bar). */
export function delayLabel(deltaMin: number): string {
  if (Math.abs(deltaMin) < 15) return "à l'heure";
  return `${deltaMin > 0 ? '+' : '−'}${fmtMin(Math.abs(deltaMin))}`;
}

/**
 * D-61: estimate vs time actually spent, over the done work (experiences excluded). Tasks without an entered
 * actual time count as estimated. Overruns: at least 1.5× the estimate (and +30 min), biggest first.
 */
export function estimationOf(tasks: DoneTask[]) {
  const work = tasks.filter((t) => !t.isExperience && t.estimateMin > 0);
  const estimatedMin = work.reduce((s, t) => s + t.estimateMin, 0);
  const spentMin = work.reduce((s, t) => s + t.durationMin, 0);
  const measured = work.filter((t) => t.measured);
  const overruns = measured
    .filter((t) => t.durationMin >= t.estimateMin * 1.5 && t.durationMin - t.estimateMin >= 30)
    .sort((a, b) => b.durationMin - b.estimateMin - (a.durationMin - a.estimateMin))
    .slice(0, 5)
    .map((t) => ({ title: t.title, estimateMin: t.estimateMin, actualMin: t.durationMin }));
  return {
    measuredCount: measured.length,
    estimatedMin,
    spentMin,
    /** spent / estimated in %, 100 = as planned; null when nothing measured. */
    ratioPct: measured.length && estimatedMin ? Math.round((spentMin / estimatedMin) * 100) : null,
    overruns,
    underruns: measured.filter((t) => t.durationMin < t.estimateMin).length,
  };
}
