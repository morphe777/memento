# 01 — Vue Plan : spécification fonctionnelle

Version 1.0 · 31/10/2026 · statut : validé en atelier, prêt pour développement.

Cette spec complète les specs Mémento existantes (doc « Specs — Outil de pilotage », IDs VIS, G, DM, CH, WF, V, F, NF). Elle réalise **V-01 Vue d'ensemble**, **V-02 Page objectif = chemin**, **V-11** et **V-12**. Les nouveaux IDs commencent à **V-20**.

## 1. Pourquoi

Avec plusieurs méta-objectifs, objectifs et projets, les listes ne permettent plus de voir le plan d'un coup d'œil. Les essais en couloirs et en grille de carrés ont été écartés : ils cachaient les projets, alors que ce sont eux qui portent le travail (un mois chacun), et ils ne savaient pas montrer les projets en parallèle.

Retenu : un **graphe de nœuds façon n8n**, rangé par trimestre, où l'on construit son plan à la souris ou au doigt.

## 2. Le flux de planification (V-20)

| Niveau | Écran | On choisit | Parmi |
| --- | --- | --- | --- |
| Trimestre et au-delà | **Vue Plan** (nouvelle) | méta-objectifs, objectifs par trimestre, projets et leurs dépendances | idées, projets, objectifs existants |
| Mois | Page « projets du mois » (existante) | les projets du mois, plusieurs possibles | les projets des objectifs du trimestre (+ hors objectif) |
| Semaine | Planifier la semaine (existante, V-16) | les tâches de la semaine | les tâches des projets du mois + Inbox |

La Vue Plan ne choisit **pas** les projets du mois : elle prépare le stock dans lequel la page du mois pioche.

## 3. Disposition de l'écran (V-21)

Voir `maquettes/vue-plan.html`.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Filtre domaines (pastilles)                                [Titres IA ☑]  │
├────────────┬──────────────────────────────────────────────────────────────┤
│ RÉSERVE    │  CANEVAS (déplaçable, zoomable)                              │
│ [Projets]  │         T4 2026          T1 2027        T2 2027   …          │
│ [Objectifs]│ ┌────┐  ┌──────────────┐ ┌───────────┐                       │
│ filtres    │ │MÉTA│●→│ Objectif     │ │ Objectif  │                       │
│ cartes…    │ └────┘  │ [P]→[P]→[P]  │ │ [P]       │                       │
│            │         │   ↘[P]       │ │           │                       │
│            │         │ Libres : [P] │ │ Libres :  │                       │
│            │         └──────────────┘ └───────────┘                       │
│            │  capacité 18 h / 78 h · chemin 3 / 3 mois                    │
├────────────┴──────────────────────────────────────────────────────────────┤
│ Alertes du plan (même composant que les alertes existantes)              │
│ Brouillon : N changements          [Annuler tout]   [Appliquer]          │
└───────────────────────────────────────────────────────────────────────────┘
```

## 4. Les éléments visuels (V-22)

### 4.1 Colonne de trimestre
- Une colonne par trimestre, du trimestre courant jusqu'à **courant + 4**. Une colonne vide affiche « Déposer un objectif ici ».
- En-tête : `T1 2027`, plus une ligne de **capacité** (§6) : `18 h / 78 h · chemin 3 / 3 mois`, en orange doux si dépassement (NF-07).
- Plusieurs objectifs d'un même trimestre s'empilent verticalement : ce sont des objectifs en parallèle.

### 4.2 Nœud méta-objectif
- À gauche du canevas, plein, de la couleur du domaine principal (G-08).
- Contenu : `MÉTA · <DOMAINE>`, le **résultat visé** en gros (§4.6), un compteur `N objectifs · M projets`.
- Un **rond de sortie** à droite : il sert à tirer les **points de départ** (flèches méta → projet), ce qui permet d'avoir des projets en parallèle dès le début.

### 4.3 Cadre objectif
- Fond teinté pâle de la couleur du domaine, bordure fine.
- En-tête (qui sert aussi de **poignée de déplacement**) :
  - ligne 1, en mono : `⋮⋮ T4 2026 · deadline 31/12/2026` et l'indicateur SMART `0 / 3` ;
  - ligne 2, en gros : le **résultat visé** ;
  - ligne 3, en petit : `Memento : <titre d'origine>`.
- **Zone principale** : les projets reliés par des dépendances, rangés automatiquement (§5).
- **Zone « Libres, sans ordre »** en bas, séparée par un trait pointillé : les projets sans aucune dépendance.
- Un objectif vide affiche « Déposer un projet ici ».

### 4.4 Nœud projet
- Carte blanche d'environ 200 × 76 px. Titre en 14–15 px gras, lisible sans zoom : c'est l'élément principal de la vue.
- Pied de carte : groupes · heures restantes · badge de statut.
- Un **rond de sortie** à droite pour tirer une dépendance.
- Liseré gauche de la couleur du domaine principal si celui-ci n'est pas le domaine filtré (projet « connexe », comme en V-15).

