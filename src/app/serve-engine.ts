// The engine's boot, which both entry points run: `src/serve.ts` for an engine nobody hosts,
// and a host's own entry point for one a host started. What differs between them arrives as
// `EngineEntry` — what the host said, the adapters, and the client served — so nothing here
// reads a host variable from the process.
//
// **Loopback, unless `--host`; and `--host` only behind a passphrase.** With
// `ORKESTRA_PASSPHRASE` set, every route under `/api/` but `/api/health` wants a session
// cookie the login screen earns, or the per-boot token `daemon.json` carries for `ork` —
// see `guard.ts`. With it unset the engine is open and binds loopback only; `--host` in
// that state is refused at boot. The first bind to a non-loopback interface makes macOS ask
// whether `node` may accept connections — answer it once in the foreground, or the port stays
// silently unreachable while the boot reports a healthy bind.
//
// A tunnel needs none of this: it connects to the engine over loopback from this machine,
// so the bind stays as it is and the engine never learns the tunnel exists. What the tunnel
// needs is the passphrase set, because loopback is not a credential here.
//
// **This process is the engine.** It owns every write to `.orkestra/.database/`, drives turns
// on fibers of its own, and publishes what it appends to anything watching `/api/stream`. An
// action endpoint answers 202 and forks; nothing here blocks on a turn, and nothing outside
// here writes. It reaps strays on boot, serves the router, then announces itself so a client
// does not have to guess which port it landed on.
//
// **A drill engine answers reads and does nothing else.** Its entry point says so with
// `EngineEntry.drill`: every write is refused, and none of the actors nobody pressed starts —
// no push sender, goal watcher, condition, forge or expiry sweep, nor any the entry point adds.

import { existsSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { join } from "node:path"
import { networkInterfaces } from "node:os"
import { Cause, Console, Effect, Exit, Fiber, type Layer, Option, type Scope } from "effect"
import * as HttpServer from "@effect/platform/HttpServer"
import type * as Router from "@effect/platform/HttpRouter"
// Imported from named submodules rather than the package root: the root index also pulls in
// `NodeClusterHttp`, which depends on `@effect/cluster` — a peer of `@effect/platform-node`
// we declined to install. These submodules avoid it.
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"
import * as NodeContext from "@effect/platform-node/NodeContext"
import { HostedProcesses, type ProcessReaped } from "../workflow/ports/hosted-processes.js"
import { Reaped } from "../workflow/ports/runs.js"
import { StoreHealth } from "../workflow/ports/store-health.js"
import { StoreFailed } from "../workflow/ports/store-errors.js"
import type { Lib } from "../library/ports/library.js"
import type { Sandboxes } from "../vcs/ports/sandboxes.js"
import type { Vcs } from "../vcs/ports/vcs.js"
import type { Feed } from "../workflow/ports/feed.js"
import type { Locks } from "../workflow/ports/locks.js"
import type { Store } from "../workflow/ports/store.js"
import { loadLibrary, orkestraDir } from "../library/adapters/library-fs.js"
import { NodeProcessLayer } from "../agent/adapters/process-node.js"
import { apiRouter, reapStrays } from "./server.js"
import { rejoinTurns, startExpirySweep } from "./expiry-sweep.js"
import { startPushForwarding } from "./push.js"
import { startGoalWatching } from "./goals.js"
import { startConditionSweep } from "./conditions.js"
import { startForgeSweep } from "./forge-sweep.js"
import { type EngineSeams, engineLayers } from "./layers.js"
import { announce, basePort, projectDir } from "./discovery.js"
import { bindPlan, makeGuard, PASSPHRASE_ENV, readOnly, sessionsFile } from "./guard.js"
import { EVERY_INTERFACE, mintToken, reachable } from "./access.js"
import { NO_RUNNER_REPORT } from "./project-files.js"
import { bundleReport, bundleState } from "./client-bundle.js"
import { migrateAtBoot } from "./store-migrate.js"
import type { OpenStoreSide } from "./store-move.js"
import { SHIPPED_AGENTS } from "./packaged.js"
import type { Process } from "../agent/ports/process.js"

type Env = Readonly<Record<string, string | undefined>>

/** What the boot settles about the store before anything is built: the sentence it refuses with, or the cache checkout. */
export interface StoreBoot {
  readonly refused?: string | undefined
  /** The cache checkout every trak's checkout is under; `undefined` on SQLite. */
  readonly checkouts?: string | undefined
}

/** What the boot hands an entry point's own actors. */
export interface ActorsAt {
  readonly project: string
  /** The cache checkout every trak's checkout is under; `undefined` on SQLite. */
  readonly checkouts: string | undefined
  /** The engine's own environment, as `EngineEntry.env`. */
  readonly env: Env
}

/** What an entry point hands the boot. */
export interface EngineEntry {
  /** The command line after the program: `--dir <path>` and `--host`. */
  readonly argv: readonly string[]
  /**
   * The engine's own environment: the port `pnpm ui` chose, the passphrase, and the secrets a
   * runner or backup file names.
   */
  readonly env: Env
  /** An engine that answers reads only: it writes nothing and starts no actor. */
  readonly drill?: boolean
  /**
   * The boot's lines about the runner, once the boot has answered which cache checkout the
   * traks are under; the public one, which names none, where left out.
   */
  readonly runnerLines?: (
    checkouts: string | undefined,
  ) => Effect.Effect<readonly string[], never, Lib>
  /** Actors of the entry point's own, started among the boot's where the engine is no drill. */
  readonly actors?: (
    at: ActorsAt,
  ) => Effect.Effect<void, never, Sandboxes | Vcs | Store | Locks | Feed | Lib | Scope.Scope>
  /** Routes of the entry point's own, beside the engine's, over any service the engine offers. */
  readonly routes?: Router.HttpRouter<unknown, Layer.Layer.Success<ReturnType<typeof engineLayers>>>
  /** The adapters, once the boot has answered which cache checkout the traks are under. */
  readonly seams?: (checkouts: string | undefined) => Partial<EngineSeams>
  /**
   * What the boot settles about the store the entry point opens, given the project; SQLite's
   * answer where left out, which refuses only a store file an older engine read.
   */
  readonly store?: (project: string) => Effect.Effect<StoreBoot, Error, Process>
  /** The store the first-boot migration moves file logs into; the SQLite file where left out. */
  readonly migratesInto?: OpenStoreSide | undefined
  /** The built client served at `/`; `client/dist` where left out, or whatever a host builds. */
  readonly client?: string
}

const NOTHING_REAPED: readonly Reaped[] = []

const formatReap = (out: readonly Reaped[]): string =>
  out.length === 0
    ? "no strays"
    : out
        .map((r) =>
          Reaped.$match(r, {
            Killed: (e) => `killed ${e.id} pid ${e.pid}`,
            AlreadyGone: (e) => `${e.id} pid ${e.pid} already gone`,
            Declined: (e) => `${e.id} pid ${e.pid} alive but not the process recorded — declined`,
            Rejoining: (e) => `${e.id} exec ${e.execId} left detached in its sandbox — rejoining`,
          }),
        )
        .join("; ")

const formatProcessReap = (out: readonly ProcessReaped[]): string =>
  out.length === 0
    ? "none left running"
    : out
        .map((r) => {
          const what = `${r.trak ?? "the project checkout"} ${r.name} pid ${String(r.pid)}`
          if (r.outcome === "killed") return `killed ${what}`
          if (r.outcome === "gone") return `${what} already gone`
          return `${what} alive but not the process recorded — declined`
        })
        .join("; ")

/**
 * A server whose `close` also ends the connections still open.
 *
 * The platform's release calls `close` alone, which stops listening and then waits for every
 * connection to end. `/api/stream` never ends — its heartbeat runs until the client leaves —
 * and its request fiber is forked outside the server's scope, so nothing interrupts it. With
 * a client attached, as the page and the host's watcher always are, that wait was forever:
 * SIGTERM, and an external store's process exiting, both left an engine alive and
 * answering nothing until SIGKILL.
 */
const closingEveryConnection = (): Server => {
  const server = createServer()
  const close = server.close.bind(server)
  server.close = (callback) => {
    close(callback)
    server.closeAllConnections()
    return server
  }
  return server
}

/**
 * The project store file an older engine read, where one is left under `root`:
 * `.orkestra/.local/store.sh` or `.orkestra/store.sh`. Nothing reads it now.
 */
export const leftStoreFile = (root: string): string | undefined =>
  [join(root, ".orkestra", ".local", "store.sh"), join(root, ".orkestra", "store.sh")].find(
    (path) => existsSync(path),
  )

/**
 * SQLite's answer at boot: no cache checkout, and a refusal where a store file an older engine
 * read is left — booting past it would put the project on an empty SQLite file beside the rows
 * it names.
 */
const sqliteBoot = (project: string): Effect.Effect<StoreBoot, Error> =>
  Effect.map(
    loadLibrary(project, SHIPPED_AGENTS).pipe(Effect.mapError((e) => new Error(e.message))),
    (lib) => {
      const left = leftStoreFile(lib.root)
      return left === undefined
        ? { checkouts: undefined }
        : {
            refused: `refused: ${left} is a store file, which no engine reads any more — this engine runs on SQLite. Delete the file to boot.`,
          }
    },
  )

/** What the boot settled before anything is built, which the program reads. */
interface Booted {
  readonly entry: EngineEntry
  readonly project: string
  readonly port: number
  readonly plan: { readonly host: string; readonly passphrase: string | undefined }
  readonly token: string
  readonly drill: boolean
  readonly checkouts: string | undefined
}

/** The runner line an engine with no runner prints: a public engine reads no runner file. */
const noRunnerLines: Effect.Effect<readonly string[], never, Lib> = Effect.succeed([
  NO_RUNNER_REPORT,
])

/** The runner this engine sends a sandboxed trak's work through, and the cache checkout. */
const reportRunner = (booted: Booted) =>
  Effect.gen(function* () {
    const { entry, checkouts } = booted
    const lines = entry.runnerLines?.(checkouts) ?? noRunnerLines
    for (const line of yield* lines) yield* Console.log(line)
    if (checkouts !== undefined) {
      yield* Console.log(
        `checkouts: ${checkouts}, a clone of origin — a trak's commits are pushed there before the log records them`,
      )
    }
  })

/** The actors nobody pressed, which a drill starts none of. */
const startActors = (booted: Booted, reaped: readonly Reaped[]) =>
  Effect.gen(function* () {
    // Before the server takes requests, so no append can land between the first request
    // and the subscription — the sender watches the same feed the stream route serves.
    yield* startPushForwarding
    // The watcher that wakes a goal's composer when one of its traks lands or stops, on the
    // same feed and subscribed before the first request for the same reason.
    yield* startGoalWatching
    // And the sweep that asks every resting trak's condition again on its interval — its
    // first pass is what re-arms the waits a restart forgot.
    yield* startConditionSweep
    // And the one that archives a goal's trak once its pull request has merged, which is
    // what wakes the goal as landed without waiting on a person's archive.
    yield* startForgeSweep
    // And the entry point's own.
    const { entry, project, checkouts } = booted
    if (entry.actors !== undefined) yield* entry.actors({ project, checkouts, env: entry.env })
    // And each turn a dead engine left running detached in its sandbox, read to its end.
    yield* rejoinTurns(reaped)
    // And the holders this boot's reap skipped, or another engine copy left by letting its
    // lease expire: reaped and rejoined as this boot reaped and rejoined — once a lease
    // length under an external store, once a minute without one.
    yield* startExpirySweep
  })

/** The addresses a phone could open, and whether anything stands in front of the routes. */
const reportReach = (booted: Booted, port: number) =>
  Effect.gen(function* () {
    // `logAddress` printed `0.0.0.0`, which no phone can open. These are the addresses one
    // could — and the reminder is there because from a phone a closed laptop, a dead bind
    // and an unanswered firewall prompt all look the same.
    if (booted.plan.host === EVERY_INTERFACE) {
      for (const address of reachable(networkInterfaces())) {
        yield* Console.log(
          `lan  http://${address}:${String(port)}   (a sleeping Mac serves nothing)`,
        )
      }
    }
    if (booted.plan.passphrase === undefined) {
      yield* Console.log(
        `open: no ${PASSPHRASE_ENV} set, so nothing is asked of a request. Loopback only — ` +
          `set one before putting a tunnel or --host in front of this.`,
      )
    }
  })

// The serve program: reap, log address, mount the router; then `Effect.never` holds the scope
// open. `serveEffect` returns void after registering the request handler — without
// `Effect.never`, `Effect.scoped` would close the server the moment binding finished and we'd
// shut down before the first request arrived. Node's listener keeps the process alive; the
// Effect's `never` keeps the Effect's scope intact so the Layer-provided `HttpServer` outlives
// each individual request.
const programOf = (booted: Booted) =>
  Effect.gen(function* () {
    const { entry, project, drill } = booted
    if (drill) {
      yield* Console.log(
        "drill: this engine answers reads only — it reaches no sandbox, drives no trak, starts no turn, takes no snapshot and sends no notification",
      )
    }
    const reaped = yield* reapStrays.pipe(
      Effect.tap((out) => Console.log(`reap: ${formatReap(out)}`)),
      Effect.catchAll((e) => Effect.as(Console.log(`reap skipped: ${String(e)}`), NOTHING_REAPED)),
    )
    // The servers a killed engine left running in traks' checkouts and the project's: each is
    // killed if it is still the process recorded, and shows as stopped by the restart.
    yield* (yield* HostedProcesses).reap.pipe(
      Effect.map(formatProcessReap),
      Effect.tap((s) => Console.log(`processes: ${s}`)),
    )
    const guard = yield* makeGuard({
      passphrase: booted.plan.passphrase,
      token: booted.token,
      sessions: sessionsFile(yield* orkestraDir(project)),
    })
    // Reported rather than acted on: a stale bundle is the developer's to rebuild, and a
    // missing one is not a reason for the engine — which `pnpm ui` also runs — not to boot.
    yield* bundleState(entry.client).pipe(
      Effect.map((state) => bundleReport(state, entry.client)),
      Effect.catchAll((e) => Effect.succeed(`client: could not read the bundle: ${String(e)}`)),
      Effect.tap((s) => Console.log(s)),
    )
    if (!drill) yield* startActors(booted, reaped)
    yield* reportRunner(booted)
    const router = apiRouter({
      ...(entry.client === undefined ? {} : { client: entry.client }),
      ...(entry.routes === undefined ? {} : { routes: entry.routes }),
    })
    yield* HttpServer.logAddress
    yield* HttpServer.serveEffect()(guard(drill ? readOnly(router) : router))
    // Announced from the address that was BOUND, not the one that was asked for. They
    // differ whenever `pnpm ui` stepped past a taken pair, and a record naming the
    // number nobody is listening on is worse than no record at all.
    const bound = (yield* HttpServer.HttpServer).address
    const port = bound._tag === "TcpAddress" ? bound.port : booted.port
    yield* announce(project, port, booted.token)
    yield* reportReach(booted, port)
    // Under an external store, until its process exits: the engine then fails and exits 1, so its
    // supervisor starts both again rather than this copy serving on with no store.
    const store = yield* Effect.serviceOption(StoreHealth)
    if (Option.isNone(store)) return yield* Effect.never
    const ended = yield* store.value.ended
    return yield* new StoreFailed({ reason: `${ended}; the engine exits with it` })
  }).pipe(
    Effect.provide(
      NodeHttpServer.layer(closingEveryConnection, { port: booted.port, host: booted.plan.host }),
    ),
    // The address a session's tool server reaches back to: loopback whatever the bind is,
    // since the turn runs on this machine, and the port asked for, which is the port bound.
    Effect.provide(
      engineLayers(booted.project, {
        ...booted.entry.seams?.(booted.checkouts),
        hosting: { engine: `http://127.0.0.1:${String(booted.port)}`, token: booted.token },
        ...(booted.checkouts === undefined ? {} : { checkouts: booted.checkouts }),
      }),
    ),
    Effect.provide(NodeContext.layer),
    Effect.scoped,
  )

/** Everything settled before a layer is built, or the one sentence the boot refuses with. */
const bootOf = async (entry: EngineEntry): Promise<Booted | { readonly refused: string }> => {
  const args = projectDir([...entry.argv])
  // The repository this daemon drives — every path it reads and writes hangs off it, and it
  // is what the port pair is derived from and what `/api/health` reports.
  const project = args.root
  // `pnpm ui` derives a port pair from the project's path and exports it to both halves. On
  // its own, the engine derives the same number `pnpm ui` would have: a project gets one
  // port, whichever way it is started. `ui` still passes the variable, because it may have
  // stepped past a taken pair.
  const port = Number(entry.env["ORKESTRA_API_PORT"] ?? basePort(project))
  // Loopback, explicitly, unless `--host` asked for every interface — and that is refused
  // here, before anything binds, when no passphrase stands in front of the endpoints that
  // spawn `claude`.
  const plan = bindPlan(args.rest, entry.env)
  if ("refused" in plan) return plan
  // Refused, with one sentence, before anything is built — or the cache checkout every trak's
  // checkout is under, where the entry point's store has one. Under SQLite, `undefined`.
  const boot = await Effect.runPromise(
    (entry.store ?? sqliteBoot)(project).pipe(Effect.provide(NodeProcessLayer)),
  )
  if (boot.refused !== undefined) return { refused: boot.refused }
  const drill = entry.drill ?? false
  // The file logs `.database/` still holds moved into the store before anything is built over
  // it; a drill reads a restored copy, which it never writes.
  if (!drill) {
    const migrated = await Effect.runPromise(
      Effect.either(
        Effect.scoped(
          migrateAtBoot(project, entry.migratesInto, Date.now(), (line) => console.log(line)),
        ),
      ),
    )
    if (migrated._tag === "Left") return { refused: migrated.left.message }
    for (const line of migrated.right) console.log(line)
  }
  // Minted once per boot and written into `daemon.json` for `ork`; it is what stands in for a
  // login on a command line. A new one every boot, so a record a dead daemon left behind
  // authorises nothing against the next.
  const token = mintToken()
  return { entry, project, port, plan, token, drill, checkouts: boot.checkouts }
}

/**
 * Boot the engine `entry` describes and serve until a signal.
 *
 * **A boot that failed says so.** `runFork` on its own observes nothing, so a port already in
 * use exited 0 and `concurrently -k` tore the client down beside it with no explanation.
 * Interruption is not a failure — it is what shutdown looks like from in here. The test is
 * `Cause.isInterruptedOnly`, not `Exit.isInterrupted`: the latter answers *is there an
 * interrupt anywhere in this cause*, and `engineLayers` composes with `Layer.mergeAll` — so
 * one member failing interrupts its siblings and the cause carries an `Interrupt` beside the
 * `Fail`. Read as shutdown, a `.orkestra/` that would not load printed nothing and exited 0.
 *
 * **A signal interrupts the fiber rather than exiting out from under it.** Three finalizers
 * matter: the drives in flight are interrupted, which kills the `claude` each one left
 * running; `run.json` is cleared per trak; and `daemon.json` is removed. Under `pnpm serve`
 * they still often do not run, because `tsx` relays a signal to the child and then SIGKILLs
 * it about 30ms later. Nothing downstream breaks, because neither record is trusted on its
 * own: a reader confirms `daemon.json` with `GET /api/health`, and `reap` is what a `run.json`
 * naming a dead holder is *for* — see
 * the deferred entry *a signal under tsx outruns the daemon's finalizers*.
 */
export const serveEngine = async (entry: EngineEntry): Promise<void> => {
  const booted = await bootOf(entry)
  if ("refused" in booted) {
    console.error(booted.refused)
    process.exit(1)
  }
  const fiber = Effect.runFork(programOf(booted))
  fiber.addObserver((exit) => {
    if (Exit.isFailure(exit) && !Cause.isInterruptedOnly(exit.cause)) {
      // `renderErrorCause` is what makes this readable rather than merely present: the
      // platform wraps a bind failure in a `ServeError` whose own message is "An error
      // has occurred", so without it the report names the wrapper and not the reason.
      console.error(Cause.pretty(exit.cause, { renderErrorCause: true }))
      process.exit(1)
    }
  })
  const stop = (): void => {
    void Effect.runPromise(Fiber.interrupt(fiber)).finally(() => process.exit(0))
  }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
}
