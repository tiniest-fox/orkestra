---
name: where-code-goes
description: Decide where a new file belongs in orkestra and what it may import. Read before creating any file under src/, before moving code between modules, before adding a provider, before adding a route to the engine, before calling a macOS-only tool or writing state about the machine, and whenever a lint error mentions no-restricted-imports.
---

# Where code goes

Two axes decide placement, and both are lint-enforced.

## Axis 1 — which module

```
agent/      run a coding-agent CLI, get schema-valid output   ← trak-agnostic
library/    load + resolve .orkestra definitions              ← trak-agnostic
prompts/    every word we send an agent, as .md templates     ← trak-agnostic
vcs/        git worktrees, the commit that keeps the work, and the forge
recording/  what a test file depended on, and whether it still holds  ← trak-agnostic
workflow/   the coupled core: domain · ports · adapters · runtime
app/        Layer wiring and the HTTP API — domain→DTO mapping, routes, drive
supervisor/ start, attach to, stop and follow engines from outside, and restore a snapshot of
            their state with none running — a client, like cli/
```

Entry points are loose `.ts` files at `src/` root (`ork.ts`, `serve.ts`,
`main.ts`, `smoke.ts`, `docs-check.ts`, the `real*.ts` scripts), each named in the
`no-console` override, as is `app/serve-engine.ts`, the boot `serve.ts`
runs. There is no `cli/` directory. `recording-hook.ts`, `recording-vitest.ts` and
`check-stages.ts` sit there too, but run inside a project's own check rather than the
engine: they may import nothing of Orkestra's own, only Node's built-ins and a type, which
lint enforces. `check-stages.ts` also imports `yaml`, which the bundle carries.

**A behavior a host adds reaches the engine as an `EngineSeams` field, never as a `process.env`
read** — or, for what the boot settles before any layer is built, the store's cache checkout
and the store the first-boot migration writes, and for what the boot adds — the drill, the
runner's lines, actors and routes of the entry point's own — as an `EngineEntry` field in
`src/app/serve-engine.ts`. `engineLayers` in `src/app/layers.ts` takes its adapters as options: `serve.ts`
passes none and gets `PUBLIC_SEAMS`, and a host's entry point passes its own. A switch read inside
`engineLayers`, or inside an adapter it builds by default, turns on in `pnpm ui` wherever
the shell exports that variable. No file reads one from the process, except
`serve.ts`, which reads `ORKESTRA_STORE` only to refuse to boot. The
Process, the sandboxes and the traks placed on this machine are one seam, `machine`:
`PUBLIC_SEAMS` holds the node layer and `NoSandboxesLayer`.

**Who sees, presses or reads a trak or a goal is asked of `People`** (`src/app/people.ts`).
A new question of that kind is a method on `PeopleShape`, and `PublicPeopleLayer` answers
everything for the one person `pnpm ui` serves.

- **`agent/`, `library/` and `vcs/` must not import from `workflow/`.** If one needs a
  `TrakId`, the boundary was fake — say so rather than working around it.
- **`workflow/domain/**` must not import `Effect`, `Layer`, `Stream`, `Ref`, `Context`,
  or any port, adapter or runtime.**

> **If `domain/` seems to need I/O, add a `Command` — don't add a dependency.** Not "we
> should add a mock". If domain wants a dependency, the design is wrong.

