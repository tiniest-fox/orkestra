// The Layer composition the HTTP server runs against — mirrors `ork.ts:998-1015`
// (the real prod stack) with two intentional differences: a no-op `Observer`
// (transitions go to the log, which the client polls — no SSE for MVP) and no
// `Term` (the server has no stdin). Everything else is the same: the store
// the `stores` seam picks, file-backed Runs, real provider, real Vcs, the full `RuntimeDeps` set `advance`
// requires. See `workflow/runtime.ts:55` for the requirement.
//
// Provide this Layer to `serve-engine.ts`'s program. The routes are tested against a
// subset of it (memory Store/Runs, scripted agent) in `test/e2e/http-api.test.ts`
// — tier 2, because building a Layer is what puts a test there rather than beside
// the source (see `testing-tiers`).

import { Context, Effect, Layer, Option, type Scope } from "effect"
import { NodeProcessLayer } from "../agent/adapters/process-node.js"
import { MermaidDiagramsLayer } from "../agent/adapters/diagrams-mermaid.js"
import type { Process } from "../agent/ports/process.js"
import type { Provider } from "../agent/ports/provider.js"
import { cliProviderLayer } from "../agent/adapters/cli-provider.js"
import { claudeSpec } from "../agent/providers/claude/index.js"
import { codexSpec } from "../agent/providers/codex/index.js"
import type { Lib } from "../library/ports/library.js"
import { GhForgeLayer } from "../vcs/adapters/forge-gh.js"
import { OriginForgeLayer } from "../vcs/adapters/forge-origin.js"
import { GitCliLayer } from "../vcs/adapters/git-cli.js"
import { ShellChecksLayer } from "../workflow/adapters/checks-shell.js"
import type { HostTraks } from "../vcs/ports/host-traks.js"
import { NoSandboxesLayer } from "../workflow/adapters/sandboxes-none.js"
import { ShellEnvironmentLayer } from "../workflow/adapters/environment-shell.js"
import { PubSubFeedLayer } from "../workflow/adapters/feed-pubsub.js"
import { publishingGoalStore } from "../workflow/adapters/goal-store-publishing.js"
import { publishingStore } from "../workflow/adapters/store-publishing.js"
import { MemoryArchiveLayer } from "../workflow/adapters/archive-memory.js"
import { MemoryIdleLayer } from "../workflow/adapters/idle-memory.js"
import { PhraseIdsLayer } from "../workflow/adapters/ids-phrase.js"
import { FileRunsLayer } from "../workflow/adapters/runs-file.js"
import { MemoryLeavingLayer } from "../workflow/adapters/leaving-memory.js"
import { UploadsLayer } from "./attachments.js"
import { MemoryOutagesLayer } from "../workflow/adapters/outages-memory.js"
import { FilePassesLayer } from "../workflow/adapters/passes-file.js"
import { MemoryTurnToolsLayer } from "../workflow/adapters/turn-tools-memory.js"
import { MemorySetupsLayer } from "../workflow/adapters/setups-memory.js"
import { MemoryPreparationLayer } from "../workflow/adapters/preparation-memory.js"
import { MemorySeamStatusesLayer } from "../workflow/adapters/seam-status-memory.js"
import { MintedSecretsLayer } from "../workflow/adapters/minted-secrets.js"
import type { MintedSecrets } from "../workflow/ports/minted-secrets.js"
import { FileEngineLogLayer } from "../workflow/adapters/engine-log-file.js"
import { publishingRuns } from "../workflow/adapters/runs-publishing.js"
import { SqliteStoresLayer } from "../workflow/adapters/store-sqlite.js"
import { NodeWorkspaceLayer } from "../workflow/adapters/workspace-node.js"
import type { Checks } from "../workflow/ports/checks.js"
import { EngineVersion } from "../workflow/ports/engine-version.js"
import type { Feed } from "../workflow/ports/feed.js"
import type { GoalStore } from "../workflow/ports/goal-store.js"
import { Leases } from "../workflow/ports/leases.js"
import { Locks } from "../workflow/ports/locks.js"
import { Observer } from "../workflow/ports/observer.js"
import type { Archive } from "../workflow/ports/archive.js"
import type { Idle } from "../workflow/ports/idle.js"
import { withProjectFiles } from "../workflow/ports/project-files.js"
import type { Runs } from "../workflow/ports/runs.js"
import { Store } from "../workflow/ports/store.js"
import type { StoreFailed } from "../workflow/ports/store-errors.js"
import { StoreHealth } from "../workflow/ports/store-health.js"
import { StoreWatch } from "../workflow/ports/store-watch.js"
import { StoredSessions } from "../workflow/ports/stored-sessions.js"
import { type LeftBehind, Sandboxes } from "../vcs/ports/sandboxes.js"
import type { Preparation } from "../vcs/ports/preparation.js"
import { Vcs } from "../vcs/ports/vcs.js"
import { MemoryLocksLayer } from "../workflow/adapters/locks-memory.js"
import { ConditionsLayer } from "./conditions.js"
import { HostProject } from "./handoff.js"
import { type People, PublicPeopleLayer } from "./people.js"
import { DeploysLayer } from "./deploys.js"
import { DetailsLayer } from "./details.js"
import { HostGitLayer } from "./host-git.js"
import { UsageMemoryLayer, usageWatching } from "./plan-usage.js"
import {
  Drives,
  DrivesLayer,
  type DrivesShape,
  OtherCopies,
  remakeSandbox,
  renewSandbox,
} from "./drive.js"
import { leaseCopies } from "./other-copies.js"
import { Events } from "../workflow/domain/event.js"
import { replayHistory } from "../workflow/domain/replay.js"
import { holdsCheckout, TrakId, waitsOnPerson } from "../workflow/domain/trak.js"
import { CHECK_STAGES, RECORDING, SHIPPED_AGENTS, TEMPLATES, version } from "./packaged.js"
import { type Push, StoredPushLayer } from "./push.js"
import { goalDrivesLayer } from "./goal-drives.js"
import {
  goalToolsServer,
  type Hosting,
  hostedProcessesLayer,
  reachedTools,
  trakToolsServer,
  type TurnGitHub,
} from "./hosting.js"
import { MachineOpenersLayer } from "./openers.js"
import { ProjectFilesLayer, refreshingVcs, type RunnerFilesRead } from "./project-files.js"
import { viewsLayer } from "./views.js"

