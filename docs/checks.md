# Checks, effects and conditions

**Path:** `.orkestra/checks/<name>.sh`, and `.orkestra/.local/checks/<name>.sh` for one
person's copy, which replaces the team's script of the same name.

A check file is a shell script with a header the engine reads. An agent names it under
one of three lists, and the list decides what the exit code means:

| Listed under | Runs | `exit 0` | Non-zero |
|---|---|---|---|
| `checks:` | in the worktree, after each artifact, before a person sees it | the work passes | the work is wrong: the step goes back to the agent with the output |
| `effects:` | once the step's work is on the branch and a person approved it | it was done | it could not be done: the trak stops as failed, for a person to retry |
| `conditions:` | before a step of the agent starts, and again on an interval | the step runs | `1` is *not yet*, and the trak rests until the next ask; anything else gives up |

## A minimal example

```bash
#!/bin/bash
# ---
# description: Runs the unit tests. Fails when any test fails.
# timeout_seconds: 600
# ---
set -euo pipefail
exec npm test
```

## The header

The header is a YAML block written as comments: a `# ---` line after the shebang, each
field behind `# `, and a closing `# ---`. The script follows it and must not be empty.

| Key | Type | Default | What it does |
|---|---|---|---|
| `description:` | string | **required** | What the script judges or does. A step's prompt tells the agent which checks will judge it and quotes this, and the app shows it when a check fails |
| `timeout_seconds:` | positive number | `60` | Wall-clock limit. A check that runs out of time has failed |
| `asked_every_seconds:` | number, at least `60` | none | How often a condition is asked again while a trak waits on it. **Required** on a script named under `conditions:`, and refused on one named only under `checks:` or `effects:` |
| `exclusive:` | boolean | `false` | Runs one at a time across every trak on this engine, queued behind any other exclusive check. For a check that already uses every core. A run in a trak's own sandbox never queues |
| `cache:` | boolean | `true` | Whether a pass may be reused. A check that passed on exactly these files, this script and this platform is not run again. Set `false` for a check whose answer depends on the network, the clock or a tool's version. Read only under `checks:` |
| `ignores_linguist_generated:` | boolean | `false` | Leaves the files `.gitattributes` marks `linguist-generated` out of the tree a pass is kept against, so a change to only those reuses the pass. A promise the engine cannot check: the script must not read those files |
| `units:` | string | none | A label for the units this check proves, such as test files. The check is handed `ORKESTRA_UNITS_OUT`, a file to append each unit it proved to, one per line, and `ORKESTRA_UNITS_PROVEN`, the units already proven under the label on this tree. Refused on a script named under `conditions:` or `effects:` |
| `cache_across:` | `platform` or `os` | `platform` | How much of the machine a kept pass is tied to: `platform` is the OS and the architecture, `os` the OS alone |
| `fingerprint:` | list of tool names | none | Opts in to skipping a test file whose recorded inputs are unchanged although the tree changed. Each tool listed is one a test may spawn and still be skipped. Requires `units:`, and the test runner must be vitest |
| `reaches:` | `local` or `external` | none | Read only on `worktrees/setup.sh` and `worktrees/teardown.sh` — see [worktrees.md](worktrees.md). Refused here |

**An unknown key fails the load.** These fail with a message saying why:

| Key | Why |
|---|---|
| `model:` | a check is a script, not an agent turn |
| `disallowed_tools:` | a check runs whatever it likes; restrict an agent with `permission:` |
| `expect_failure:` | `exit 0` always means pass; invert the result inside the script |
| `assumes:` | which assumptions a pass may rely on is the engine's to say |

## Names

The filename, without `.sh`, is the check's name, in lowercase kebab case. Three names are
reserved: `merged` and `deployed`, which the engine answers itself, and `wait_until`.

- **`merged`** is the trak's branch having gone in, through a merged pull request or a
  merge made from the engine.
- **`deployed`** is `merged` and then `.orkestra/deploy.sh` saying the merge commit is live.
  An agent may list it only where `deploy.sh` exists.

Orkestra ships one script, `open-pr`, which the shipped `pull-request` agent names as an
effect. A project script called `open-pr.sh` replaces it.

## What the script is given

A script runs in the trak's worktree, with the environment the engine runs in, laid over by
whatever `worktrees/env.sh` exports. The engine adds:

| Variable | What it holds |
|---|---|
| `ORKESTRA_STAGES` | the path of the stage runner, below |
| `ORKESTRA_BASE_COMMIT` | the commit the trak's checkout was cut from |
| `ORKESTRA_PASSED_TREE` | the tree this check last passed on in this checkout, where it has passed |
| `ORKESTRA_UNITS_OUT`, `ORKESTRA_UNITS_PROVEN` | the two unit files, on a check with `units:` |
| `ORKESTRA_TARGET_BRANCH` | for an effect, the branch a pull request goes into, where the trak's goal has a goal branch |

An agent can run any check that has `cache: true` during its own turn, through the
`run_check` tool the engine gives it. A pass recorded that way is reused when the step
finishes, so the check does not run twice on the same files.

## The stage runner and `*.select.yaml`

`ORKESTRA_STAGES` is a Node script for projects that use `pnpm` and `vitest`. A check calls
it with the commands to run:

```bash
node "$ORKESTRA_STAGES" --related --select .orkestra/checks/test.select.yaml 'pnpm test'
```

It resolves each `pnpm <script>` through `package.json`, runs a script starting with
`vitest` as a test stage and anything else as written, stops at the first failure, and
prints a short report the agent can act on. With `units:` it skips proven test files and
records passing ones.

| Flag | What it does |
|---|---|
| `--parallel` | starts consecutive non-test stages together |
| `--keep-going` | after a failure, runs every remaining test stage and names every failure |
| `--related` | runs only the test files related to what changed since the last pass, or since the branch began |
| `--select <file>` | with `--related`, reads a project's selection tables from a YAML file |
| `--list-changed` | prints what `--related` counts as changed, and runs nothing |

**A `*.select.yaml` file in `checks/` is not a check.** The engine reads only `*.sh` there;
the file is read by the stage runner, through `--select`, and the name beside a check is a
convention. It holds two tables. A pattern is a path from the repository root where `*` is
any run of characters, `/` included.

| Key | Type | What it does |
|---|---|---|
| `reads:` | mapping of pattern to list of files | Files that read a matching file off disk rather than importing it, so a change to a match counts as a change to them. A `run:<entry>` pattern is a `.ts` file a test starts as a child process: its readers count when the entry or anything it imports changed |
| `held_back:` | list of `when:` and `tests:` lists | A selected test in `tests:` is left out unless a changed file matches one of the entry's `when:` patterns, or is that test itself |

```yaml
reads:
  "templates/*": [lib/render.test.ts]
held_back:
  - when: ["docker/*"]
    tests: [e2e/container.test.ts]
```

## `deploy.sh`

**Path:** `.orkestra/deploy.sh`. It takes the same header as a check, and its presence lets
an agent list the `deployed` condition. The engine runs it from the project root with the
merge commit as `$1`, once the trak's branch has gone in. `exit 0` is live, `1` is not yet,
and anything else gives up. `asked_every_seconds:` sets how often it is asked again.
