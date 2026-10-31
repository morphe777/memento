# Mémento · Dossier de développement « Vue Plan » et dépendances

Dossier préparé le 31/10/2026 pour Claude Code sur MyDev. Il décrit :

1. une nouvelle **Vue Plan**, un graphe de nœuds pour planifier méta-objectifs, objectifs par trimestre et projets ;
2. le passage de Memento à des **dépendances explicites entre projets** (`dependsOn`) ;
3. les **ajouts à l'API et au serveur MCP** que cela demande.

## Contenu

| Fichier | Rôle |
| --- | --- |
| `01-spec-fonctionnelle.md` | Écran, éléments visuels, interactions, appareils (V-20 à V-31) |
| `02-modele-et-regles.md` | Règles métier : dépendances, récurrence, capacité, alertes (DM-100 à DM-114, CH-20 à CH-23) |
| `03-api-et-mcp.md` | Endpoints et outils MCP à ajouter ou modifier (API-01 à API-20) |
| `04-criteres-acceptation.md` | Liste vérifiable de ce qui doit marcher (CA-01 à CA-37) |
| `05-decisions-et-questions.md` | Décisions validées et questions ouvertes, avec une réponse par défaut |
| `maquettes/vue-plan.html` | Maquette interactive autonome : l'ouvrir dans un navigateur |
| `donnees/carriere-2026-10-31.json` | Extrait réel des données Carrière, pour les tests et la migration |

## Ordre de lecture

1. Ouvrir `maquettes/vue-plan.html`, essayer : tirer les ronds, glisser les cartes et les en-têtes d'objectif.
2. Lire `05`, puis `01`, `02`, `03`, et garder `04` comme liste de fin.

## Points d'attention pour le développement

- **La maquette est un prototype, pas du code à reprendre.** Réutiliser le design system, les composants (dont les alertes) et la stack existants de Memento. Les couleurs de domaine viennent de la configuration (`colorLight` / `colorDark`).
- **Les règles vivent dans l'API**, comme le reste de Memento. L'interface et le MCP ne font qu'appeler l'API.
- Les points d'`03` marqués « vérifier » existent peut-être déjà dans l'API REST sans être exposés au MCP : **lire le code avant de créer**.
- Ne rien supprimer en base : la migration DM-109 est idempotente et a un mode simulation.

## Découpage proposé (un lot = un commit ou une PR)

1. **Modèle et migration** : DM-100 à DM-109, codes d'erreur, tests CA-01 à CA-04.
2. **Dépendances souples** dans les plans du mois et de la semaine : DM-106, API-13 à API-15, CA-05 à CA-07.
3. **Cycle de vie** : abandon, pause, récurrents (DM-107, DM-108, API-17, API-18, CA-08 à CA-10).
4. **Méta-objectifs et `outcomeTitle`** : API-01, API-04 à API-06, API-11, DM-111 à DM-114.
5. **Capacité et alertes de trimestre** : CH-20 à CH-23, API-16, CA-14 et CA-15.
6. **Graphe en lecture** : API-07, API-10 ; affichage, rangement, survol, filtre (CA-11, CA-20, CA-31 à CA-33, CA-36, CA-37).
7. **Édition** : brouillon, gestes, réserve, application atomique (API-08, API-09, CA-12, CA-13, CA-21 à CA-30).
8. **Appareils** : iPad et iPhone (CA-34, CA-35).
9. **MCP et guide** : tous les outils d'`03`, mise à jour de `get_guide` et d'`openapi.json` (CA-16).

## Prompt suggéré pour Claude Code

> Lis le dossier `memento-vue-plan/` (README d'abord). Explore le dépôt Memento pour repérer le modèle des projets et des objectifs, le calcul actuel de `blocked` et `locked`, les plans du mois, de la semaine et du trimestre, le serveur MCP et le design system. Avant d'écrire du code, fais-moi un plan par lot (README §Découpage) qui liste ce qui existe déjà et ce qui manque, et signale tout écart avec la spec. Puis avance lot par lot, avec les tests des critères d'acceptation correspondants.