/**
 * The transitions a live CLI prints. The server prints nothing and watches nothing
 * here — what a client sees comes off the `Feed`, which hangs off `Store` so that a
 * frame is an append rather than a second account of one.
 *
 * **Not the seam to hang the stream on**, and the reason is `withTranscript`: it
 * collapses a burst of `Thinking` ticks into one stored line but hands the Observer
 * every tick, so an Observer-sourced feed carries entries no file holds. See
 * `store-publishing.ts`.
 *
 * `agentEvent` returning `Effect.void` is precisely not a verdict: see `effect-idiom`
 * on the catch-all trap. A no-op is a no-op, not a recovery.
 */
const SilentObserver = Layer.succeed(Observer, {
  transition: () => Effect.void,
  agentEvent: () => Effect.void,
})

/**
 * The trak and goal stores, the locks and the run records, one layer for all four: the SQLite
 * file in `.database/`, permits in memory, and `run.json`. `proc` is what a run record kills a
 * stray command through. A store a host's entry point builds instead may offer leases, a change
 * stream, stored sessions and its health out of the same layer, which no type here names: a
 * reader asks with `Effect.serviceOption`, and finds none here.
 */
export const sqliteStoresOf = <PE, PR>(
  cwd: string,
  proc: Layer.Layer<Process, PE, PR>,
): Layer.Layer<Store | GoalStore | Locks | Runs, PE | StoreFailed, PR> =>
  Layer.mergeAll(
    SqliteStoresLayer(cwd),
    MemoryLocksLayer,
    FileRunsLayer(cwd).pipe(Layer.provide(proc)),
  )

