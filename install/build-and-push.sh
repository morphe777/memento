#!/bin/bash
# Build the Mémento image and push it to Docker Hub (morphe777/memento), tagged with the version and latest.
# H-17: only from a clean commit tagged vVERSION (CI green), so every image matches one tagged commit.
set -e

DOCKER_USERNAME="morphe777"
REPO_NAME="memento"
BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Version read from the root package.json
VERSION=$(grep '"version"' "$(dirname "$0")/../package.json" | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
echo "🐳 Build & Push Mémento v${VERSION}"
echo "======================================="
echo "Image : $DOCKER_USERNAME/$REPO_NAME:$VERSION"
echo ""

if ! docker info &> /dev/null; then
    echo "❌ Docker non accessible"
    exit 1
fi

cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "❌ Modifications non commitées : commiter d'abord"
    exit 1
fi
if [ "$(git describe --exact-match --tags HEAD 2>/dev/null)" != "v$VERSION" ]; then
    echo "❌ Le commit courant n'a pas le tag v$VERSION (git tag v$VERSION, après une CI verte)"
    exit 1
fi

echo "🔨 Build de l'image..."
docker build \
    --build-arg VERSION="$VERSION" \
    --build-arg BUILD_DATE="$BUILD_DATE" \
    -t $DOCKER_USERNAME/$REPO_NAME:$VERSION \
    -t $DOCKER_USERNAME/$REPO_NAME:latest \
    .

if [ "$1" = "--no-push" ]; then
    echo "✅ Image construite (sans push) : $DOCKER_USERNAME/$REPO_NAME:$VERSION"
    exit 0
fi

echo "🔑 Login Docker Hub..."
docker login

echo "📤 Push vers Docker Hub..."
docker push $DOCKER_USERNAME/$REPO_NAME:$VERSION
docker push $DOCKER_USERNAME/$REPO_NAME:latest

echo ""
echo "✅ Image disponible :"
echo "   $DOCKER_USERNAME/$REPO_NAME:$VERSION"
echo "   $DOCKER_USERNAME/$REPO_NAME:latest"
