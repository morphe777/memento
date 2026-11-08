# Mémento — objectifs, projets, charge mentale

**Mémento** est le nom de l'application (interface, titres, PWA). Identifiant technique : `memento` (dépôt, packages, images Docker, base de données, hôte `memento.example.lan`).

Outil personnel, mono-utilisateur, auto-hébergé (homelab). Il organise ma vie en Domaines › Objectifs › Projets › Tâches, me propose chaque lundi un plan de semaine plafonné en heures, et produit des rapports figés. Il est piloté par IA (API + MCP) mais doit rester 100 % utilisable à la main.

## Lire dans cet ordre

1. `docs/02-dossier-dev.md` — **le document de travail** : architecture, stack, modèle de données, règles métier (RB-xx), moteur, rapports, API, MCP, pages, design system, plan par lots.
2. `docs/01-specs-fonctionnelles.md` — le pourquoi et le détail fonctionnel (IDs VIS, G, DM, CH, WF, R, V, F, NF). La section **9.0 « Décisions prises »** prime sur tout le reste.
3. `maquettes/README.md` puis les 4 fichiers `.dc.html` — référence visuelle et comportementale des écrans clés, figée à la v0.1.
4. `memento-vue-plan/` — dossier de conception de la Vue Plan (identifiants V-20 à V-31, DM-100 à DM-114, CH-20 à CH-23, API-xx, CA-xx), figé au 31/10/2026 : les changements ultérieurs sont dans `docs/DECISIONS.md`.

Priorité en cas de conflit : décisions datées (Specs §9.0) > dossier de dev > maquettes > reste des Specs.

## Règles de travail

- Développer **lot par lot** (dossier de dev §13). À la fin de chaque lot : tests verts, courte démo, puis **s'arrêter et attendre ma validation** avant le lot suivant.
- L'API est la seule porte d'entrée de la logique métier ; le front, le MCP et le worker passent par elle (F-26).
- Toute règle métier vit dans `packages/domain`, avec ses tests unitaires et son ID en commentaire.
- Interface en français ; code, noms de tables, endpoints et messages de commit en anglais.
- Si une règle manque ou est ambiguë : prendre l'option la plus simple, l'écrire dans `docs/DECISIONS.md` (date, contexte, choix) et me la signaler en fin de lot. Ne jamais inventer silencieusement une règle métier.
- Ne pas exposer de service sur Internet ; aucun secret dans le dépôt.
- Les décisions encore ouvertes sont listées en dossier de dev §14 : les valeurs proposées s'appliquent tant que je n'ai pas tranché.

## Depuis la v1.0 (publiée le 08/11/2026)

Le dépôt GitHub est **public**. Chaque changement passe ces règles.

**Données personnelles et confidentialité**
- Aucune donnée réelle dans Git : exemples, tests, fixtures, docs et seed sont fictifs. Mes données restent dans
  `data/` (ignoré).
- Ne jamais committer `docs/audit/` ni `data/private/` (failles décrites, chaînes personnelles, scripts privés).
- Le hook `.githooks/pre-push` refuse un push contenant une chaîne personnelle (`git config core.hooksPath .githooks`
  dans chaque clone). Ne jamais le contourner (`--no-verify`).

**Code**
- Une règle métier = `packages/domain` + test + ID en commentaire + ligne dans `docs/DECISIONS.md` si elle est
  nouvelle. Règles simples, sans cas particuliers.
- Nouvelle route API : la classer dans `apps/api/src/access.ts` (`read`, `write`, ou absente = interface seule). Le
  test matriciel (`apps/api/test/access-matrix.test.ts`) couvre toutes les routes et doit rester vert.
- Dates : valider les jours réels (D-126) ; heure de Paris, jamais UTC, pour jours, semaines et mois.
- Jobs planifiés : passer par `once()` de `services/jobs.ts` (tout ou rien, relance, échec signalé, C-07). Pas de
  `catch` vide.
- Une route ou un outil MCP qui change : mettre à jour `docs/api/guide-ia.md` (lu par l'IA à l'exécution).

**Tests**
- Écrire d'abord le test qui échoue, puis la correction.
- Avant chaque commit : `pnpm check` (lint, typage, tests) et `pnpm test:dates` (autres jours, ordre aléatoire).
  Tests à horloge fixe (`makeCtx(date)`), jamais dépendants du jour réel.
- Essais manuels : instance isolée (copie de base dans le scratchpad, ports 4520 et plus, faux LLM). Ne jamais
  modifier `data/memento.db`. Redémarrer l'instance de dev avant de me demander de vérifier.

**Version et livraison**
- Commits locaux en anglais, fichiers ajoutés un par un, messages factuels.
- Me demander avant tout push, tag, image Docker, ou action sur la production.
- Version : la même dans tous les `package.json` et `docker-compose.yml`, une entrée dans `CHANGELOG.md`, puis CI
  verte, tag `vX.Y.Z`, `./install/build-and-push.sh` (refuse sans le tag).
- Migration de base : `pnpm db:backup` avant ; après, `pnpm db:check` doit être propre.
- `install/docker-compose.yml` n'est qu'un exemple public : la production utilise son propre compose.
