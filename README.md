# Mémento

Outil personnel de pilotage : objectifs, projets, charge mentale. Voir `CLAUDE.md` et `docs/`.

## Architecture (v0.1)

| Dossier | Rôle |
| --- | --- |
| `packages/domain` | **Toute la logique métier** (règles RB-xx, moteur du lundi, rapports, services) + schémas Zod partagés |
| `packages/db` | Schéma Drizzle (SQLite), migrations, client |
| `apps/api` | API REST Fastify `/api/v1` (OpenAPI : `/api/v1/openapi.json`), sert aussi le front buildé |
| `apps/web` | Front React + Vite + TanStack Router / Query + Tailwind (aucune règle métier) |
| `apps/worker` | Jobs planifiés (lundi 07:00, 1er du mois, 1er jour du trimestre), heure de Paris |
| `apps/mcp` | Serveur MCP (Streamable HTTP), chaque outil = un appel API |

Ports : API + front **4500**, Vite dev 4501, MCP 4502.

## Prérequis

Node.js 24 LTS et pnpm 12. Sur la machine de dev, ils sont installés dans `~/.local/opt/node` (ajouté au `PATH` dans `~/.bashrc`).

## Démarrer

```bash
cp .env.example .env          # puis adapter (jamais versionné)
pnpm install
pnpm db:migrate && pnpm db:seed   # base vide : 8 domaines, groupes, réglages
pnpm user:set-password mehdi      # crée le compte web (pas de mot de passe par défaut)
pnpm build                        # build du front
pnpm start                        # API + front sur http://<hôte>:4500
pnpm worker                       # jobs planifiés (autre terminal)
pnpm mcp                          # serveur MCP (autre terminal)
```

Développement avec rechargement : `pnpm dev` (API en watch + Vite sur 4501, qui relaie `/api` vers 4500).

### Données de démo

`pnpm db:demo` charge un jeu de données inspiré des maquettes : historique de 2 semaines, plan validé, rapports hebdo. La commande refuse de tourner si la base contient déjà des projets. Pour repartir de zéro : arrêter les services, `rm data/memento.db*`, puis `pnpm db:seed`.

## Accès IA (API et MCP)

Guides : [`docs/api/guide.md`](docs/api/guide.md) (pour toi : brancher une IA ou un robot) et [`docs/api/guide-ia.md`](docs/api/guide-ia.md) (pour l'IA : règles, formats, recettes ; aussi servi par `GET /api/v1/guide` et l'outil MCP `get_guide`).

1. Créer un jeton : Configuration › Accès, ou `pnpm token:create claude read_write`. Le secret n'est affiché qu'une fois et seul son hash est stocké.
2. API : `Authorization: Bearer mem_…`
3. MCP : URL `http://<hôte>:4502/mcp`, même en-tête `Authorization: Bearer mem_…`. Chaque agent utilise **son** jeton, ce qui lui donne son nom dans le journal (`ai:<nom>`) et dans « À revoir ».

Ce qu'un jeton peut appeler est fixé par **une seule liste**, `apps/api/src/access.ts` (D-123) ; toute autre route est
réservée à l'interface (403 `USER_ONLY`) :

- jeton **lecture** : les lectures de la liste, plus deux POST qui n'écrivent rien (`/plan/preview`, `/tasks/parse`) ;
- jeton **lecture-écriture** : toute la liste, suppressions comprises (D-60 ; le contenu supprimé est journalisé) ;
- **jamais pour un jeton** : les réglages (même en lecture), les jetons, le compte, l'import, l'export, la purge,
  la configuration et les assistants IA de l'interface, les notifications (Telegram, push), l'écriture sur les
  domaines et les groupes, la génération d'un rapport et « Marquer comme revu ».

## Qualité

```bash
pnpm check        # lint (Biome) + typage + tests (Vitest)
pnpm test:dates   # la suite à d'autres dates (01/01/2027, 30/11/2026 23:30 UTC) et dans un ordre aléatoire
```

La CI GitHub (`.github/workflows/ci.yml`) bloque sur un échec de lint, de typage, de test, de `pnpm audit` (niveau
high) ou du scan de l'image (Trivy), et vérifie que l'image ne contient ni maquettes, ni dossier de conception, ni
données.

## Déploiement Docker (production)