**A trak's checkout may not be on this machine.** Where the `machine` seam provides
sandboxes, it is in a sandbox at the same path, and the engine's machine has nothing there. Code that runs a
command in a checkout spawns through the `Process` tag, which sends it to the sandbox by
its `cwd`; code that reads the branch reads the engine's `trak/<id>`, which is a forced copy
only as fresh as the last `Vcs.fetchWork`. Code that reads or writes a file in a
checkout asks `Sandboxes.placeOf` first and goes through that port's file methods where it
answers a place, keeping its `node:fs` code for `undefined` — the projection, proof images,
process declarations and check side files all do. So a bare `node:fs` read of a trak's
checkout, or a `git -C` on it outside `src/vcs/adapters/git-cli.ts`'s sandbox path, works
with no runner and fails under one, and new code that moves the branch in the sandbox
fetches afterwards — `src/vcs/ports/sandboxes.ts`. **A read never starts a stopped
sandbox**: it is `ProcessSpec.ifRunning` on a spawn, or one of the port's reads, and its
answer for a stopped sandbox is that nothing is readable — only work starts one. A
command that starts one and keeps running without being work, as a declared process does,
sets `ProcessSpec.keepsAwake: false`, or the engine never stops that sandbox for idleness. The same
holds for what such a command is handed: a file written on this machine for it to read goes
in the spec's `carries`, a port is reached across only while `Sandboxes.expose` or `reach`
is held, and a session's MCP servers come from `TurnTools.reached`, since the stdio shim's
command is not in the sandbox.

**Nothing under `src/` imports `node:child_process` but the files that already do**, each
with a lint exception on the import saying why. Spawn through the `Process` tag: the `machine` seam may put a guard beneath it that
refuses a spawn, and a direct spawn goes around it.
A spawn that must run there anyway is declared, as `provider-hazards` says.

## Axis 2 — which kind

The kind is decided by **what the file exports**, not by what it is about.

| Kind | Exports | Signature | May do I/O |
|---|---|---|---|
| `types/` | data — brands, schemas, constructors | no behaviour | no |
| `logic/` | pure functions | `(A) => B`, **no `Effect`** | no |
| `ports/` | one interface + `Context.Tag` + its errors | — | declares only |
| `interactions/` | business logic over ports | `(A) => Effect<B, E, R>` | via ports |
| `adapters/` | exactly one `Layer` | — | **the only place** |
| `runtime.ts` | the loop (`workflow` only) | — | yes |
| `index.ts` | the module's public surface, where it has one | re-exports only | — |

A port is a file of its own under its module's `ports/`, with only the operations its
callers need. Nothing re-exports the files there: an importer names the port it uses, so an
edit to one port reruns only the tests that reach it. **`agent/` and `library/` have no
`index.ts` at all**, for the same reason: an importer names the file that defines what it
uses, because a barrel puts every file it re-exports in the import graph of every importer,
and `verify-light` then runs most engine tests for an edit to any one of them. An error several ports raise goes in
a file of its own, as the store's do in `workflow/ports/store-errors.ts`.

Enforced:

- `types/` and `logic/` may not import `Effect`, `Layer`, `Stream`, `Ref`, `Context`,
  `Scope`, `Fiber` — `Data`, `Schema`, `Option` and `Match` are fine, because they are
  values.
- `types/` and `logic/` may not import any port, adapter, interaction or runtime.
- `interactions/` may not import `adapters/` or `providers/`.
- `adapters/` may not import `interactions/`.
- `library/{types,logic}` and `vcs/{types,logic}` also ban `node:fs`,
  `node:fs/promises` and `node:path`.

A module keeps only the kinds it needs, and adding one is normal. A tag moves into
`ports/` before an adapter can provide it.

**The reading and the rules are separate files.** `adapters/library-fs.ts` decides which
files to read; `logic/assemble.ts` decides what they mean. Every validation rule is
therefore a pure function of file *text*, testable with no temp directory — which is
what lets `library/{types,logic}` and `vcs/{types,logic}` ban `node:fs` and `node:path`
outright.

## Traces, for orienting before you place something

**Executing one step.** There is no event that says "start a step" — a step runs because
a human approved the one before it, or because a check it declared came back non-zero.

```
advance(id, HumanActed{Approve})                  workflow/runtime
  replayHistory + applyEvent
    → Advance{AgentWorking(i), [SpawnStep(i)]}    workflow/domain
  runCommand(SpawnStep)                           workflow/runtime
    lib.agents.get(step.agent)                    library/
    StepOutputFor(earlier, requiredTitles)        workflow/domain/outputs
    buildStepPrompt(prompts, ctx) → prompt        workflow/domain/prompt
    Runs.turn(id, {step, sessionId})              workflow/adapters/runs-file
    elicit(schema, req)                           agent/   ← generic; knows no traks
      (converse, on a Message trigger only — everything else owes an artifact)
      resolveModel → spawn → normalize            agent/ internals
      collect → extract → decode                  agent/ internals
      Transcript.record(e) ───────────────────→   workflow: store · observer ·
                                                    Runs.spawned on `Spawned`
  two outcomes, and each produces its event:
    AgentReturned{step, sessionId, output}        the turn answered
    TurnFailed{step, sessionId?, reason}          the provider went
  → advance(id, …)  →  decide → Advance{[RunChecks]} | Await{Human} | Settle{Failed}
```

