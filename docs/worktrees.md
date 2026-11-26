# Worktree scripts

**Path:** `.orkestra/worktrees/setup.sh`, `teardown.sh` and `env.sh`, and the same names
under `.orkestra/.local/worktrees/`, which replace the team's.

Every trak works in its own git worktree, which holds the tracked files and nothing else.
These three scripts prepare it, clean up after it, and set the environment every command
in it runs with. All three are optional, and nothing selects them: the engine runs each at
a fixed moment.

## `setup.sh`

Prepares a new worktree — installs dependencies, creates a per-worktree database — so the
first check an agent declares fails only for reasons that have to do with the work.

```bash
#!/bin/bash
# ---
# description: Installs dependencies into a fresh worktree.
# timeout_seconds: 300
# reaches: local
# ---
set -euo pipefail
exec npm ci
```

**When it runs:** once in each new worktree, in the worktree, in the background beside the
trak's first turn. A command an agent runs in the checkout waits for setup to end. A failure
stops the trak with the script's output, and leaves the worktree in place to look at. A
retry runs it again.

## `teardown.sh`

Undoes what `setup.sh` made outside the worktree — a container, a database — just before
the engine removes the worktree. It must be safe to run twice: a restart between the script
passing and the removal runs it again. A failure or a timeout keeps the worktree and the
branch, and a resume runs it again. It is skipped when the worktree is already gone.

## `env.sh`

Sets the toolchain every command runs with. The engine sources it in the directory of each
agent turn, check, effect, `setup.sh` and `teardown.sh` before that command starts, and lays
the variables it **exports** over the inherited environment.

```bash
#!/bin/bash
# ---
# description: Puts the versions mise pins on PATH.
# ---
eval "$(mise env -s bash)"
```

It runs before every command and is never cached, because a trak may change a pinned
version. A failure or a timeout fails the command it ran for, with its stderr.

## The header

All three take the header a check takes — see [checks.md](checks.md) for every key. The
keys that matter here:

| Key | Type | Default | What it does |
|---|---|---|---|
| `description:` | string | **required** | What the script prepares |
| `timeout_seconds:` | positive number | `60` | Wall-clock limit. Raise it for an install |
| `reaches:` | `local` or `external` | none | Only on `setup.sh` and `teardown.sh`. How far the script's work goes outside the checkout, read only when traks run in sandboxes. `local` work dies with the sandbox, so a `local` setup runs again on each sandbox a trak is given and a `local` teardown is skipped. `external` work outlives it, so that setup is not repeated and that teardown runs before the sandbox is released |

`asked_every_seconds:` is refused on `setup.sh` and `teardown.sh`, which run once per
worktree. `reaches:` is refused on `env.sh`.
