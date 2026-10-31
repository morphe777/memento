# 05 — Décisions prises et questions ouvertes

## Décisions (atelier du 31/10/2026)

| ID | Décision |
| --- | --- |
| D-01 | La vue de planification est un **graphe de nœuds** (façon n8n) rangé par trimestre. Couloirs et grilles de carrés écartés : peu lisibles, projets trop petits, pas de parallélisme. |
| D-02 | Les **projets** sont les éléments visuels principaux ; les objectifs sont des cadres ; le méta-objectif est le nœud de départ. |
| D-03 | Le **filtre de domaine** n'affiche par défaut qu'un domaine ; la vue de tous les domaines sert à l'organisation globale. |
| D-04 | Memento passe à **`dependsOn`** comme source de vérité pour l'enchaînement des projets. L'ordre devient un affichage. |
| D-05 | Les dépendances se créent **en tirant des flèches** dans la vue. Les retirer, ou poser le projet en zone Libres, le rend libre. Le risque de « trop câbler » est accepté : un trimestre ne contient que quelques projets d'un mois. |
| D-06 | Une dépendance **ne bloque jamais**, ni au mois ni à la semaine : elle informe, ordonne les propositions du moteur et nourrit les alertes. |
| D-07 | Flux : **Vue Plan** (trimestre) → **projets du mois** (plusieurs) → **tâches de la semaine**. |
| D-08 | La capacité compte **tous les domaines sans exception**, sauf les expériences. Les alertes reprennent le design existant. |
| D-09 | Récurrents : une occurrence non terminée est close **sans report**, et la suivante repart à zéro. |
| D-10 | Abandon : la dépendance est retirée. Pause : elle est conservée. |
| D-11 | Les manques de l'API et du MCP font partie du lot (03). |
| D-12 | iPad : ronds plus gros, détectés par `pointer: coarse` ; sur PC, ils restent petits. iPhone : lecture seule. |
| D-13 | Les titres « résultat visé » (`outcomeTitle`) sont rédigés par l'IA et modifiables, sur les méta-objectifs et les objectifs. |
| D-14 | L'édition passe par un **brouillon** appliqué atomiquement, avec simulation de la capacité et des alertes. |

## Questions ouvertes, avec la proposition par défaut si personne ne tranche

| ID | Question | Proposition par défaut |
| --- | --- | --- |
| Q-01 | Les projets `done` restent-ils affichés sur le graphe ? | Oui, atténués, pendant le trimestre en cours. Ensuite, masqués derrière « Afficher les terminés ». |
| Q-02 | Le méta-objectif a-t-il déjà un domaine principal dans le modèle ? | Vérifier dans le code. Sinon, ajouter `primaryDomainId` (DM-114). |
| Q-03 | Tirer du méta vers un projet de la réserve : dans quel objectif ? | Le premier objectif du méta, par trimestre puis par position. Le brouillon le dit. |
| Q-04 | Combien de trimestres afficher ? | Le courant + 4. Défilement pour les suivants. |
| Q-05 | Faut-il persister les brouillons hors cadre ? | Non en v1 : ils disparaissent au rechargement, avec un avertissement si le brouillon n'est pas appliqué. |
| Q-06 | Supprimer `isFree` de l'API ? | Le garder en lecture seule (dérivé) pendant une version, puis le retirer. |
| Q-07 | Statut d'une occurrence récurrente non terminée ? | `done` + `success: false`, sauf si un statut « manqué » existe déjà. |
| Q-08 | `outcomeTitle` aussi pour les projets ? | Non (titre déjà concret). À revoir après usage. |
| Q-09 | Seuil de `PATH_TOO_LONG` : mois restants ou 3 mois fixes ? | Mois restants du trimestre, mois courant compris. |
