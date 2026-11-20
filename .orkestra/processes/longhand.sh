#!/bin/bash
# ---
# description: >
#   A read-only browser over this checkout, each file drawn as a document, in
#   the working tree or as its change since the merge base with main. The open
#   file draws again on every save, so it never needs a restart for an edit.
# page: true
# ---

# It binds `127.0.0.1` alone.
set -euo pipefail

exec longhand serve --port "$PORT"
