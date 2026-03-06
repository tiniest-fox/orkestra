#!/bin/bash
# Orkestra service entrypoint.
#
# Configures git identity, optionally authenticates gh CLI, then starts
# ork-service. Project cloning is handled by ork-service itself via its API.

set -euo pipefail

# ============================================================================
# Git identity (required for agent commits within spawned daemons)
# ============================================================================

git config --global user.email "${GIT_USER_EMAIL:-orkestra@localhost}"
git config --global user.name "${GIT_USER_NAME:-Orkestra}"

# ============================================================================
# GitHub CLI + HTTPS git auth
# ============================================================================

if [ -n "${GH_TOKEN:-}" ]; then
    echo "$GH_TOKEN" | gh auth login --with-token 2>/dev/null || true
    git config --global url."https://${GH_TOKEN}@github.com/".insteadOf "https://github.com/"
fi

# ============================================================================
# Start service
# ============================================================================

echo "[entrypoint] Starting ork-service..."
exec ork-service \
    --bind 0.0.0.0 \
    --data-dir /data \
    --port "${SERVICE_PORT:-3847}"
