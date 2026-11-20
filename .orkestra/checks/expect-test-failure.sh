#!/bin/bash
# ---
# description: >
#   Inverted — passes only when at least one test FAILS. Attach to a step whose
#   deliverable is a test demonstrating a bug, so "I wrote a failing test" is
#   enforced rather than claimed. A green suite means the bug was not
#   demonstrated, and this check says so.
# timeout_seconds: 300
# ---

# The whole point is the inversion, so the exit codes are swapped deliberately
# rather than by accident: `vitest run` exits non-zero when something fails,
# which is exactly the state this step is supposed to leave the repository in.
#
# Known imprecision, accepted for now: vitest also exits non-zero on a
# compilation error or on finding no tests at all, and neither is a demonstrated
# bug. Distinguishing them means parsing vitest's output, which is a contract
# that would break on an upgrade — whereas a step that leaves the repo unable to
# compile is going to fail its review anyway.
#
# **Only the test files this branch added or changed, by file, in the suite each
# belongs to.** The step's deliverable is a test it wrote, so that is the question;
# the whole root suite takes longer than this check's timeout on a small sandbox, and
# a test already failing on the default branch would pass the check for a step that
# wrote nothing. The suites are still three — `pnpm test` at the root scopes itself
# to `src/**` and `test/**`, and `client/` and `desktop/` each keep their own config —
# because a bug in a `.tsx` component can only be demonstrated by a client test, and
# one in the shell's native views only by a desktop test. A file is handed to its own
# suite, relative to that package. A branch that changed no test file has
# demonstrated nothing, and is told so.
#
# `&&` short-circuits, which is the inversion working: any suite going red
# makes the condition false and the check pass, and whichever one failed is the
# last thing that ran.
#
# **No suite's output is shown, in either direction.** Failing, it is the
# thing this check wanted and nobody has to read it; passing, it is green
# tests confirming the one thing that is the problem. What the step is owed is
# the sentence below, and a run that prints a page ahead of it buries it — see
# `verify.sh`, which makes the same argument at length. Naming each suite as it
# starts and again if it got through is the exception that argument allows: a
# command per line, and without them nothing reaches a gate's console at all
# until the whole check has exited, which for two full suites is minutes.
set -uo pipefail

# Which suite is running, and which one got through.
#
# **On stdout, and that is the whole point** — Orkestra shows a check's stdout
# while the check is still running and holds its stderr until the process exits,
# so this is the only stream that reaches a gate's console live, and it stays
# there afterwards above whichever of the two messages below the run settled on.
# It is also how the reader tells WHICH suite went red: `&&` short-circuits, so
# the failing one is the announced suite with no `✓` under it.
#
# No durations. These lines are part of a stored failure, ahead of the message
# below, and `check-progress.ts` compares one failure's text to the last to decide
# whether the agent is repeating itself — see the same rule in `verify.sh`.
began() {
  printf '→ %s\n' "$*"
}

passed() {
  printf '✓ %s\n' "$*"
}

# What a person running this by hand needs and a captured run does not: the
# announcements above say a suite is running, not what it is finding. Nothing
# reaches stderr when stderr is not a terminal, which keeps a stored failure to
# the stage record and the message below.
quiet() {
  if [ -t 2 ]; then "$@" >&2; else "$@" >/dev/null 2>&1; fi
}

suite() {
  began "$*"
  quiet "$@" || return 1
  passed "$*"
}

# Where the branch began — the same base `check-stages.ts` measures from: its merge
# base with the commit the checkout was cut from, `ORKESTRA_BASE_COMMIT`, where this
# checkout holds it, and otherwise where it left the default branch.
base() {
  local default
  if [ -n "${ORKESTRA_BASE_COMMIT:-}" ] && git cat-file -e "$ORKESTRA_BASE_COMMIT^{commit}" 2>/dev/null &&
    git merge-base HEAD "$ORKESTRA_BASE_COMMIT" 2>/dev/null; then
    return
  fi
  default=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null) || default=origin/main
  git merge-base HEAD "$default" 2>/dev/null || git merge-base HEAD main 2>/dev/null || echo HEAD
}

# Committed since the base, edited and not committed, and new and not yet added.
changed_tests() {
  {
    git diff --name-only --diff-filter=AMR "$(base)" -- '*.test.ts' '*.test.tsx'
    git ls-files --others --exclude-standard -- '*.test.ts' '*.test.tsx'
  } | sort -u
}

# A `read` loop, not `mapfile`, which bash 3.2 does not have.
changed=()
while IFS= read -r file; do changed+=("$file"); done < <(changed_tests)
root=() client=() desktop=()
for file in ${changed[@]+"${changed[@]}"}; do
  case "$file" in
    client/*) client+=("${file#client/}") ;;
    desktop/*) desktop+=("${file#desktop/}") ;;
    *) root+=("$file") ;;
  esac
done

if [ "${#changed[@]}" -eq 0 ]; then
  echo "This branch added or changed no test file, so nothing here demonstrates the bug."
  echo "This step owes a test that FAILS because of the cause you found."
  echo "Write it, commit it, and do not fix the code — the fix is the next step."
  exit 1
fi

# A suite with no file of this branch's is skipped, which counts as getting through.
if { [ "${#root[@]}" -eq 0 ] || suite pnpm test "${root[@]}"; } &&
  { [ "${#client[@]}" -eq 0 ] || suite pnpm --filter @orkestra/client test "${client[@]}"; } &&
  { [ "${#desktop[@]}" -eq 0 ] || suite pnpm --filter @orkestra/desktop test "${desktop[@]}"; }; then
  echo "Every test this branch added or changed passes, so nothing here demonstrates the bug."
  echo "This step owes a test that FAILS because of the cause you found."
  echo "Write it, commit it, and do not fix the code — the fix is the next step."
  exit 1
fi

echo "At least one test this branch added or changed fails, which is what this step was for."
exit 0
