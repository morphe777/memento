// Richer demo roadmap: meta-objectives → quarterly objectives → ordered project paths, to see the
// « Carte » of Objectifs. Adds to an existing database (run after db:demo); skips if already loaded.
// Usage: pnpm db:demo-map
import { openDb, runMigrations, schema } from '@memento/db';
import type { Ctx } from '../context.ts';
import { seed } from '../seed.ts';
import {
  completeProject,
  createProject,
  getObjectivePath,
  promoteProject,
  reorderProjects,
  updateProject,
} from '../services/projects.ts';
import {
  createMetaObjective,
  createObjective,
  listGroups,
  listMetaObjectives,
  listObjectives,
  updateObjective,
} from '../services/referential.ts';
import { completeTask, createTask } from '../services/tasks.ts';

const { db, sqlite } = openDb();
runMigrations(db);
let clock = new Date();
const ctx: Ctx = { db, sqlite, actor: 'me', now: () => clock };
seed(ctx);

const META_ENERGY = 'Autonomie énergétique de la maison';
if (listMetaObjectives(ctx).some((m) => m.title === META_ENERGY)) {
  console.error('Carte de démo déjà chargée.');
  process.exit(0);
}

const g = (name: string) => {
  const found = listGroups(ctx).find((x) => x.name === name);
  if (!found) throw new Error(`Groupe introuvable : ${name}`);
  return found.id;
};
const at = (date: string) => {
  clock = new Date(`${date}T09:00:00+01:00`);
};
const objectiveByTitle = (title: string) => listObjectives(ctx).find((o) => o.title === title);
const metaByTitle = (title: string) => listMetaObjectives(ctx).find((m) => m.title === title);

type T = [string, 30 | 60 | 120];
function idea(title: string, groups: string[], objectiveId: string, tasks: T[] = [], description = '') {
  const p = createProject(ctx, { title, groupIds: groups.map(g), objectiveId, description });
  for (const [t, d] of tasks) createTask(ctx, { projectId: p.id, title: t, durationMin: d });
  return p;
}
function done(
  title: string,
  groups: string[],
  objectiveId: string,
  dates: [string, string],
  criterion: string,
  tasks: T[],
  description = '',
) {
  at(dates[0]);
  const p = createProject(ctx, {
    title,
    groupIds: groups.map(g),
    objectiveId,
    description,
    successCriterion: criterion,
    startDate: dates[0],
    dueDate: dates[1],
  });
  const ids = tasks.map(([t, d]) => createTask(ctx, { projectId: p.id, title: t, durationMin: d }).id);
  promoteProject(ctx, p.id);
  for (const id of ids) completeTask(ctx, id);
  at(dates[1]);
  completeProject(ctx, p.id, true);
  clock = new Date();
  return p;
}

// ---------- Meta 1: Autonomie énergétique ----------
const energy = createMetaObjective(ctx, {
  title: META_ENERGY,
  horizonDate: '2027-12-31',
  description: `## Pourquoi
Ne plus subir les hausses du prix de l'électricité et tenir quelques jours en cas de coupure.

## À quoi ça ressemble quand c'est réussi
- Facture divisée par deux par rapport à 2025
- Production solaire pilotée par Home Assistant
- **3 jours** sans réseau sans perdre le congélateur`,
});

const o1 =
  objectiveByTitle('Réduire la facture d’énergie') ??
  createObjective(ctx, { title: 'Réduire la facture d’énergie', deadline: '2026-12-30', criticality: 2 });
updateObjective(ctx, o1.id, {
  metaObjectiveId: energy.id,
  title: 'Réduire la facture d’énergie de 30 %',
  smartIndicator: 'Baisse de la facture annuelle',
  smartTarget: '30 %',
  smartCurrent: '8 %',
  description: `Premier pas vers l'autonomie : **consommer moins** avant de produire plus.

## Résultat attendu
Facture annuelle estimée < 1 400 € (contre 2 000 € en 2025).

## Chemin
1. Savoir où part l'énergie (audit)
2. Produire (panneaux)
3. Isoler ce qui fuit le plus
4. Piloter le chauffage`,
});
const audit = done(
  'Audit énergétique de la maison',
  ['Travaux'],
  o1.id,
  ['2026-09-01', '2026-09-25'],
  'Rapport d’audit reçu',
  [
    ['Trouver un auditeur RGE', 30],
    ['Visite de l’auditeur', 120],
    ['Lire le rapport et lister les 3 priorités', 60],
  ],
  'Les combles et le chauffage arrivent en tête des pertes.',
);
const pv = db
  .select()
  .from(schema.project)
  .all()
  .find((p) => p.title === 'Panneaux photovoltaïques');