| Statut Memento | Rendu | Badge |
| --- | --- | --- |
| `active` (du mois) | bordure 2 px couleur domaine | ▶ Du mois |
| `ready` | normal | ◌ Prêt |
| `idea` | bordure pointillée, fond gris très clair | 💡 Idée (+ icône si `gaps` non vide) |
| `paused` | atténué | ⏸ En pause |
| `done` | atténué, titre gris | ✓ Terminé |
| `abandoned` | non affiché | — |
| a des dépendances non terminées | — | 🔒 Attend / Attend N (information, **non bloquant**) |
| zone Libres | bordure pointillée | ⇄ Libre |
| brouillon (hors cadre) | bordure pointillée couleur accent | ✎ Brouillon |

Les icônes sont celles du jeu d'icônes déjà utilisé par Memento : les émojis ci-dessus ne servent qu'à décrire.

### 4.5 Flèches
- **Dépendance** (`dependsOn`) : courbe de Bézier gris foncé, de gauche à droite, avec une pointe.
- **Point de départ** (méta → projet) : couleur du domaine, un peu transparente.
- **Incohérence** : rouge pointillé quand le projet dont on dépend est dans un trimestre **postérieur** à celui du projet qui l'attend (alerte `DEP_AFTER`, §7).
- Au survol d'une flèche, un halo rouge discret ; un clic la supprime.

### 4.6 Titre « résultat visé » (V-23)
- Méta-objectif et objectif ont un champ **`outcomeTitle`** : leur titre reformulé comme un résultat (ex. « Fondation du repositionnement » → « Un positionnement IA clair et visible »).
- L'IA le rédige via l'API/MCP, l'utilisateur le modifie. Les deux cas sont journalisés (F-23).
- S'il est vide, on affiche le titre d'origine. Un interrupteur « Titres IA » bascule l'affichage.
- Pas d'`outcomeTitle` pour les projets : leur titre est déjà court et concret.

## 5. Rangement automatique (V-24)

L'utilisateur ne place jamais un nœud au pixel près : la vue se range seule.

1. Dans un objectif, la **colonne** d'un projet = la longueur de sa plus longue chaîne de dépendances *à l'intérieur de cet objectif*, la première colonne étant 0.
2. Les projets d'une même colonne s'empilent ; l'ordre vertical suit `positionInObjective`.
3. Deux projets qui dépendent du même prérequis tombent donc dans la même colonne : ils sont **en parallèle**.
4. Un projet qui attend deux branches se place après la plus longue (rendez-vous).
5. Projets sans aucune dépendance (ni entrante ni sortante) → zone Libres.
6. Une dépendance vers un projet d'un autre objectif est dessinée, mais ne compte pas pour la colonne.
7. Largeur du cadre = nombre de colonnes ; largeur de la colonne de trimestre = son cadre le plus large.
8. Les espacements doivent éviter tout chevauchement : environ 245 px entre colonnes, 104 px entre lignes, 34 px entre cadres empilés, 58 px entre trimestres. Le chevauchement de la v0 a été signalé comme un défaut.

## 6. Capacité affichée (V-25, voir CH-20 à CH-23)

Par colonne de trimestre :
- **Heures** : charge planifiée / budget du trimestre. Elle compte **tous les domaines**, quel que soit le filtre affiché, et **exclut les expériences** (`isExperience`).
- **Chemin** : longueur du plus long chemin de projets non terminés d'un objectif du trimestre (1 projet = 1 mois), comparée aux mois restants du trimestre.

Le filtre de domaine change **ce qu'on voit**, jamais **ce qu'on compte**.

## 7. Alertes du plan (V-26)

Même composant et même design que les alertes déjà présentes dans Memento (niveaux `warn` / `error`, code, texte en français). **Aucune alerte ne bloque une action** : elles disent ce qui ne tient pas.

| Code | Niveau | Texte type |
| --- | --- | --- |
| `QUARTER_OVER` | error | « T1 2027 : 92 h prévues pour 78 h de budget (tous domaines). » |
| `PATH_TOO_LONG` | error | « Fondation du repositionnement : chemin de 4 mois pour 2 mois restants. » |
| `DEP_AFTER` | warn | « Refonte du CV (T4) attend Premier RAG (T1). » |
| `OBJECTIVE_EMPTY` | warn | existe déjà : objectif sans projet |
| `PROJECT_INCOMPLETE` | warn | « 3 projets du trimestre sont incomplets (critère, tâches, durées). » |
| `DEP_RELEASED` | info | « ADR Novembre attendait X, abandonné : dépendance retirée. » |

Un clic sur une alerte centre le canevas sur l'élément concerné.

## 8. Interactions (V-27)

