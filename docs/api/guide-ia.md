# Mémento — guide de l'API pour une IA

Tu pilotes Mémento, l'outil personnel de l'utilisateur pour ses objectifs, projets et sa charge mentale. Ce guide dit **ce
que tu peux faire, dans quel ordre, et quelles règles l'API impose**. Le contrat technique exact (schémas JSON) est
dans `GET /api/v1/openapi.json` : entrées, erreurs (schéma `Error`) et, pour chaque opération, `x-token-access`
(`read`, `write`, `capture` ou `none` = interface seule). Toute la logique métier est dans l'API : si une règle n'est pas respectée, l'API
refuse avec un code lisible. Ne contourne jamais une règle, explique-la à l'utilisateur.

## 1. Accès

- Base : `http://<hôte>:4500/api/v1` (réseau local uniquement). MCP : `http://<hôte>:4502/mcp`, mêmes droits.
- Authentification : `Authorization: Bearer mem_…` (jeton créé par l'utilisateur dans Configuration › Accès).
- Tes actions sont signées `ai:<nom du jeton>` et apparaissent dans le **Journal** de l'utilisateur (`GET /changes`).
- Une seule liste fixe les routes ouvertes aux jetons ; toute autre route répond 403 `USER_ONLY` (réservée à
  l'interface).
- Jeton « lecture » : les lectures, plus `POST /plan/preview` et `POST /tasks/parse`, qui n'écrivent rien
  (sinon 403 `READ_ONLY_TOKEN`).
- Jeton « lecture-écriture » : création, modification, planification et suppression (journalisée avec son contenu).
- Fermé à tout jeton : réglages (même en lecture), jetons, compte, export / import, purge des données,
  « Proposer avec l'IA » (`/ai/*`), notifications (Telegram, push), écriture sur les domaines et les groupes,
  génération d'un rapport (`POST /reports/generate`), « Marquer comme revu » (`POST /changes/mark-reviewed`),
  « Tout marquer comme lu » dans les notifications et la migration des chemins (`POST /plan/migrate-dependencies`).
- Lisible par tout jeton : les modèles de description (`GET /templates`).

## 2. Conventions

| Sujet | Format |
| --- | --- |
| Dates | `AAAA-MM-JJ`, heure de Paris, un jour qui existe (sinon 422 `INVALID_DATE`) |
| Horodatages | ISO 8601 UTC en lecture (`doneAt`, `createdAt`…) ; en écriture, `doneAt` = `AAAA-MM-JJTHH:MM`, heure de Paris |
| Semaine | ISO `AAAA-Www` (lundi → dimanche), ex. `2026-W45` |
| Mois | `AAAA-MM` · Trimestre : `AAAA-Qn`, ex. `2026-Q4` |
| Durée d'une tâche | minutes : **5, 15, 30, 60 ou 120** (2 h max, RB-03) ; `null` = inconnue (idées) |
| Récurrence | RRULE iCalendar, **Inbox seulement** : `FREQ=WEEKLY`, `FREQ=MONTHLY`, `FREQ=MONTHLY;INTERVAL=3`, `FREQ=YEARLY`. Clés acceptées, une fois chacune : `FREQ` (DAILY, WEEKLY, MONTHLY, YEARLY), `INTERVAL` (1 à 999), `BYDAY`, `BYMONTH`, `BYMONTHDAY` |
| Descriptions | **Markdown** (titres, listes, cases `- [ ]`, tableaux, liens). Pas de HTML |
| Identifiants | UUID |

Erreurs : `{ "code": "…", "message": "…", "details": … }`.
400 `VALIDATION_ERROR` (forme de la requête) · 401 `UNAUTHENTICATED` · 403 `READ_ONLY_TOKEN` / `USER_ONLY` ·
404 `NOT_FOUND` · 409 conflit (`PLAN_APPLY_CONFLICT`, `ALREADY_EXISTS` : nom déjà pris) · **422 = règle métier** (le
`message` est en français et peut être montré tel quel) · 429. Un succès répond 200 avec du JSON ; un `GET` n'écrit
jamais. `GET /tasks` accepte `limit` (1 à 500) et `offset` pour lire par pages. `/api/v1` ne fait que s'enrichir
(routes, champs, paramètres facultatifs) : rien n'y est retiré ni ne change de sens.
Une création en plusieurs étapes se fait en **un appel** (tout ou rien, H-11) : `POST /tasks { …, isoWeek }` crée la
tâche et l'ajoute à la fin de la semaine ; `POST /projects { …, tasks, promote: true }` crée le projet, ses tâches et
le promeut ; `POST /projects/batch { projects: [...] }` crée plusieurs projets dans l'ordre (chemin d'un objectif).

## 3. Le modèle

```
Domaine de vie (8, ordonnés par priorité, avec une description)
  └ Groupe (rangement ; appartient à 1 domaine)
Méta-objectif (cap ~1 an et +, domaine principal `primaryDomainId`, `outcomeTitle` ≤ 80 car. = titre en résultat)
  └ Objectif trimestriel (deadline dans son trimestre, indicateur SMART, criticité 1-3, avancement stocké, `outcomeTitle`)
      └ Chemin = projets reliés par `dependsOn` (graphe sans cycle ; zone « Libres » = `isFree`)
Projet (1 à 3 groupes → ses domaines ; domaine principal = couleur)
  └ Tâches ordonnées (séquentiel : une tâche attend la précédente ; parallèle : toutes disponibles)
Inbox = tâches hors projet (deadlines, récurrences, domaine facultatif)
```

**Prérequis entre projets** : `dependsOn` (liste d'ids de projets) est la **seule source de vérité** ; plus d'ordre
implicite. Un projet créé dans un objectif suit par défaut le dernier projet de l'objectif, sauf `isFree: true` (projet
sans prérequis, rangé dans la zone « Libres »). `waitingOn` = prérequis non terminés, `blocked` = a des prérequis non
terminés : **informatifs uniquement**. Modifier : `PUT /projects/{id}/dependencies { dependsOn }` (remplace),
`POST …/dependencies { dependsOnId }`, `DELETE …/dependencies/{dependsOnId}`.

**Classer un projet dans le bon domaine** : lis d'abord `GET /domains` ; chaque domaine a une `description` qui dit
ce qui y entre et ce qui n'y entre pas. Choisis ensuite les groupes (`GET /groups`) de ce domaine.

### Cycle de vie d'un projet

| Statut | Sens | Comment y entrer |
| --- | --- | --- |
| `idea` | bac à sable | création (`POST /projects` : titre + ≥ 1 groupe) |
| `ready` | « prêt », le backlog considéré | `POST /projects/{id}/promote` (jamais bloquant) |
| `active` | **projet du mois** | `POST /projects/{id}/month` `{ "month": "AAAA-MM" }` (mois courant) |
| `paused` | en pause | `PATCH { status: "paused" }` ; reprise : `PATCH { status: "ready" }` |
| `done` | terminé, réussi | `POST /projects/{id}/complete` `{}` ; un projet qui n'atteindra pas son critère passe en `abandoned` (ses tâches faites restent faites, D-140) |
| `abandoned` | abandonné | `PATCH { status: "abandoned" }` ; retour : `PATCH { status: "idea" }` |

- Un projet est **complet** (RB-02) s'il a : un critère de succès oui / non, ≥ 1 groupe, ≥ 1 tâche, une durée sur
  chaque tâche. Les dates sont facultatives (si les deux sont posées, fin ≥ début). Le champ `gaps` d'un projet liste
  ce qui manque ; `GET /projects/{id}` donne aussi `readiness` (liste cochée).
- Seul un projet **complet** devient projet du mois (sinon 422 `MONTH_PROJECT_INCOMPLETE` + `details`).
- Un mois futur : le projet reste `ready` avec `monthFlag`, et devient `active` le 1er du mois.
- En fin de mois, un projet actif non terminé repasse `ready` (`previousMonthFlag` garde le mois).
- `importance` : `low` / `normal` / `high` (×0,5 / ×1 / ×1,5 sur la valeur du score). Normale par défaut.
- `recurrence` (projet) : `monthly` / `quarterly` / `yearly`. Une fois terminé, le projet est recréé avec ses
  tâches pour la période suivante (`nextOccurrenceId` dans la réponse de `/complete`). Objectif : `quarterly` /
  `yearly`, recréé quand il est clos (atteint, partiel, manqué). `previousId` = occurrence précédente.

### Tâches

- `GET /tasks?projectId=<id|inbox>` : `locked` = attend une tâche précédente ou un prérequis ; `inPlan` = dans le
  plan de la semaine en cours ; `plannedWeek` = première semaine, en cours ou à venir, dont le plan contient la tâche
  (`null` sinon, D-151).
- Dupliquer : `POST /tasks/{id}/duplicate` (D-174) : copie à faire sous l'originale, sans deadline, récurrence ni
  semaine.
- Cocher : `POST /tasks/{id}/complete` (une tâche Inbox récurrente crée sa prochaine occurrence) ; décocher :
  `/uncomplete`. Annuler sans supprimer : `PATCH { status: "cancelled" }`.
- Date de fin d'une tâche faite (D-152) : `PATCH /tasks/{id} { doneAt: "AAAA-MM-JJTHH:MM" }` (heure de Paris, jamais
  dans l'avenir). Comme si elle avait été cochée à ce moment : la trace « hors planification » suit la semaine ; les
  rapports déjà figés ne changent pas.
- Temps réellement passé : `actualMin` (minutes) sur une tâche faite, via `PATCH /tasks/{id}` ou
  `POST /tasks/{id}/complete { actualMin }`. Il remplace l'estimation dans le « fait » et les rapports
  (bloc `estimation` : ratio estimé / réel, dépassements).
- `isExperience: true` = une **expérience** (hors budget, objectif de vivre plus d'expériences). La cible
  (`experience.target`) se compte par **mois civil** ; une semaine compte pour le mois de son jeudi (D-154).
- Une tâche sans projet sans durée est permise (Inbox) ; dans un projet du mois, chaque tâche doit avoir une durée.

## 4. Planification (le cœur)

- **Semaine** : `GET /week-plans/{semaine}` renvoie la page prête à afficher : bacs Inbox / Projets du mois / À
  considérer aussi, budget, alertes, « pourquoi » de chaque tâche. Le moteur est déterministe.
  - `POST /week-plans/{semaine}/propose` : proposition du moteur (les choix de l'utilisateur sont conservés).
  - `PUT /week-plans/{semaine}/items` `{ items: [{ taskId, kind: "week"|"bonus" }] }` : la sélection complète.
    Refus : `TASK_LOCKED` (attend la précédente), `PROJECT_NOT_ACTIVE` (projet ni prêt ni du mois), `TASK_NOT_TODO`.
  - Le dépassement de budget n'est **jamais bloquant** : il est signalé (alerte `BUDGET_OVER`).
  - `PATCH /week-plans/{semaine}` `{ budgetMin, budgetReason }` : budget ponctuel + **contexte** (fatigue,
    maladie, congés…). Le contexte est journalisé et figé dans le rapport de la semaine.
- **Vue Plan → mois → semaine** (D-07) : on dessine le plan à long terme dans la Vue Plan (`GET /plan-graph`), puis on
  choisit les projets du mois, puis la semaine. **Les prérequis ne bloquent jamais** le mois ni la semaine : le
  moteur de semaine propose simplement les tâches des projets prérequis d'abord.
  - `GET /plan-graph?domainIds=a,b&from=2026-Q4&to=2027-Q4&includeReserve=true` : méta-objectifs, objectifs, projets,
    capacité par trimestre (tous domaines confondus, **expériences exclues**), alertes, `version`, réserve.
  - Alertes du plan : `QUARTER_OVER` (trimestre surchargé), `PATH_TOO_LONG` (chemin trop long pour le trimestre),
    `DEP_AFTER` (prérequis placé après son dépendant), `PROJECT_INCOMPLETE`, `DEP_RELEASED` (prérequis terminé
    récemment), `OBJECTIVE_EMPTY`.
  - `POST /plan/preview { ops }` (sans écriture, autorisé en lecture seule) puis `POST /plan/apply { ops,
    baseVersion? }` (atomique : 422 = rien n'est appliqué ; 409 `PLAN_APPLY_CONFLICT` si `baseVersion` est périmée).
    Ops : `setDependencies`, `attachProject`, `detachProject`, `setFree`, `setObjectiveQuarter`, `setObjectiveMeta`,
    `reorderObjectives`.
- **Mois** : `GET /month-plans/{mois}` : capacité (budgets des semaines au prorata), projets du mois, backlog
  classé, objectifs du trimestre couverts ou non, alertes (`MONTH_OVER`, `TOO_MANY_PROJECTS`, `OBJECTIVE_EMPTY`,
  `OFF_OBJECTIVE`, `CARRIED_OVER`). Choisir : `POST /projects/{id}/month`.
- **Trimestre** : `GET /quarter-plans/{trimestre}` : capacité, objectifs et reste à faire de leurs chemins,
  objectifs ouverts d'autres trimestres, méta-objectifs couverts. Déplacer : `POST /objectives/{id}/quarter`
  `{ quarter }` (la deadline est ramenée dans le trimestre si besoin).
- Exécution : `GET /weeks/{semaine}/execution` (ce que voit « Ma semaine » ; `drift` = tâches prévues faites et
  travail **hors planification**, D-99).
- **Hors planification** (D-99) : une tâche cochée alors qu'elle n'était prévue ni cette semaine ni la précédente est
  tracée `kind: 'unplanned'` dans la semaine. `POST /tasks/done { title, projectId, durationMin, actualMin? }` crée
  une tâche déjà faite (« Fait hors plan »). Les rapports (semaine, mois, trimestre) ont un bloc `drift`.
- **Cap** (D-100) : `GET /cap?month=AAAA-MM` : objectifs du trimestre par méta-objectif et projets du mois avec leur
  **pourquoi** (`motive`, quelques mots, mot-clé entre `**…**`). Champ `motive` sur méta-objectifs, objectifs et
  projets (≤ 120 caractères). Écris le pourquoi, pas le quoi.
- **Suites de tâches** (RB-06, D-101) : dans un projet séquentiel, une tâche `isFree` n'attend rien et **démarre une
  nouvelle suite** : les tâches non libres placées dessous la suivent, pas celles du dessus.
- Expériences : `GET /experiences` (cible du mois, souvenirs, prévues, et `reserve` : les **envies**) ;
  `POST /experiences { title, durationMin?, domainId?, description?, placeId? }` ajoute une **envie** (D-171 : une tâche Inbox
  marquée Expérience, sans date ; `placeId` = un lieu mémorisé (`POST /places`), écrit dans la description avec un
  lien de carte, D-174 ; le moteur en propose quand la cible du mois n'est pas tenue) ; `POST /experiences/lived { title, doneAt?, domainId?, projectId?, durationMin?, description? }` trace une
  expérience **déjà vécue** (D-153) : faite à `doneAt` (maintenant si absent), dans le projet donné (durée alors
  obligatoire) ou dans le domaine (Famille si absent, aucun si `null`).

## 5. Recettes

1. **Capturer une idée de projet** : `GET /domains` + `GET /groups` → `POST /projects { title, groupIds,
   description }`. Écris une vraie description en suivant le modèle de l'utilisateur (`GET /templates`, outil MCP
   `get_templates`) : sans elle, le projet reste sans description (aucun modèle n'est copié, D-119).
2. **Découper un projet** : nouveau projet, `POST /projects { …, tasks: [{ title, durationMin }], promote: true }`
   (outil MCP `create_project`) ; projet existant, `POST /tasks/batch { projectId, tasks }` puis
   `POST /projects/{id}/promote`. Ordre des tâches = ordre d'exécution. Vérifie `gaps` et complète
   (`PATCH /projects/{id}` `{ successCriterion }`).
3. **Préparer le lundi** : `GET /week-plans/{semaine}` → explique les alertes → propose une sélection par
   `PUT …/items`. L'utilisateur garde la main : il peut tout modifier.
4. **Revue du mois** : `GET /month-plans/{mois}` → signale surcharge, objectifs non couverts, projets reconduits
   → propose des projets du mois (complets uniquement).
5. **Contexte d'une semaine** : `GET /reports/by-period/week/{semaine}` (rapport figé : fait, focus, rythme,
   `budgetAdjustment.reason`, réussites, évitements). Utile pour corréler avec d'autres données.
6. **Rendre compte de tes actions** : tout ce que tu fais est dans `GET /changes?actor=ai`. L'utilisateur le revoit.

7. **Construire un plan** : `GET /plan-graph` (garde `version`) → monte la liste d'ops → `POST /plan/preview` : lis
   `alerts` et `capacity` → ajuste → `POST /plan/apply { ops, baseVersion }`. Résume à l'utilisateur ce que tu as changé.

## 6. Souvenirs, lieux, personnes

Un **souvenir** est la trace d'une expérience vécue (photos, lieu, personnes, phrase, avis). Une **envie** est une
expérience à vivre un jour : une tâche Expérience sans date (`add_experience_idea`, section 4, D-171). Accès : « lecture » = jeton lecture ou plus ; « écriture » = lecture-écriture.

| Route | Accès | Rôle |
| --- | --- | --- |
| `GET /souvenirs` | lecture | journal, du plus récent au plus ancien ; filtres `personId`, `domainId`, `placeId`, `category`, `from`, `to`, `rating` (`again`, `good`, `meh`), `withPhotos` (`true`/`false`) |
| `GET /souvenirs/{id}` | lecture | détail |
| `PATCH /souvenirs/{id}` | écriture | titre, `startDate`, `endDate`, `placeId`, `personIds`, `newPersons` (prénoms), `phrase`, `rating`, `domainId`, `projectId`, `description` |
| `GET /souvenirs/{id}/suggestions`, `GET /souvenirs/on-this-day` | lecture | expériences prévues à rattacher ; « il y a un an » |
| `POST /souvenirs/{id}/attach\|merge\|save\|cover`, `DELETE /souvenirs/{id}` | écriture | rattacher, fusionner, enregistrer un brouillon, photo à la une, supprimer (seulement si l'utilisateur le demande) |
| `POST /captures`, `POST /captures/test`, `POST /souvenirs/{id}/photos` | jeton « capture » ou écriture | capture (photos ; ou `url`, ou `lat`/`lng`/`name` : une envie) et envoi des photos |
| `GET /places/search?q=&near=lat,lng` | lecture | lieux par leur nom (OpenStreetMap) |
| `GET /places`, `GET /places/nearby`, `POST /places` | lecture / lecture / écriture | lieux mémorisés, proches d'un point, ajout |
| `GET /persons` | lecture | personnes (`id`, `name`, `group` : `family`, `friends`, `other`, `toConfirm`) ; écritures : interface seule |
| `GET /living?from&to` | lecture | bilan « Vivre » d'une période |

Photos, tuiles de carte, configuration des personnes, modification et oubli des lieux :
interface seule (`USER_ONLY`). **Tu ne peux pas téléverser de photo** par MCP : la capture se fait par l'application ou le
Raccourci de l'utilisateur.

Champs d'un souvenir : `id`, `title`, `description`, `startDate`, `endDate`, `days`, `place` (`id`, `name`, `category`,
`lat`, `lng`, `city`), `persons` (`id`, `name`, `group`), `phrase`, `rating`, `photoCount`, `photos`, `domainId`,
`projectId`.

Règles en bref :

- **Un souvenir par expérience vécue** (1–1 avec la tâche Expérience, D-157) : le cocher ou `log_experience` en crée un ;
  `title`, `description`, `domainId`, `projectId` et `startDate` (heure de « faite ») sont ceux de la tâche, que
  `PATCH /souvenirs/{id}` met à jour. Décocher la tâche cache le souvenir, le supprimer l'emporte avec ses photos.
- **Capture** (`POST /captures`) : des photos donnent un brouillon de souvenir déjà compté comme vécu, sans lieu
  choisi d'office (sauf à moins de 100 m du domicile : lieu « Maison », D-173), que l'utilisateur vérifie dans l'application (`editUrl`, `kind: 'souvenir'`) ; rejouer le même `clientCaptureId`
  (8 caractères ou plus) renvoie la première capture, sans doublon. Un lien ou un lieu donne une **envie**
  (`kind: 'idea'`, D-171) : titre lu sur la page, texte, lien, dates, prix et lieu dans la description. Un
  jeton « capture » n'appelle que les trois routes de capture ; partout ailleurs 403 `CAPTURE_ONLY`.
- **Lieux** : cherche par nom avec `search_places` (OpenStreetMap, autour de `near` ou de la maison), pas par
  coordonnées. Dans la région (~100 km du point) : les lieux mémorisés et les réponses qui contiennent les mots tapés d'abord, puis les approchantes ; plus loin, seulement celles qui contiennent les mots (D-171, D-172). Lieu absent d'OpenStreetMap : `POST /places` avec `provider: 'manual'`. Un lieu choisi est **mémorisé une fois** (une référence = un lieu) et réutilisé. Service indisponible :
  503 `PLACE_PROVIDER_UNAVAILABLE`, jamais bloquant (lieu déjà mémorisé ou tapé à la main).
- **Bilan `GET /living`** : `souvenirs`, `days`, `places`, `withPhotos`, `byPerson`, `categories`, `zones`, `medianKm`
  (distance médiane à la maison), `alike` (ce qui se ressemble), `novelties` (premières fois), `again` (« À refaire »),
  `offTrack` (types jamais faits, personnes peu vues), `alerts` (« Aucun souvenir avec Alice depuis 90 jours »).
- Exemples fictifs : « Chez Lucette » à Valbourg, avec Alice.

## 7. Ce que tu ne fais pas

- Suppression (`DELETE /tasks|projects|objectives|meta-objectives/{id}`, outils MCP `delete_*`) : définitive,
  **seulement si l'utilisateur le demande explicitement**. Sinon préfère `abandoned` pour un projet, `cancelled` pour une
  tâche.
- Pas de tâche de plus de 2 h : découpe.
- Ne déplace pas des objectifs entre trimestres ni ne choisis les projets du mois sans le dire.
- N'invente pas de domaine ni de groupe : utilise ceux qui existent ; propose d'en créer si besoin.

## 8. Codes d'erreur métier (422)

| Code | Signification |
| --- | --- |
| `GROUP_REQUIRED` | un projet a au moins un groupe |
| `TOO_MANY_DOMAINS` | 3 domaines au plus par projet (retire un groupe) |
| `PRIMARY_DOMAIN_INVALID` | le domaine principal doit venir des groupes du projet |
| `MONTH_PROJECT_INCOMPLETE` / `ACTIVE_PROJECT_INCOMPLETE` | projet du mois incomplet (`details` = manques) |
| `MONTH_IN_PAST` | mois déjà passé |
| `INVALID_STATUS_TRANSITION` | passage de statut interdit (le message dit lequel utiliser) |
| `USE_ABANDON` | `success: false` refusé : un projet terminé est réussi, sinon il est abandonné (D-140) |
| `INVALID_DURATION` | durée 5, 15, 30, 60 ou 120 min |
| `TASK_LOCKED` | la tâche attend la précédente ou un prérequis |
| `TASK_NOT_TODO` / `TASK_CANCELLED` | tâche déjà faite / annulée |
| `TASK_NOT_DONE` / `DONE_IN_FUTURE` | `doneAt` sur une tâche pas faite / dans l'avenir (D-152) |
| `PROJECT_NOT_ACTIVE` | tâche d'un projet ni prêt ni du mois |
| `DEPENDENCY_CYCLE` | la dépendance créerait une boucle |
| `DEPENDENCY_SELF` / `DEPENDENCY_NOT_FOUND` | un projet ne dépend pas de lui-même / prérequis introuvable |
| `PATH_NOT_LINEAR` | réordonnancement d'un chemin qui a des branches : utilise `setDependencies` |
| `NOT_IN_QUARTER` | l'objectif n'est pas dans le trimestre indiqué |
| `PLAN_APPLY_CONFLICT` (409) | le plan a changé depuis `baseVersion` : relis `GET /plan-graph` |
| `RECURRENCE_INBOX_ONLY` / `INVALID_RECURRENCE` | récurrence : Inbox seulement, RRULE valide |
| `DEADLINE_REQUIRED` / `DEADLINE_AFTER_QUARTER` | objectif : deadline obligatoire, dans son trimestre |
| `INVALID_CRITICALITY` | criticité 1, 2 ou 3 |
| `NOT_IN_OBJECTIVE` / `NOT_IN_PROJECT` / `REORDER_INCOMPLETE` | réordonnancement incohérent |
| `GROUP_IN_USE` / `GROUP_NAME_TAKEN` | groupe encore utilisé / nom déjà pris |
| `INVALID_WEEK` / `INVALID_MONTH` / `INVALID_QUARTER` / `INVALID_PERIOD` | clé de période invalide |
| `PERIOD_NOT_OVER` | rapport demandé pour une période pas encore terminée |
| `INVALID_DATE` | date impossible ou mal écrite (`AAAA-MM-JJ`) |
| `UNSUPPORTED_MEDIA` | photo dans un format non lu (HEIC refusé : envoyer du JPEG) |
| `PHOTO_TOO_LARGE` | photo de plus de 40 Mo |
| `URL_UNREADABLE` | lien partagé illisible : **avertissement non bloquant**, l'envie est créée avec un titre « (à confirmer) » |
| `PLACE_PROVIDER_UNAVAILABLE` (503) | recherche de lieux indisponible : lieu mémorisé ou tapé à la main |
| `CAPTURE_ONLY` (403) | un jeton « capture » n'appelle que les routes de capture |
| `NOT_PLANNED_EXPERIENCE` | seule une expérience encore à vivre se rattache à un souvenir |
| `SOUVENIR_EXISTS` | cette expérience a déjà un souvenir |
| `PLACE_IN_USE` | lieu encore utilisé par un souvenir |
| `PERSON_EXISTS` | une personne porte déjà ce nom |
| `USER_ONLY` (403) | route réservée à l'interface |
| `TASK_NOT_FOUND` / `GROUP_NOT_FOUND` | tâche ou groupe inconnu (dans une sélection, une liste de groupes) |
| `TASK_TOO_LONG` | tâche de plus de 2 h : la découper |
| `BAD_REQUEST` (400) / `RATE_LIMITED` (429) / `INTERNAL` (500) | requête illisible / trop de requêtes / erreur inattendue (à signaler) |

Les autres codes (`AI_*`, `BAD_CREDENTIALS`, `INVALID_SETTINGS`, `INVALID_EXPORT`, `NOTIFY_*`, `TOKEN_NAME_TAKEN`…)
viennent de routes réservées à l'interface.

## 9. Outils MCP

Chaque outil appelle l'API ci-dessus : mêmes règles, mêmes codes. Chaque paramètre est décrit ; les annotations
disent si l'outil lit (`readOnlyHint`) ou supprime / remplace l'existant (`destructiveHint` : demande d'abord à
l'utilisateur). Un jeton « lecture » ne voit que les outils de lecture.

- **Lecture** : `get_context` (vue d'ensemble), `get_guide` (ce document), `search`, `list_objectives`, `get_objective`,
  `list_projects`, `get_project`, `get_templates`, `get_experiences`, `list_meta_objectives`, `get_meta_objective`,
  `get_plan_graph`, `preview_plan_changes`, `list_tasks`, `list_inbox`, `get_task`, `get_calendar`, `parse_task`,
  `get_cap`, `get_week_plan`, `list_reports`, `get_report`, `get_daily_recap`, `list_vacations`, `list_changes`, `list_souvenirs`, `get_souvenir`,
  `search_places`, `list_persons`, `get_living_report`.
- **Écriture** : `create_objective`, `update_objective`, `create_idea`, `create_project` (projet, tâches et promotion
  en un appel), `update_project`, `duplicate_project`, `duplicate_objective`, `duplicate_task`, `promote_idea`, `add_experience_idea`,
  `log_experience`, `set_objective_quarter`, `set_project_month`, `complete_project`, `create_meta_objective`,
  `update_meta_objective`, `set_objective_meta`, `add_project_dependency`, `reorder_objectives`, `create_tasks`,
  `update_task`, `complete_task`, `reorder_tasks`, `log_done_task`, `add_inbox_task`, `propose_week_plan`,
  `add_vacation`, `add_resource`, `update_souvenir`.
- **Suppression ou remplacement** : `set_project_dependencies`, `remove_project_dependency`, `apply_plan_changes`,
  `set_week_plan_items`, `remove_vacation`, `delete_task`, `delete_project`, `delete_objective`, `delete_meta_objective`.
