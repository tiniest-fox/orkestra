#!/bin/bash
# Worktree Setup Script
# =====================
# Runs automatically when Orkestra creates a new git worktree for a task.
# The worktree path is passed as the first argument ($1).
#
# This script runs from the main repo directory, not the worktree.
# Use $WORKTREE_PATH to reference the new worktree location.

set -e

WORKTREE_PATH="$1"
MAIN_REPO="$(pwd)"

# Example: copy .env file into the worktree
# cp "$MAIN_REPO/.env" "$WORKTREE_PATH/.env"