| Geste | Effet | Écriture (à l'application du brouillon) |
| --- | --- | --- |
| Tirer du rond d'un projet A vers un projet B | B dépend de A | ajout de A dans `B.dependsOn` |
| Tirer du rond du méta vers un projet P | P devient un point de départ | rattache P au premier objectif du méta s'il n'en a pas (voir 05-Q3) |
| Cliquer une flèche | la supprimer | retrait de `dependsOn` |
| Glisser une carte de la réserve sur la moitié **droite** d'un projet X | la placer après X | rattachement à l'objectif + `dependsOn = [X]` |
| … sur la moitié **gauche** de X | la placer avant X | rattachement + ajout dans `X.dependsOn` |
| … dans la zone Libres d'un objectif | rattachée, sans dépendance | rattachement + `dependsOn = []` (+ retrait des flèches sortantes) |
| … dans un objectif vide | rattachée | rattachement |
| … hors de tout cadre | brouillon visuel, non rattaché | rien : le brouillon de canevas n'est pas persisté en v1 (05-Q5) |
| Glisser un nœud du canevas vers la réserve | détacher de l'objectif | `objectiveId = null`, dépendances retirées |
| Glisser un nœud d'un cadre vers un autre | changer d'objectif | `objectiveId`, dépendances conservées |
| Glisser l'en-tête d'un objectif vers une autre colonne | changer de trimestre | `POST /objectives/{id}/quarter` (deadline ramenée) |
| … à une autre hauteur de la même colonne | réordonner | `position` |
| … vers la réserve | détacher du méta-objectif | `metaObjectiveId = null` |
| Glisser un objectif de la réserve vers une colonne | rattacher au méta et fixer le trimestre | `metaObjectiveId` + trimestre |
| Survol d'un projet | sa chaîne amont et aval en surbrillance, le reste atténué | — |
| Clic sur un projet | panneau de détail : objectif, critère, attend / débloque, heures, lien vers la fiche (G-12) | — |
| Molette / pincement | zoom | — |
| Glisser le fond | déplacement | — |

Pendant un glisser, un **repère** montre où l'élément atterrira (trait bleu « avant / après », cadre « Libres », colonne surlignée), et l'étiquette qui suit le curseur l'écrit : « → après « Plan, Profil & ADR » ».

Toute flèche qui créerait une **boucle** est refusée sur le moment : le cadre cible devient rouge pendant le glisser, puis l'alerte « créerait une boucle » s'affiche.

## 9. Brouillon et application (V-28)

- Les gestes modifient un **brouillon local**. Le panneau du bas liste les changements en clair : « Formation LangGraph : réserve → Fondation du repositionnement ».
- **Appliquer** envoie tout le brouillon en **une seule requête atomique** (API-08). En cas de refus (422), rien n'est appliqué, le message est montré tel quel et le brouillon reste ouvert.
- **Annuler tout** revient à l'état du serveur.
- Chaque écriture appliquée apparaît dans le Journal (F-23) avec l'auteur `me`. Elle remonte aussi dans « À revoir » (F-25) si elle vient de l'IA.
- La capacité et les alertes se recalculent **en direct sur le brouillon**, avant l'application : c'est l'intérêt de la vue.

## 10. Réserve (V-29)

- Deux onglets :
  - **Projets** : projets et idées du ou des domaines filtrés qui n'ont pas d'objectif. Filtres : groupe, statut (Idées / Prêts), case « connexes d'autres domaines ».
  - **Objectifs** : objectifs non placés sur le plan, sous deux rubriques, « Sans méta-objectif » et « Dans un autre méta-objectif ». Rattacher un objectif de la seconde rubrique le fait **changer de méta-objectif** : c'est dit dans le brouillon.
- Les cartes montrent : titre, statut, groupes, domaine si connexe, heures.
- Les projets déjà rattachés à un objectif **d'un autre domaine** apparaissent en connexes, avec la mention « dans « <objectif> » ».

## 11. Filtre de domaine (V-30)

- Pastilles des 8 domaines, dans l'ordre de priorité. Par défaut, **un seul domaine** : le dernier utilisé, mémorisé par appareil.
- Le canevas montre les méta-objectifs du ou des domaines choisis, ainsi que les objectifs sans méta-objectif dont au moins un projet est dans ces domaines.
- Avec plusieurs domaines, les méta-objectifs s'empilent en bandes horizontales, chacune avec son nœud méta à gauche ; les colonnes de trimestre restent communes.
- La vue « tous les domaines » sert de vue d'organisation globale. La capacité y est la même, puisqu'elle compte toujours tout.

## 12. Appareils (V-31, complète G-05 et NF-01)

| Appareil | Mode | Spécificités |
| --- | --- | --- |
| PC UltraWide | édition complète | réserve à gauche, canevas large, ronds de connexion de 14 px de diamètre |
| iPad 11" | édition complète au doigt | **ronds de connexion de 44 pt** et cible de toucher élargie, poignées d'objectif plus hautes, réserve repliable en tiroir. Détection par `@media (pointer: coarse)`, pas par la largeur d'écran |
| iPhone 17 | **lecture seule** (V-18) | graphe consultable (déplacement, zoom, survol par appui), sans réserve ni glisser |

## 13. Hors périmètre v1

- Placement manuel libre des nœuds au pixel.
- Graphe des **tâches** : elles gardent l'ordre séquentiel / parallèle du projet.
- Dépendances entre **objectifs** : elles passent par les dépendances entre leurs projets.
- Persistance des brouillons hors cadre.
- « Proposer avec l'IA » sur la Vue Plan (bouton présent, grisé, comme V-17).
