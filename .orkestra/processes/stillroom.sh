#!/bin/bash
# ---
# description: >
#   Every stillroom experiment under this checkout's `.experiments/`, from one
#   port: an index at `/` and each experiment's read-only page under `/<name>/`.
#   It reads the folders on every request, so a new run or a new experiment
#   shows on a reload without a restart.
# page: true
# ---

# With no experiment named, `stillroom open` serves them all and accepts a
# checkout that has none yet. It binds `127.0.0.1` alone.
set -euo pipefail

exec stillroom open --port "$PORT"
