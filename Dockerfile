# Mémento — one image, three processes (see install/docker-compose.yml):
#   API + web front (port 4500), worker (scheduled jobs), MCP server (port 4502).
# TypeScript runs through tsx, exactly as in development (no separate compile step).

# ── Stage 1: install dependencies and build the web front ──────────────
FROM node:24-bookworm-slim AS build
WORKDIR /app

# Build tools in case a native module (better-sqlite3, argon2) has no prebuilt binary.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@12.15.0

# Manifests first, so that the dependency layer is cached between code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/mcp/package.json apps/mcp/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @memento/web build

# ── Stage 2: runtime ───────────────────────────────────────────────────
FROM node:24-bookworm-slim
WORKDIR /app

ARG VERSION=dev
ARG BUILD_DATE

LABEL org.opencontainers.image.title="Mémento" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="https://github.com/morphe777/memento" \
      org.opencontainers.image.description="Objectifs, projets, charge mentale — outil personnel de pilotage"

RUN apt-get update && apt-get install -y --no-install-recommends tzdata ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /app /app
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
