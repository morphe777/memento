# Questions ouvertes pour Mehdi

Ce que tu dois trancher ensuite, par ordre d'importance. Les choix provisoires sont dans `DECISIONS.md` (colonne « À valider » = oui).

## À trancher avant la mise en service (L7)

1. ~~Déploiement Docker~~ : fait (D-56), SQLite conservé. Reste : sauvegarde régulière de `/home/morphe/Dockers/Memento` vers le NAS.
2. **Nom d'hôte interne** (ex. `memento.internal.lcl`) et accès iPhone via WireGuard : à confirmer pour la conf NGINX Proxy Manager. Passer alors `MEMENTO_COOKIE_SECURE=true`.
3. **Exposition en dev** : l'API écoute sur `0.0.0.0:4500` (LAN `192.168.10.18`) pour que tu puisses tester. OK, ou on la restreint à `127.0.0.1` ?
4. **Import Vikunja** : script en L7 ou départ à zéro ?

## En attente de ta réponse (structurant)

- **Q-F · Page Expériences** (proposition) : une page « Expériences » avec la cible (ex. 2 sur 4 semaines), les expériences vécues (souvenirs, avec date et note facultative), celles prévues, et une réserve d'idées d'expériences. À décider après quelques semaines d'usage du badge Expérience.
- **Corrélation santé / productivité** : mise de côté. Mémento reste fournisseur de données via l'API.

## À valider sur l'usage (v0.1)

5. **Poids des domaines** (D-07) : la proposition linéaire te va-t-elle ? Elle est modifiable dans Configuration › Domaines.
6. **Couleurs du thème sombre** (§11) : à valider à l'écran (bouton Auto / Clair / Sombre en bas de la barre latérale).
7. **Moteur** (D-16, D-17, D-18) : les « pourquoi » et le nombre de tâches visibles par projet sonnent-ils juste ? Les 3 Bonus pré-placés te conviennent-ils, ou préfères-tu ne rien pré-cocher ?
8. **Indicateur global R-01** (D-24) : les seuils vert / orange / rouge te parlent-ils ?
9. **Garde-fous Santé / Famille** (D-15, Q-28) : reconnus par le nom du domaine. Seuils après usage ?
10. ~~Kanban~~ : tranché (pas de « En cours », Kanban projets conservé).
11. **Domaine principal par défaut** (D-32) : « le plus prioritaire » met PV en Sécurité plutôt qu'en Maison. On garde cette règle ?

## Décisions déjà listées dans le dossier de dev §14, toujours ouvertes

12. Délai de purge des idées : 12 mois ? (réglable dans Configuration › Alertes)
13. Canal des rapports et alertes (Q-16) : dans l'outil seulement pour l'instant.
14. Lecture du calendrier (Q-07) : v2 ou jamais.
15. « Interactions entre objectifs » de la vue d'ensemble (Q-09) : non implémenté en v0.1 (la page Objectifs regroupe par méta-objectif, avec domaines et avancement).
16. Rattachement des groupes « Outils perso » (Santé) et « Travaux » (Maison) : repris tels quels.

## Hors v0.1, à planifier

- Tests de bout en bout Playwright : différés, comme demandé (« pas pour le moment »). Les écrans ont été vérifiés par captures automatiques.
- Purge des idées (DM-87) : le réglage existe, mais la proposition de purge en revue trimestrielle n'est pas encore codée.
- Notifications, raccourci iOS de saisie rapide, bouton « Proposer avec l'IA » (v2).

## Parcours de saisie : notés pour plus tard (revue UX du 27/10/2026)

- **Rattacher un projet existant depuis l'objectif** (recherche parmi les idées et projets sans objectif). Aujourd'hui : depuis la fiche du projet.
- **Fil d'Ariane du projet** par l'objectif (Objectifs › Méta › Objectif › Projet) et « projet précédent / suivant » du chemin.
- **Message de confirmation avec un lien « Ouvrir »** quand une création laisse sur place.
- **Raccourci clavier « N »** = nouvel élément enfant de la page en cours.
- **Saisie de tâches plus rapide** : coller plusieurs lignes = plusieurs tâches ; durée retenue d'une tâche à l'autre ou tapée dans le titre (« … 30m »). Pas compris le 27/10 : à réexpliquer.
- **Chantier « Atelier »** : une page en plan dépliable Méta › Objectif › Projet › Tâche, remplie au clavier (Entrée = élément suivant, Tab = un niveau plus bas, Maj+Tab = un niveau plus haut), pour vider sa tête d'un coup.
