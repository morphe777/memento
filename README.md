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

Un jeton en lecture seule ne peut faire que des GET. Aucun jeton ne peut gérer les jetons ni les réglages : c'est réservé à l'interface.

## Qualité

```bash
pnpm check        # lint (Biome) + typage + tests (Vitest)
```

## Sauvegarde (en attendant L7)

La base est un seul fichier SQLite (`data/memento.db`, mode WAL). Pour une sauvegarde à chaud cohérente :

```bash
sqlite3 data/memento.db ".backup 'sauvegarde-$(date +%F).db'"
```

## Sécurité

- Aucun secret dans le dépôt (`.env` et `data/` sont ignorés par git).
- Mots de passe hachés en argon2id ; sessions et jetons stockés hachés (SHA-256) ; cookie `httpOnly`, `SameSite=Strict`, `Secure` derrière HTTPS (`MEMENTO_COOKIE_SECURE=true`).
- Connexion limitée à 5 tentatives par minute.
- Pas d'exposition Internet : LAN ou VPN WireGuard uniquement.
