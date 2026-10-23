// Demo data inspired by the mockups (maquettes/README.md: "jeu de données de démo possible").
// Goes through the domain services, so every business rule and the audit log apply.
// Usage: pnpm db:demo   (refuses to run on a database that already has projects)
import { openDb, runMigrations, schema } from '@memento/db';
import type { Ctx } from '../context.ts';
import { seed } from '../seed.ts';
import { closeWeek, proposeWeek, setWeekItems, validateWeek } from '../services/planning.ts';
import { completeProject, createProject, promoteProject, setProjectMonth } from '../services/projects.ts';
import { createMetaObjective, createObjective, listDomains, listGroups } from '../services/referential.ts';
import { generateReport } from '../services/reports.ts';
import { completeTask, createTask } from '../services/tasks.ts';
import { addDays, currentWeek, parisDate, shiftWeek, weekMonday } from '../time.ts';

const { db, sqlite } = openDb();
runMigrations(db);
let clock = new Date();
const realNow = new Date();
const ctx: Ctx = { db, sqlite, actor: 'me', now: () => clock };
seed(ctx);
if (db.select().from(schema.project).all().length > 0) {
  console.error(
    'La base contient déjà des projets : démo non chargée. Supprime data/memento.db pour repartir de zéro.',
  );
  process.exit(1);
}

