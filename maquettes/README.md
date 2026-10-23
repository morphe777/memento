# Maquettes validées (v1)

4 écrans validés le 23/10/2026. Ce sont des **références visuelles et comportementales**, pas du code à réutiliser.

| Fichier | Écran | Points à respecter |
| --- | --- | --- |
| `ma-semaine.dc.html` | Ma semaine (desktop) | Tâches non faites en haut, faites en bas barrées et atténuées ; « Bonus · N » toujours replié par défaut, une tâche Bonus faite rejoint la liste avec un badge Bonus ; Budget et Fait hors expériences ; colonne droite : projets du mois (barre avance / retard centrée) et domaines |
| `planifier-la-semaine.dc.html` | Planifier la semaine (desktop) | 3 bacs gris dans l'ordre Inbox, Projets du mois, À considérer aussi ; cartes projet blanches ; seules les tâches importantes visibles, la suivante apparaît quand toutes sont choisies ; « + N autres tâches » déplie en lecture seule ; tâches séquentielles verrouillées ; boutons « + Semaine » / « Bonus » ; colonne droite live : budget, alertes, répartition ; bouton IA grisé « v2 » |
| `rapport-hebdo.dc.html` | Rapport hebdo figé | Ordre : en-tête + navigation, indicateur global, Mes réussites (phrases, pas de tâches), tuiles (Tâches terminées, Expériences, Focus, Rythme, Évitement), avance / retard, heures par domaine |
| `ma-semaine-iphone.dc.html` | Ma semaine (iPhone, 390 × 844) | Consultation et cochage seulement ; barre d'onglets Semaine / Projets / Idées / Rapports |

## Comment lire ces fichiers

Format « Design Component » d'un outil de maquettage : **ils ne s'ouvrent pas tels quels dans un navigateur** (le script `support.js` référencé n'est pas fourni). Les lire comme du HTML annoté :

- Le balisage dans `<x-dc>` est la structure de l'écran ; les styles en ligne donnent les valeurs exactes (couleurs, tailles, espacements, rayons).
- `{{nom}}` = valeur calculée dans la méthode `renderVals()` du script en bas de fichier.
- `<sc-for list="{{liste}}" as="x">` = boucle ; `<sc-if value="{{cond}}">` = affichage conditionnel.
- `onClick="{{handler}}"` = interaction ; les handlers modifient `this.state`, ce qui montre le comportement attendu (cocher, déplier, révéler la tâche suivante).
- Les données dans `renderVals()` sont **fictives** : elles servent d'exemples réalistes et de jeu de données de démo possible.

Les valeurs de couleurs et de typographie de référence sont aussi dans `../docs/02-dossier-dev.md` §11.

## Écrans sans maquette

Inbox, Objectifs, Objectif (chemin), Projets (arborescence, liste, kanban), Projet, panneau Tâche, Domaine, Idées, Rapports (historique), À revoir, Configuration : réutiliser les composants de ces 4 maquettes (cartes, lignes de tâche, bacs, pastilles, tuiles, barres), sans inventer de nouveau style.
