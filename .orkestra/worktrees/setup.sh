#!/bin/bash
# ---
# description: >
#   Installs this project's dependencies into a fresh worktree, so that the
#   checks a step declares have something to run against. Runs once, before the
#   composer's turn.
# timeout_seconds: 300
# reaches: local
# ---

# A `git worktree` is a checkout, not a copy: it has the tracked files and
# nothing else, so `node_modules` is absent and `pnpm verify` — which is what
# `checks/verify.sh` runs — fails on the first import rather than on the work.
#
# `install` rather than a symlink to the parent's `node_modules`: a step is
# allowed to change dependencies, and a shared directory would make that change
# leak into the checkout the human is sitting in. pnpm's store makes the copy
# hardlinks, so the cost is much closer to a link than to a download.
set -euo pipefail

exec pnpm install --frozen-lockfile --prefer-offline