if (pv) updateProject(ctx, pv.id, { objectiveId: o1.id });
// The audit comes first on the path, then the panels.
reorderProjects(
  ctx,
  o1.id,
  getObjectivePath(ctx, o1.id)
    .map((p) => p.id)
    .sort((x, y) => Number(y === audit.id) - Number(x === audit.id)),
);
idea('Isoler les combles', ['Travaux'], o1.id, [
  ['Demander 3 devis d’isolation', 60],
  ['Vérifier les aides MaPrimeRénov’', 60],
  ['Vider le grenier', 120],
]);
idea('Programmer le chauffage pièce par pièce', ['Équipement', 'Labo Tech'], o1.id, [
  ['Choisir des têtes thermostatiques Zigbee', 60],
  ['Les intégrer dans Home Assistant', 120],
]);

const o2 = createObjective(ctx, {
  title: 'Stocker et piloter l’énergie produite',
  metaObjectiveId: energy.id,
  smartIndicator: 'Autoconsommation',
  smartTarget: '70 %',
  smartCurrent: '0 %',
  deadline: '2027-03-20',
  criticality: 2,
  description: 'Une fois les panneaux posés, garder l’énergie du midi pour le soir.',
});
idea('Choisir une batterie domestique', ['Équipement'], o2.id, [
  ['Comparer 3 batteries (capacité, prix, garantie)', 120],
  ['Dimensionner selon la courbe de conso', 60],
]);
idea('Installer la batterie', ['Travaux'], o2.id);
idea('Brancher Home Assistant sur l’onduleur', ['Labo Tech'], o2.id, [
  ['Trouver l’intégration de l’onduleur', 30],
  ['Tableau de bord production / conso', 120],
]);

const o3 = createObjective(ctx, {
  title: 'Tenir 3 jours sans réseau',
  metaObjectiveId: energy.id,
  smartIndicator: 'Jours d’autonomie testés',
  smartTarget: '3',
  smartCurrent: '0',
  deadline: '2027-06-20',
  criticality: 1,
});
idea('Kit d’urgence électrique', ['Résilience'], o3.id);
idea('Récupérer l’eau de pluie', ['Jardin', 'Résilience'], o3.id);
idea('Test de coupure d’un week-end', ['Résilience'], o3.id);

// ---------- Meta 2: IA (from db:demo) gets a second objective ----------
const ia =
  metaByTitle('Me repositionner sur l’IA') ??
  createMetaObjective(ctx, { title: 'Me repositionner sur l’IA', horizonDate: '2027-09-30' });
const poc = objectiveByTitle('2 POC IA publiés');
if (poc) {
  idea('POC 2 : agent de tri des mails', ['IA', 'Labo Tech'], poc.id, [
    ['Choisir le cas d’usage précis', 60],
    ['Prototype avec l’API Claude', 120],
    ['Article de présentation', 120],
  ]);
}
const mission = createObjective(ctx, {
  title: 'Décrocher une mission IA',
  metaObjectiveId: ia.id,
  smartIndicator: 'Mission signée',
  smartTarget: '1',
  smartCurrent: '0',
  deadline: '2027-03-31',
  criticality: 3,
  description: 'Transformer les POC en arguments commerciaux.',
});
idea('Mettre à jour CV et LinkedIn', ['Mission'], mission.id, [
  ['Réécrire le titre et le résumé', 60],
  ['Ajouter les 2 POC', 30],
]);
idea('Contacter 10 ESN et clients', ['Mission', 'MYARCHI'], mission.id);
idea('Préparer 3 démos clients', ['IA'], mission.id);

// ---------- Meta 3: Santé durable ----------
const health = createMetaObjective(ctx, {
  title: 'Santé durable',
  horizonDate: '2027-06-30',
  description: 'Bouger, bien dormir, manger correctement : la base de tout le reste.',
});
const sport = objectiveByTitle('Pratiquer 2 sports en régulier');
if (sport) updateObjective(ctx, sport.id, { metaObjectiveId: health.id });
const sleep = createObjective(ctx, {
  title: 'Dormir 7 h par nuit',
  metaObjectiveId: health.id,
  smartIndicator: 'Moyenne de sommeil (montre)',
  smartTarget: '7 h',
  smartCurrent: '6 h 10',
  deadline: '2027-03-31',
  criticality: 2,
});
idea('Routine du soir sans écran', ['Outils perso'], sleep.id);
idea('Chambre noire et fraîche', ['Équipement'], sleep.id, [['Installer des rideaux occultants', 60]]);

console.log('Carte de démo chargée : 3 méta-objectifs, objectifs sur 3 trimestres, chemins de projets.');
sqlite.close();
