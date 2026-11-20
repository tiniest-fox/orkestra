#!/bin/bash
# ---
# description: >
#   The light tier of `verify`: formatting, types, lint and dead code, each only for
#   the projects a changed file reaches, docs, and only
#   the tests that import a file changed since it last passed in this checkout — or
#   since the branch began, where it has not — no builds and no full suites. A test
#   that starts a Docker container runs only when a file it tests changed.
#   Attach to every step that changes files under src/, test/, client/ or desktop/,
#   review included: the full tier runs on GitHub. It names each stage as it passes, and
#   each test stage with how many test files ran; on failure it adds the failing
#   command's own complaint and nothing else about it — for a failing test stage, each
#   failing test's file, name, assertion, first stack line and capped console output,
#   with the command that runs it again.
# timeout_seconds: 900
# exclusive: true
# ignores_linguist_generated: true
# units: vitest
# cache_across: os
# fingerprint: [git, sh, sleep, bash, cat, tar, pwd]
# ---

# One script with two tiers rather than two copies of the stage list: `verify.sh` reads
# the tier, and everything else about a run — the report and the noise it drops —
# stays in one place.
ORKESTRA_VERIFY_TIER=light exec bash "$(dirname "$0")/verify.sh"
