#!/bin/bash
# Worktree Cleanup Script
# =======================
# This script runs automatically before a git worktree is removed.
# The worktree path is passed as the first argument: $1
#
# Note: This script runs from the main repo directory, not the worktree.
# Use $1 or $WORKTREE_PATH to reference the worktree being removed.

set -e

WORKTREE_PATH="$1"

# ---------------------------------------------------------------------------
# Remove symlinks created by worktree_setup.sh
# ---------------------------------------------------------------------------
# These point to the main repo's build artifacts. Remove them before the
# worktree directory is deleted so rm -rf doesn't follow symlinks.

if [ -L "$WORKTREE_PATH/target" ]; then
    rm "$WORKTREE_PATH/target"
    echo "Removed target/ symlink"
fi

if [ -L "$WORKTREE_PATH/dist" ]; then
    rm "$WORKTREE_PATH/dist"
    echo "Removed dist/ symlink"
fi

echo "Worktree cleanup complete: $WORKTREE_PATH"
