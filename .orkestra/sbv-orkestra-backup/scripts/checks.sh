#!/bin/bash
# Checks Script
# =============
# Runs automatically after an agent completes a stage with a gate.
# Customize this script for your project's build, lint, and test commands.
#
# Environment variables available:
#   ORKESTRA_PROJECT_ROOT  - Path to the project root
#   ORKESTRA_TASK_ID       - ID of the current task
#   ORKESTRA_TASK_TITLE    - Title of the current task
#   ORKESTRA_BRANCH        - Git branch for the task
#   ORKESTRA_BASE_BRANCH   - Base branch the task branched from
#   ORKESTRA_WORKTREE_PATH - Absolute path to the task's git worktree
#   ORKESTRA_PARENT_ID     - Parent task ID (only set for subtasks)
#
# Exit 0 for success (task advances), non-zero for failure (agent retries).

set -e

# Example: Run your project's test suite
# cargo test
# npm test
# pytest

echo "No checks configured — edit .orkestra/scripts/checks.sh for your project"
