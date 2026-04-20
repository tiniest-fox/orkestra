#!/bin/bash
# Docs Checks Script
# ==================
# Gate script for the docs write and component build stages.
# Runs Biome, Knip, and Astro type checks on the docs site.
#
# Environment variables available:
#   ORKESTRA_PROJECT_ROOT  - Path to the project root
#   ORKESTRA_WORKTREE_PATH - Absolute path to the task's git worktree

set -e

cd "$ORKESTRA_WORKTREE_PATH/docs"
pnpm install
pnpm check
pnpm knip
pnpm typecheck