Une image `morphe777/memento` (Docker Hub), trois conteneurs : `memento` (API + interface, port 4500),
`memento-worker` (jobs planifiés) et `memento-mcp` (serveur MCP, port 4502). Données : bind du
dossier `MEMENTO_DATA_DIR` de l'hôte (obligatoire) → `/data` (base `memento.db`).

### 1. Publier une version

1. Version dans le `package.json` racine et les sous-paquets, entrée dans `CHANGELOG.md`, commit.
2. CI verte, puis tag : `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. Image, depuis ce commit tagué et propre (le script refuse sinon) :

```bash
./install/build-and-push.sh            # build + login + push (version lue dans package.json, + latest)
./install/build-and-push.sh --no-push  # build local seulement
```

4. Dans `install/docker-compose.yml` (et la stack Portainer), l'image porte la version : `morphe777/memento:X.Y.Z`,
   jamais `latest`.

**Retour arrière** : remettre la version précédente dans la stack. Les migrations ne se défont pas : restaurer
aussi la sauvegarde prise juste avant la mise à jour (voir Sauvegarde).

### 2. Préparer le dossier de données

```bash
mkdir -p /srv/memento
sudo chown -R 1000:1000 /srv/memento   # le conteneur tourne en uid 1000 (utilisateur node)
# Reprendre la base de dev : arrêter d'abord l'API, le worker et le MCP de dev, puis copier la base
cp data/memento.db* /srv/memento/
```

Sans base existante, le conteneur la crée au premier démarrage (migrations + 8 domaines). Créer alors le compte :

```bash
docker exec -it memento node_modules/.bin/tsx apps/api/src/cli/set-password.ts <identifiant>
```

### 3. Lancer la stack

Portainer : nouvelle stack avec le contenu de `install/docker-compose.yml` et la variable `MEMENTO_DATA_DIR`. Ou en ligne de
commande :

```bash
MEMENTO_DATA_DIR=/srv/memento docker compose -f install/docker-compose.yml up -d
```

Les ports 4500 et 4502 doivent être libres (arrêter les services de dev sur la même machine). Derrière NGINX Proxy
Manager en HTTPS, passer `MEMENTO_COOKIE_SECURE: "true"`. Mise à jour : nouvelle image puis « Pull and redeploy »
(les migrations s'appliquent au démarrage) : faire d'abord une sauvegarde avec `backup-cli.ts` (voir Sauvegarde).

Contrôle des données, en lecture seule (aucune écriture, aucune migration) : il liste les dates impossibles et les règles
de récurrence illisibles enregistrées avant la v1.0, à corriger à la main. Code de sortie 1 s'il en trouve.

```bash
pnpm db:check                     # en dev (MEMENTO_DB_FILE, sinon data/memento.db)
docker exec memento node_modules/.bin/tsx packages/domain/src/cli/check-data.ts   # en production
```

Si le déploiement échoue avec `container memento is unhealthy` : `docker logs memento`. Le plus souvent, le dossier
de données n'est pas accessible en écriture par l'uid 1000 (dossier créé par Docker en root) → `chown` ci-dessus.

Version : visible en bas du menu de l'application, dans `GET /api/v1/health`, dans le label OCI
`org.opencontainers.image.version` de l'image et dans la variable `MEMENTO_VERSION` du conteneur.

### 4. IA (« Proposer avec l'IA »)

Dans Configuration › IA : choisir le fournisseur (Anthropic, OpenAI, OpenRouter, Google Gemini, Ollama ou tout
serveur compatible OpenAI), vérifier l'URL (pré-remplie), coller la clé d'API, puis « Tester et charger les
modèles » et choisir le modèle dans la liste. La clé est gardée dans la base (une par fournisseur), jamais
réaffichée ni exportée. Les variables `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`,
`GEMINI_API_KEY` ou `MEMENTO_AI_API_KEY` restent lues si aucune clé n'est saisie. Ollama n'en demande pas ; en
Docker, renseigner son URL (ex. `http://192.168.1.10:11434/v1`). Les prompts semaine / mois / trimestre se modifient dans la même page.

### 5. Capturer depuis l'iPhone

