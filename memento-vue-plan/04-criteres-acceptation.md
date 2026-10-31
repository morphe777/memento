# 04 — Critères d'acceptation

Chaque ligne est vérifiable, par un test automatisé ou par une démonstration. Les données de `donnees/carriere-2026-10-31.json` servent de cas réel.

## Modèle et API

- [ ] **CA-01** Après migration (DM-109), « Fondation du repositionnement » a les chaînes Plan, Profil & ADR → Refonte du CV → ADR Novembre ; Formation LangGraph (libre) n'a aucune dépendance.
- [ ] **CA-02** La migration relancée ne crée rien (idempotente). Le mode simulation liste les dépendances sans les écrire.
- [ ] **CA-03** Créer un projet dans un objectif crée `dependsOn = [dernier projet non libre et non terminé]` ; avec `free: true`, aucune dépendance.
- [ ] **CA-04** A → B puis B → A : `422 DEPENDENCY_CYCLE` ; A → A : `422 DEPENDENCY_SELF`.
- [ ] **CA-05** Un projet dont le prérequis a des tâches restantes peut devenir projet du mois. La réponse contient `waitingOn`.
- [ ] **CA-06** Les tâches de ce projet s'ajoutent au plan de la semaine sans `TASK_LOCKED`. La 2e tâche d'un projet séquentiel reste refusée tant que la 1re n'est pas faite.
- [ ] **CA-07** Le moteur de semaine propose les tâches du prérequis avant celles du projet qui l'attend, avec le « pourquoi ».
- [ ] **CA-08** Abandonner X retire les dépendances vers X, les écrit au journal et crée `DEP_RELEASED`. Mettre X en pause les conserve.
- [ ] **CA-09** Un projet récurrent mensuel non terminé au 1er du mois est clos sans report. La nouvelle occurrence existe, sans aucune dépendance.
- [ ] **CA-10** Un objectif récurrent trimestriel à 3 / 5 en fin de trimestre est clos « partiel ». Le suivant démarre à 0 / 5.
- [ ] **CA-11** `GET /plan-graph` renvoie en un appel tout ce qu'il faut pour dessiner le graphe Carrière T4 2026 → T4 2027, y compris les titres des méta-objectifs.
- [ ] **CA-12** `POST /plan/apply` avec une op invalide n'applique **rien** et renvoie le message 422 en français.
- [ ] **CA-13** `POST /plan/preview` renvoie capacité et alertes recalculées, sans aucune écriture (journal inchangé).
- [ ] **CA-14** La capacité d'un trimestre compte tous les domaines même si la requête filtre un seul domaine, et exclut les tâches `isExperience`.
- [ ] **CA-15** `QUARTER_OVER`, `PATH_TOO_LONG` et `DEP_AFTER` apparaissent dans les cas décrits dans 02 §5 et ne bloquent aucune écriture.
- [ ] **CA-16** Chaque nouvel outil MCP d'`03-api-et-mcp.md` existe. Un jeton en lecture est refusé sur les écritures (`READ_ONLY_TOKEN`). Le guide est à jour.

## Vue Plan

- [ ] **CA-20** Le méta Carrière, ses 2 objectifs et leurs projets s'affichent sans **aucun chevauchement** de cadres ni de cartes, à tous les niveaux de zoom.
- [ ] **CA-21** Tirer du rond du méta vers un projet le rend point de départ. Deux points de départ s'affichent en parallèle.
- [ ] **CA-22** Tirer du rond de A vers B crée la flèche. B passe dans la colonne à droite de A, et le badge « Attend » apparaît.
- [ ] **CA-23** Deux projets dépendant de A s'empilent dans la même colonne. Un projet dépendant des deux se place après la plus longue branche.
- [ ] **CA-24** Une flèche qui ferait une boucle est montrée en rouge pendant le glisser et refusée au lâcher.
- [ ] **CA-25** Cliquer une flèche la supprime ; le brouillon le liste.
- [ ] **CA-26** Lâcher une carte à droite ou à gauche d'un projet la place après ou avant ; lâcher en zone Libres retire ses flèches.
- [ ] **CA-27** Glisser l'en-tête « 2 Projets Vitrine & ADR » de T1 vers T2 2027 change son trimestre dans le brouillon. La deadline affichée devient le 30/06/2027.
- [ ] **CA-28** Glisser un objectif de l'onglet Objectifs de la réserve vers une colonne le rattache au méta-objectif ; venu d'un autre méta-objectif, le brouillon le signale.
- [ ] **CA-29** Capacité et alertes se mettent à jour pendant l'édition du brouillon, avant « Appliquer ».
- [ ] **CA-30** « Appliquer » écrit tout en une requête, le journal montre les changements, et « Annuler tout » revient à l'état du serveur.
- [ ] **CA-31** Le survol d'un projet met en surbrillance sa chaîne amont et aval et atténue le reste.
- [ ] **CA-32** L'interrupteur « Titres IA » bascule entre `outcomeTitle` et le titre d'origine. Sans `outcomeTitle`, le titre d'origine s'affiche dans les deux cas.
- [ ] **CA-33** Le filtre de domaine change ce qui est affiché, pas la capacité.
- [ ] **CA-34** Sur iPad (`pointer: coarse`), les ronds mesurent au moins 44 pt et le glisser au doigt marche partout. Sur PC, les ronds restent petits.
- [ ] **CA-35** Sur iPhone, la vue est en lecture seule (ni réserve ni glisser).
- [ ] **CA-36** Thèmes clair et sombre lisibles (NF-06), couleurs de domaine dosées (G-08), design des alertes identique à l'existant.
- [ ] **CA-37** Chaque projet, objectif et méta-objectif affiché est un lien vers sa fiche (G-12) : un double-clic ou le lien du panneau de détail l'ouvre.
