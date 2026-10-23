# Mémento — guide de l'API pour une IA

Tu pilotes Mémento, l'outil personnel de Mehdi pour ses objectifs, projets et sa charge mentale. Ce guide dit **ce
que tu peux faire, dans quel ordre, et quelles règles l'API impose**. Le contrat technique exact (schémas JSON) est
dans `GET /api/v1/openapi.json`. Toute la logique métier est dans l'API : si une règle n'est pas respectée, l'API
refuse avec un code lisible. Ne contourne jamais une règle, explique-la à Mehdi.

## 1. Accès

- Base : `http://<hôte>:4500/api/v1` (réseau local uniquement). MCP : `http://<hôte>:4502/mcp`, mêmes droits.
- Authentification : `Authorization: Bearer mem_…` (jeton créé par Mehdi dans Configuration › Accès).
- Tes actions sont signées `ai:<nom du jeton>` et apparaissent dans le **Journal** de Mehdi (`GET /changes`).
- Jeton « lecture » : seulement des `GET` (sinon 403 `READ_ONLY_TOKEN`).
- Interdit à tout jeton (403 `USER_ONLY`) : réglages, jetons, compte, export / import.

## 2. Conventions

| Sujet | Format |
| --- | --- |
| Dates | `AAAA-MM-JJ`, heure de Paris |
| Horodatages | ISO 8601 UTC (`doneAt`, `createdAt`…) |
| Semaine | ISO `AAAA-Www` (lundi → dimanche), ex. `2026-W45` |
| Mois | `AAAA-MM` · Trimestre : `AAAA-Qn`, ex. `2026-Q4` |
| Durée d'une tâche | minutes : **30, 60 ou 120** (2 h max, RB-03) ; `null` = inconnue (idées) |
| Récurrence | RRULE iCalendar, **Inbox seulement** : `FREQ=WEEKLY`, `FREQ=MONTHLY`, `FREQ=MONTHLY;INTERVAL=3`, `FREQ=YEARLY` |
| Descriptions | **Markdown** (titres, listes, cases `- [ ]`, tableaux, liens). Pas de HTML |
| Identifiants | UUID |

Erreurs : `{ "code": "…", "message": "…", "details": … }`.
400 `VALIDATION_ERROR` (forme de la requête) · 401 `UNAUTHENTICATED` · 403 `READ_ONLY_TOKEN` / `USER_ONLY` ·
404 `NOT_FOUND` · **422 = règle métier** (le `message` est en français et peut être montré tel quel) · 429.

## 3. Le modèle

```
Domaine de vie (8, ordonnés par priorité, avec une description)
  └ Groupe (rangement ; appartient à 1 domaine)
Méta-objectif (cap ~1 an et +)
  └ Objectif trimestriel (deadline dans son trimestre, indicateur SMART, criticité 1-3, avancement stocké)
      └ Chemin = projets ordonnés (l'ordre crée le prérequis, sauf projet « libre »)
Projet (1 à 3 groupes → ses domaines ; domaine principal = couleur)
  └ Tâches ordonnées (séquentiel : une tâche attend la précédente ; parallèle : toutes disponibles)
Inbox = tâches hors projet (deadlines, récurrences, domaine facultatif)
```

**Classer un projet dans le bon domaine** : lis d'abord `GET /domains` ; chaque domaine a une `description` qui dit
ce qui y entre et ce qui n'y entre pas. Choisis ensuite les groupes (`GET /groups`) de ce domaine.

### Cycle de vie d'un projet

| Statut | Sens | Comment y entrer |
| --- | --- | --- |
| `idea` | bac à sable | création (`POST /projects` : titre + ≥ 1 groupe) |
| `ready` | « prêt », le backlog considéré | `POST /projects/{id}/promote` (jamais bloquant) |
| `active` | **projet du mois** | `POST /projects/{id}/month` `{ "month": "AAAA-MM" }` (mois courant) |
| `paused` | en pause | `PATCH { status: "paused" }` ; reprise : `PATCH { status: "ready" }` |
| `done` | terminé | `POST /projects/{id}/complete` `{ "success": true\|false }` (critère atteint ?) |
| `abandoned` | abandonné | `PATCH { status: "abandoned" }` ; retour : `PATCH { status: "idea" }` |

