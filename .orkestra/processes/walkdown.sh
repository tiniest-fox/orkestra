#!/bin/bash
# ---
# description: >
#   Every walkdown record under this checkout's `.walkdowns/`, each on its own
#   live page that draws again on every save to the record. A record that fails
#   `walkdown check` keeps its last good page with the errors under it. A record
#   added while this is up is listed without a restart.
# page: true
# ---

# `walkdown serve` refuses a `.walkdowns/` that does not exist, and a checkout
# has none until its first record. An empty directory is invisible to git.
set -euo pipefail

mkdir -p .walkdowns
exec walkdown serve --port "$PORT"
