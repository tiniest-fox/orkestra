#!/bin/bash
# Worktree Cleanup Script
# =======================
# Runs automatically before Orkestra removes a git worktree.
# The worktree path is passed as the first argument ($1).
#
# This script runs from the main repo directory, not the worktree.
# Use $WORKTREE_PATH to reference the worktree being removed.
#
# If this script fails, removal still proceeds (cleanup failure never blocks removal).

set -e

WORKTREE_PATH="$1"
MAIN_REPO="$(pwd)"

# Example: remove symlinks or caches specific to this worktree
# rm -f "$WORKTREE_PATH/.env"
