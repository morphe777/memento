# Changelog

Format : une entrée par version publiée (tag `vX.Y.Z`, image `morphe777/memento:X.Y.Z`). Les décisions détaillées
sont dans [`docs/DECISIONS.md`](docs/DECISIONS.md).

## 1.3.0 — en cours

- Chaque appel à l'IA est mesuré dans le journal (fonction, durée, tokens dont réflexion, relance, hôte), sans son
  contenu, pour trouver d'où vient la lenteur (D-156).
- **Souvenirs** : chaque expérience vécue a son souvenir (photos, lieu, personnes, une phrase, une note), y compris
  les anciennes (D-157). **« + Souvenir »** sur le téléphone ou **partage** depuis Photos par le Raccourci iPhone
  ([guide](docs/raccourci-iphone.md)) : date, lieu et titre pré-remplis, écran de vérification, photos envoyées en
  arrière-plan ; « Rattacher » à une expérience prévue, fusion avec un souvenir du même jour (D-158 à D-160).
- **Lieux par leur nom** (OpenStreetMap, désactivable), mémorisés une fois ; **proches** en Configuration ; domaine
  déduit des personnes (D-161 à D-163).
- **Revivre** : journal par mois, carte (un point par lieu, rayon de vie), fiche avec galerie plein écran et
  parcours des photos, « Il y a un an » sur Ma semaine, bilan **« Vivre »** dans le rapport trimestriel et la page
  Expériences (D-166, D-167).
- **Un seul menu « Expériences »** : onglets **Vécues** (journal, carte), **À vivre** (prévues, envies) et
  **Bilan** (D-170).
- Lieux plus fiables : Photon prend le relais quand Overpass ne répond pas, l'écran de vérification recherche autour
  des photos dès leur arrivée, la recherche par nom donne d'abord les lieux à moins de 100 km, lieux mémorisés compris (D-169, D-171).
- **Envies** : la réserve d'expériences s'appelle désormais « Envies » ; « + Envie », et un lien ou un lieu partagé
  depuis l'iPhone devient une envie (titre lu sur la page ; texte, dates, prix et lieu dans la description). Le
  moteur en propose toujours quand la cible du mois n'est pas tenue (D-171).
- API : `/captures`, `/souvenirs`, `/photos`, `/places`, `/persons`, `/map`, `/living` ;
  jeton **capture** (D-168). MCP : `list_souvenirs`, `get_souvenir`, `update_souvenir`, `search_places`,
  `list_persons`, `get_living_report`.