**What never appears is the point:** a provider name outside `agent/providers/`, an `if`
in `runCommand`, any I/O in `domain/`, or a `TrakId` inside `agent/`. And neither failure
escapes through `advance`'s error channel — **a command must always produce its event**,
or the state moves to `AgentWorking` with nothing able to move it again.

**Startup after a crash.** Recovery happens when a person runs a command, not on a
clock. There is no reconciler. The two things on a timer are the condition sweep in
`src/app/conditions.ts`, which asks a resting trak's `conditions:` script again on the
interval it declares, and the forge sweep in `src/app/forge-sweep.ts`, which asks GitHub
about finished traks. Neither recovers anything — a trak either finds is at rest.

```
every ork command                           src/ork.ts
  Runs.reap()                               workflow/adapters/runs-file
    holder pid dead? → clear it; agent pid alive and started when the
                       recorded agent did? → kill it
  ork list      replayHistory per live trak — Archive says which; Runs.holder(id)
                reads, never claims
  ork resume <id>
    Runs.claim(id) — refuses a live holder, reports a turn left in flight
    neither parked nor terminal?  ← the state alone says a command was in flight
      → name the position, ask before spending, advance(id, Restarted{sessionId?})
    state Failed?  ← reached on its own, or from that restart failing again
      → pickUpFailed: kind, error, positionLabel(failedFrom); retryAt decides
        whether picking it up costs anything
    driveToEnd(id, trak) → reportFinal
```

The two branches are one mechanism: a crash records no event, so the state replays to
something in flight; a failure records one, so the state is `Failed` and the position is
on `failedFrom`. `Restarted` answers both, which is why there is one event rather than
two. They run in sequence rather than as a branch, because a restarted crash can hit the
same provider failure and land straight in the second.

## Two files per port, not five

```
workflow/ports/store.ts          interface + Context.Tag
workflow/adapters/store-file.ts  Layer.effect(Store, …)
```

No `mock.ts`. A test double is another `Layer`, usually under twenty lines.

## Provider bundles

One directory per CLI, always the same three files, and **that shape is the contract.**
`claude/` and `codex/` are the two that exist.

```
agent/providers/claude/
  argv.ts        what to run              (logic — pure)
  normalize.ts   how to read output       (logic — pure)
  index.ts       the CliProviderSpec      (data only)
```

**Nothing in a provider directory spawns, and nothing in one opens a file.** A CLI that
keeps a reading in a file of its own — Codex's per-call token readings, read from the
rollout under its home — declares `sessionLog` on its spec as three pure pieces: the
directory, the name test, and a line reader. `adapters/cli-provider.ts` does the spawning
and the reading, once for every provider, and `adapters/provider-registry.ts` is what
holds them all — a model name's `<provider>/` qualifier picks one, a bare name picks the
first registered.
**To add a provider, copy the directory** and name its spec where `cliProviderLayer` is
built — if you are editing the runner to support one, an override point is missing. Add
it to `CLI_EFFORTS` in `agent/types/effort.ts` as well, with the levels its effort flag
takes: that map is what a `models.yaml` group key is checked against, so a provider
missing from it is one no project can list a model for.

**Whether a provider can be handed a message mid-turn is its `promptDelivery` arm, and
nothing else is written for it.** Under `Stdin` or `LastArg` no pipe is held, `steer`
answers `false`, and a waiting message keeps waiting — for a later turn on a provider
that holds one, or for the gate the trak parks at. Under `StreamJson` or `Dialogue` the
harness writes the message, and the provider's normalizer owes
`ProviderEvent.MessageDelivered` at the line where the CLI reports the model receiving
it — never at the write, and never for the turn's own prompt. A provider that holds a
pipe and reports no delivery sends every message twice: once down the pipe, and again as
the chat at the gate. `provider-hazards` has what each CLI's report looks like.

