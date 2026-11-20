#!/bin/bash
# ---
# description: >
#   The atelier gallery for this checkout: every study and proof under
#   `.atelier/`, with its control panel. It reloads on any change to a design,
#   so it never needs a restart for one. `atelier dev` run while this is up
#   prints this gallery's URL and exits.
# page: true
# ready_seconds: 60
# ---

# `--port` binds exactly the port given, on `localhost` — `::1` alone on macOS and in a
# boat.dev sandbox, which the engine's readiness probe and the runner's tunnel both reach.
set -euo pipefail

exec atelier dev --port "$PORT"
