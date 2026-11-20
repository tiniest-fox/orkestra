#!/bin/bash
# ---
# description: >
#   Runs everything `pnpm verify` runs — formatting, types, lint, dead code,
#   docs, all three test suites and both builds — stopping at the first failure.
#   The full tier, which CI runs on every pull request and no step here
#   attaches: `verify-light` is the tier for every step that changes files,
#   review included. It names each stage as it passes, and each test stage with
#   how many test files ran; on failure it adds the failing command's own
#   complaint and nothing else about it — for a failing test stage, each
#   failing test's file, name, assertion, first stack line and capped console
#   output, with the command that runs it again.
# timeout_seconds: 900
# exclusive: true
# ignores_linguist_generated: true
# units: vitest
# cache_across: os
# fingerprint: [git, sh, sleep, bash, cat, tar, pwd]
# ---

# **The budget is set against a busy machine, not an idle one.** It was 300s, and the
# machine that runs this is also running the person's `pnpm ui` and every other trak
# in parallel — so the same stages, all passing, came in either side of that
# number depending only on what else was in flight. What it timed out on was the load,
# and the step it sent back had nothing to fix.
#
# **And it runs alone.** `exclusive: true` queues it behind any other trak's `verify` or
# `verify-light` in this engine, and the 900s counts from its turn. A run in a trak's
# sandbox does not queue, because no other trak's check runs on that machine. Every
# stage already takes all the cores it is given, so overlapping runs bought no throughput: from 2026-10-15 to 2026-10-22 a
# run with no other beside it took a median 211s and one beside four or more took 720s.
#
# So the number is not this chain's cost plus a margin, which is the version that
# produces exactly that failure. It is loose enough that only a stage which is not
# going to finish reaches it — a suite hung on a process that never answers is what a
# timeout here is actually for.
#
# `pnpm verify` chains every stage and only the one that failed is worth reading. This
# hands the chain to the engine's stage runner, which the engine passes every check as
# `ORKESTRA_STAGES`: it reads each script from package.json at each run, so the stages
# cannot drift from the chain, and prints of what the tools themselves say ONLY the failing
# stage's output — what a human at the gate and the agent both read, because the engine
# cuts only at a backstop far above it. Each stage is named as it passes, and each test
# stage as it starts too, which is the only thing in a gate's console while this runs.
set -uo pipefail

# Which stages run: `full`, unless `verify-light.sh` says `light`. A variable rather
# than an argument, because Orkestra's check runner invokes a check with no arguments.
# `${…:-}` and not a bare reference: `set -u` above exits on an unset variable.
#
# The browser tier is in neither. It runs on GitHub, which is the only place it ran
# reliably: on a machine also running every other trak's suite, five full runs in six
# timed a different page load out.
TIER="${ORKESTRA_VERIFY_TIER:-full}"

# Which half of the full tier runs: `all`, or the `engine` half — the static stages
# and the engine's suite — or the `apps` half — the client and the desktop package.
# GitHub runs the two halves as parallel jobs, which is the only reason this exists;
# the split lives here rather than in the workflow so the stage list stays in one file.
# `all` runs both. Not an `ORKESTRA_` name: the engine strips its own from every script it
# starts, and on GitHub `pnpm ork proofs run` is what starts this one.
PART="${VERIFY_PART:-all}"
case "$TIER/$PART" in
  full/all | full/engine | full/apps | light/all) ;;
  *)
    printf 'VERIFY_PART=%s is not a part of the %s tier. It takes all, engine or apps, and only the full tier splits.\n' "$PART" "$TIER"
    exit 1
    ;;
esac

