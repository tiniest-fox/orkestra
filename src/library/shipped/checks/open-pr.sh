#!/bin/bash
# ---
# description: >
#   Pushes this branch and opens the pull request described by the `pull-request`
#   document this step filed — or updates the one that is already open, so running
#   it twice leaves one pull request rather than two. **An effect, never a check:**
#   under `checks:` it would run before the gate and send a body nobody approved.
#   Non-zero means it could not do it and nothing was sent — no document, no title
#   in it, `gh` missing or unauthenticated, the push refused, or this branch's
#   newest pull request closed without merging. A merged one is history: the
#   branch's next pull request is a fresh one. On success it prints the URL and
#   whether it opened or updated it.
# timeout_seconds: 180
# ---

# The one script here that acts outside the checkout, so what it prints is the
# only record that it did. `EffectsRan` keeps this output where a passing check's
# is thrown away, and the drawer draws it with the time it ran — which is why
# every exit path below says what happened in a line a person can read, and why
# the tools' own chatter is captured and shown only when it is the explanation.
#
# **Nothing is passed in** but one optional variable. Everything else it reads is in
# the directory it runs in: the branch, and `.orkestra/.trak/`, which `RunEffects`
# rebuilds before this runs so the document the step just filed is on disk. That
# rebuild is the whole reason an effect can read its own step's artifact and a check
# cannot. `ORKESTRA_TARGET_BRANCH` is the branch the pull request goes into, set by
# the engine only for a trak whose goal has a goal branch; unset, the forge's default
# branch is the base, as `gh` picks it.
#
# **Idempotent by construction, because a restart re-issues it.** Existence is
# asked of the forge rather than remembered here: a pull request somebody closed
# by hand, or opened by hand before this ever ran, is found by the same question.
# The thing that must never happen is two open pull requests for one branch, and
# `git push` is a no-op when there is nothing to push. A branch may hold several
# pull requests one after another — once one merges, work added later goes into a
# fresh one — so the question is always about the newest.
set -uo pipefail

TRAK_DIR=".orkestra/.trak"

# What the step filed, as `<position>-pull-request.md`. Everything else under
# there belongs to another step.
GLOB="*-pull-request.md"

# stdout, not stderr, and the sentence before the details: `report()` in
# `checks-shell.ts` puts stderr FIRST, so a message written there would be read
# ahead of the explanation for it.
fail() {
  printf '%s\n' "$1"
  if [ -n "${2:-}" ]; then printf '\n%s\n' "$2"; fi
  exit 1
}

# ----------------------------------------------------------------------------
# The document
# ----------------------------------------------------------------------------