/**
 * Each trak's preparation, told by the runner's Process, git and the runtime, and published
 * on the feed the engine provides — one reference, so one feed and one memory per build.
 */
const preparation = MemoryPreparationLayer.pipe(Layer.provide(PubSubFeedLayer))

/** What each trak's action at the seam is doing, published on the same feed — see `SeamStatuses`. */
const seamStatuses = MemorySeamStatusesLayer.pipe(Layer.provide(PubSubFeedLayer))

/** The engine's memory of each trak that no log holds — see where `engineLayers` provides it. */
const engineMemory = Layer.mergeAll(
  MemoryLeavingLayer,
  MemoryOutagesLayer,
  MemorySetupsLayer,
  preparation,
  seamStatuses,
)

/**
 * What the sandboxes are handed once at boot, being built over the layers built over them:
 * how to make one again, the job lease an idle stop takes — each copy's timer may start
 * one, and two whose timers fall together stop the sandbox once — and whether a trak waits
 * on a person, which keeps its sandbox for `idle_minutes_waiting`.
 */
const handedToSandboxes = Effect.gen(function* () {
  const held = yield* Effect.context<Vcs | Checks | Lib | Sandboxes | Preparation>()
  const sandboxes = yield* Sandboxes
  yield* sandboxes.remakeWith({
    lost: (trak) => withProjectFiles(remakeSandbox(trak)).pipe(Effect.provide(held)),
    stale: (trak, checkout) =>
      withProjectFiles(renewSandbox(trak, checkout)).pipe(Effect.provide(held)),
    startsFrom: (trak) => Effect.flatMap(Vcs, (v) => v.branchTip(trak)).pipe(Effect.provide(held)),
  })
  const locks = yield* Locks
  const leases = Option.getOrUndefined(yield* Effect.serviceOption(Leases))
  // Not while any copy holds the trak's own lease: this copy's timer knows nothing of a
  // turn another copy is driving in the sandbox.
  const idle = (trak: string): Effect.Effect<boolean> =>
    leases === undefined
      ? Effect.succeed(true)
      : leases.read(trak).pipe(
          Effect.map((row) => row === undefined || row.expired),
          Effect.catchTag("StoreFailed", () => Effect.succeed(false)),
        )
  yield* sandboxes.stopIdleUnder((trak, stop) =>
    Effect.asVoid(
      locks.withJob(`idle-stop/${trak}`)(
        Effect.flatMap(idle(trak), (free) => (free ? stop : Effect.void)),
      ),
    ),
  )
  const store = yield* Store
  // A log that cannot be read waits on nobody: the sandbox stops at `idle_minutes`, as it
  // would with no `idle_minutes_waiting`.
  yield* sandboxes.waitingBy((trak) =>
    store.events(TrakId.make(trak)).pipe(
      Effect.map((events) => waitsOnPerson(replayHistory(TrakId.make(trak), events).state)),
      Effect.orElseSucceed(() => false),
    ),
  )
})

/**
 * The leases, what other copies drive, the change stream, the stored sessions and the store's
 * health out of `stores`, where it offers them, and an empty context where it does not — so the drives, the watcher and the
 * idle stop each find them by `Effect.serviceOption`, and an engine on SQLite builds none.
 */
