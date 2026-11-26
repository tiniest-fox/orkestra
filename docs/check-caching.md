# Check caching

How the engine avoids running a check, or part of one, that has already answered. It
applies only to scripts named under an agent's `checks:`; an effect or a condition runs
every time. Every header key named here is listed in [checks.md](checks.md).

Three records do the skipping, each finer than the one before:

| Record | Kept under | Skips | Set up with |
|---|---|---|---|
| a **pass** | the tree, the script's text, the check's name, the platform part | the whole check | nothing: `cache:` is `true` by default |
| a **unit proof** | the tree, the `units:` label, the platform part | each unit the check already proved on this tree | `units:`, and a script that reads and writes the unit files |
| a **print** | the `units:` label, the `fingerprint:` tools, the OS and the architecture | each test file whose recorded inputs are unchanged, on any tree | `fingerprint:`, with vitest run through the stage runner |

The engine keeps all three in the project's `.orkestra/.database/passes/`, on the machine
that ran the check. A record made in one trak's checkout counts in every other checkout
of the project on that machine that holds the same files.

## What "the same files" means

The **tree** is the checkout's files as git would hash them: tracked and untracked,
committed or not, with ignored files left out. Two checkouts holding the same files have
the same tree.

With `ignores_linguist_generated: true`, the files `.gitattributes` marks
`linguist-generated` are also left out, so a change to only those files keeps the tree.
The engine cannot check this promise: a script that reads one of those files passes on
content it never saw.

The **platform part** is the OS and the architecture under `cache_across: platform`, and
the OS alone under `cache_across: os`. Use `os` for a check whose answer does not change
between architectures, so a pass made on an Intel machine is found on an ARM one.

## Passes

Before it runs a check, the engine looks for a pass under the check's key. On a hit the
check does not run, and the step is accepted as if it had passed; the run names it as
reused. A reused `exclusive:` check never waits in the queue.

- **Only a pass is kept.** A failure runs again every time, because the agent sent back
  has to read output from the files it is fixing.
- **Editing the script discards its passes**, because the script's text is in the key.
  Renaming the check does too.
- **The key is taken before the run.** A check that writes files changes the tree, and
  its pass is kept under the tree it started on.
- **`cache: false` turns all of it off** for one check: no pass, no units, no prints. Use
  it for a check whose answer depends on the network, the clock or a tool's version.

An agent that runs a check during its own turn, through the `run_check` tool, records a
pass the same way. The pass is kept only when the tree is still the same once the check
finishes, since the agent may have edited files meanwhile. When the step then ends on
those files, the check is reused rather than run a second time.

`ORKESTRA_PASSED_TREE` is the tree this check last passed on in this checkout. It is
kept by the check's name, whatever the script said then. A script can use it to run only
what changed since that pass; the stage runner's `--related` flag does exactly this.

## Units

A **unit** is whatever piece of work a check can prove on its own: a test file, a
package, a page. `units: <label>` gives the check two files:

| Variable | What the script does with it |
|---|---|
| `ORKESTRA_UNITS_PROVEN` | reads it: the units already proven under this label on this tree and platform part, one per line. Skip them |
| `ORKESTRA_UNITS_OUT` | appends to it: each unit as it passes, one per line, the whole line and its newline in one write |

The engine never reads a unit; it is a string one run wrote and a later run reads back.
Write paths from the repository root, so two packages that share a path below their own
directories stay distinct. Write a unit only once it has passed: a unit that failed must
run again.

```bash
#!/bin/bash
# ---
# description: Lints each package. Fails when any package has a lint error.
# units: lint-package
# timeout_seconds: 600
# ---
set -uo pipefail
status=0
for pkg in packages/*/; do
  grep -qxF "$pkg" "$ORKESTRA_UNITS_PROVEN" 2>/dev/null && continue
  if (cd "$pkg" && npm run lint); then
    echo "$pkg" >> "$ORKESTRA_UNITS_OUT"
  else
    status=1
  fi
done
exit "$status"
```

- **Units are kept however the run ended.** A run that fails or times out keeps every unit
  it wrote, so the run after it on the same tree starts where this one stopped.
- **The key holds no script and no check name.** Two checks that declare the same label
  read each other's proofs, provided they agree on `ignores_linguist_generated:` and
  `cache_across:`. A slow check and a light one over the same tests can share a label.
