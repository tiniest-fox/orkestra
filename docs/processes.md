# Processes

**Path:** `.orkestra/processes/<name>.sh`, and `.orkestra/.local/processes/<name>.sh` for
one person's copy, which replaces the team's script of the same name.

A process is a long-running program a trak keeps up in its checkout: a dev server, a
component gallery, anything that listens on a port. The engine picks the port, starts the
script, and waits for the port to answer. A process is expected never to exit; exiting is
what it does when something went wrong.

## A minimal example

```bash
#!/bin/bash
# ---
# description: The web app's dev server, with live reload.
# page: true
# ---
exec npx vite --port "$PORT" --strictPort
```

## The header

The same comment block a [check](checks.md#the-header) uses: a `# ---` line after the shebang, each field behind
`# `, and a closing `# ---`. The script follows it and must not be empty.

| Key | Type | Default | What it does |
|---|---|---|---|
| `description:` | string | **required** | What the process is. Every turn it runs beside is told this |
| `page:` | boolean | `false` | Whether it serves a page a person would look at. The app offers to open one that does. A process without a page is still given a port and still probed on it |
| `ready_seconds:` | positive number | `30` | How long the engine waits for `$PORT` to answer before it calls the start a failure and kills the process. A process that exits before the port answers has failed, whatever its exit code |
| `needs:` | list of process names | `[]` | Processes that must be running first. Starting this one starts them; stopping, restarting or an exit of one of them stops this one first. A name no file declares, or a cycle, fails the load |

**An unknown key fails the load.** These fail with a message saying why:

| Key | Why |
|---|---|
| `timeout_seconds:` | a process is meant to keep running; use `ready_seconds:` for how long it may take to start |
| `asked_every_seconds:` | that is a condition's interval; a process starts once |
| `port:` | the engine picks the port and passes it as `$PORT` |

## Names

The filename, without `.sh`, is the process's name, in lowercase kebab case. An agent lists
it by that name under `processes:`.

## What the engine does with it

- **It assigns a port** and runs the script in the checkout with `PORT` set, so two
  checkouts never compete for one. The script must pass `$PORT` to the server.
- **It starts a process** when a person presses start on a trak or on the project
  checkout, before a turn of an agent whose `processes:` lists it, when a turn calls the
  `start_process` tool, or when a process that `needs:` it starts.
- **It tells each turn where a running process is**, in the variable
  `HOSTED_<NAME>_URL`: the process `dev-server` is `HOSTED_DEV_SERVER_URL`.
- **It never restarts a process on its own.** A process that exits stays down until
  something starts it again. A turn can use `process_status`, `restart_process`,
  `stop_process` and `process_logs`.
- **A trak's checkout may declare its own** under its own `.orkestra/processes/`. Those are
  read on every start and replace the project's process of the same name for that trak
  alone, so a step can add a server and start it in the same trak.