## One file per concept, not per operation

`decide.ts` holds every transition in one file, deliberately: a state machine has to be
read whole to be verified. If it outgrows a few hundred lines, split by *phase*, never by
transition. A feature is a new event, a new command and a case — not a new directory.

> **Creating a directory rather than a file? Read `new-module` instead.** Every rule here
> is an allowlist of globs, so a new module inherits none of them until someone
> classifies it.

## `src/app/` — the one module that may drive the engine

`advance` is a free function, and holding custody before calling it is a convention
`ork.ts` follows. Inside `app/` it is a **restricted import**: only `src/app/drive.ts`
may take it, because that function claims custody first and every route goes through it.
An unclaimed drive races a live `pnpm ork` on one log and leaves a stray `claude` that
`reap` can never see, since `reap` skips any trak whose `run.json` names no holder.

**Anything here that acts on a trak nobody pressed holds no drive key while it works, and
re-reads the trak under the permit before it appends.** The condition sweep and the forge
sweep are the two such actors. The forge sweep appends through `Drives.startIfStill`,
which drops the event unless the re-read trak still passes the predicate it is given.
`Drives.ask` is the condition sweep's shape: the script runs on a map of its own, so a
person's archive or merge is never refused by a poll, and the answer becomes a drive only
through `start`, which reads the log again and drops an answer a press has overtaken.
Hold the key for the length of a poll and the rule inverts — the person waits on the
machine.

**The condition sweep never opens an idle trak's log**: `waitOf` returns before
`liveTrak` for a trak `Idle.idleAt` reports idle, so work added to the sweep's per-trak
pass never runs on one. A reason to ask an idle trak goes on its log, where `mayIdle`
(`domain/activity.ts`) refuses to let it go idle.

**A sweep the engine starts by itself runs under a job lease**, so two engine copies on one
store that offers leases never run it twice: `heldJob(name, loop)` from `workflow/ports/locks.ts` for a loop
that never ends, `locks.withJob(name)` for one pass. With no leases the loop simply runs.
So do the push sender and the goal watcher, under the `push` and `goal-watch` jobs:
where copies share a store, every copy's `Feed` carries every copy's appends, so a drain on
each copy would act on each append once per copy.

**A route goes in its group's file under `src/app/routes/`**, named for the
`shared/src/dto/` slice it answers with where one exists, and the group's router is
concatenated in `src/app/server.ts`, which holds nothing else but the boot-time reap.
Goal routes and a turn's tool and MCP routes are the exception: they stay in `goals.ts`,
`trak-tools.ts` and `trak-mcp.ts`, beside the work they run. A group's first lines say what
it serves and name the slice it answers with, if any; a feature no group's header names is a new
group, which needs no lint override of its own: the one for `src/app/routes/*.ts`
already matches it. Every route still gets its line in the route list at the top of `server.ts`,
the one index of them all. Nothing re-exports the group files. One group may import
`routes/common.ts` — the `:id` segment, the refusal body, the project checkout — and no
other group, which lint enforces: a helper two groups need goes in `common.ts`, or beside
`drive.ts` in `src/app/`.

**A route that names a trak or a goal goes through the audience check**, `hiddenUnseen` in
`src/app/people.ts`, so that an item the viewer does not see answers what a missing one
does: an empty 404, on every method and for every body. A per-trak route lives under
`/api/traks/:id`, its segment named `id`, because `trakGate` in `routes/common.ts` is applied
once to `apiRouter` and matches that prefix: a trak named by any other path, a query
parameter or a body is not checked. A per-goal route lives under `/api/goals/:id`, and a
router outside `goals.ts` that serves one adds `Router.use(goalGate)` itself, as
`trak-mcp.ts` does. A route that lists or searches traks or goals filters by `People.levels` before
it builds a row or takes a cap, as `GET /api/traks/archived` does.