- **Editing the script keeps its unit proofs.** To discard them, change the label.
- **A proof is tied to one tree.** Once a file changes, every unit runs again unless the
  script narrows the run itself, as `--related` does, or the check keeps prints.

The stage runner does all of this for a vitest stage: it leaves proven test files out of
the run and records each test file that passes.

## Prints

`fingerprint:` lets a test file be skipped on a tree it has never run on, because nothing
it depends on changed. It needs `units:`, and the check must run its tests with vitest
through the stage runner, which adds the recording setup to each vitest project with no
configuration of yours. Under it a unit is a test file's path from the checkout root.

```bash
#!/bin/bash
# ---
# description: Runs the unit tests. Fails when any test fails.
# timeout_seconds: 600
# units: vitest
# fingerprint: [git]
# ---
exec node "$ORKESTRA_STAGES" 'pnpm test'
```

While the check runs, the engine loads a recording hook into every Node process it
starts. For each test file, the hook records every file the test read, every module it
loaded and which of its functions ran, and every process it started, and so does every
process those start. For each test file that passes, the engine keeps a print of that
record. On a later run, a test file is skipped when every input its print names still
matches the checkout.

- **A test file the hook cannot account for always runs.** That includes one that starts
  a tool not listed under `fingerprint:`, or a listed tool outside a directory the test
  made, or on a path outside it.
- **Listing a tool is a promise** the engine cannot check: run in a directory the test
  made, the tool depends only on its binary, its arguments and its environment.
- **Not recorded at all:** environment variables, the clock and randomness. A test whose
  result depends on one can be skipped wrongly.
- **Changing the list of tools discards every print**, because the list is in the key.
- **A test file skipped on its print is not proven on the tree.** Only units that ran are
  written as unit proofs.

Some inputs the hook can only assume, and a print names each assumption it leaned on:

| Assumption | What it takes on trust |
|---|---|
| `gitconfig` | a read of the global git configuration answers what it answered before |
| `lockfile` | what the package manager installed is exactly what its lockfile says |
| `ps` | `ps` reports processes, never files |
| `tmpdir` | a write anywhere under the temp directory belongs to the test |

A machine where the environment variable `CI` is set to anything accepts none of these,
so a print that names one is not used there. Every other machine accepts all of them. A
check cannot choose: `assumes:` in its header fails the load.

## Alongside CI

The engine keeps every record on its own machine, so CI sees none of them. A CI job that
runs the check's script directly runs everything, which is the safe default. To let CI
skip what the engine already proved, publish the records with the commit and read them
back on CI. All three commands below need no engine running, and each takes `--dir
<path>` for a checkout other than the current directory.

| Command | Where | What it does |
|---|---|---|
| `ork proofs publish` | a checkout with nothing uncommitted | pushes the unit proofs of every check with `units:`, and the prints of every check with `fingerprint:`, to `origin` under `refs/passes/<tree>`, where `<tree>` is the tree of `HEAD` |
| `ork proofs read --check <name>` | CI | prints the units `origin` holds for that check's label on `HEAD`'s tree and this machine's platform part, one per line |
| `ork proofs run --check <name> --skipped <dir> [--prints-from <tree>]` | CI | runs a check with `fingerprint:` as the engine runs it, and exits non-zero when it fails |

Nothing publishes on its own: run `ork proofs publish` after the commit, before CI reads
it. It finds the records in the nearest `.orkestra/.database/` at or above the checkout,
so it works from a trak's checkout too.

`ork proofs run` skips the units proven on `HEAD`'s tree, and every test file whose print
holds and names no assumption. It writes what it skipped to `<dir>`: `units`, one per
line, and the prints each was skipped on under `prints/`. It keeps the prints its own run
makes in the checkout's `.orkestra/.database/`, so a later run on a CI machine that keeps
that directory between jobs skips on them too.

**A pull request's CI usually builds a merge commit**, whose tree matches the head's only
when the base has not moved. Unit proofs are found only on a matching tree. Prints hold on
any tree, so pass the head commit's tree as `--prints-from` to read the prints published
for it. Here `HEAD_SHA` is the pull request's head commit:

```bash
ork proofs run --check test --skipped "$RUNNER_TEMP/skipped" \
  --prints-from "$(git rev-parse "$HEAD_SHA^{tree}")"
```

**A record crosses machines only when the machines match.** A unit proof is read only on
its platform part, and a print only on its OS and architecture. Records published from a
macOS laptop skip nothing on a Linux runner. `cache_across: os` lets unit proofs cross
architectures; prints never do.
