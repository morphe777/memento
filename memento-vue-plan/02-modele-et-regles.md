# 02 — Modèle de données et règles métier

Ces règles vivent dans l'API, comme toutes les règles de Memento. L'interface et le MCP ne font que les appeler.

## 1. État constaté (lecture du MCP, 31/10/2026)

- Les projets et les tâches exposent un champ **`dependsOn`**, mais il est **vide partout**, y compris pour des projets `blocked: true` et des tâches `locked: true`.
- Le blocage est donc **calculé à partir de la position** (`positionInObjective`, `position`) : « le précédent non libre est-il terminé ? ».
- `isFree` sort un projet de la séquence.
- Les positions ont des trous (ex. 2, 3, 4, 6 dans « Fondation du repositionnement »).
- Aucun outil MCP ne lit un méta-objectif : on connaît son `metaObjectiveId`, pas son titre.

Conséquence : avec la seule position, on ne peut exprimer qu'**une ligne**. Les projets en parallèle, les rendez-vous et les dépendances entre objectifs sont impossibles. La Vue Plan en a besoin.

## 2. Dépendances entre projets

**DM-100 — `dependsOn` est la seule source de vérité** pour l'enchaînement des projets. Un projet dépend de 0 à N projets, dans le même objectif ou non, dans le même méta-objectif ou non.

**DM-101 — Créer à la suite crée la dépendance.** Un projet ajouté à un objectif (création, `POST /projects` avec `objectiveId`, ou rattachement) reçoit par défaut `dependsOn = [dernier projet non libre et non terminé de l'objectif]`. Les options `free: true` ou `dependsOn: [...]` explicites l'emportent. On garde ainsi le zéro effort de DM-51.

**DM-102 — L'ordre devient un affichage.** Les listes (V-02, V-03, recherche, page du mois) trient les projets d'un objectif par **tri topologique stable** : à égalité, ordre de `positionInObjective`. `positionInObjective` ne sert plus qu'à départager.

**DM-103 — Réordonner une liste linéaire réécrit la chaîne.** Si les projets non libres d'un objectif forment une seule chaîne A→B→C, un glisser-déposer dans la liste (F-10) réécrit les `dependsOn` pour suivre le nouvel ordre. S'il y a des branches, la liste n'accepte pas le réordonnancement et propose d'ouvrir la Vue Plan.

**DM-104 — « Libre » veut dire « aucune dépendance ».** `isFree` devient **dérivé** (lecture seule, conservé pour compatibilité) : vrai si le projet n'a aucune dépendance entrante ni sortante dans son objectif. Écrire `isFree: true` retire ses dépendances. Le champ peut ensuite disparaître (05-Q6).

**DM-105 — Pas de boucle.** Toute écriture qui créerait un cycle est refusée par `422 DEPENDENCY_CYCLE` (code déjà prévu dans le guide). Pas de dépendance d'un projet vers lui-même.

**DM-106 — Une dépendance est souple : elle ne bloque jamais.**
- Un projet peut devenir **projet du mois** même si ce dont il dépend n'est pas terminé. Exemple : le prérequis a encore 3 tâches, on prend les deux projets ce mois-ci.
- Ses tâches sont **sélectionnables** dans le plan de la semaine. Le refus `TASK_LOCKED` **ne s'applique plus pour cause de projet**. Il reste valable **à l'intérieur** d'un projet séquentiel (une tâche attend la tâche précédente du même projet).
- Ce que fait la dépendance :
  1. affichage « Attend « X » » sur la carte, la fiche et le plan de la semaine ;
  2. le moteur de semaine propose les tâches du prérequis **avant** celles du projet qui l'attend (« pourquoi » : « termine d'abord X ») ;
  3. alertes de plan (§5) ;
  4. capacité : la longueur du chemin.
- Le champ `blocked` de l'API devient `waitingOn: [ids non terminés]`. `blocked` reste lisible pour compatibilité, mais ne bloque plus rien.

**DM-107 — Cycle de vie de ce dont on dépend.**