- Données : les photos vont dans `photos/` du dossier de données (même bind, même sauvegarde) ; migrations `0010` et `0011` (D-171 : les envies d'avant deviennent des envies de la réserve).

## 1.2.0 — 2026-11

Demandes de Mehdi : repères de planification, expériences, aide de l'IA pour remplir la semaine.

### Fonctionnalités

- **Tâche planifiée** : une pastille discrète « Cette semaine » ou « Sem. du … » sur chaque tâche prévue dans le plan
  de cette semaine ou d'une semaine à venir (Inbox, projets, objectifs, Tâches, Expériences, fiche) (D-151).
- **« Faite le »** : la date et l'heure de fin d'une tâche faite se corrigent dans sa fiche, comme si elle avait été
  cochée à ce moment-là ; jamais dans l'avenir (D-152).
- **« J'ai vécu une expérience »** : un souvenir s'ajoute directement, déjà fait, Famille par défaut ou dans un
  projet ; la réserve propose aussi Famille par défaut (D-153).
- **Cible d'expériences par mois civil**, partout (une semaine compte pour le mois de son jeudi) ; le réglage de
  fenêtre glissante disparaît ; le rapport mensuel affiche « faites / cible » (D-154).
- **« Compléter le budget »** (Planifier › Semaine) : l'IA propose 1 à 3 tâches qui tiennent dans le temps restant,
  sans toucher à la sélection, chacune avec une étiquette, une raison courte et ses mots clés en gras (D-155).

### API, MCP et IA

- `plannedWeek` sur les tâches ; `PATCH /tasks/{id} { doneAt }` ; `POST /experiences/lived` et outil MCP
  `log_experience` ; `POST /ai/fill-week` (interface seulement) ; prompt « Compléter le budget » modifiable.

## 1.1.0 — 2026-11

Demandes de Mehdi (budget, répartition, graphe des projets) et lot 2 de l'audit v1.0.

### Fonctionnalités

- **Budget = fait + prévu** : la charge d'une semaine ou d'un mois compte ce qui est déjà fait dans la période (jour
  de Paris), plus ce qui reste prévu. Une tâche faite en avance consomme sa semaine et libère la suivante. « Plus de
  budget disponible » quand le fait atteint le budget (alerte, jamais bloquant) (D-137).
- **Planifier › Mois** : « Répartition prévue » par domaine, au-dessus des alertes (D-138).
- **Ma semaine** : graphe « Projets du mois » (aide à côté du titre) ; rien d'écrit pour un projet dans les temps ;
  projet terminé grisé, « terminé » à la place du délai ; « dans les temps » partout (D-139).
- Un projet ne « rate » pas : « Terminer » = réussi ; un récurrent non fini au changement de mois est abandonné, ses
  tâches faites restent faites (D-140).

### Règles et rapports

- Une semaine à cheval appartient au mois de son jeudi ; le rapport mensuel attend sa dernière semaine ; le rapport
  trimestriel attend la clôture des objectifs récurrents (D-142).
- Récurrentes, replanification, mois d'un projet rouvert, renouvellement par duplication, journal complété (D-143).
- Migrations de données une seule fois (D-141).

### API, MCP et IA

- Créations en plusieurs étapes en un appel, tout ou rien : tâche + semaine, projet + tâches + promotion, plusieurs
  projets (D-144).
- Un `GET` n'écrit jamais ; 409 pour un nom pris, 404 pour un jeton inconnu ; booléens stricts ; `GET /tasks` par pages.
- MCP : paramètres décrits, outils marqués lecture / destructifs, un jeton lecture ne voit que la lecture, nouveaux
  `list_tasks`, `list_inbox`, `get_task` (D-146). OpenAPI : erreurs et droits par opération.
- Données envoyées à l'IA délimitées et marquées « non fiables » ; une clé enregistrée ne part que vers son serveur
  (D-145).

### Données, exploitation

- Import vérifié à blanc avant toute écriture ; copie de sécurité ensuite, 5 gardées ; copies en mode 600 (D-145).
- La base refuse un statut inconnu et un jour qui n'existe pas ; index sur les colonnes filtrées (migration 0009).
- `/health` lit la base ; échecs de connexion et appels MCP journalisés ; recherche masquée dans les logs.
- Image de production allégée (578 → 378 Mo), dépendances à jour ; compose d'exemple : MCP sans accès aux données,
  ports sur `MEMENTO_BIND_IP` (D-147).
- Tests : sessions, révocations, chaque outil MCP, worker (D-148) ; parcours de bout en bout (Playwright).
- Documentation resynchronisée ; statut de chaque décision (D-149).

## 1.0.0 — 2026-11

Première version publiée. Correctifs issus de l'audit de sortie v1.0.

### Sécurité et accès

- Authentification décidée sur la route reconnue par le serveur, quelle que soit l'écriture de l'URL.
- Une seule liste des routes ouvertes aux jetons (`apps/api/src/access.ts`) ; le reste est réservé à l'interface.
  Fermés aux jetons : réglages, « Marquer comme revu », génération de rapport, écriture sur domaines et groupes (D-123).
- Paramètres du serveur MCP validés par les schémas du domaine, puis encodés.
- Suppression d'un projet : le journal garde le contenu des tâches supprimées.
- Limite de connexion par adresse réelle ; proxy à déclarer dans `MEMENTO_TRUST_PROXY`.
- En-têtes CSP, Permissions-Policy (et HSTS derrière HTTPS) ; les images des descriptions s'affichent en lien.

### Données et robustesse

- Règles de récurrence limitées à des clés et valeurs connues ; recherche d'occurrence bornée.
- Dates : seulement des jours qui existent (422 `INVALID_DATE`).
- `pnpm db:check` : contrôle en lecture seule des dates et récurrences déjà enregistrées.
- Transactions SQLite prises en écriture dès le début (plus d'échec sous verrou court).
- Jobs planifiés : tout ou rien, relancés jusqu'à réussir, échec signalé une fois dans les notifications.
- Rapports : période valide et terminée exigée (à partir de l'heure du job).
- `pnpm db:backup` / `pnpm db:verify` et procédure de restauration testée.

### Planification

- Fin de semaine : seules les tâches encore planifiables sont reportées.
- Un prérequis d'un autre projet, une fois fait, ne verrouille plus la tâche.
- Une nouvelle proposition de semaine garde les tâches déjà faites.

### Livraison

- Licence MIT, version unique dans tous les paquets, CI (lint, typage, tests à plusieurs dates et en ordre aléatoire,
  audit des dépendances, scan de l'image), image construite depuis un tag, version épinglée dans le compose.
- Dépôt public sans données personnelles ; une installation neuve démarre vide (seed générique).

## 0.x — 10/2026 à 11/2026

Versions de développement, non publiées comme telles : voir l'historique Git et `docs/DECISIONS.md` (D-01 à D-121).
