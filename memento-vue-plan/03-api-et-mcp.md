# 03 — Ce qui manque à l'API et au serveur MCP

Constaté depuis le serveur MCP (outils listés dans le guide `get_guide`), avec un jeton en lecture seule. Certains points existent peut-être déjà dans l'API REST sans être exposés au MCP : **vérifier dans le code avant de créer**. Règle G-07 / F-26 : tout ce qui est faisable dans l'interface doit l'être par l'API **et** par le MCP.

## Lecture

| ID | Besoin | API proposée | Outil MCP | Pourquoi |
| --- | --- | --- | --- | --- |
| API-01 | Lire les méta-objectifs | `GET /meta-objectives`, `GET /meta-objectives/{id}` (titre, `outcomeTitle`, `primaryDomainId`, horizon, description, objectifs) | `list_meta_objectives`, `get_meta_objective` | Aujourd'hui on n'obtient que `metaObjectiveId`, pas le titre |
| API-07 | Tout le graphe en un appel | `GET /plan-graph?domainIds=…&from=2026-Q4&to=2027-Q4` → méta-objectifs, objectifs (trimestre, position, `outcomeTitle`, SMART, avancement), projets allégés (statut, groupes, domaines, heures restantes, `gaps`, `dependsOn`, `waitingOn`), dépendances, capacité par trimestre (CH-20 à CH-22), alertes | `get_plan_graph` | Évite N appels `get_objective` ; une seule source pour la vue et pour l'IA |
| API-10 | Réserve | `GET /plan-graph/reserve?domainIds=…` → projets sans objectif (dont connexes), objectifs sans méta ou dans un autre méta | (inclus dans `get_plan_graph`, option `includeReserve`) | Onglets de la réserve |

## Écriture

| ID | Besoin | API proposée | Outil MCP |
| --- | --- | --- | --- |
| API-02 | Écrire les dépendances d'un projet | `PUT /projects/{id}/dependencies` `{ "dependsOn": [ids] }` (remplacement) + `POST` / `DELETE /projects/{id}/dependencies/{depId}` | `set_project_dependencies`, `add_project_dependency`, `remove_project_dependency` |
| API-03 | Rattacher, détacher, changer d'objectif un projet | `PATCH /projects/{id}` `{ objectiveId: id \| null }`, avec application de DM-101 | `update_project` (vérifier que `objectiveId` est accepté) |
| API-04 | Changer ou retirer le méta-objectif d'un objectif | `PATCH /objectives/{id}` `{ metaObjectiveId: id \| null }` | `update_objective` (vérifier) ou `set_objective_meta` |
| API-05 | Ordre des objectifs dans un trimestre | `PATCH /objectives/{id}` `{ position }` ou `POST /objectives/reorder` `{ quarter, ids }` | `reorder_objectives` |
| API-06 | `outcomeTitle` | `PATCH /objectives/{id}` et `PATCH /meta-objectives/{id}` `{ outcomeTitle }` | `update_objective`, `update_meta_objective` (nouveau) |
| API-08 | Appliquer un brouillon de plan **atomiquement** | `POST /plan/apply` `{ ops: [ { op: "setDependencies" \| "attachProject" \| "detachProject" \| "setObjectiveQuarter" \| "setObjectiveMeta" \| "reorderObjectives" \| "setFree", … } ] }` → tout ou rien ; journal : une entrée par op, regroupées par un `batchId` | `apply_plan_changes` |
| API-09 | Simuler un brouillon | `POST /plan/preview` (même corps qu'API-08) → capacité et alertes recalculées, sans écriture | `preview_plan_changes` |
| API-11 | Méta-objectifs : créer, modifier | `POST /meta-objectives`, `PATCH /meta-objectives/{id}` | `create_meta_objective`, `update_meta_objective` |

## Changements de comportement

| ID | Changement |
| --- | --- |
| API-12 | `dependsOn` est rempli et respecté (DM-100 à DM-105). `blocked` devient informatif ; on ajoute `waitingOn`. |
| API-13 | `PUT /week-plans/{semaine}/items` : `TASK_LOCKED` n'est plus renvoyé pour cause de **projet** en attente (DM-106), seulement pour l'ordre des tâches **dans** un projet séquentiel. |
| API-14 | `POST /projects/{id}/month` : jamais refusé pour cause de dépendance. Réponse enrichie d'un avertissement `waitingOn`. |
| API-15 | Moteur de semaine (`propose`) : à score proche, les tâches d'un prérequis passent avant celles du projet qui l'attend, avec le « pourquoi » correspondant. |
| API-16 | `GET /quarter-plans/{trimestre}` : capacité **tous domaines**, expériences exclues ; chemin par objectif ; nouvelles alertes `QUARTER_OVER`, `PATH_TOO_LONG`, `DEP_AFTER`, `PROJECT_INCOMPLETE`, `DEP_RELEASED`. |
| API-17 | Fin de période des récurrents (DM-108) : tâche planifiée qui clôt les occurrences non terminées et crée les suivantes, sans report ni héritage de dépendances. |
| API-18 | Abandon d'un projet → retrait des dépendances qui pointent vers lui + `DEP_RELEASED` (DM-107). |
| API-19 | Migration DM-109, idempotente, avec un mode « simulation » qui liste ce qui serait créé. |
| API-20 | Mettre à jour `get_guide` (§3 « Le modèle », §4 « Planification », §7 « Codes ») et `openapi.json`. |

## Codes d'erreur

- Réutiliser `DEPENDENCY_CYCLE`.
- Ajouter `DEPENDENCY_SELF` (un projet ne dépend pas de lui-même) et `DEPENDENCY_NOT_FOUND`.
- `PLAN_APPLY_CONFLICT` (409) : l'état a changé depuis le chargement du brouillon. La réponse renvoie l'état frais ; l'interface propose de recharger.
- Les messages sont en français et montrables tels quels, comme les autres 422.

## Jetons

- Jeton lecture : `get_plan_graph`, `preview_plan_changes` (aucune écriture) et `list/get_meta_objectives` sont permis.
- `apply_plan_changes` et les autres écritures demandent un jeton en écriture et sont signées `ai:<nom du jeton>`.
