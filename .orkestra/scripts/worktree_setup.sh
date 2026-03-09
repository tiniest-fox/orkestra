#!/bin/bash
# Worktree Setup Script
# =====================
# This script runs automatically when a new git worktree is created for a task.
# The worktree path is passed as the first argument: $1
#
# Note: This script runs from the main repo directory, not the worktree.
# Use $1 or $WORKTREE_PATH to reference the new worktree location.

set -e

WORKTREE_PATH="$1"
MAIN_REPO="$(pwd)"

# ---------------------------------------------------------------------------
# Symlink shared build artifact directories
# ---------------------------------------------------------------------------
# Cargo's target/ is ~27GB and nearly identical across worktrees. Sharing via
# symlink avoids duplicating gigabytes of build artifacts per task. Cargo's
# file-level locking (target/.cargo-lock) serializes concurrent builds safely.

# target/ symlink (Cargo build artifacts)
if [ ! -e "$WORKTREE_PATH/target" ]; then
    ln -s "$MAIN_REPO/target" "$WORKTREE_PATH/target"
fi
echo "target/ -> $(readlink "$WORKTREE_PATH/target")"

# dist/ symlink (frontend build output — only if main repo already has it)
if [ -d "$MAIN_REPO/dist" ] && [ ! -e "$WORKTREE_PATH/dist" ]; then
    ln -s "$MAIN_REPO/dist" "$WORKTREE_PATH/dist"
    echo "dist/ -> $(readlink "$WORKTREE_PATH/dist")"
fi

# node_modules/ symlink (frontend dependencies)
# Share the main repo's node_modules rather than running pnpm install in the
# worktree. Running pnpm inside a worktree that sits inside the pnpm workspace
# root (/workspace) causes ELOOP errors — pnpm follows its own virtual-store
# symlinks into a cycle. Same pattern as target/: one shared copy, no duplication.
# If package.json changes, the agent can run `pnpm install` from the main repo.
if [ -d "$MAIN_REPO/node_modules" ] && [ ! -e "$WORKTREE_PATH/node_modules" ]; then
    ln -s "$MAIN_REPO/node_modules" "$WORKTREE_PATH/node_modules"
    echo "node_modules/ -> $(readlink "$WORKTREE_PATH/node_modules")"
fi

echo "Worktree setup complete: $WORKTREE_PATH"
