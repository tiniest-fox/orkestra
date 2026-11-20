#!/bin/bash
# ---
# description: >
#   The simulated engine: the whole app over a temporary project, with every agent turn
#   scripted, so pressing anything spends nothing and nothing reaches this checkout's
#   `.orkestra/.database/`. Each boot seeds a fresh copy of every catalog state; it is
#   seeded once `process_logs` shows `sim: ready`. The `sim` skill says what it seeds.
#   Builds `client/dist` first when the bundle is missing or older than its sources.
# page: true
# ready_seconds: 240
# ---

set -euo pipefail

# The sources `src/app/client-bundle.ts` compares the bundle against, so the page shows
# this branch's client rather than whatever was built last.
built=client/dist/index.html
if [[ ! -f $built ]] ||
  [[ -n $(find client/src client/public client/*.html shared/src -newer "$built" -print -quit) ]]; then
  pnpm --filter @orkestra/client build
fi

exec pnpm sim