const sharedOf = <E, R>(stores: Layer.Layer<Store | Locks, E, R>): Layer.Layer<never, E, R> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const leases = yield* Effect.serviceOption(Leases)
      const watch = yield* Effect.serviceOption(StoreWatch)
      const sessions = yield* Effect.serviceOption(StoredSessions)
      const health = yield* Effect.serviceOption(StoreHealth)
      // `OtherCopies` is built here and only here, beside `Leases`: a drive with leases and
      // no `OtherCopies` would read every trak as free and take over without waiting.
      const withLeases = yield* Option.match(leases, {
        onNone: () => Effect.succeed(Context.empty()),
        onSome: (l) =>
          Effect.map(
            Effect.flatMap(Locks, (locks) =>
              leaseCopies(l, Option.getOrUndefined(watch), locks.expiresAfter),
            ),
            (copies) => Context.make(Leases, l).pipe(Context.add(OtherCopies, copies)),
          ),
      })
      const withWatch = Option.match(watch, {
        onNone: () => withLeases,
        onSome: (w) => Context.add(withLeases, StoreWatch, w),
      })
      const withSessions = Option.match(sessions, {
        onNone: () => withWatch,
        onSome: (s) => Context.add(withWatch, StoredSessions, s),
      })
      // Without it the engine never exits with its store process, and `/api/health` never
      // says the store is down.
      return Option.match(health, {
        onNone: () => withSessions,
        onSome: (h) => Context.add(withSessions, StoreHealth, h),
      })
    }),
  ).pipe(Layer.provide(stores))

/**
 * How a remake that left a sandbox's uncommitted changes behind fails its trak, whatever
 * woke the sandbox: a `WorktreeFailed` carrying the ref, on a drive of its own, where
 * nothing is moving the trak and it still holds a checkout. A drive that is moving it meets
 * the failure as its own step's. Handed here rather than with `remakeWith`, because it is a
 * drive and the drives are built over the sandboxes.
 */
export const recordLeftBehind =
  (drives: DrivesShape): LeftBehind =>
  (trak, failure) =>
    Effect.map(
      drives.startIfStill(
        TrakId.make(trak),
        Events.worktreeFailed(`${failure.op}: ${failure.reason}`, failure),
        (t) => holdsCheckout(t.state),
      ),
      (answer) => answer === "started",
    )

const leftBehindToDrives = Effect.gen(function* () {
  const record = recordLeftBehind(yield* Drives)
  yield* (yield* Sandboxes).leftBehindTo(record)
})

/**
 * `layer` with `watch` beneath it, last and over everything a change is handed to, so it
 * subscribes as the layers are built — before any route or sweep can append.
 */
const watched = <A, E, R>(layer: Layer.Layer<A, E, R>, watch: EngineSeams["watch"]) =>
  Layer.scopedDiscard(watch).pipe(Layer.provideMerge(layer))

/** How the stores are built over the library and the Process. */
export type StoresOf = <E, PE, PR>(
  cwd: string,
  lib: Layer.Layer<Lib, E>,
  proc: Layer.Layer<Process, PE, PR>,
) => Layer.Layer<Store | GoalStore | Locks | Runs, E | PE | StoreFailed, PR>

type LibLayer = ReturnType<typeof ProjectFilesLayer>
type LibFailed = Layer.Layer.Error<LibLayer>

/** What the machine seam builds over. */
export interface MachineAt {
  readonly lib: LibLayer
  /** Each trak's preparation: the one memory the engine publishes, which a spawn may tell. */
  readonly preparation: Layer.Layer<Preparation>
  /** The cache checkout every trak's checkout is under; `undefined` where it is the project's own. */
  readonly checkouts: string | undefined
}

/**
 * Where the engine's work runs: the Process every spawn goes through, which may record a
 * secret it mints in `MintedSecrets`; the sandboxes every reader of a checkout asks first; and
 * the traks placed on this machine although the project has a runner, none where left out.
 */
export interface Machine {
  readonly process: Layer.Layer<Process, LibFailed, MintedSecrets>
  readonly sandboxes: Layer.Layer<Sandboxes, LibFailed>
  readonly hostTraks: Layer.Layer<HostTraks, LibFailed> | undefined
}

/** How the machine is built for the project at `cwd`. */
export type MachineOf = (cwd: string, at: MachineAt) => Machine

/** This machine and nothing else: every spawn runs here, and no checkout is in a sandbox. */
const localMachine: MachineOf = () => ({
  process: NodeProcessLayer,
  sandboxes: NoSandboxesLayer,
  hostTraks: undefined,
})