# Which slice of the engine's suite runs, as vitest's `--shard` writes it — `1/2` — or
# empty for all of it. A caller that runs the engine half as parallel slices sets it; the
# static stages run in the first slice alone, and `test/support/durations-sequencer.ts` decides
# which files each slice takes. Unset at once, so the checks the suite's own tests start
# do not inherit it.
SHARD="${VERIFY_SHARD:-}"
unset VERIFY_SHARD
case "$TIER/$PART/$SHARD" in
  */*/ | full/engine/[1-9]/[1-9]) ;;
  *)
    printf 'VERIFY_SHARD=%s does not apply to part %s of the %s tier. Only the engine part of the full tier takes one, as index/count.\n' "$SHARD" "$PART" "$TIER"
    exit 1
    ;;
esac

# **Every test stage runs through the engine's stage runner**, which the engine hands every
# check as `ORKESTRA_STAGES`. It leaves out the files `ORKESTRA_UNITS_PROVEN` lists — those
# any check labelled `vitest` already proved on exactly this tree, or whose print still
# holds — appends each file that passes to `ORKESTRA_UNITS_OUT` as it finishes, lists the
# recording setup file under `fingerprint:`, and prints the stage's pass line or its report
# on each failing test. On GitHub `pnpm ork proofs run` in
# `checks.yml` hands the list over, and a refused read fails that job rather than running
# every file. A bare run, as GitHub's other `verify.sh` steps are, takes this checkout's own
# runner; with neither unit variable set, every suite runs whole. The runner splits each
# command on spaces, so no word passed it may hold one — a path from this checkout holds
# none.
#
# `cache_across: os` because no test here depends on the architecture, so a proof made on
# one is found on the other; a print is kept by the architecture whatever this says. A
# proof made on macOS stays separate, because the process tests depend on the OS.
ROOT=$PWD
STAGES="${ORKESTRA_STAGES:-$ROOT/src/check-stages.ts}"

# A root script as a light-tier stage, where any changed file reaches a project.
reaching_any() {
  if [ -n "$REACHED" ]; then
    STATIC+=("pnpm $1")
  else
    printf -- '– pnpm %s, not run: no changed file reaches a project\n' "$1"
  fi
}

# **The light tier runs each static stage only for the projects a changed file can
# reach**, and imports decide what reaches what: `desktop/src/main.ts` and
# `client/e2e/app.spec.ts` import the engine's `src/`, and every project imports `shared/`.
# A relative import from one project into another that this does not map fails
# `verify-light.test.ts`. A path on no row here reaches every project, so a
# file nobody listed — `package.json`, the lockfile, a tsconfig, `.oxlintrc.json`,
# `knip.json` — never narrows the run. Markdown outside every project reaches none: it
# is only `docs:check`'s, which always runs. The full tier reads none of this.
PROJECTS=(engine shared client desktop)

reach_of() {
  case $1 in
    shared/*) printf '%s\n' "${PROJECTS[@]}" ;;
    src/*) printf '%s\n' engine client desktop ;;
    test/*) printf '%s\n' engine desktop ;;
    client/*) printf '%s\n' client ;;
    desktop/*) printf '%s\n' desktop ;;
    *.md) ;;
    *) printf '%s\n' "${PROJECTS[@]}" ;;
  esac
}

# The project a directory a `check` or `lint` command names belongs to; `.` is the root
# tsconfig, which tsc reads when it is given no `-p`.
project_of() {
  case $1 in
    . | src | test) printf '%s\n' engine ;;
    shared | client | desktop) printf '%s\n' "$1" ;;
    *) return 1 ;;
  esac
}

# The projects the changed files on the argument reach, one a line, in `PROJECTS` order.
reached() {
  local path all= project
  while IFS= read -r path; do
    [ -n "$path" ] && all+=$(reach_of "$path")$'\n'
  done <<<"$1"
  for project in "${PROJECTS[@]}"; do
    if grep -qxF "$project" <<<"$all"; then printf '%s\n' "$project"; fi
  done
}

# Whether any changed file on the argument reaches a project. One that reaches none is
# markdown outside every project, which no test imports; a test that reads one off disk
# has a `reads:` row, whose readers the runner has already added to the list.
reaching() {
  [ -n "$(reached "$1")" ]
}

# The projects one command of a chained script checks, from the directories it names and,
# for tsc without `-p`, the root. Nothing when it names none, or is more than a plain
# command, and the caller then runs the whole script.
command_projects() {
  local words word found= named=no
  case $1 in *[\;\|\&\<\>\`\$\(]*) return ;; esac
  read -r -a words <<<"$1"
  # `${a[@]+…}` throughout: bash 3.2, which macOS ships as `/bin/bash`, reads an empty
  # array as unbound under `set -u`.
  for word in ${words[@]+"${words[@]}"}; do
    found+=$(project_of "$word")$'\n'
    case $word in -p | --project) named=yes ;; esac
  done
  # A loop rather than `printf | grep -q`: under `pipefail`, `grep -q` leaving at `-p`
  # can kill `printf` before it writes the path, and the failed pipe read as no `-p`.
  if [ "${words[0]:-}" = tsc ] && [ $named = no ]; then
    found+=$(project_of .)$'\n'
  fi
  printf '%s' "$found" | grep -v '^$' | sort -u
}

# The root `check` or `lint` script as light-tier stages, added to `STATIC`: split into the
# commands it chains with ` && `, keeping the ones that check a reached project, each a
# stage the runner names by its own text. Read from package.json at each run, so the
# commands cannot drift from the script. Where every command is kept, or one names no
# project, the script runs whole.
narrowed() {
  local script=$1 text commands=() command projects kept=() dropped=no
  if [ -z "$REACHED" ]; then
    printf -- '– pnpm %s, not run: no changed file reaches a project\n' "$script"
    return
  fi
  text=$(node -p "require('./package.json').scripts['$script']" 2>/dev/null) || text=
  # A `read` loop, not `mapfile`, which bash 3.2 does not have.
  while IFS= read -r command; do commands+=("$command"); done < <(printf '%s\n' "${text// && /$'\n'}")
  for command in ${commands[@]+"${commands[@]}"}; do
    projects=$(command_projects "$command")
    if [ -z "$projects" ]; then
      dropped=unknown
      break
    fi
    if grep -qxF -f <(printf '%s\n' "$REACHED") <<<"$projects"; then
      kept+=("$command")
    else
      dropped=yes
    fi
  done
  if [ "$dropped" != yes ]; then
    STATIC+=("pnpm $script")
  elif [ ${#kept[@]} -eq 0 ]; then
    printf -- '– pnpm %s, not run: no changed file reaches a project it checks\n' "$script"
  else
    STATIC+=("${kept[@]}")
  fi
}

# The light tier. **Its tests are the stage runner's `--related` selection**: each test file
# that imports what changed since this check last passed here, or since the branch began
# where it has not, or that `verify.select.yaml`'s `reads:` names as a reader of it, less
# the real-container tests its `held_back:` holds back. The runner's `--list-changed` is the
# same list, which narrows the static stages, all started together and read in chain order.
# A step that changed only documents starts neither suite, and that is a pass. Prints do not
# replace this selection, so `verify` and `verify-light` stay two checks: on the same edits,
# every file run under prints was slower than this on all but one, because recording costs
# time and the `fingerprints*.test.ts` files, which are never skipped on their print, run
# every time.
if [ "$TIER" = light ]; then
  SELECT=.orkestra/checks/verify.select.yaml
  if CHANGED=$(node "$STAGES" --list-changed --select "$SELECT"); then
    REACHED=$(reached "$CHANGED")
  else
    CHANGED= REACHED=$(printf '%s\n' "${PROJECTS[@]}")
  fi
  STATIC=()
  reaching_any fmt:check
  narrowed check
  narrowed lint
  reaching_any knip
  STATIC+=("pnpm docs:check")
  for app in client desktop; do
    if grep -qxF "$app" <<<"$REACHED"; then
      STATIC+=("pnpm --filter @orkestra/$app check")
    else
      printf -- '– pnpm --filter @orkestra/%s check, not run: no changed file reaches %s\n' "$app" "$app"
    fi
  done
  SUITES=('pnpm test' 'pnpm --filter @orkestra/client test')
  TESTED=("${SUITES[@]}")
  if [ -n "$CHANGED" ] && [ -z "$REACHED" ]; then TESTED=(); fi
  node "$STAGES" --parallel --related --select "$SELECT" "${STATIC[@]}" ${TESTED[@]+"${TESTED[@]}"} || exit 1
  if [ ${#TESTED[@]} -eq 0 ]; then
    printf -- '– %s, not run: no changed file is code a test can import\n' "${SUITES[@]}"
  fi
  printf 'Light tier: each static stage only for the projects a changed file reaches, only the tests that import what changed since this check last passed here, real-container tests only where a file they test changed, and no builds. The `verify` check runs the rest.\n'
  exit 0
fi

# The full tier, as the runner resolves each command through package.json. The engine part
# copies the head of the root chain, because only its first slice runs the static stages.
# How long each of the engine's test files and tests took goes to the file
# `TEST_DURATIONS_OUT` names, for the artifact CI uploads and the release's slices, and
# never into this output. The apps' suites record none: their words would reach the last
# part of each `verify` chain, its build.
TESTS="pnpm test${SHARD:+ --shard=$SHARD}${TEST_DURATIONS_OUT:+ --reporter=$ROOT/test/support/durations-reporter.ts}"
case $PART in
  all) exec node "$STAGES" --parallel 'pnpm verify' ;;
  engine)
    if [ -n "${SHARD%%/*}" ] && [ "${SHARD%%/*}" != 1 ]; then exec node "$STAGES" "$TESTS"; fi
    exec node "$STAGES" --parallel \
      'pnpm fmt:check' 'pnpm check' 'pnpm lint' 'pnpm knip' 'pnpm docs:check' "$TESTS"
    ;;
  apps) exec node "$STAGES" 'pnpm --filter @orkestra/client verify' 'pnpm --filter @orkestra/desktop verify' ;;
esac
