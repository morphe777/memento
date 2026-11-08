# Mémento — one image, three processes (see install/docker-compose.yml):
#   API + web front (port 4500), worker (scheduled jobs), MCP server (port 4502).
# TypeScript runs through tsx, exactly as in development (no separate compile step).

# ── Stage 1: tools and manifests shared by the two install stages ──────
FROM node:24-bookworm-slim AS base
WORKDIR /app

# Build tools in case a native module (better-sqlite3, argon2) has no prebuilt binary.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@12.15.0

# Manifests first, so that the dependency layers are cached between code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/mcp/package.json apps/mcp/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/

# ── Stage 2: all dependencies, build of the web front ──────────────────
FROM base AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @memento/web build

# ── Stage 3: production dependencies only (H-18: no test, lint or type tools) ──
FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod

# ── Stage 4: runtime ───────────────────────────────────────────────────
FROM node:24-bookworm-slim
WORKDIR /app

ARG VERSION=dev
ARG BUILD_DATE

LABEL org.opencontainers.image.title="Mémento" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="https://github.com/morphe777/memento" \
      org.opencontainers.image.description="Objectifs, projets, charge mentale — outil personnel de pilotage"

RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends tzdata ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# H-18: only what runs — production dependencies, server sources, migrations, the built front and the AI guide.
COPY --from=prod-deps --chown=node:node /app /app
COPY --chown=node:node tsconfig.json ./
COPY --chown=node:node packages/db/src packages/db/src
COPY --chown=node:node packages/db/migrations packages/db/migrations
COPY --chown=node:node packages/domain/src packages/domain/src
COPY --chown=node:node apps/api/src apps/api/src
COPY --chown=node:node apps/worker/src apps/worker/src
COPY --chown=node:node apps/mcp/src apps/mcp/src
COPY --chown=node:node docs/api/guide-ia.md docs/api/guide-ia.md
COPY --from=build --chown=node:node /app/apps/web/dist apps/web/dist
RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production \
    MEMENTO_VERSION=${VERSION} \
    TZ=Europe/Paris \
    MEMENTO_DB_FILE=/data/memento.db \
    MEMENTO_HOST=0.0.0.0 \
    MEMENTO_API_PORT=4500 \
    MEMENTO_MCP_HOST=0.0.0.0 \
    MEMENTO_MCP_PORT=4502 \
    MEMENTO_API_URL=http://127.0.0.1:4500/api/v1

# uid 1000: files written in the /data bind mount belong to the host user.
USER node
EXPOSE 4500 4502
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MEMENTO_API_PORT||4500)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Default: API + front. The compose file starts the worker and the MCP server with other commands.
CMD ["node_modules/.bin/tsx", "apps/api/src/server.ts"]
