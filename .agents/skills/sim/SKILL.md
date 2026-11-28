---
name: sim
description: Start the simulated engine — the whole app over a temporary project, every agent turn scripted — reach its seeded traks and goal, and screenshot a page of it. Read before using the running app to check a change, before pressing anything in it, before screenshotting it, and before adding a state to what it seeds.
---

# The simulated engine

`pnpm sim` is the engine and the built client over a fresh temporary git repository, with
scripted answers in place of every CLI. **A press spends nothing**, and nothing reaches
this checkout's `.orkestra/.database/` or the person's engine.

## Start it

Start the declared process; never run `pnpm sim` in the background yourself.

1. `start_process` with `name: "sim"`. The script rebuilds `client/dist` first when it is
   missing or older than its sources, so the page shows this branch's client.
2. `process_logs` for `sim` until it shows `sim: ready on http://127.0.0.1:<port>/`. The
   port answers before seeding ends, so readiness alone is not enough.
3. The API is under `/api/`, the page at `/`, a trak at `/traks/<id>`, a goal at
   `/goals/<id>`.

`restart_process` gives a clean copy of every state. Each boot seeds from scratch.

## What it seeds

`test/support/sim-states.ts` is the catalog, and the boot log prints one line per state.

| Trak | Where it rests |
|---|---|
| `sim-plan-gate` | at the plan gate |
| `sim-at-gate` | at the build step's gate, its check passed |
| `sim-questions` | at a question card from the build step |
| `sim-stuck` | stuck at the build step |
| `sim-check-running` | mid-check, and running until the engine stops |
| `sim-check-failed` | at the gate a failing check opens |
| `sim-second-step` | at the review step's gate |
| `sim-finished` | finished |

One goal, `sim-goal-<suffix>` — read its id from `GET /api/goals` — is watching: its first
trak open at its own plan gate, and its second still to open in its plan.

## What a press does

Each seeded trak answers from its own queue of scripted turns. Past the end of the queue,
and for a trak opened on the page, every turn takes the first repeated answer its schema
accepts: a plan for the composer, a document filling the role's sections otherwise. So a
trak keeps advancing however far it is pressed. A goal started on the page gets prose
and nothing else, because its composer moves only by tool calls.

Every trak offers *Report a problem…*: the simulated engine has a destination named *the
sim's inbox*, which prints each report to the log and answers a link. A note holding `fail`
is refused instead, which reaches the failed state and its Try again.

`build` runs one stand-in check. It passes, except in a trak whose id names
`check-failed` or `check-running`.

## Shooting a page

The client's Playwright CLI takes one screenshot of one URL. Save it under
`.orkestra/.screenshots/`, which is git-ignored and inside the checkout, the only place
an artifact draws an image from:

```bash
shoot() { pnpm --filter @orkestra/client exec playwright screenshot "$@"; }
shoot --viewport-size=1280,800 http://127.0.0.1:<port>/traks/sim-at-gate \
  "$PWD/.orkestra/.screenshots/gate-desk.png"
shoot --viewport-size=390,844 http://127.0.0.1:<port>/traks/sim-at-gate \
  "$PWD/.orkestra/.screenshots/gate-phone.png"
```

Run it from the checkout's root: the CLI runs inside `client/`, so a relative path lands
there.

`--color-scheme dark` shoots the dark scheme. `--wait-for-selector` waits for a surface
that loads after the page does. Each shot loads the page afresh, so it reaches a
state the engine holds — press it first, through the page or `/api/` — and never one
that lives only in the page, such as an open menu.

## Adding a state

Add an entry to `SIM_TRAKS`: its id, its queue, and the presses that reach it. A state
is reached by pressing the real engine, never by writing a log. Add its row to
`EXPECTED` in `test/e2e/sim.test.ts` and to the table above.