`src/app/dto.ts` is also required to be **total** — no `throw`. A mapper that needs a
runtime guard to satisfy a domain constructor is reporting that the request Schema is too
weak; state the constraint in the Schema, where the boundary answers 400 instead of 500.
Checked by `pnpm docs:check` (oxlint has no `no-restricted-syntax`). The two trak
mappers, `toSummaryDto` and `toDetailDto`, take one named input object: a new input is a
property rather than an argument position, and one a caller may have nothing for is
optional — left out, never passed as `undefined`.

**An idle trak's list row is the row its last read built**, kept by the `Idle` port until
an append forgets it — the publishing store and the store watch call `Idle.forget` before
the append's frames go out. So a row field may change only when the log does. A field
`toSummaryDto` takes from anything else — daemon memory, `Lib`, a file — stays as it was
on an idle row until the trak's next append or an engine restart; one that has to move
while a trak sits untouched needs `Idle.forget` called where it changes.

## Shipped assets, and the two layouts

Every path to something this build ships — the prompt templates, the shipped fleet and scripts,
the built client, its own version — is named in `src/app/packaged.ts`, and a module may
not resolve one from its own location. `pnpm build` collapses every module into one
bundle, such as `dist/serve.js`, so `import.meta.url` names that file for all of them, and `process.cwd()`
is the repository being driven, which never holds these. A reader imports the constant or
takes the path as an argument, the way `FsLibraryLayer(startDir, shipped)` does.

- **A path added there is added to `src/build.ts`'s `ASSETS` in the same change.** The
  build still succeeds; the bundle is simply short an asset.
- **Read a shipped asset eagerly, at layer construction.** That is what turns a missing
  one into a boot that fails rather than a request mid-trak that does.

## The engine runs off macOS

`src/` and `shared/` run on Linux as well as macOS; `desktop/` is the only macOS-only
code. A call to a macOS-only tool — `plutil`, `sips`, `open`, `osascript`, a path under
`~/Library` — is picked by platform where its service is built, the way `openersOn` is,
and off macOS that service answers a refusal that runs nothing. A guard inside each
function is the shape to avoid: one missed branch spawns a binary that is not there.

**Every git command the engine runs has to exist in `MIN_GIT`**, in
`src/vcs/logic/version.ts` — the floor the startup refusal names, below the 2.39 Debian
bookworm ships. A newer flag, such as `check-attr --source` (2.40), raises that floor and its
refusal or is not used: nothing else stops an older git from failing the call at runtime.

A new file of state about the machine goes in the directory `preferenceDirOn` names —
`~/Library/Application Support/Orkestra/` on macOS, `$XDG_CONFIG_HOME/orkestra/` or
`~/.config/orkestra/` elsewhere. The macOS spelling also lives in `desktop/src/main.ts`,
and the two must agree.

## `desktop/` — a client of the daemon

The Electron shell may import `@orkestra/shared`, `src/app/discovery.ts` and
`src/supervisor/`, and no other engine file: it starts engines, finds them and opens
windows on them, so everything it knows about a trak arrives as a DTO and everything it
does to one is an HTTP request. Sharing the port derivation is what lets it find an
engine somebody else started. `src/cli/` and `src/supervisor/` are restricted the same
way and for the same reason; what is Electron's — its own Node under
`ELECTRON_RUN_AS_NODE`, the login shell's `PATH` — the shell hands `startEngine` as
options.

**A window the shell puts up draws a page of `client/`, never markup written here.** The
launch window is `client/launcher.html` and every other window's own page — the project
rail — is `client/rail.html`, both built with the client and loaded off disk; what
`desktop/` owns is the preload that gives each page a bridge and the handlers behind it,
and nothing that draws. `client-style` has what such a page is held to.

## The `overrides` gotcha

**oxlint applies the last matching override and *replaces* a rule's config rather than
merging it.** Two overrides configuring `no-restricted-imports` for overlapping globs
means the later silently wins, and the earlier enforces nothing. Each glob repeats
everything that applies to it, general → specific.
