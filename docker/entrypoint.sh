#!/bin/bash
# Orkestra daemon entrypoint.
#
# Responsibilities:
#   1. Configure git identity for agent commits
#   2. Clone the project repo if not already present at PROJECT_ROOT
#   3. Authenticate gh CLI if GH_TOKEN is set
#   4. Start orkd

set -euo pipefail

PROJECT_ROOT="${ORKD_PROJECT_ROOT:-/project}"

# ============================================================================
# Git identity (required for agent commits)
# ============================================================================

git config --global user.email "${GIT_USER_EMAIL:-orkestra@localhost}"
git config --global user.name "${GIT_USER_NAME:-Orkestra}"

# Allow git to operate in the project directory (mounted volume ownership may differ)
git config --global --add safe.directory "$PROJECT_ROOT"
git config --global --add safe.directory "$PROJECT_ROOT/.orkestra/.worktrees/*" || true

# ============================================================================
# Project repo setup
# ============================================================================

if [ -n "${PROJECT_REPO_URL:-}" ]; then
    if [ ! -d "$PROJECT_ROOT/.git" ]; then
        echo "[entrypoint] Cloning $PROJECT_REPO_URL into $PROJECT_ROOT..."
        git clone "$PROJECT_REPO_URL" "$PROJECT_ROOT"
        echo "[entrypoint] Clone complete."
    else
        echo "[entrypoint] Project already cloned at $PROJECT_ROOT."
    fi
else
    if [ ! -d "$PROJECT_ROOT/.git" ]; then
        echo "[entrypoint] ERROR: PROJECT_ROOT ($PROJECT_ROOT) is not a git repo and PROJECT_REPO_URL is not set."
        echo "[entrypoint] Either mount a git repo at $PROJECT_ROOT or set PROJECT_REPO_URL."
        exit 1
    fi
fi

# ============================================================================
# GitHub CLI + HTTPS git auth
# ============================================================================

if [ -n "${GH_TOKEN:-}" ]; then
    # Authenticate gh CLI
    echo "$GH_TOKEN" | gh auth login --with-token 2>/dev/null || true
    # Rewrite github.com HTTPS URLs to use the token — lets agents push branches
    git config --global url."https://${GH_TOKEN}@github.com/".insteadOf "https://github.com/"
fi

# ============================================================================
# Start daemon
# ============================================================================

echo "[entrypoint] Starting orkd at $PROJECT_ROOT..."
exec orkd \
    --project-root "$PROJECT_ROOT" \
    --bind 0.0.0.0 \
    --port "${ORKD_PORT:-3847}"
