#!/bin/bash
# Worktree Setup Script
# =====================
# This script runs automatically when a new git worktree is created for a task.
# The worktree path is passed as the first argument: $1
#
# Use this for project-specific setup that new worktrees need, such as:
# - Copying environment files (.env)
# - Installing dependencies (npm/pnpm install)
# - Setting up local config files
# - Creating necessary directories
#
# Example usage:
#
#   WORKTREE_PATH="$1"
#
#   # Copy .env file if it exists in the main repo
#   if [ -f ".env" ]; then
#       cp .env "$WORKTREE_PATH/.env"
#       echo "Copied .env to worktree"
#   fi
#
#   # Install node dependencies
#   cd "$WORKTREE_PATH" && pnpm install
#
# Note: This script runs from the main repo directory, not the worktree.
# Use $1 or $WORKTREE_PATH to reference the new worktree location.

WORKTREE_PATH="$1"

# Install node dependencies using pnpm (fast with global cache)
echo "Installing node dependencies..."
cd "$WORKTREE_PATH" && pnpm install --frozen-lockfile

echo "Worktree setup complete: $WORKTREE_PATH"