/** What wraps the CLIs' Provider, handed the library beside it. */
export type ProviderOver = <E, R>(
  cli: Layer.Layer<Provider, E, R>,
  lib: LibLayer,
) => Layer.Layer<Provider, E | LibFailed, R>

/**
 * The adapters an entry point chooses. Each defaults to what an engine nobody hosts runs;
 * a host may provide its own for an engine it starts.
 */
export interface EngineSeams {
  /** The project's id on the host that started this engine, which a sandboxed trak's handoff line names. */
  readonly hostProject: string | undefined
  /**
   * The project's runner and backup files, read beside each library — `Runners`. None is no
   * runner and no backup file.
   */
  readonly runners: RunnerFilesRead | undefined
  readonly machine: MachineOf
  readonly provider: ProviderOver
  /** What a turn in a trak's sandbox is handed to sign in to GitHub; nothing where left out. */
  readonly turnGitHub: TurnGitHub | undefined
  readonly stores: StoresOf
  readonly environment: ReturnType<typeof ShellEnvironmentLayer>
  readonly push: (cwd: string) => Layer.Layer<Push, Error>
  /** Who sees, presses and reads each item — over the stores and the feed it follows. */
  readonly people: Layer.Layer<People, never, Store | GoalStore | Feed>
  /**
   * What follows the store's own news of writes other engine copies made, forked into the
   * engine's scope as its layers are built. Nothing, where one engine is the only writer.
   */
  readonly watch: Effect.Effect<
    void,
    StoreFailed,
    Store | Feed | Archive | Idle | Drives | Scope.Scope
  >
}

/**
 * The seams of an engine nobody hosts: SQLite, its own push keys, nobody else's users, and no
 * other copy writing to its store.
 */
export const PUBLIC_SEAMS: EngineSeams = {
  hostProject: undefined,
  runners: undefined,
  machine: localMachine,
  provider: (cli) => cli,
  turnGitHub: undefined,
  stores: (cwd, _lib, proc) => sqliteStoresOf(cwd, proc),
  environment: ShellEnvironmentLayer(),
  push: (cwd) => StoredPushLayer(cwd),
  people: PublicPeopleLayer,
  watch: Effect.void,
}

export interface EngineOptions extends Partial<EngineSeams> {
  /** Where this engine listens, for the tool servers a session is handed; without it, none. */
  readonly hosting?: Hosting
  /**
   * Every CLI this build can spawn, in one registry — the simulated engine's scripted
   * answers. Built over the engine's own processes when left out. See `registryOf`.
   */
  readonly scripted?: Layer.Layer<Provider>
  /**
   * The cache checkout `bootCheckouts` answers under an external store: git's repository, and
   * the root every trak's checkout and its sandbox's mirror are under. With none they are
   * the project's own.
   */
  readonly checkouts?: string
}

/**
 * The full prod Layer set, minus the CLI-only wiring. Provide this (composed
 * with the HTTP server's own layers) to the program `serve-engine.ts` runs.
 *
 * `cwd` is the directory the `.orkestra/` walk-up begins from — the same
 * starting point `ork.ts` uses (`process.cwd()`), so the server and the CLI
 * read and write the same `.database/` and the client polls the same logs.
 * **It reads no host variable**: what a host says reaches it through `options`, from the
 * entry point.
 */
