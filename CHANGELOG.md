# Changelog

Format : une entrée par version publiée (tag `vX.Y.Z`, image `morphe777/memento:X.Y.Z`). Les décisions détaillées
sont dans [`docs/DECISIONS.md`](docs/DECISIONS.md).

## 1.0.0 — 2026-11

Première version publiée. Correctifs issus de l'audit de sortie v1.0.

### Sécurité et accès

- Authentification décidée sur la route reconnue par le serveur, quelle que soit l'écriture de l'URL.
- Une seule liste des routes ouvertes aux jetons (`apps/api/src/access.ts`) ; le reste est réservé à l'interface.
  Fermés aux jetons : réglages, « Marquer comme revu », génération de rapport, écriture sur domaines et groupes (D-123).
- Paramètres du serveur MCP validés par les schémas du domaine, puis encodés.
- Suppression d'un projet : le journal garde le contenu des tâches supprimées.
- Limite de connexion par adresse réelle ; proxy à déclarer dans `MEMENTO_TRUST_PROXY`.
- En-têtes CSP, Permissions-Policy (et HSTS derrière HTTPS) ; les images des descriptions s'affichent en lien.

### Données et robustesse

- Règles de récurrence limitées à des clés et valeurs connues ; recherche d'occurrence bornée.
- Dates : seulement des jours qui existent (422 `INVALID_DATE`).
- `pnpm db:check` : contrôle en lecture seule des dates et récurrences déjà enregistrées.
- Transactions SQLite prises en écriture dès le début (plus d'échec sous verrou court).
- Jobs planifiés : tout ou rien, relancés jusqu'à réussir, échec signalé une fois dans les notifications.
- Rapports : période valide et terminée exigée (à partir de l'heure du job).
- `pnpm db:backup` / `pnpm db:verify` et procédure de restauration testée.

### Planification

- Fin de semaine : seules les tâches encore planifiables sont reportées.
- Un prérequis d'un autre projet, une fois fait, ne verrouille plus la tâche.
- Une nouvelle proposition de semaine garde les tâches déjà faites.

### Livraison

- Licence MIT, version unique dans tous les paquets, CI (lint, typage, tests à plusieurs dates et en ordre aléatoire,
  audit des dépendances, scan de l'image), image construite depuis un tag, version épinglée dans le compose.
- Dépôt public sans données personnelles ; une installation neuve démarre vide (seed générique).

## 0.x — 10/2026 à 11/2026

Versions de développement, non publiées comme telles : voir l'historique Git et `docs/DECISIONS.md` (D-01 à D-121).