- Un projet est **complet** (RB-02) s'il a : un critère de succès oui / non, ≥ 1 groupe, ≥ 1 tâche, une durée sur
  chaque tâche. Les dates sont facultatives (si les deux sont posées, fin ≥ début). Le champ `gaps` d'un projet liste
  ce qui manque ; `GET /projects/{id}` donne aussi `readiness` (liste cochée).
- Seul un projet **complet** devient projet du mois (sinon 422 `MONTH_PROJECT_INCOMPLETE` + `details`).
- Un mois futur : le projet reste `ready` avec `monthFlag`, et devient `active` le 1er du mois.
- En fin de mois, un projet actif non terminé repasse `ready` (`previousMonthFlag` garde le mois).
- `importance` : `low` / `normal` / `high` (×0,5 / ×1 / ×1,5 sur la valeur du score). Normale par défaut.

### Tâches

- `GET /tasks?projectId=<id|inbox>` : `locked` = attend une tâche précédente ou un prérequis ; `inPlan` = dans le
  plan de la semaine en cours.
- Cocher : `POST /tasks/{id}/complete` (une tâche Inbox récurrente crée sa prochaine occurrence) ; décocher :
  `/uncomplete`. Annuler sans supprimer : `PATCH { status: "cancelled" }`.
- `isExperience: true` = une **expérience** (hors budget, objectif de vivre plus d'expériences).
- Une tâche sans projet sans durée est permise (Inbox) ; dans un projet du mois, chaque tâche doit avoir une durée.

## 4. Planification (le cœur)

- **Semaine** : `GET /week-plans/{semaine}` renvoie la page prête à afficher : bacs Inbox / Projets du mois / À
  considérer aussi, budget, alertes, « pourquoi » de chaque tâche. Le moteur est déterministe.
  - `POST /week-plans/{semaine}/propose` : proposition du moteur (les choix de Mehdi sont conservés).
  - `PUT /week-plans/{semaine}/items` `{ items: [{ taskId, kind: "week"|"bonus" }] }` : la sélection complète.
    Refus : `TASK_LOCKED` (attend la précédente), `PROJECT_NOT_ACTIVE` (projet ni prêt ni du mois), `TASK_NOT_TODO`.
  - Le dépassement de budget n'est **jamais bloquant** : il est signalé (alerte `BUDGET_OVER`).
  - `PATCH /week-plans/{semaine}` `{ budgetMin, budgetReason }` : budget ponctuel + **contexte** (fatigue,
    maladie, congés…). Le contexte est journalisé et figé dans le rapport de la semaine.
- **Mois** : `GET /month-plans/{mois}` : capacité (budgets des semaines au prorata), projets du mois, backlog
  classé, objectifs du trimestre couverts ou non, alertes (`MONTH_OVER`, `TOO_MANY_PROJECTS`, `OBJECTIVE_EMPTY`,
  `OFF_OBJECTIVE`, `CARRIED_OVER`). Choisir : `POST /projects/{id}/month`.
- **Trimestre** : `GET /quarter-plans/{trimestre}` : capacité, objectifs et reste à faire de leurs chemins,
  objectifs ouverts d'autres trimestres, méta-objectifs couverts. Déplacer : `POST /objectives/{id}/quarter`
  `{ quarter }` (la deadline est ramenée dans le trimestre si besoin).
- Exécution : `GET /weeks/{semaine}/execution` (ce que voit « Ma semaine »).
- Expériences : `GET /experiences` (cible, souvenirs, prévues, réserve) ; `POST /experiences` ajoute une envie.

## 5. Recettes

1. **Capturer une idée de projet** : `GET /domains` + `GET /groups` → `POST /projects { title, groupIds,
   description }`. Le modèle de description de Mehdi s'applique si tu n'en donnes pas.
2. **Découper un projet** : `POST /tasks/batch { projectId, tasks: [{ title, durationMin }] }` (ordre = ordre
   d'exécution), puis `POST /projects/{id}/promote`. Vérifie `gaps` et complète (`PATCH /projects/{id}`
   `{ successCriterion }`).
3. **Préparer le lundi** : `GET /week-plans/{semaine}` → explique les alertes → propose une sélection par
   `PUT …/items`. Mehdi garde la main : il peut tout modifier.
4. **Revue du mois** : `GET /month-plans/{mois}` → signale surcharge, objectifs non couverts, projets reconduits
   → propose des projets du mois (complets uniquement).
5. **Contexte d'une semaine** : `GET /reports/by-period/week/{semaine}` (rapport figé : fait, focus, rythme,
   `budgetAdjustment.reason`, réussites, évitements). Utile pour corréler avec d'autres données.
