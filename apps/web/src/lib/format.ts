// Display helpers only (formatting, colours). No business rule here.
export function fmtMin(m: number | null | undefined): string {
  if (m === null || m === undefined) return '—';
  const a = Math.abs(Math.round(m));
  if (a < 60) return `${a} min`;
  return a % 60 ? `${Math.floor(a / 60)} h ${a % 60}` : `${a / 60} h`;
}
export const fmtMinOrDash = (m: number) => (m ? fmtMin(m) : '—');

const MONTHS = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];
export const fmtDate = (d: string | null | undefined) =>
  d ? `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : '—';
export const fmtDateShort = (d: string | null | undefined) =>
  d ? `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}` : '—';
export function fmtDateTime(iso: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  }).format(new Date(iso));
}
export const weekNumber = (isoWeek: string) => Number(isoWeek.slice(6));

/** ISO week arithmetic for navigation links (display only). */
export function shiftIsoWeek(isoWeek: string, n: number): string {
  const [y, w] = [Number(isoWeek.slice(0, 4)), Number(isoWeek.slice(6))];
  const jan4 = Date.UTC(y, 0, 4);
  const dow = new Date(jan4).getUTCDay() || 7;
  const monday = jan4 - (dow - 1) * 86_400_000 + (w - 1 + n) * 7 * 86_400_000;
  const d = new Date(monday + 3 * 86_400_000); // Thursday
  const year = d.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const week = Math.floor((d.getTime() - start) / 86_400_000 / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export const STATUS_LABEL: Record<string, string> = {
  idea: 'Idée',
  ready: 'Prêt',
  active: 'Actif',
  paused: 'En pause',
  done: 'Terminé',
  abandoned: 'Abandonné',
  achieved: 'Atteint',
  partial: 'Partiel',
  failed: 'Raté',
  todo: 'À faire',
  cancelled: 'Annulée',
};
export const ENTITY_LABEL: Record<string, string> = {
  project: 'Projet',
  objective: 'Objectif',
  meta_objective: 'Méta-objectif',
  task: 'Tâche',
  group: 'Groupe',
  domain: 'Domaine',
  resource: 'Ressource',
  import: 'Données',
  purge: 'Données',
};
export const ACTION_LABEL: Record<string, string> = {
  create: 'créé',
  update: 'modifié',
  complete: 'terminé',
  uncomplete: 'rouvert',
  promote: 'promu',
  move: 'déplacé',
  reorder: 'réordonné',
  cancel: 'annulé',
  archive: 'archivé',
  delete: 'supprimé',
  import: 'importées',
  purge: 'vidées',
  groups: 'groupes modifiés',
  domain_change: 'domaine changé',
  replan: 'replanifié',
  postpone: 'reporté',
  progress: 'avancement',
  dependency_add: 'prérequis ajouté',
  dependency_remove: 'prérequis retiré',
};

/**
 * D-61: reads a time typed by hand: « 1h30 », « 4h », « 45 min », « 1,5 » (hours), « 90 » (minutes).
 * A bare number up to 12 is read as hours, above as minutes. Returns minutes, or null if unreadable.
 */
export function parseDuration(text: string): number | null {
  const s = text.trim().toLowerCase().replace(',', '.').replace(/\s+/g, '');
  if (!s) return null;
  const hm = s.match(/^(\d+(?:\.\d+)?)h(\d{1,2})?(?:min|m)?$/);
  if (hm) return Math.round(Number(hm[1]) * 60 + Number(hm[2] ?? 0));
  const m = s.match(/^(\d+)(?:min|mn|m)$/);
  if (m) return Number(m[1]);
  const n = s.match(/^\d+(?:\.\d+)?$/);
  if (n) return Number(s) <= 12 ? Math.round(Number(s) * 60) : Math.round(Number(s));
  return null;
}