const at = (date: string, hour = 9) => {
  clock = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00+01:00`);
};
const g = (name: string) => listGroups(ctx).find((x) => x.name === name)!.id;
const today = parisDate(realNow);
const week = currentWeek(realNow);
const monday = weekMonday(week);
const month = today.slice(0, 7);
const prev = shiftWeek(week, -1);
const prev2 = shiftWeek(week, -2);

// --- Two weeks ago: start of the history ---
at(addDays(weekMonday(prev2), 0), 8);
const meta = createMetaObjective(ctx, {
  title: 'Me repositionner sur l’IA',
  horizonDate: `${Number(today.slice(0, 4)) + 1}-09-30`,
  description: '',
});
const qEnd = (() => {
  const m = Number(today.slice(5, 7));
  const endMonth = Math.ceil(m / 3) * 3;
  const d = new Date(Date.UTC(Number(today.slice(0, 4)), endMonth, 0));
  return d.toISOString().slice(0, 10);
})();
const oIA = createObjective(ctx, {
  title: '2 POC IA publiés',
  metaObjectiveId: meta.id,
  smartIndicator: 'POC publiés',
  smartTarget: '2',
  smartCurrent: '0',
  deadline: addDays(qEnd, -10),
  criticality: 3,
});
const oEnergy = createObjective(ctx, {
  title: 'Réduire la facture d’énergie',
  smartIndicator: 'Devis signé',
  smartTarget: '1',
  deadline: addDays(qEnd, -1),
  criticality: 2,
});
const oSport = createObjective(ctx, {
  title: 'Pratiquer 2 sports en régulier',
  smartIndicator: 'Sports pratiqués chaque semaine',
  smartTarget: '2',
  smartCurrent: '1',
  deadline: qEnd,
  criticality: 3,
});

function project(
  title: string,
  groups: string[],
  tasks: [string, 30 | 60 | 120, Partial<{ exp: boolean; free: boolean }>?][],
  opts: {
    objectiveId?: string;
    month?: boolean;
    start?: string;
    due?: string;
    success?: string;
    primary?: string;
  } = {},
) {
  const p = createProject(ctx, {
    title,
    groupIds: groups.map(g),
    primaryDomainId: opts.primary ? listDomains(ctx).find((d) => d.name === opts.primary)!.id : undefined,
    objectiveId: opts.objectiveId,
    successCriterion: opts.success ?? 'Résultat livré',
    startDate: opts.start ?? addDays(monday, -14),
    dueDate: opts.due ?? addDays(monday, 14),
  });
  const ts = tasks.map(([t, d, o]) =>
    createTask(ctx, { projectId: p.id, title: t, durationMin: d, isExperience: o?.exp, isFree: o?.free }),
  );
  promoteProject(ctx, p.id);
  if (opts.month) setProjectMonth(ctx, p.id, month);
  return { p, ts };
}

const pv = project(
  'Panneaux photovoltaïques',
  ['Travaux', 'Résilience'],
  [
    ['Lister 3 installateurs RGE', 60],
    ['Demander les devis', 30],
    ['Comparer les 3 devis photovoltaïques', 60],
    ['Choisir l’installateur', 60],
    ['Signer le devis', 30],
    ['Déposer la déclaration préalable en mairie', 60],
  ],
  {
    objectiveId: oEnergy.id,
    primary: 'Maison',
    month: true,
    start: `${month}-01`,
    due: addDays(`${month}-01`, 29),
    success: 'Devis signé et déclaration déposée',
  },
);
const ia = project(
  'Repositionnement IA',
  ['IA'],
  [
    ['Choisir le cas d’usage du POC RAG', 60],
    ['Rédiger la fiche du POC RAG', 60],
    ['Coder l’ingestion des documents', 120],
    ['Écrire le README du POC', 30],
    ['Préparer une démo de 5 minutes', 60],
    ['Publier un post sur le POC', 60],
  ],
  {
    objectiveId: oIA.id,
    month: true,
    start: `${month}-01`,
    due: addDays(`${month}-01`, 30),
    success: 'POC RAG publié avec démo',
  },
);
const sport = project(
  'Trouver un second sport',
  ['Sport'],
  [
    ['Lister 3 sports à tester', 30],
    ['Séance d’essai au club d’escalade', 60],
    ['Séance d’essai n°2 à l’escalade', 60],
    ['S’inscrire au club', 30],
  ],
  {
    objectiveId: oSport.id,
    month: true,
    start: `${month}-01`,
    due: addDays(`${month}-01`, 27),
    success: 'Inscrit dans un club',
  },
);
const fw = project(
  'Firewall maison',
  ['Sécu digitale', 'Labo Tech'],
  [
    ['Installer OPNsense sur le mini-PC', 120],
    ['Isoler les objets connectés sur un VLAN', 30],
    ['Activer les alertes de détection d’intrusion', 60],
  ],
);
const fam = project(
  'Sorties & activités famille',
  ['Sorties & activités famille'],
  [
    ['Sortie vélo en famille', 120, { exp: true, free: true }],
    ['Pique-nique et balade en forêt', 120, { exp: true, free: true }],
  ],
);
const backups = project(
  'Sauvegardes prouvées',
  ['Sécu digitale'],
  [
    ['Planifier le pg_dump vers le NAS', 60],
    ['Tester une restauration de bout en bout', 60],
  ],
);

// Ideas (DM-85): a title and a group.
for (const [t, gr] of [
  ['Clim bi-split salon', 'Travaux'],
  ['Reaper Bot', 'Crypto'],
  ['Menu Planning', 'Repas'],
  ['Sac de survie', 'Résilience'],
  ['AirPlay dans toute la maison', 'Audio & Musique'],
  ['Remote gaming depuis le salon', 'Gaming'],
] as const) {
  createProject(ctx, { title: t, groupIds: [g(gr)] });
}

// Inbox
const colis = createTask(ctx, {
  title: 'Déposer le colis au relais',
  durationMin: 30,
  dueDate: addDays(monday, 3),
});
const notaire = createTask(ctx, { title: 'Appeler le notaire', durationMin: 30 });
createTask(ctx, { title: 'Renouveler l’assurance auto', durationMin: 30, dueDate: addDays(monday, 10) });
createTask(ctx, {
  title: 'Déclaration d’impôts',
  durationMin: 120,
  dueDate: `${Number(today.slice(0, 4)) + 1}-05-20`,
  recurrenceRule: 'FREQ=YEARLY',
});

// --- Week -2: planned and executed ---
setWeekItems(ctx, prev2, [
  { taskId: pv.ts[0].id, kind: 'week' },
  { taskId: ia.ts[0].id, kind: 'week' },
  { taskId: sport.ts[0].id, kind: 'week' },
  { taskId: notaire.id, kind: 'week' },
  { taskId: backups.ts[0].id, kind: 'week' },
]);
validateWeek(ctx, prev2);
at(addDays(weekMonday(prev2), 1), 19);
completeTask(ctx, pv.ts[0].id);
at(addDays(weekMonday(prev2), 2), 20);
completeTask(ctx, ia.ts[0].id);
at(addDays(weekMonday(prev2), 4), 18);
completeTask(ctx, sport.ts[0].id);
completeTask(ctx, backups.ts[0].id);

// --- Week -1: engine proposal, then my choices ---
at(weekMonday(prev), 7);
closeWeek(ctx, prev2);
generateReport(ctx, 'week', prev2);
proposeWeek(ctx, prev);
setWeekItems(ctx, prev, [
  { taskId: notaire.id, kind: 'week' },
  { taskId: pv.ts[1].id, kind: 'week' },
  { taskId: ia.ts[1].id, kind: 'week' },
  { taskId: sport.ts[1].id, kind: 'week' },
  { taskId: backups.ts[1].id, kind: 'week' },
  { taskId: fw.ts[0].id, kind: 'bonus' },
]);
validateWeek(ctx, prev);
at(addDays(weekMonday(prev), 1), 19);
completeTask(ctx, pv.ts[1].id);
at(addDays(weekMonday(prev), 2), 20);
completeTask(ctx, ia.ts[1].id);
at(addDays(weekMonday(prev), 3), 18);
completeTask(ctx, backups.ts[1].id);
completeProject(ctx, backups.p.id, true);
at(addDays(weekMonday(prev), 5), 11);
completeTask(ctx, sport.ts[1].id);
completeTask(ctx, fw.ts[0].id);

// --- This week: Monday 07:00 engine, then validated plan, a few done ---
at(monday, 7);
closeWeek(ctx, prev); // RB-10: "Appeler le notaire" carried over again
generateReport(ctx, 'week', prev);
proposeWeek(ctx, week);
setWeekItems(ctx, week, [
  { taskId: colis.id, kind: 'week' },
  { taskId: notaire.id, kind: 'week' },
  { taskId: fam.ts[0].id, kind: 'week' },
  { taskId: pv.ts[2].id, kind: 'week' },
  { taskId: sport.ts[2].id, kind: 'week' },
  { taskId: ia.ts[2].id, kind: 'week' },
  { taskId: fw.ts[1].id, kind: 'week' },
  { taskId: fw.ts[2].id, kind: 'bonus' },
  { taskId: ia.ts[3].id, kind: 'bonus' },
]);
validateWeek(ctx, week);
if (today > monday) {
  at(addDays(monday, 1), 18);
  completeTask(ctx, colis.id);
  completeTask(ctx, sport.ts[2].id);
}

// An AI-created task to show "À revoir".
clock = realNow;
createTask(
  { ...ctx, actor: 'ai:claude' },
  { projectId: ia.p.id, title: 'Comparer 3 bases vectorielles', durationMin: 60 },
);

sqlite.close();
console.log(`Démo chargée : semaine ${week}, rapports ${prev2} et ${prev}.`);