export const engineLayers = (cwd: string, options: EngineOptions = {}) => {
  const seams: EngineSeams = { ...PUBLIC_SEAMS, ...options }
  const { hosting, scripted, checkouts } = options
  // Named for the same reason as the store below: the library and the templates are
  // read once at boot, and every consumer resolves the one pair a reload swaps through
  // this one layer.
  // Under an external store, out of the commit `origin`'s default branch names in the cache
  // checkout rather than out of `cwd`.
  const lib = ProjectFilesLayer(cwd, SHIPPED_AGENTS, TEMPLATES, seams.runners, checkouts)
  const machine = seams.machine(cwd, { lib, preparation, checkouts })
  const { sandboxes } = machine
  const hostTraks = machine.hostTraks ?? Layer.empty
  // The secrets the Process mints are kept in `minted`, which the engine tools redact beside
  // the environment's.
  const minted = MintedSecretsLayer
  const proc = machine.process.pipe(Layer.provide(minted))
  const provider =
    scripted ??
    seams.provider(cliProviderLayer(claudeSpec, codexSpec).pipe(Layer.provide(proc)), lib)
  // Named rather than inlined because `PhraseIdsLayer` needs both: naming a trak
  // asks what the store knows and what git holds. One reference each, so the
  // memoized build gives the mint the same store the engine writes to — a second
  // instance would check a directory nothing appends into.
  const stores = seams.stores(cwd, lib, proc)
  // The locks alone, out of the same build of the stores.
  const locks = Layer.effect(Locks, Locks).pipe(Layer.provide(stores))
  const shared = sharedOf(stores)
  const store = publishingStore(stores)
  // Over the library, which reads `.orkestra/` again once this layer's boot has made or fetched
  // the cache checkout, and after each call that can move the default branch. The library never
  // fetches: `proc` is built over it, and only `proc` carries the credential a hosted fetch needs.
  const vcs = refreshingVcs(GitCliLayer(cwd, checkouts)).pipe(
    Layer.provide(Layer.mergeAll(proc, sandboxes, preparation, lib)),
  )
  const environment = seams.environment.pipe(Layer.provide(Layer.merge(proc, lib)))
  const checks = ShellChecksLayer(RECORDING, CHECK_STAGES).pipe(
    Layer.provide(Layer.mergeAll(proc, environment, sandboxes)),
  )

  const engine = Layer.mergeAll(
    // Read once, at boot: an upgrade takes effect on the next boot. A reload re-reads the
    // shipped roles but not this, so the two disagree only where the package changed on
    // disk under a running engine.
    Layer.succeed(EngineVersion, version()),
    MermaidDiagramsLayer,
    hostTraks,
    store,
    // A goal's log and transcript, beside the traks' and never among them — and wrapped
    // so a goal screen hears of every append.
    publishingGoalStore(stores),
    // Wrapped as the store is, and for the same reason: a turn's spend before it ends
    // is on no log, so the record is the only thing a frame can be read out of.
    publishingRuns(stores),
    // Over the sandboxes, so a print is held against a sandboxed checkout where it is.
    FilePassesLayer(cwd).pipe(Layer.provide(sandboxes)),
    PhraseIdsLayer.pipe(Layer.provide(Layer.merge(store, vcs))),
    SilentObserver,
    lib,
    vcs,
    // Beside `Vcs` and pointed at the same directory, because `gh` finds the
    // repository the way git does. It builds without asking anything of the
    // machine — a checkout on no forge, or one with no `gh` installed, is a
    // question this answers rather than a daemon that will not start. With no `origin`
    // there is no forge to ask, and `gh` is not spawned at all.
    OriginForgeLayer(GhForgeLayer(cwd).pipe(Layer.provide(proc))).pipe(Layer.provide(vcs)),
    NodeWorkspaceLayer(cwd).pipe(Layer.provide(sandboxes)),
    sandboxes,
    // Wrapped so each turn on a CLI reports its plan usage to the usage service, and
    // the service is offered too, for the route. One reference, so one memory.
    usageWatching(provider).pipe(Layer.provide(UsageMemoryLayer)),
    UsageMemoryLayer,
    environment,
    checks,
    // A sandbox lost while stopped, or seeded by another engine version, is made again by
    // the first work after it, which needs git and the setup script — both built over the
    // layers built over the sandboxes.
    Layer.effectDiscard(handedToSandboxes).pipe(
      Layer.provide(Layer.mergeAll(vcs, checks, lib, sandboxes, locks, shared, store, preparation)),
    ),
    // The daemon's long-running processes. Its scope is this layer set's, which is the
    // engine's: they outlive every drive, and die with the engine.
    // A trak's run in its sandbox is reached through a tunnel the sandboxes hold open.
    hostedProcessesLayer(cwd, hosting).pipe(
      Layer.provide(Layer.mergeAll(proc, environment, lib, sandboxes)),
    ),
    // The push key and subscription store, on disk beside `daemon.json` so a restart
    // forgets no phone. The sender is not here — `serve-engine.ts` forks it off the `Feed`.
    seams.push(cwd),
    // The turns in flight a check-tool call can act for, and the server a step's session
    // is handed to make one.
    // Under a runner file the session is handed the same tools over HTTP instead, with
    // the engine's port tunnelled into the sandbox for the turn — and, under a host's GitHub
    // App, the helper that asks the engine for a token through it.
    Layer.unwrapEffect(
      Effect.zipWith(
        trakToolsServer(cwd, hosting),
        reachedTools(hosting, undefined, seams.turnGitHub),
        MemoryTurnToolsLayer,
      ),
    ).pipe(Layer.provide(sandboxes)),
    // The engine's warning and error lines, kept across restarts for `engine_log`. Its
    // logger is added to every fiber this set is provided to, drives and sweeps included.
    FileEngineLogLayer(cwd),
    // Uploads held for a new trak until its checkout is made — in the OS temporary folder,
    // under this project's name.
    UploadsLayer(cwd),
    minted,
    // The host's id for this project, which a sandboxed trak's handoff line names.
    seams.hostProject === undefined ? Layer.empty : Layer.succeed(HostProject, seams.hostProject),
    // The opener scan and the once-per-machine picks behind `/api/openers` — it
    // answers *unsupported* off macOS rather than failing to build there.
    MachineOpenersLayer,
    // `provideMerge` rather than `provide` for all three: the store and the runs publish
    // into the feed and the stream route subscribes to it, the store classifies into the archive
    // and the list and the sweep read it, and a drive takes a permit `advance` also
    // takes the twin of — so each is a dependency here *and* part of what this set
    // offers. One `Layer` reference each, so there is one PubSub, one set and one set
    // of permits.
  ).pipe(
    Layer.provideMerge(PubSubFeedLayer),
    Layer.provideMerge(MemoryArchiveLayer),
    Layer.provideMerge(MemoryIdleLayer),
    Layer.provideMerge(locks),
    Layer.provideMerge(shared),
    // Beneath the runner's Process and `Runs`, which read it as a turn's scope closes, and
    // offered to the drives, whose release sets it — see `Leaving`, and `Outages` beside it.
    // Background setups and each trak's preparation ride with them: the engine's scope,
    // which a setup outlives every drive in.
    Layer.provideMerge(engineMemory),
  )

  // Last, and provided the whole engine: `DrivesLayer` captures the runtime a forked
  // drive will run in, so everything a turn needs has to be in scope by the time it is
  // built. A dependency missing here is a drive that dies on its first `yield*`.
  // The sweep sits over it, because a re-ask is a drive. The deploy memory sits under
  // it, because a re-ask of `deployed` is what fills it.
  // The detail's memory of each trak's files sits beside it: it reads the store and
  // nothing drives through it. So does the git bar's, which reads only `Vcs`, and who sees,
  // presses and reads each item, whose host implementation reads the stores and follows the
  // feed.
  const remembering = Layer.mergeAll(
    DeploysLayer,
    DetailsLayer,
    HostGitLayer,
    viewsLayer(),
    seams.people,
  ).pipe(Layer.provideMerge(engine))
  const driving = Layer.effectDiscard(leftBehindToDrives).pipe(
    Layer.provideMerge(DrivesLayer.pipe(Layer.provideMerge(remembering))),
  )
  // Over the drives, because a goal's moves on its traks are drives — and its turns run on
  // a worker this layer's scope holds, so they end with the engine.
  const goals = Layer.unwrapEffect(
    Effect.map(goalToolsServer(cwd, hosting), (tools) => goalDrivesLayer(tools)),
  ).pipe(Layer.provideMerge(driving))
  return watched(ConditionsLayer.pipe(Layer.provideMerge(goals)), seams.watch)
}