| Le projet dont on dépend devient… | Effet sur la dépendance |
| --- | --- |
| `done` | satisfaite. Elle reste stockée, elle sert à l'historique et au graphe |
| `abandoned` | **retirée automatiquement**, journalisée, alerte `DEP_RELEASED` dans la prochaine revue |
| `paused` | conservée, affichée « Attend « X » (en pause) » |
| supprimé | retirée (cascade) |
| `idea` (retour d'un abandon) | rien de spécial |

**DM-108 — Projets et objectifs récurrents.**
- En fin de période, une occurrence **non terminée** est **close sans report**. Le statut est `done` avec `success: false`, ou un statut « manqué » si le modèle en a un (05-Q7). La période suivante repart de zéro. On ne veut pas six fois le même projet.
- La règle « en fin de mois, un projet actif non terminé repasse `ready` » **ne s'applique pas** aux projets récurrents.
- Même logique pour un objectif récurrent (ex. « Activités Famille » : 3 sur 5 à la fin du trimestre → clos « partiel », le suivant repart à 0 / 5).
- Une nouvelle occurrence **n'hérite d'aucune dépendance**, ni entrante ni sortante.

**DM-109 — Migration.** Une seule fois, pour chaque objectif : les projets non libres et non terminés, triés par `positionInObjective`, deviennent une chaîne (`dependsOn` = le précédent). Les projets libres ne reçoivent rien. Les tâches ne sont pas migrées. La migration est journalisée sous l'auteur `system:migration`.

## 3. Objectifs et méta-objectifs

**DM-110 — Changer de trimestre** : `POST /objectives/{id}/quarter` existe. La deadline est ramenée dans le trimestre. Les projets suivent leur objectif.

**DM-111 — Changer de méta-objectif** : un objectif peut changer de `metaObjectiveId` ou ne plus en avoir (`null`). C'est journalisé. Ses projets le suivent.

**DM-112 — Ordre des objectifs dans un trimestre** : `position` (existe déjà) sert à l'ordre vertical dans la colonne.

**DM-113 — `outcomeTitle`** : nouveau champ texte court, ≤ 80 caractères, facultatif, sur **méta-objectif** et **objectif**. Écrit par l'IA ou par moi. Journalisé.

**DM-114 — Domaine du méta-objectif** : le filtre de domaine en a besoin. Si le méta-objectif n'a pas encore de domaine principal, l'ajouter : `primaryDomainId`, obligatoire à la création, déduit à la migration du domaine majoritaire de ses projets. À vérifier dans le code (05-Q2).

## 4. Capacité

**CH-20 — Budget d'un trimestre** = somme des budgets de ses semaines ISO. Il compte le budget par défaut (6 h), les surcharges ponctuelles et les congés (`vacations`). Une semaine à cheval sur deux trimestres est répartie au prorata des jours, comme le fait déjà le plan du mois.

**CH-21 — Charge d'un trimestre** = somme des durées des tâches **non faites** de :
- les projets rattachés aux objectifs du trimestre ;
- les projets `ready` ou `active` dont le `monthFlag` tombe dans le trimestre, même hors objectif ;
- les tâches Inbox à échéance dans le trimestre.

Elle compte **tous les domaines, sans exception**. Les **expériences sont exclues** (`isExperience: true`), comme ailleurs dans Memento. Une durée réelle (`actualMin`) remplace l'estimation pour les tâches faites, mais ces tâches ne comptent de toute façon plus dans la charge restante.

**CH-22 — Chemin d'un objectif** = nombre de projets non terminés sur la plus longue chaîne de dépendances interne à l'objectif (1 projet = 1 mois, d'après DM-23). On le compare aux **mois restants** du trimestre, mois courant compris.

**CH-23 — Ni la capacité ni le chemin ne bloquent.** Ils produisent les alertes `QUARTER_OVER` et `PATH_TOO_LONG`, au niveau `error` : affichées en rouge, mais l'action reste permise. L'utilisateur crée souvent des objectifs presque vides puis les remplit : l'alerte apparaît au moment où ça ne tient plus.

## 5. Alertes de plan

| Code | Déclencheur |
| --- | --- |
| `QUARTER_OVER` | CH-21 > CH-20 pour un trimestre |
| `PATH_TOO_LONG` | CH-22 > mois restants du trimestre |
| `DEP_AFTER` | A dépend de B, et l'objectif de B est dans un trimestre postérieur à celui de A |
| `DEP_RELEASED` | dépendance retirée par DM-107 (abandon) |
| `PROJECT_INCOMPLETE` | des projets du trimestre ont des `gaps` (ils ne pourront pas devenir projets du mois) |
| `OBJECTIVE_EMPTY` | existe déjà |

Ces alertes s'ajoutent à `GET /quarter-plans/{trimestre}` et à la réponse du graphe (API-07). Elles sont calculées **aussi sur un brouillon** (API-09).