Dans l'app (ajoutée à l'écran d'accueil via Safari › Partager › « Sur l'écran d'accueil ») : bouton rond **+**
en bas à droite, sur toutes les pages (titre, durée 15 min par défaut, domaine facultatif). Sur PC / iPad :
« Capturer dans l'Inbox » dans le menu. L'adresse `…/semaine?capturer=1` ouvre directement la fenêtre de capture.

Raccourcis iOS (app Raccourcis) :

- **Le plus simple** : action « Ouvrir les URL » avec `http://memento.example.lan/semaine?capturer=1`
  (ton adresse), nommée « Capturer » : « Dis Siri, Capturer », ou une icône dédiée sur l'écran d'accueil.
- **À la voix, sans ouvrir l'app** : créer un jeton `iphone` (Configuration › Accès, lecture-écriture), puis
  1. « Dicter le texte » ;
  2. « Obtenir le contenu de l'URL » : `http://memento.example.lan/api/v1/tasks`, méthode POST, en-tête
     `Authorization: Bearer mem_…`, corps JSON `title` = Texte dicté, `durationMin` = 15 (nombre) ;
  3. « Afficher une notification » « Ajouté à l'Inbox ».
  La tâche est alors journalisée « ai:iphone » et apparaît dans « À revoir ».

Les deux passent par le réseau de la maison (VPN dehors).

## Sauvegarde

La base est un seul fichier SQLite en mode WAL : `memento.db` plus `memento.db-wal` (les dernières écritures). Copier
le fichier seul pendant que l'application tourne peut donner une copie incomplète. Les commandes ci-dessous font une
copie à chaud cohérente (API de sauvegarde de SQLite, sans le CLI `sqlite3`), puis la vérifient (intégrité, nombre
de domaines, objectifs, projets, tâches, rapports, migrations) ; elles n'écrasent jamais un fichier existant.

```bash
# En dev
pnpm db:backup sauvegardes/$(date +%F).db
pnpm db:verify sauvegardes/2026-11-07.db
# En production (le fichier atterrit dans le dossier de données de l'hôte)
docker exec memento node_modules/.bin/tsx packages/db/src/backup-cli.ts /data/sauvegardes/$(date +%F).db
docker exec memento node_modules/.bin/tsx packages/db/src/verify-cli.ts /data/sauvegardes/2026-11-07.db
```

La sauvegarde externe du dossier de données (bind) copie `memento.db` et `memento.db-wal` à des instants
différents : elle n'est sûre que pour les fichiers de `sauvegardes/`. Planifier `backup-cli.ts` (cron de l'hôte,
chaque nuit) avant la sauvegarde externe.

### Restaurer

1. Vérifier la sauvegarde choisie : `verify-cli.ts <fichier>` doit afficher `"ok":true`.
2. Arrêter la stack (les trois conteneurs).
3. Mettre de côté la base actuelle : `mv memento.db memento.db.avant-restauration`, de même pour `memento.db-wal`
   et `memento.db-shm` s'ils existent.
4. Copier la sauvegarde à la place : `cp sauvegardes/<date>.db memento.db` (propriétaire uid 1000).
5. Démarrer la stack : les migrations éventuelles s'appliquent. `GET /api/v1/health` doit répondre `ok`.
6. Contrôler : `verify-cli.ts /data/memento.db` (mêmes nombres qu'à l'étape 1, migrations à jour) et
   `check-data.ts` (aucune donnée invalide).

Exercice fait le 07/11/2026 sur une copie de la sauvegarde réelle prise avant la v0.18, restaurée puis démarrée
en v1.0.0 : intégrité ok, migrations 6 → 9, mêmes nombres d'objets avant et après, aucune donnée invalide, puis sauvegarde
à chaud vérifiée pendant que l'API tournait.

## Sécurité

- Aucun secret dans le dépôt (`.env` et `data/` sont ignorés par git).
- Mots de passe hachés en argon2id ; sessions et jetons stockés hachés (SHA-256) ; cookie `httpOnly`, `SameSite=Strict`, `Secure` derrière HTTPS (`MEMENTO_COOKIE_SECURE=true`).
- Connexion limitée à 5 tentatives par minute et par adresse. L'en-tête `X-Forwarded-For` n'est cru que du proxy déclaré dans `MEMENTO_TRUST_PROXY` (IP ou CIDR) ; sans lui, toutes les connexions passées par le proxy partagent le même quota.
- Pas d'exposition Internet : LAN ou VPN WireGuard uniquement.