shopt -s nullglob
docs=("$TRAK_DIR"/$GLOB)
if [ ${#docs[@]} -eq 0 ]; then
  fail "No $TRAK_DIR/$GLOB — this branch has no pull-request document to send.

open-pr belongs on the effects: of an agent whose artifact IS the pull request
body. On any other agent there is nothing here for it to read."
fi

# The highest position wins: a re-plan can put a second `pull-request` step after
# the first, and the later document is the current one. Sorted on the position as
# a number rather than as text, so 10 comes after 9 — and a spawn child's `2.1-`
# still sorts by its parent's position, which is the order those ran in.
doc="$TRAK_DIR/$(printf '%s\n' "${docs[@]}" | sed 's|.*/||' | sort -t- -k1,1n | tail -1)"

# `## ` headings, with fenced blocks skipped — a body carrying a diff or a shell
# snippet can legitimately hold a line starting with `## `, and a naive match
# would cut the document there.
section_title() {
  awk '
    /^```/ { fence = !fence; next }
    !fence && /^## / { on = ($0 == "## Title"); next }
    on { print }
  ' "$doc"
}

section_body() {
  awk '
    /^```/ { fence = !fence; if (!on) print; next }
    !fence && /^## / { on = ($0 == "## Title") }
    !on { print }
  ' "$doc"
}

# First non-blank line, trimmed. The section is specified as one line; taking the
# first rather than joining them means a second paragraph is dropped visibly in
# the pull request rather than smuggled into the title.
title=$(section_title | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | grep -v '^$' | head -1)
if [ -z "$title" ]; then
  fail "$doc has no '## Title' section with anything in it, so there is no title
to open a pull request under. The section is required and holds one line."
fi

body_file=$(mktemp "${TMPDIR:-/tmp}/open-pr.XXXXXX") ||
  fail "Could not write a temporary file for the pull request body."
trap 'rm -f "$body_file"' EXIT
section_body >"$body_file"

# ----------------------------------------------------------------------------
# The branch
# ----------------------------------------------------------------------------

branch=$(git rev-parse --abbrev-ref HEAD 2>&1)
if [ $? -ne 0 ] || [ "$branch" = "HEAD" ]; then
  fail "Not on a branch, so there is nothing to open a pull request from." "$branch"
fi

# Captured and shown only if it fails: a successful push writes a page of remote
# progress to stderr, and that would be read ahead of the URL every time.
push=$(git push --set-upstream origin "$branch" 2>&1)
if [ $? -ne 0 ]; then
  fail "Could not push $branch, so nothing was sent." "$push"
fi

# ----------------------------------------------------------------------------
# Create, or update
# ----------------------------------------------------------------------------

# `gh pr list` rather than `gh pr view`: view exits non-zero BOTH when there is no
# pull request and when gh cannot reach the forge at all, and telling those apart
# by reading its message is a contract that breaks on an upgrade. `list` exits 0
# with an empty result for the first and non-zero only for the second — which is
# the difference between *open one* and *stop, this project's script could not do
# it*. The jq expression is gh's own, so nothing here depends on jq being
# installed.
#
# Every pull request the branch has had, as `<number> <state> <url>`, and the
# newest by number taken here rather than trusted to gh's ordering: after a merge
# the branch holds a merged one and the open one that followed it, and editing
# the merged one would send this body nowhere anyone reads.
found=$(gh pr list --head "$branch" --state all --limit 100 \
  --json number,state,url --jq '.[] | "\(.number) \(.state) \(.url)"' 2>&1)
if [ $? -ne 0 ]; then
  fail "Could not ask whether $branch already has a pull request, so nothing was sent." "$found"
fi

newest=$(printf '%s\n' "$found" | grep -v '^$' | sort -n -k1,1 | tail -1)
rest=${newest#* }
state=${rest%% *}
url=${rest#* }

base=()
if [ -n "${ORKESTRA_TARGET_BRANCH:-}" ]; then
  base=(--base "$ORKESTRA_TARGET_BRANCH")
fi

# Closed without merging is somebody's decision about this work, so nothing here
# overrides it. Merged is not: GitHub cannot reopen a merged pull request, and the
# commits after it need a new one. That holds even where the merge landed after
# the branch was last moved and the branch still carries the squashed commits —
# the new pull request then shows them again, and a person trims it on the forge.
if [ "$state" = "CLOSED" ]; then
  fail "$branch's newest pull request was closed without merging, so this body was not sent.

  $url

Take the body from $doc and open a pull request by hand if this work should
still go in."
fi

if [ "$state" = "OPEN" ]; then
  out=$(gh pr edit "$url" ${base[@]+"${base[@]}"} --title "$title" --body-file "$body_file" 2>&1)
  if [ $? -ne 0 ]; then
    fail "Could not update the pull request at $url." "$out"
  fi
  printf 'Updated %s\n' "$url"
else
  out=$(gh pr create --head "$branch" ${base[@]+"${base[@]}"} --title "$title" --body-file "$body_file" 2>&1)
  if [ $? -ne 0 ]; then
    fail "Could not open a pull request for $branch." "$out"
  fi
  # gh prints the URL it created; anything else it said is progress noise.
  url=$(printf '%s' "$out" | grep -o 'https://[^[:space:]]*' | tail -1)
  printf 'Opened %s\n' "${url:-$out}"
fi

printf 'Title: %s\n' "$title"
printf 'From:  %s\n' "$doc"
