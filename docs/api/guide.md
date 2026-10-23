# Mémento — brancher une IA ou un robot

Ce guide est pour toi (humain) : comment donner accès à Mémento à une IA (Claude, un agent) ou à un robot (n8n,
script), et comment vérifier ce qu'ils font. L'IA, elle, lit un autre document : [`guide-ia.md`](guide-ia.md).

## Pourquoi deux guides ?

| | Guide humain (ce fichier) | Guide IA (`guide-ia.md`) |
| --- | --- | --- |
| Lecteur | toi, une fois, pour brancher | l'IA, à chaque session |
| Contenu | mise en route, sécurité, vérification | règles métier, cycle de vie, formats, codes d'erreur, recettes |
| Forme | pas à pas, exemples à copier | dense, exhaustif, sans pédagogie |
| Accès | dans le dépôt | dans le dépôt **et** servi par `GET /api/v1/guide` et l'outil MCP `get_guide` |

Une IA n'a pas besoin qu'on lui explique l'intérêt d'un jeton, mais elle doit connaître chaque règle pour ne pas
se faire refuser ses appels ; toi, c'est l'inverse.

## 1. Créer un jeton

Configuration › Accès › nom (`claude`, `n8n`…) + portée :

- **Lecture seule** : consulter (rapports, plans, projets). Idéal pour une IA d'analyse ou un tableau de bord.
- **Lecture-écriture** : créer des idées, découper des projets, proposer un plan de semaine…

Le secret `mem_…` n'est affiché **qu'une fois** (seule son empreinte est stockée). Un jeton par agent : chaque
action est signée `ai:<nom>` dans le Journal. Révoquer coupe l'accès immédiatement. Aucun jeton ne peut toucher aux
réglages, aux jetons, au compte, à l'export / import ni à « Vider les données ».

## 2. Brancher une IA par MCP (recommandé)

Serveur MCP : `http://<hôte>:4502/mcp` (Streamable HTTP), en-tête `Authorization: Bearer mem_…`.

Claude Code :

```bash
claude mcp add --transport http memento http://<hôte>:4502/mcp --header "Authorization: Bearer mem_…"
```

Au démarrage, le serveur demande à l'IA de lire le guide (`get_guide`) puis la vue d'ensemble (`get_context`).

## 3. Appeler l'API directement (robots, scripts)

```bash
TOKEN=mem_…
curl -s -H "Authorization: Bearer $TOKEN" http://<hôte>:4500/api/v1/auth/me
curl -s -H "Authorization: Bearer $TOKEN" http://<hôte>:4500/api/v1/week-plans/2026-W45
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"title":"Renouveler le passeport","durationMin":30,"dueDate":"2026-12-01"}' \
  http://<hôte>:4500/api/v1/tasks
```

Contrat complet (schémas, champs) : `http://<hôte>:4500/api/v1/openapi.json`.

## 4. Vérifier ce que fait l'IA

- **Journal** (barre latérale › Suivi) : toutes les créations et modifications, filtre « IA », bouton « revu ».
- Le badge à côté de « Journal » compte les changements de l'IA pas encore revus.
- Les rapports hebdomadaires, mensuels et trimestriels sont figés : une IA ne peut pas les réécrire.

## 5. Mémento comme fournisseur de données

Pour un écosystème (santé, sommeil, activité…), lis en lecture seule :

- `GET /reports/by-period/week/AAAA-Www` : la semaine figée (fait, focus, rythme, contexte du budget).
- `GET /weeks/AAAA-Www/execution` : la semaine en cours.
- `GET /experiences`, `GET /month-plans/AAAA-MM`, `GET /quarter-plans/AAAA-Qn`.
- `GET /changes?since=7d&actor=all` : le journal.

## 6. Sécurité

- Mémento n'est pas exposé sur Internet : réseau local ou VPN uniquement.
- Les jetons et mots de passe ne sont stockés que sous forme d'empreinte. Un jeton perdu se révoque, il ne se
  retrouve pas.
- Le MCP ne garde aucun secret : il relaie le jeton de l'agent appelant.