6. **Rendre compte de tes actions** : tout ce que tu fais est dans `GET /changes?actor=ai`. Mehdi le revoit.

## 6. Ce que tu ne fais pas

- Pas de suppression (aucun outil MCP ; via l'API, seulement si Mehdi le demande explicitement). Préfère
  `abandoned` pour un projet, `cancelled` pour une tâche.
- Pas de tâche de plus de 2 h : découpe.
- Ne déplace pas des objectifs entre trimestres ni ne choisis les projets du mois sans le dire.
- N'invente pas de domaine ni de groupe : utilise ceux qui existent ; propose d'en créer si besoin.

## 7. Codes d'erreur métier (422)

| Code | Signification |
| --- | --- |
| `GROUP_REQUIRED` | un projet a au moins un groupe |
| `TOO_MANY_DOMAINS` | 3 domaines au plus par projet (retire un groupe) |
| `PRIMARY_DOMAIN_INVALID` | le domaine principal doit venir des groupes du projet |
| `MONTH_PROJECT_INCOMPLETE` / `ACTIVE_PROJECT_INCOMPLETE` | projet du mois incomplet (`details` = manques) |
| `MONTH_IN_PAST` | mois déjà passé |
| `INVALID_STATUS_TRANSITION` | passage de statut interdit (le message dit lequel utiliser) |
| `SUCCESS_ANSWER_REQUIRED` | terminer exige `success: true\|false` |
| `INVALID_DURATION` | durée 30, 60 ou 120 min |
| `TASK_LOCKED` | la tâche attend la précédente ou un prérequis |
| `TASK_NOT_TODO` / `TASK_CANCELLED` | tâche déjà faite / annulée |
| `PROJECT_NOT_ACTIVE` | tâche d'un projet ni prêt ni du mois |
| `DEPENDENCY_CYCLE` | la dépendance créerait une boucle |
| `RECURRENCE_INBOX_ONLY` / `INVALID_RECURRENCE` | récurrence : Inbox seulement, RRULE valide |
| `DEADLINE_REQUIRED` / `DEADLINE_AFTER_QUARTER` | objectif : deadline obligatoire, dans son trimestre |
| `INVALID_CRITICALITY` | criticité 1, 2 ou 3 |
| `NOT_IN_OBJECTIVE` / `NOT_IN_PROJECT` / `REORDER_INCOMPLETE` | réordonnancement incohérent |
| `GROUP_IN_USE` / `GROUP_NAME_TAKEN` | groupe encore utilisé / nom déjà pris |
| `INVALID_WEEK` / `INVALID_MONTH` / `INVALID_QUARTER` / `INVALID_PERIOD` | clé de période invalide |

## 8. Outils MCP

`get_context` (vue d'ensemble), `get_guide` (ce document), `search`, `list_objectives`, `get_objective`,
`create_objective`, `update_objective`, `set_objective_quarter`, `list_projects`, `get_project`, `create_idea`,
`create_project`, `update_project`, `promote_idea`, `set_project_month`, `complete_project`, `create_tasks`,
`update_task`, `complete_task`, `reorder_tasks`, `add_inbox_task`, `get_week_plan`, `propose_week_plan`,
`set_week_plan_items`, `get_experiences`, `add_experience_idea`, `list_reports`, `get_report`, `list_changes`,
`add_resource`. Chaque outil appelle l'API ci-dessus : mêmes règles, mêmes codes.
