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

echo "Worktree setup complete: $WORKTREE_PATH"

# ---------------------------------------------------------------------------
# Warm the rust-analyzer index in the background
# ---------------------------------------------------------------------------
# cargo check populates the compiled metadata that rust-analyzer needs to index
# quickly. Run in the background so worktree setup doesn't block; by the time
# the agent invokes its first LSP operation, indexing is typically complete.
# target/ is shared via symlink above, so subsequent worktrees pay a fraction
# of the cost of the first run.

(cd "$WORKTREE_PATH" && cargo check --workspace --message-format=json > /dev/null 2>&1) &
echo "rust-analyzer index warm-up started in background (pid $!)"
