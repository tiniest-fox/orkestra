// The only Layer here: the daemon's hosted processes — a project's dev servers, kept up
// in a trak's checkout for as long as somebody wants them, over the Process port.
//
// **Its scope is the layer's, which is the engine's.** A drive's scope closes on every
// stop, recompose and archive, and a server started from inside one would die with it.
// Each run gets a scope forked off this layer's, so a stop closes one run's and the
// engine stopping closes them all; closing a scope is what kills a process group — see
// `Process.spawn`.
//
// **A pid record, so a crash is not a leak.** Every run is detached into its own process
// group, so an engine that dies without its finalizers — SIGKILL, or `tsx` outrunning
// them — leaves every server running and nothing in memory that knows. The record names
// each live run's pid and the start time `ps` reported for it, and the next boot kills
// the ones still alive *and* started when recorded, the check `runs-file.ts` makes before
// it kills an agent, and for its reason: a reused pid is somebody else's process.
//
// **It publishes, as `checks-shell.ts` does and for its reason.** What a process prints
// has to reach a watcher while it is being printed, and is never written to a file — a
// dev server logs for hours. So the run is held in memory, `list` answers off it, and
// the deltas go on the `Feed` in 200 ms chunks.
//
// **A start is watched before its script runs.** Waking a sandbox and copying files into
// it can take minutes, so a run is `Preparing` from the press, with the stage the Process
// layer reports, and each stage has a time limit counted from the last report — the copy's
// from its last finished batch. The preparation runs on a fiber of its own, outside the
// process's permit, so a stop pressed while it waits interrupts it rather than queueing.
//
// **A registry in each checkout, for tools outside Orkestra.** On every state change the
// `.orkestra/.processes.json` of the trak's checkout — or the project's — is rewritten
// from memory: each live process's state, pid, start time, port and — once running — URL.
// It is a public contract, documented beside the `processes/*.sh` header in
// `prompts-are-files`, so its shape changes only with that document.
//
// **A sandboxed checkout's declarations and registry are read and written there**,
// through the `Sandboxes` the layer finds, since this machine holds no such directory.
// Both are reads by the rule a read never starts a stopped sandbox: a stopped one lists
// the project's processes alone and is written no registry. Only a start reads them as
// work, because it is about to run one there.
//
// **Under an external store the project's processes run in sandbox `project`**, where
// `Sandboxes.project` names it: each spawn names the project as its place, and the port is
// exposed from there as a trak's is. Their declarations are still the engine's library.

import { createHash } from "node:crypto"
import { writeFileSync, readFileSync, renameSync, mkdirSync, existsSync } from "node:fs"
import { connect, createServer } from "node:net"
import { dirname } from "node:path"
import {
  Clock,
  Deferred,
  Duration,
  Effect,
  Equal,
  ExecutionStrategy,
  Exit,
  Fiber,
  HashMap,
  Layer,
  Option,
  Ref,
  Schedule,
  Schema,
  Scope,
  Stream,
} from "effect"
import { type Exited, Process, type ProcessShape, type Spawned } from "../../agent/ports/process.js"
import { type Place, Places } from "../../agent/types/place.js"
import { SpawnStage } from "../../agent/types/spawn-stage.js"
import {
  CHECKOUT_PROCESSES,
  checkoutProcessesOf,
  readCheckoutProcesses,
} from "../../library/adapters/library-fs.js"
import {
  type CheckoutProcesses,
  type HostedProcess,
  urlVariable,
} from "../../library/types/process.js"
import type { Lib } from "../../library/ports/library.js"
import type { Library } from "../../library/types/library.js"
import type { CheckoutPlace } from "../../vcs/index.js"
import { Sandboxes, type SandboxesShape } from "../../vcs/ports/sandboxes.js"
import { TrakId } from "../domain/trak.js"
import { Environment, type EnvironmentShape } from "../ports/environment.js"
import { Feed, type FeedShape, Frame } from "../ports/feed.js"
import {
  HostedProcesses,
  type HostedProcessesShape,
  type HostedRun,
  HostedState,
  type ProcessReaped,
  UnknownProcess,
} from "../ports/hosted-processes.js"
import { libraryNow } from "../ports/project-files.js"

/** How long a start may sit in each stage before its script runs without moving on. */
export type PreparingLimits = Readonly<Record<SpawnStage["_tag"], Duration.Duration>>

/**
 * Readying may remake a stale sandbox, setup script and all, so it gets the longest. A
 * copy is one exec that reports only before and after, so its limit is the whole copy's.
 */
const LIMITS: PreparingLimits = {
  Readying: Duration.minutes(10),
  Copying: Duration.minutes(1),
  Launching: Duration.minutes(2),
}

export interface HostingConfig {
  /** The pid record's path. Absent keeps none, and `reap` has nothing to read. */
  readonly record: string | undefined
  /** Over `LIMITS`, stage by stage — a test's way to see one pass. */
  readonly limits?: Partial<PreparingLimits>
}

/**
 * Where a port is looked for: clear of the engine's pairs (31000–46999), the e2e
 * harness's (47000–48998), atelier's (4321–4420), stillroom's (4870–5869) and the
 * kernel's ephemeral range, which starts at 49152 on macOS.
 */
const BAND_START = 22000
const BAND_SIZE = 9000

/** How many ports past the first choice are tried before a start is given up. */
const PORT_ATTEMPTS = 200

/** The most of a run's output held in memory, kept from the end. */
const LOG_LIMIT = 64 * 1024

/** How often what a process printed goes out as a frame — `checks-shell.ts`'s window. */
const CHUNK_WINDOW = Duration.millis(200)

/** The most of a failed start's log its reason carries: its last lines, each cut short. */
const TAIL_LINES = 3
const TAIL_WIDTH = 200

/** The longest the watchdog sleeps between two looks at a start's stage. */
const WATCH_EVERY = Duration.seconds(1)

/** How long the log is waited on to end after a process exits, so its last line is read. */
const DRAIN_WAIT = Duration.seconds(1)

/** How often the port is asked whether it answers while a process comes up. */
const PROBE_EVERY = Duration.millis(250)

/**
 * The two addresses a dev server binds. Vite binds `localhost`, which resolves to `::1`
 * alone on macOS and refuses `127.0.0.1`; stillroom binds `127.0.0.1` alone. Whichever
 * answers is the address the process is reached at.
 */
const LOOPBACKS = [
  { host: "127.0.0.1", url: (port: number) => `http://127.0.0.1:${String(port)}/` },
  { host: "::1", url: (port: number) => `http://[::1]:${String(port)}/` },
] as const

/**
 * Whose processes: a trak's, or — `undefined` — the project checkout's, which no trak
 * owns and which only a person starts and stops.
 */
type Home = TrakId | undefined

/**
 * `exec`, so the script's own process becomes the group leader's and a signal reaches
 * the server rather than a shell waiting on it; `2>&1`, so the log is one stream in the
 * order it was written. stderr is otherwise buffered whole by the Process port, which
 * for a process that logs for hours is a leak.
 */
const RUN_SCRIPT = 'exec bash "$0" 2>&1'

/**
 * Asked inside a sandbox, once for the whole wait: whether something answers on port
 * `$0` of `127.0.0.1` or `::1`, every quarter second for `$1` seconds. From this machine
 * the tunnel's own listener answers the moment it is up, whether or not the process
 * behind it does, so only a dial in the sandbox says the process came up. Both
 * addresses, because a server told `localhost` binds either, and a runner's `expose`
 * carries both.
 */
const SANDBOX_PROBE =
  'end=$((SECONDS + $1)); until (exec 3<>"/dev/tcp/127.0.0.1/$0") 2>/dev/null || (exec 3<>"/dev/tcp/::1/$0") 2>/dev/null; do [ "$SECONDS" -ge "$end" ] && exit 1; sleep 0.25; done'

const tail = (text: string): string =>
  text.length <= LOG_LIMIT ? text : text.slice(text.length - LOG_LIMIT)

/** One recorded run in the pid record — what the next boot needs to find it again. */
const Recorded = Schema.Struct({
  /** Absent for a process on the project checkout. */
  trak: Schema.optional(Schema.String),
  name: Schema.String,
  pid: Schema.Number,
  start: Schema.optional(Schema.String),
  /** The checkout it ran in, so the boot can rewrite its registry after the reap. */
  cwd: Schema.optional(Schema.String),
  /** The local half of the tunnel a sandboxed run's port is reached through. */
  tunnel: Schema.optional(
    Schema.Struct({ pid: Schema.Number, start: Schema.optional(Schema.String) }),
  ),
})
type Recorded = Schema.Schema.Type<typeof Recorded>
const RecordFile = Schema.parseJson(Schema.Array(Recorded))

/** One run of one process at one trak or the project — what every transition is keyed on. */
interface At {
  readonly trak: Home
  readonly decl: HostedProcess
  /**
   * Which run, so a fiber left over from a run that has been replaced cannot settle its
   * successor.
   */
  readonly run: number
}

/**
 * A run in a sandbox, whose port is a tunnel: the sandbox's id — the trak's, or `project` —
 * and the directory a command there is spawned in. `inProject` is the project's run, whose
 * every spawn names the project as its place, since routing by `cwd` would keep it here.
 */
interface Sandboxed {
  readonly id: string
  readonly cwd: string
  readonly inProject: boolean
}

/** A run that has a process: what its lifecycle needs to see it through. */
interface Launched extends At {
  readonly port: number
  /** Where the run is in a sandbox and its port is a tunnel. */
  readonly sandboxed: Sandboxed | undefined
  /** Settled once, when the process is gone — `undefined` where its end was unreadable. */
  readonly exit: Deferred.Deferred<Exited | undefined>
  readonly flush: Effect.Effect<void>
  /** Done once everything the process printed has been read, or after `DRAIN_WAIT`. */
  readonly drained: Effect.Effect<void>
}

/** One process at one trak, as this engine holds it. */
interface Held {
  readonly run: number
  readonly state: HostedState
  readonly log: string
  readonly chunks: number
  /** Closed to kill the run. Absent once nothing is left to kill. */
  readonly scope: Scope.CloseableScope | undefined
  /** Settled when the start is decided: up, or failed to come up. */
  readonly ready: Deferred.Deferred<void> | undefined
  /** The fiber getting a `Preparing` run as far as its spawn, which a stop interrupts. */
  readonly preparing?: Fiber.RuntimeFiber<void>
  /** Where the run's script runs, from its spawn — see `HostedRun.place`. */
  readonly place?: Place
}

/** A trak id is never empty, so `""` is the project's and can be no trak's. */
const homeKey = (trak: Home): string => trak ?? ""

const keyOf = (trak: Home, name: string): string => `${homeKey(trak)}\u0000${name}`

const live = (state: HostedState): boolean =>
  state._tag === "Preparing" || state._tag === "Starting" || state._tag === "Running"

/** Who a log line is about: the trak by its id, or the project checkout. */
const whose = (trak: Home): string => trak ?? "the project"

/** Where a run's port is looked for first: stable per home and name, so a URL usually is too. */
const firstChoice = (trak: Home, name: string): number =>
  BAND_START +
  (createHash("sha1")
    .update(`${homeKey(trak)}/${name}`)
    .digest()
    .readUInt32BE(0) %
    BAND_SIZE)

/**
 * Whether nothing is bound to `port` on either loopback. A host with no IPv6 refuses the
 * second with an address error rather than an in-use one, and that is free.
 */
const freeOn = (port: number, host: string): Promise<boolean> =>
  new Promise((done) => {
    const server = createServer()
    server.once("error", (e: NodeJS.ErrnoException) => {
      done(e.code === "EADDRNOTAVAIL" || e.code === "EAFNOSUPPORT")
    })
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => {
        done(true)
      })
    })
  })

/** The first loopback URL something answers on at `port`, or nothing. */
const answering = async (port: number): Promise<string | undefined> => {
  for (const address of LOOPBACKS) {
    // oxlint-disable-next-line no-await-in-loop -- in order: the first that answers wins
    const answered = await new Promise<boolean>((done) => {
      const socket = connect({ host: address.host, port })
      const settle = (yes: boolean): void => {
        socket.destroy()
        done(yes)
      }
      socket.setTimeout(500, () => {
        settle(false)
      })
      socket.once("connect", () => {
        settle(true)
      })
      socket.once("error", () => {
        settle(false)
      })
    })
    if (answered) return address.url(port)
  }
  return undefined
}

/** The pid record, or nothing for a file that is missing or not this shape. */
const readRecord = (path: string): readonly Recorded[] => {
  if (!existsSync(path)) return []
  const decoded = Schema.decodeUnknownEither(RecordFile)(readFileSync(path, "utf8"))
  return decoded._tag === "Right" ? decoded.right : []
}

/** Written whole and renamed into place, so a crash mid-write leaves the old record. */
const writeRecord = (path: string, entries: readonly Recorded[]): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(`${path}.tmp`, `${JSON.stringify(entries)}\n`)
  renameSync(`${path}.tmp`, path)
}

/** Kill `pid` where it is still the process started at `recorded`. */
const reapPid = (proc: ProcessShape, pid: number, recorded: string | undefined) =>
  Effect.gen(function* () {
    if (!(yield* proc.isAlive(pid))) return "gone" as const
    const start = yield* proc.startTime(pid)
    if (start === undefined || recorded === undefined || start !== recorded)
      return "declined" as const
    yield* proc.kill(pid)
    return "killed" as const
  })

/** The run, then its tunnel — which would otherwise hold the port on this machine's loopback. */
const reapOne = (proc: ProcessShape, entry: Recorded) =>
  Effect.gen(function* () {
    const outcome = yield* reapPid(proc, entry.pid, entry.start)
    if (entry.tunnel !== undefined) yield* reapPid(proc, entry.tunnel.pid, entry.tunnel.start)
    return outcome
  })

/** Where the registry sits in a checkout. Read by tools outside Orkestra. */
const REGISTRY = ".orkestra/.processes.json"

/** One live process in the registry, keyed by its name. */
interface Registered {
  readonly state: "starting" | "running"
  readonly pid: number
  readonly started?: string
  readonly port: number
  readonly url?: string
}

/**
 * The checkout whose registry a run writes, or nothing for a trak without one of its own:
 * the routes pass `""` and a turn `"."`, and a registry there would land in the person's
 * own checkout under a trak's name. The project's is that checkout, by design.
 */
const checkoutOf = (trak: Home, cwd: string): string | undefined =>
  trak === undefined || (cwd !== "" && cwd !== ".") ? cwd : undefined

/**
 * Written whole beside the file and renamed over it, so a reader never sees half of one.
 * Nothing where the checkout is gone: a write that lands after the archive removed it
 * would otherwise make the directory again. A sandboxed checkout's is written there.
 */
const writeRegistry = (
  sv: Supervisor,
  cwd: string,
  entries: Readonly<Record<string, Registered>>,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const text = `${JSON.stringify(entries, undefined, 2)}\n`
    const place = yield* placeIn(sv, cwd)
    if (place !== undefined) {
      yield* place.sandboxes.write(place.at, REGISTRY, text)
      return
    }
    yield* Effect.try(() => {
      if (!existsSync(cwd)) return
      const path = `${cwd}/${REGISTRY}`
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(`${path}.tmp`, text)
      renameSync(`${path}.tmp`, path)
    })
  })

/** Everything the supervisor holds, built once with the layer. */
interface Supervisor {
  readonly proc: ProcessShape
  readonly environment: EnvironmentShape
  readonly feed: FeedShape
  /** Read on each use, so a reload's declarations are the next start's. A run keeps the one it began with. */
  readonly library: Effect.Effect<Library>
  /** The layer's own scope: every run's is forked off it, and every lifecycle runs in it. */
  readonly root: Scope.Scope
  readonly held: Ref.Ref<HashMap.HashMap<string, Held>>
  readonly counter: Ref.Ref<number>
  readonly recorded: Ref.Ref<readonly Recorded[]>
  /** Picking a port and claiming it, so two starts at once never take the same one. */
  readonly portPermit: Effect.Semaphore
  /** One per process, so a stop never lands in the middle of a start. */
  readonly permits: Map<string, Effect.Semaphore>
  /** Each home's checkout by `homeKey`, learned from `start`, `list` or the pid record. */
  readonly checkouts: Map<string, string>
  /**
   * The declaration each process's latest run began with, by `keyOf`, so a process
   * whose script has since gone from its checkout can still be stopped and shown.
   */
  readonly ran: Map<string, HostedProcess>
  /**
   * One registry write at a time, so a write built from older state can never land after
   * one built from newer.
   */
  readonly registryPermit: Effect.Semaphore
  readonly config: HostingConfig
  /**
   * Where a sandboxed checkout's files are reached, and its processes run and are brought
   * out; none, or one with no runner, keeps every process and file on this machine's disk.
   */
  readonly sandboxes: Option.Option<SandboxesShape>
  /** Each sandboxed checkout's latest read of its declarations, by `readKey` — see `sharedRead`. */
  readonly reads: Map<string, SharedRead>
}

/** What `collect` answered, or how it failed. */
type Collected = Exit.Exit<
  Effect.Effect.Success<ReturnType<SandboxesShape["collect"]>>,
  Effect.Effect.Error<ReturnType<SandboxesShape["collect"]>>
>

/** One sandboxed checkout's reads: one at a time, and the latest with when it began. */
interface SharedRead {
  readonly permit: Effect.Semaphore
  latest: { readonly at: number; readonly answer: Collected } | undefined
}

/** A checkout in a trak's sandbox, and the sandboxes that reach it. */
interface InSandbox {
  readonly sandboxes: SandboxesShape
  readonly at: CheckoutPlace
}

/** `cwd` as a sandboxed checkout, or nothing for one on this machine's disk. */
const placeIn = (sv: Supervisor, cwd: string): Effect.Effect<InSandbox | undefined> =>
  Option.match(sv.sandboxes, {
    onNone: () => Effect.succeed(undefined),
    onSome: (sandboxes) =>
      Effect.map(sandboxes.placeOf(cwd), (at) =>
        at === undefined ? undefined : { sandboxes, at },
      ),
  })

/**
 * How long one read of a sandboxed checkout's declarations answers every caller, from when
 * it began. Under the page's 15 s poll, so a script an agent adds mid-turn is listed by the
 * next poll but one at the latest.
 */
const READ_FOR = Duration.seconds(10)

const readKey = (at: CheckoutPlace): string => `${at.trak}\u0000${at.path}`

/**
 * `at` collected without waking its sandbox, shared: one read at a time per checkout, and
 * one begun within `READ_FOR` answers the callers queued behind it. Every page polls each
 * trak's list, and each read is a session on the sandbox's one SSH connection, which turns
 * and checks share and which refuses past ten at once.
 */
const sharedRead = (
  sv: Supervisor,
  sandboxes: SandboxesShape,
  at: CheckoutPlace,
): Effect.Effect<Effect.Effect.Success<Collected>, Effect.Effect.Error<Collected>> =>
  Effect.suspend(() => {
    const key = readKey(at)
    const found = sv.reads.get(key)
    const shared: SharedRead = found ?? { permit: Effect.unsafeMakeSemaphore(1), latest: undefined }
    if (found === undefined) sv.reads.set(key, shared)
    return shared.permit.withPermits(1)(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const latest = shared.latest
        if (latest !== undefined && now - latest.at < Duration.toMillis(READ_FOR)) {
          return yield* latest.answer
        }
        const answer = yield* Effect.exit(sandboxes.collect(at, { wake: false }))
        shared.latest = { at: now, answer }
        return yield* answer
      }),
    )
  })

/**
 * What a sandboxed checkout declares. A stopped sandbox declares nothing of its own, for
 * nothing is readable there; one that cannot be reached is one unreadable entry, as a
 * directory on disk that cannot be read is. A trak with no sandbox declares nothing of its
 * own either, and its checkout is forgotten — its worktree is gone, or going — so a caller
 * that names none reads nothing there again. A read that wakes the sandbox is its own.
 */
const sandboxedDeclarations = (
  sv: Supervisor,
  trak: Home,
  place: InSandbox,
  checkout: string,
  project: ReadonlyMap<string, HostedProcess>,
  wake: boolean,
): Effect.Effect<CheckoutProcesses> => {
  const at = { trak: place.at.trak, path: `${place.at.path}/${CHECKOUT_PROCESSES}` }
  return (wake ? place.sandboxes.collect(at, { wake }) : sharedRead(sv, place.sandboxes, at)).pipe(
    Effect.map((files) => {
      if (files === "absent") {
        sv.reads.delete(readKey(at))
        if (sv.checkouts.get(homeKey(trak)) === checkout) sv.checkouts.delete(homeKey(trak))
      }
      return files === "stopped" || files === "absent"
        ? { processes: project, unreadable: [] }
        : checkoutProcessesOf(
            checkout,
            project,
            new Map([...files].map(([name, bytes]) => [name, decoder.decode(bytes)])),
          )
    }),
    Effect.catchTag("GitFailed", (e) =>
      Effect.succeed({
        processes: project,
        unreadable: [{ name: "processes", shown: CHECKOUT_PROCESSES, reason: e.reason }],
      }),
    ),
  )
}

const decoder = new TextDecoder()

const permitFor = (sv: Supervisor, key: string): Effect.Semaphore => {
  const found = sv.permits.get(key)
  if (found !== undefined) return found
  const made = Effect.unsafeMakeSemaphore(1)
  sv.permits.set(key, made)
  return made
}

const entryOf = (sv: Supervisor, trak: Home, name: string): Effect.Effect<Held | undefined> =>
  Effect.map(Ref.get(sv.held), (map) => Option.getOrUndefined(HashMap.get(map, keyOf(trak, name))))

/**
 * What a home declares. The project reads the engine's library. A trak with a checkout of
 * its own reads that checkout's `.orkestra/processes/` over the library on every call, so
 * a script an agent adds there is listed and started at that trak and no other before it
 * merges; a trak without one reads the library.
 */
const declarationsAt = (
  sv: Supervisor,
  trak: Home,
  cwd: string,
  wake = false,
): Effect.Effect<CheckoutProcesses> =>
  Effect.gen(function* () {
    const lib = yield* sv.library
    const checkout =
      trak === undefined ? undefined : (checkoutOf(trak, cwd) ?? sv.checkouts.get(homeKey(trak)))
    if (checkout === undefined) return { processes: lib.processes, unreadable: [] }
    sv.checkouts.set(homeKey(trak), checkout)
    const place = yield* placeIn(sv, checkout)
    return place === undefined
      ? yield* readCheckoutProcesses(checkout, lib.processes)
      : yield* sandboxedDeclarations(sv, trak, place, checkout, lib.processes, wake)
  })

/**
 * The declaration `name` has at the home, or — for one no longer declared there — the one
 * its latest run began with. A broken file is unknown, with what is wrong with it.
 */
const declared = (
  sv: Supervisor,
  trak: Home,
  cwd: string,
  name: string,
  wake = false,
): Effect.Effect<HostedProcess, UnknownProcess> =>
  Effect.flatMap(declarationsAt(sv, trak, cwd, wake), (at) => {
    const found = at.processes.get(name) ?? sv.ran.get(keyOf(trak, name))
    if (found !== undefined) return Effect.succeed(found)
    const broken = at.unreadable.find((u) => u.name === name)
    return Effect.fail(
      new UnknownProcess(
        broken === undefined ? { name } : { name, reason: `${broken.shown}: ${broken.reason}` },
      ),
    )
  })

const viewOf = (decl: HostedProcess, entry: Held | undefined): HostedRun => ({
  name: decl.name,
  description: decl.description,
  page: decl.page,
  readySeconds: decl.readySeconds,
  run: entry?.run ?? 0,
  state: entry?.state ?? HostedState.NotStarted(),
  log: entry?.log ?? "",
  chunks: entry?.chunks ?? 0,
  ...(entry?.place === undefined ? {} : { place: entry.place }),
})

const current = (sv: Supervisor, trak: Home, decl: HostedProcess): Effect.Effect<HostedRun> =>
  Effect.map(entryOf(sv, trak, decl.name), (entry) => viewOf(decl, entry))

/**
 * Rewrite the home's registry from what is held now: every Starting and Running process,
 * with the pid and start time the pid record holds for it. A write that fails is logged,
 * not fatal.
 */
const register = (sv: Supervisor, trak: Home): Effect.Effect<void> => {
  const cwd = sv.checkouts.get(homeKey(trak))
  if (cwd === undefined) return Effect.void
  return sv.registryPermit.withPermits(1)(
    Effect.gen(function* () {
      const held = yield* Ref.get(sv.held)
      const recorded = yield* Ref.get(sv.recorded)
      const entries: Record<string, Registered> = {}
      for (const pid of recorded.filter((e) => e.trak === trak)) {
        const name = pid.name
        const state = Option.getOrUndefined(HashMap.get(held, keyOf(trak, name)))?.state
        const known = { pid: pid.pid, ...(pid.start === undefined ? {} : { started: pid.start }) }
        if (state?._tag === "Starting")
          entries[name] = { state: "starting", ...known, port: state.port }
        if (state?._tag === "Running")
          entries[name] = { state: "running", ...known, port: state.port, url: state.url }
      }
      yield* writeRegistry(sv, cwd, entries).pipe(Effect.ignoreLogged)
    }),
  )
}

/** Say what changed: the registry first, so a watcher told of it can read it there. */
const publish = (sv: Supervisor, trak: Home, decl: HostedProcess): Effect.Effect<void> =>
  Effect.andThen(
    register(sv, trak),
    Effect.flatMap(current(sv, trak, decl), (process) =>
      sv.feed.publish(Frame.Process({ id: trak, process })),
    ),
  )

/** Change the pid record and write it through. A write that fails is logged, not fatal. */
const remember = (
  sv: Supervisor,
  change: (entries: readonly Recorded[]) => readonly Recorded[],
): Effect.Effect<void> =>
  Effect.flatMap(Ref.updateAndGet(sv.recorded, change), (entries) => {
    const path = sv.config.record
    return path === undefined
      ? Effect.void
      : Effect.try(() => {
          writeRecord(path, entries)
        }).pipe(Effect.ignoreLogged)
  })

const forget = (sv: Supervisor, trak: Home, name: string): Effect.Effect<void> =>
  remember(sv, (entries) => entries.filter((e) => e.trak !== trak || e.name !== name))

/** Put an entry in place whole, and say so. */
const install = (sv: Supervisor, trak: Home, decl: HostedProcess, entry: Held) =>
  Effect.gen(function* () {
    sv.ran.set(keyOf(trak, decl.name), decl)
    yield* Ref.update(sv.held, (map) => HashMap.set(map, keyOf(trak, decl.name), entry))
    yield* publish(sv, trak, decl)
  })

/**
 * Move the run from one of `from` to what `to` makes of it, and say whether it moved.
 */
const settle = (
  sv: Supervisor,
  at: At,
  from: readonly HostedState["_tag"][],
  to: (state: HostedState) => HostedState,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const key = keyOf(at.trak, at.decl.name)
    const moved = yield* Ref.modify(sv.held, (map) => {
      const entry = Option.getOrUndefined(HashMap.get(map, key))
      if (entry === undefined || entry.run !== at.run || !from.includes(entry.state._tag))
        return [false, map]
      return [true, HashMap.set(map, key, { ...entry, state: to(entry.state) })]
    })
    if (moved) yield* publish(sv, at.trak, at.decl)
    return moved
  })

/** Kill what is left of a run and let go of its record — after its state has moved. */
const release = (sv: Supervisor, at: At): Effect.Effect<void> =>
  Effect.gen(function* () {
    const key = keyOf(at.trak, at.decl.name)
    const entry = yield* Ref.modify(sv.held, (map) => {
      const found = Option.getOrUndefined(HashMap.get(map, key))
      if (found === undefined || found.run !== at.run) return [undefined, map]
      const cleared: Held = {
        run: found.run,
        state: found.state,
        log: found.log,
        chunks: found.chunks,
        scope: undefined,
        ready: found.ready,
        ...(found.place === undefined ? {} : { place: found.place }),
      }
      return [found, HashMap.set(map, key, cleared)]
    })
    // The preparation first: interrupted, it closes the run's scope it was spawning into.
    if (entry?.preparing !== undefined) yield* Fiber.interrupt(entry.preparing)
    if (entry?.scope !== undefined) yield* Scope.close(entry.scope, Exit.void)
    if (entry?.ready !== undefined) yield* Deferred.succeed(entry.ready, undefined)
    yield* forget(sv, at.trak, at.decl.name)
  })

/**
 * Put what the run printed since last time on its log and on the feed. The log and the
 * frame come out of one `Ref.modify`, so the `seq` a watcher compares is the one reached.
 */
const flushing = (sv: Supervisor, at: At, pending: Ref.Ref<string>): Effect.Effect<void> =>
  Effect.flatMap(Ref.getAndSet(pending, ""), (chunk) =>
    chunk === ""
      ? Effect.void
      : Ref.modify(sv.held, (map) => {
          const key = keyOf(at.trak, at.decl.name)
          const entry = Option.getOrUndefined(HashMap.get(map, key))
          if (entry === undefined || entry.run !== at.run) return [undefined, map]
          const next = { ...entry, log: tail(entry.log + chunk), chunks: entry.chunks + 1 }
          return [next.chunks, HashMap.set(map, key, next)]
        }).pipe(
          Effect.flatMap((seq) =>
            seq === undefined
              ? Effect.void
              : sv.feed.publish(
                  Frame.ProcessOutput({
                    id: at.trak,
                    name: at.decl.name,
                    run: at.run,
                    seq,
                    chunk,
                  }),
                ),
          ),
        ),
  )

/** Asks the port until it answers or the declaration's time is up. */
const probe = (port: number, readySeconds: number): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    const deadline = (yield* Clock.currentTimeMillis) + readySeconds * 1000
    for (;;) {
      const url = yield* Effect.promise(() => answering(port))
      if (url !== undefined) return url
      if ((yield* Clock.currentTimeMillis) >= deadline) return undefined
      yield* Effect.sleep(PROBE_EVERY)
    }
  })

/**
 * `probe` for a run in a sandbox: the process answering there, then the tunnel answering
 * here — the address everything on this machine dials. A probe that cannot be spawned is
 * nothing answering.
 */
const probeSandboxed = (
  sv: Supervisor,
  sandboxed: Sandboxed,
  port: number,
  readySeconds: number,
): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    const spawned = yield* sv.proc.spawn({
      command: "bash",
      args: ["-c", SANDBOX_PROBE, String(port), String(readySeconds)],
      cwd: sandboxed.cwd,
      env: {},
      stdin: undefined,
      holdStdin: false,
      // In the project's sandbox, a read: a new spawn there fetches `origin` and moves the
      // checkout first, under the server that is running from it.
      ...(sandboxed.inProject ? { inProject: true as const, ifRunning: true } : {}),
    })
    yield* Stream.runDrain(spawned.lines)
    const exited = yield* spawned.exited
    return exited.code === 0 ? yield* probe(port, readySeconds) : undefined
  }).pipe(
    Effect.scoped,
    Effect.orElseSucceed(() => undefined),
  )

/** The start is decided: whoever is waiting on it is let go. */
const readied = (sv: Supervisor, at: At): Effect.Effect<void> =>
  Effect.flatMap(entryOf(sv, at.trak, at.decl.name), (entry) =>
    entry?.run === at.run && entry.ready !== undefined
      ? Effect.asVoid(Deferred.succeed(entry.ready, undefined))
      : Effect.void,
  )

/** It came up: running from now, and exited when the process ends on its own. */
const cameUp = (sv: Supervisor, launched: Launched, url: string) =>
  Effect.gen(function* () {
    // What it printed coming up is on the log before anybody is told it is up.
    yield* launched.flush
    const now = yield* Clock.currentTimeMillis
    yield* settle(sv, launched, ["Starting"], (s) =>
      s._tag === "Starting"
        ? HostedState.Running({ port: s.port, startedAt: s.startedAt, readyAt: now, url })
        : s,
    )
    yield* readied(sv, launched)
    const ended = yield* Deferred.await(launched.exit)
    yield* launched.flush
    const at = yield* Clock.currentTimeMillis
    const exited = yield* settle(sv, launched, ["Running"], (s) =>
      s._tag === "Running"
        ? HostedState.Exited({
            port: s.port,
            startedAt: s.startedAt,
            at,
            code: ended?.code,
            signal: ended?.signal,
          })
        : s,
    )
    // An exit is a stop to whatever needs it. Only when this settle moved the state: a
    // stop that got here first has already taken the dependents down itself.
    if (exited) yield* stopDependents(sv, launched.trak, launched.decl.name)
  })

/** The last lines `log` holds that say anything, each cut to a width a screen can hold. */
const tailOf = (log: string): readonly string[] =>
  log
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "")
    .slice(-TAIL_LINES)
    .map((line) => (line.length <= TAIL_WIDTH ? line : `${line.slice(0, TAIL_WIDTH - 1)}…`))

/** Say a start failed, at WARN, naming the trak — the engine log keeps it. */
const warnDown = (trak: Home, name: string, reason: string): Effect.Effect<void> =>
  Effect.logWarning(`${whose(trak)}: process ${name} did not come up: ${reason}`)

/** It did not come up, for `reason`, followed by the last lines the process printed. */
const cameDown = (sv: Supervisor, launched: Launched, reason: string) =>
  Effect.gen(function* () {
    yield* launched.drained
    yield* launched.flush
    const log = (yield* entryOf(sv, launched.trak, launched.decl.name))?.log ?? ""
    const said = [reason, ...tailOf(log)].join("\n")
    const now = yield* Clock.currentTimeMillis
    const moved = yield* settle(sv, launched, ["Starting"], (s) =>
      s._tag === "Starting"
        ? HostedState.DidNotComeUp({
            port: s.port,
            startedAt: s.startedAt,
            at: now,
            reason: said,
          })
        : s,
    )
    if (moved) yield* warnDown(launched.trak, launched.decl.name, said)
  })

/**
 * One run from spawn to end, on a fiber of the layer's own: the port answering or the
 * process exiting first decides the start, and the exit after a good start is the run
 * ending on its own. A stop that got there first has already moved the state, so no
 * settle here finds the state it expects, and each does nothing.
 */
const lifecycle = (sv: Supervisor, launched: Launched): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { port, decl, sandboxed } = launched
    const asked =
      sandboxed === undefined
        ? probe(port, decl.readySeconds)
        : probeSandboxed(sv, sandboxed, port, decl.readySeconds)
    const first = yield* Effect.raceFirst(
      Effect.map(Deferred.await(launched.exit), (exit) => ({ _tag: "Exited" as const, exit })),
      Effect.map(asked, (url) => ({ _tag: "Probed" as const, url })),
    )
    if (first._tag === "Probed" && first.url !== undefined) {
      yield* cameUp(sv, launched, first.url)
    } else {
      const exited =
        first._tag === "Exited" && first.exit?.code !== undefined
          ? ` with code ${String(first.exit.code)}`
          : ""
      yield* cameDown(
        sv,
        launched,
        first._tag === "Probed"
          ? `Nothing answered on port ${String(port)} in ${String(decl.readySeconds)}s, so it was stopped.`
          : `It exited${exited} before anything answered on port ${String(port)}.`,
      )
    }
    yield* release(sv, launched)
  })

/** A port nobody has: not one this engine handed out, and bound on neither loopback. */
const pickPort = (sv: Supervisor, trak: Home, name: string): Effect.Effect<number | undefined> =>
  Effect.gen(function* () {
    const taken = new Set(
      [...HashMap.values(yield* Ref.get(sv.held))].flatMap((e) =>
        e.state._tag === "Preparing" || e.state._tag === "Starting" || e.state._tag === "Running"
          ? [e.state.port]
          : [],
      ),
    )
    const first = firstChoice(trak, name)
    for (let i = 0; i < PORT_ATTEMPTS; i += 1) {
      const port = BAND_START + ((first - BAND_START + i) % BAND_SIZE)
      if (taken.has(port)) continue
      const free = yield* Effect.promise(async () =>
        (await freeOn(port, "127.0.0.1")) ? freeOn(port, "::1") : false,
      )
      if (free) return port
    }
    return undefined
  })

/** A start that never got as far as preparing: no port, or a needed process not up. */
const failedToSpawn = (sv: Supervisor, at: At, port: number, reason: string) =>
  Effect.flatMap(Clock.currentTimeMillis, (now) =>
    Effect.zipRight(
      install(sv, at.trak, at.decl, {
        run: at.run,
        state: HostedState.DidNotComeUp({ port, startedAt: now, at: now, reason }),
        log: "",
        chunks: 0,
        scope: undefined,
        ready: undefined,
      }),
      warnDown(at.trak, at.decl.name, reason),
    ),
  )

/**
 * Where `trak`'s runs are in a sandbox. A trak's are in its own, at the checkout — which the
 * Process layer decides by the same working directory, so a run here and its spawn always
 * agree. The project's are in sandbox `project` where `Sandboxes.project` names it, under an
 * external store, and here otherwise.
 */
const sandboxedAt = (
  sv: Supervisor,
  trak: Home,
  cwd: string,
): Effect.Effect<Sandboxed | undefined> =>
  Option.match(sv.sandboxes, {
    onNone: () => Effect.succeed(undefined),
    onSome: (sandboxes) =>
      trak === undefined
        ? Effect.map(sandboxes.project, (at) =>
            at === undefined ? undefined : { id: at.trak, cwd: at.path, inProject: true },
          )
        : checkoutOf(trak, cwd) === undefined
          ? Effect.succeed(undefined)
          : Effect.map(sandboxes.holds(trak), (inUse) =>
              inUse ? { id: trak, cwd, inProject: false } : undefined,
            ),
  })

/**
 * Spawn the script in the run's scope, with the project's environment and the port. In a
 * sandbox the port is also brought to this machine's loopback, by a tunnel held in the
 * same scope, so it ends when the run does and the same number answers on both sides.
 * The caller closes the scope where this fails.
 */
const spawnIn = (
  sv: Supervisor,
  sandboxed: Sandboxed | undefined,
  scope: Scope.Scope,
  spawning: { readonly cwd: string; readonly decl: HostedProcess; readonly port: number },
  onStage: (stage: SpawnStage) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const { cwd, decl, port } = spawning
    // In the project's sandbox the env script is sourced there too: captured here, it would
    // hand the engine's whole environment to the sandbox as the run's explicit variables.
    const inProject = sandboxed?.inProject === true ? { inProject: true as const } : {}
    const captured = yield* sv.environment.capture(cwd, onStage, inProject)
    const spawned = yield* sv.proc
      .spawn({
        command: "bash",
        args: ["-c", RUN_SCRIPT, decl.path],
        cwd,
        env: { ...captured, PORT: String(port) },
        stdin: undefined,
        holdStdin: false,
        // A server left running is not work: an open page must not keep a sandbox billing.
        keepsAwake: false,
        ...inProject,
        onStage,
      })
      .pipe(
        Scope.extend(scope),
        Effect.mapError((e) => ({ reason: `It could not be started: ${e.reason}` })),
      )
    const sandboxes = Option.getOrUndefined(sv.sandboxes)
    const tunnel =
      sandboxed === undefined || sandboxes === undefined
        ? undefined
        : yield* sandboxes.expose(sandboxed.id, port).pipe(
            Scope.extend(scope),
            Effect.mapError((e) => ({
              reason: `Its port could not be brought out of the sandbox: ${e.reason}`,
            })),
          )
    return { spawned, tunnel }
  })

/** What a stage is called in a reason, and how far it got. */
const stageText = (stage: SpawnStage): string =>
  SpawnStage.$match(stage, {
    Readying: () => "waking the sandbox and checking its seed",
    Copying: (c) => `copying files into the sandbox (${String(c.sent)} of ${String(c.total)} sent)`,
    Launching: () => "starting its script",
  })

/**
 * Fails, naming the stage, once the stage `last` holds has gone its limit with no report
 * after it. Read again every `WATCH_EVERY` at most, because a report can move the stage
 * to one with a shorter limit than the one it slept on.
 */
const watchdog = (
  limits: PreparingLimits,
  last: Ref.Ref<{ readonly stage: SpawnStage; readonly at: number }>,
): Effect.Effect<never, { readonly reason: string }> =>
  Effect.gen(function* () {
    for (;;) {
      const { stage, at } = yield* Ref.get(last)
      const limit = limits[stage._tag]
      const left = at + Duration.toMillis(limit) - (yield* Clock.currentTimeMillis)
      if (left <= 0) {
        return yield* Effect.fail({
          reason: `It did not start: ${stageText(stage)} went ${Duration.format(limit)} without moving on, so it was stopped.`,
        })
      }
      yield* Effect.sleep(Duration.millis(Math.min(left, Duration.toMillis(WATCH_EVERY))))
    }
  })

/**
 * Move a `Preparing` run of this start along, and say so; nothing for one that has moved
 * on, or that is at this stage already — a spawn reports `Readying` again after the
 * environment's own spawn did.
 */
const staged = (sv: Supervisor, at: At, stage: SpawnStage): Effect.Effect<void> =>
  Effect.flatMap(entryOf(sv, at.trak, at.decl.name), (entry) =>
    entry?.state._tag === "Preparing" && Equal.equals(entry.state.stage, stage)
      ? Effect.void
      : Effect.asVoid(
          settle(sv, at, ["Preparing"], (s) =>
            s._tag === "Preparing" ? HostedState.Preparing({ ...s, stage }) : s,
          ),
        ),
  )

/**
 * Hand the preparing run its process: `Starting` from now, with the scope that holds it.
 * `false` where the run is no longer the one preparing — stopped while it spawned.
 */
const toStarting = (
  sv: Supervisor,
  at: At,
  scope: Scope.CloseableScope,
  spawned: { readonly port: number; readonly place: Place },
) =>
  Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis
    const key = keyOf(at.trak, at.decl.name)
    const moved = yield* Ref.modify(sv.held, (map) => {
      const entry = Option.getOrUndefined(HashMap.get(map, key))
      if (entry === undefined || entry.run !== at.run || entry.state._tag !== "Preparing")
        return [false, map]
      const next: Held = {
        run: entry.run,
        state: HostedState.Starting({ port: spawned.port, startedAt }),
        log: entry.log,
        chunks: entry.chunks,
        scope,
        ready: entry.ready,
        place: spawned.place,
      }
      return [true, HashMap.set(map, key, next)]
    })
    if (moved) yield* publish(sv, at.trak, at.decl)
    return moved
  })

/** The preparation failed for `reason`: the run did not come up, and nothing is left of it. */
const preparationFailed = (sv: Supervisor, at: At, reason: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const moved = yield* settle(sv, at, ["Preparing"], (s) =>
      s._tag === "Preparing"
        ? HostedState.DidNotComeUp({ port: s.port, startedAt: s.startedAt, at: now, reason })
        : s,
    )
    if (!moved) return
    yield* warnDown(at.trak, at.decl.name, reason)
    yield* readied(sv, at)
  })

/**
 * From the press to the spawn, on the fiber a stop interrupts: each stage the Process
 * layer reports goes on the run's state and moves the watchdog's deadline. Once spawned,
 * the run is `Starting` and its lifecycle has it.
 */
const prepare = (
  sv: Supervisor,
  at: At,
  spawning: {
    readonly cwd: string
    readonly port: number
    readonly sandboxed: Sandboxed | undefined
  },
  first: SpawnStage,
) => {
  const { cwd, port, sandboxed } = spawning
  const decl = at.decl
  const limits = { ...LIMITS, ...sv.config.limits }
  return Effect.flatMap(Scope.fork(sv.root, ExecutionStrategy.sequential), (scope) =>
    Effect.gen(function* () {
      const last = yield* Ref.make({ stage: first, at: yield* Clock.currentTimeMillis })
      const onStage = (stage: SpawnStage) =>
        Effect.flatMap(Clock.currentTimeMillis, (now) =>
          Effect.zipRight(Ref.set(last, { stage, at: now }), staged(sv, at, stage)),
        )
      const started = yield* Effect.either(
        Effect.raceFirst(
          spawnIn(sv, sandboxed, scope, { cwd, decl, port }, onStage),
          watchdog(limits, last),
        ),
      )
      if (started._tag === "Left") {
        yield* Scope.close(scope, Exit.void)
        return yield* preparationFailed(sv, at, started.left.reason)
      }
      const { spawned, tunnel } = started.right
      yield* handOver(sv, { ...at, port, sandboxed, cwd, scope }, spawned, tunnel)
    }).pipe(Effect.onInterrupt(() => Scope.close(scope, Exit.void))),
  )
}

/**
 * The spawned run, recorded, made `Starting` and handed to its lifecycle — or, where a
 * stop moved it first, ended. A stop that interrupts it here has the run's scope closed by
 * `prepare` and its record forgotten by `release`, which waits for this fiber first.
 */
const handOver = (
  sv: Supervisor,
  run: At & {
    readonly port: number
    readonly sandboxed: Sandboxed | undefined
    readonly cwd: string
    readonly scope: Scope.CloseableScope
  },
  spawned: Spawned,
  tunnel: { readonly pid: number } | undefined,
) =>
  Effect.gen(function* () {
    const { trak, decl, port, cwd, scope } = run
    // Read from the moment of the spawn, before anything else is awaited: a line printed
    // before the reader is listening is lost, and a script's first line is usually the
    // one that says why it failed.
    const pending = yield* Ref.make("")
    const flush = flushing(sv, run, pending)
    const reader = yield* Effect.forkIn(
      Effect.ignore(
        Stream.runForEach(spawned.lines, (line) =>
          Ref.update(pending, (text) => `${text}${line}\n`),
        ),
      ),
      scope,
    )
    const drained = Effect.ignore(Effect.timeout(Fiber.await(reader), DRAIN_WAIT))
    // Waited on from the moment of the spawn too, and once: a process that exits between
    // two separate waits closes before the second is listening, and its run never ends.
    const exit = yield* Deferred.make<Exited | undefined>()
    yield* Effect.forkIn(
      Effect.flatMap(Effect.option(spawned.exited), (e) =>
        Deferred.succeed(exit, Option.getOrUndefined(e)),
      ),
      sv.root,
    )
    yield* recordRun(sv, trak, decl, cwd, spawned.pid, tunnel)
    const place = spawned.place ?? Places.local()
    if (!(yield* toStarting(sv, run, scope, { port, place }))) {
      yield* Scope.close(scope, Exit.void)
      yield* forget(sv, trak, decl.name)
      return
    }
    yield* Effect.forkIn(Effect.repeat(flush, Schedule.spaced(CHUNK_WINDOW)), scope)
    yield* Effect.forkIn(lifecycle(sv, { ...run, exit, flush, drained }), sv.root)
  })

/** The run in the pid record, with its start time and its tunnel's, for the next boot's reap. */
const recordRun = (
  sv: Supervisor,
  trak: Home,
  decl: HostedProcess,
  cwd: string,
  pid: number,
  tunnel: { readonly pid: number } | undefined,
) =>
  Effect.gen(function* () {
    const start = yield* sv.proc.startTime(pid)
    const tunnelStart = tunnel === undefined ? undefined : yield* sv.proc.startTime(tunnel.pid)
    yield* remember(sv, (entries) => [
      ...entries.filter((e) => e.trak !== trak || e.name !== decl.name),
      {
        ...(trak === undefined ? {} : { trak }),
        name: decl.name,
        pid,
        ...(start === undefined ? {} : { start }),
        ...(checkoutOf(trak, cwd) === undefined ? {} : { cwd }),
        ...(tunnel === undefined
          ? {}
          : {
              tunnel: {
                pid: tunnel.pid,
                ...(tunnelStart === undefined ? {} : { start: tunnelStart }),
              },
            }),
      },
    ])
  })

/**
 * Put the run in place as `Preparing` and start its preparation, answering the deferred
 * the caller waits on — or nothing, where there is no port to start it on.
 */
const launch = (sv: Supervisor, trak: Home, cwd: string, decl: HostedProcess) =>
  Effect.gen(function* () {
    const at: At = { trak, decl, run: yield* Ref.updateAndGet(sv.counter, (n) => n + 1) }
    const port = yield* sv.portPermit.withPermits(1)(pickPort(sv, trak, decl.name))
    if (port === undefined) {
      yield* failedToSpawn(sv, at, 0, "No free port was found to start it on.")
      return undefined
    }
    const sandboxed = yield* sandboxedAt(sv, trak, cwd)
    yield* Effect.logInfo(
      `${whose(trak)}: process ${decl.name} is starting on port ${String(port)}${sandboxed === undefined ? "" : " in the sandbox"}`,
    )
    const first = sandboxed === undefined ? SpawnStage.Launching() : SpawnStage.Readying()
    const ready = yield* Deferred.make<void>()
    const startedAt = yield* Clock.currentTimeMillis
    yield* install(sv, trak, decl, {
      run: at.run,
      state: HostedState.Preparing({ port, startedAt, stage: first }),
      log: "",
      chunks: 0,
      scope: undefined,
      ready,
    })
    const fiber = yield* Effect.forkIn(prepare(sv, at, { cwd, port, sandboxed }, first), sv.root)
    // Held only while it is still preparing: a fiber that already handed over has no stop to wait on.
    yield* Ref.update(sv.held, (map) => {
      const key = keyOf(trak, decl.name)
      const entry = Option.getOrUndefined(HashMap.get(map, key))
      return entry?.run === at.run && entry.state._tag === "Preparing"
        ? HashMap.set(map, key, { ...entry, preparing: fiber })
        : map
    })
    return ready
  })

/** The processes at the home that list `name` under `needs:`. */
const dependentsOf = (
  sv: Supervisor,
  trak: Home,
  name: string,
): Effect.Effect<readonly HostedProcess[]> =>
  Effect.map(declarationsAt(sv, trak, ""), (at) =>
    [...at.processes.values()].filter((p) => p.needs.includes(name)),
  )

/** Why a needed process is not up, as the reason the process that needs it gives. */
const notUp = (name: string, state: HostedState): string =>
  HostedState.$match(state, {
    NotStarted: () => `It needs \`${name}\`, which was not started.`,
    Preparing: () => `It needs \`${name}\`, which was still starting.`,
    Starting: () => `It needs \`${name}\`, which was still starting.`,
    Running: () => `It needs \`${name}\`, which is running.`,
    DidNotComeUp: (s) => `It needs \`${name}\`, which did not come up: ${s.reason}`,
    Exited: (s) =>
      `It needs \`${name}\`, which exited${s.code === undefined ? "" : ` with code ${String(s.code)}`}${s.signal === undefined ? "" : ` on ${s.signal}`}.`,
    Stopped: () => `It needs \`${name}\`, which was stopped before this could start.`,
    StoppedByRestart: () => `It needs \`${name}\`, which was stopped by an engine restart.`,
  })

/**
 * Start each process `decl` needs, through `start`, and answer why the first that is not
 * running keeps `decl` from starting — or nothing, where all of them are up. Each is
 * started at once and awaited outside `decl`'s permit, so a stop of a needed process,
 * which stops `decl` first, is never made to wait for `decl`'s start.
 */
const startNeeds = (
  sv: Supervisor,
  trak: Home,
  cwd: string,
  decl: HostedProcess,
): Effect.Effect<string | undefined, UnknownProcess> =>
  Effect.map(
    Effect.forEach(decl.needs, (name) => start(sv)(trak, cwd, name), { concurrency: "unbounded" }),
    (runs) => {
      const down = runs.find((run) => run.state._tag !== "Running")
      return down === undefined ? undefined : notUp(down.name, down.state)
    },
  )

/**
 * Read again under `decl`'s permit, just before the spawn: a needed process can be
 * stopped between coming up and this, and a dependent spawned after that would be
 * running on nothing.
 */
const stillNeeded = (sv: Supervisor, trak: Home, decl: HostedProcess) =>
  Effect.gen(function* () {
    for (const name of decl.needs) {
      const state = (yield* entryOf(sv, trak, name))?.state ?? HostedState.NotStarted()
      if (state._tag !== "Running") return notUp(name, state)
    }
    return undefined
  })

const start =
  (sv: Supervisor): HostedProcessesShape["start"] =>
  (trak, cwd, name) =>
    Effect.gen(function* () {
      // As work: this start runs the process in the checkout, sandbox or not.
      const decl = yield* declared(sv, trak, cwd, name, true)
      const checkout = checkoutOf(trak, cwd)
      if (checkout !== undefined) sv.checkouts.set(homeKey(trak), checkout)
      // Before the permit, so `ready_seconds` counts from this process's own spawn and
      // never from its needed processes coming up.
      const needed = yield* startNeeds(sv, trak, cwd, decl)
      const ready = yield* permitFor(sv, keyOf(trak, name)).withPermits(1)(
        Effect.gen(function* () {
          const entry = yield* entryOf(sv, trak, name)
          if (entry !== undefined && live(entry.state)) return entry.ready
          const why = needed ?? (yield* stillNeeded(sv, trak, decl))
          if (why === undefined) return yield* launch(sv, trak, cwd, decl)
          const at: At = { trak, decl, run: yield* Ref.updateAndGet(sv.counter, (n) => n + 1) }
          yield* failedToSpawn(sv, at, 0, why)
          return undefined
        }),
      )
      // Awaited outside the permit, so a stop pressed while a server is still coming up
      // is not made to wait for it.
      if (ready !== undefined) yield* Deferred.await(ready)
      return yield* current(sv, trak, decl)
    })

/** Stop every process that needs `name`, each through `stop` and so its own first. */
const stopDependents = (sv: Supervisor, trak: Home, name: string): Effect.Effect<void> =>
  Effect.flatMap(dependentsOf(sv, trak, name), (dependents) =>
    Effect.forEach(dependents, (d) => Effect.ignore(stop(sv)(trak, d.name)), {
      concurrency: "unbounded",
      discard: true,
    }),
  )

const stop =
  (sv: Supervisor): HostedProcessesShape["stop"] =>
  (trak, name) =>
    Effect.gen(function* () {
      const decl = yield* declared(sv, trak, "", name)
      // Before this one's permit, because a dependent still starting is waiting on this
      // one outside its own, and stopping it first is what lets it see this one go.
      yield* stopDependents(sv, trak, name)
      const moved = yield* permitFor(sv, keyOf(trak, name)).withPermits(1)(
        Effect.gen(function* () {
          const entry = yield* entryOf(sv, trak, name)
          if (entry === undefined || !live(entry.state)) return false
          const now = yield* Clock.currentTimeMillis
          const at: At = { trak, decl, run: entry.run }
          const settled = yield* settle(sv, at, ["Preparing", "Starting", "Running"], (s) =>
            s._tag === "Preparing" || s._tag === "Starting" || s._tag === "Running"
              ? HostedState.Stopped({ port: s.port, startedAt: s.startedAt, at: now })
              : s,
          )
          if (settled) yield* release(sv, at)
          return settled
        }),
      )
      // And again once this one has moved, as `cameUp` does after an exit: a dependent
      // can read this one as running after the first pass found nothing to stop, and
      // launch. Every look it takes from here on sees this one stopped, and one that
      // launched before is caught on its own permit.
      if (moved) yield* stopDependents(sv, trak, name)
      return yield* current(sv, trak, decl)
    })

/** Every live process that needs `name`, however far down — read before a stop moves them. */
const liveDependents = (sv: Supervisor, trak: Home, name: string) =>
  Effect.gen(function* () {
    const found = new Set<string>()
    const frontier = [name]
    for (let next = frontier.pop(); next !== undefined; next = frontier.pop()) {
      for (const d of yield* dependentsOf(sv, trak, next)) {
        const state = (yield* entryOf(sv, trak, d.name))?.state
        if (found.has(d.name) || state === undefined || !live(state)) continue
        found.add(d.name)
        frontier.push(d.name)
      }
    }
    return [...found]
  })

/**
 * Stop, start, then start again whatever was live on it — only once it is running, since
 * starting a dependent of one that did not come up would start it a second time.
 */
const restart =
  (sv: Supervisor): HostedProcessesShape["restart"] =>
  (trak, cwd, name) =>
    Effect.gen(function* () {
      const dependents = yield* liveDependents(sv, trak, name)
      yield* stop(sv)(trak, name)
      const run = yield* start(sv)(trak, cwd, name)
      if (run.state._tag === "Running") {
        yield* Effect.forEach(dependents, (d) => start(sv)(trak, cwd, d), {
          concurrency: "unbounded",
          discard: true,
        })
      }
      return run
    })

const turnEnv =
  (sv: Supervisor): HostedProcessesShape["turnEnv"] =>
  (trak) =>
    Effect.gen(function* () {
      const env: Record<string, string> = {}
      for (const [key, decl] of sv.ran) {
        if (key !== keyOf(trak, decl.name)) continue
        const state = (yield* entryOf(sv, trak, decl.name))?.state
        if (state?._tag === "Running") env[urlVariable(decl.name)] = state.url
      }
      return env
    })

/**
 * What the boot finds in the record: each killed where it is still the process recorded.
 * Then each recorded home's registry is rewritten, which clears what was reaped.
 */
const homeOf = (entry: Recorded): Home =>
  entry.trak === undefined ? undefined : TrakId.make(entry.trak)

const reap = (sv: Supervisor): HostedProcessesShape["reap"] =>
  Effect.gen(function* () {
    const entries = sv.config.record === undefined ? [] : readRecord(sv.config.record)
    const at = yield* Clock.currentTimeMillis
    const results: ProcessReaped[] = []
    for (const entry of entries) {
      const trak = homeOf(entry)
      if (entry.cwd !== undefined) sv.checkouts.set(homeKey(trak), entry.cwd)
      const outcome = yield* reapOne(sv.proc, entry)
      results.push({ trak, name: entry.name, pid: entry.pid, outcome })
      yield* Ref.update(sv.held, (map) =>
        HashMap.has(map, keyOf(trak, entry.name))
          ? map
          : HashMap.set(map, keyOf(trak, entry.name), {
              run: 0,
              state: HostedState.StoppedByRestart({ at }),
              log: "",
              chunks: 0,
              scope: undefined,
              ready: undefined,
            }),
      )
    }
    yield* remember(sv, () => [])
    yield* Effect.forEach(new Set(entries.map(homeOf)), (trak) => register(sv, trak))
    return results
  })

export const ShellHostedProcessesLayer = (
  config: HostingConfig,
): Layer.Layer<HostedProcesses, never, Process | Environment | Feed | Lib> =>
  Layer.scoped(
    HostedProcesses,
    Effect.gen(function* () {
      const sv: Supervisor = {
        proc: yield* Process,
        environment: yield* Environment,
        feed: yield* Feed,
        library: yield* libraryNow,
        root: yield* Effect.scope,
        held: yield* Ref.make(HashMap.empty<string, Held>()),
        counter: yield* Ref.make(0),
        recorded: yield* Ref.make<readonly Recorded[]>([]),
        portPermit: yield* Effect.makeSemaphore(1),
        permits: new Map(),
        checkouts: new Map(),
        ran: new Map(),
        registryPermit: yield* Effect.makeSemaphore(1),
        config,
        sandboxes: yield* Effect.serviceOption(Sandboxes),
        reads: new Map(),
      }
      const survey: HostedProcessesShape["survey"] = (trak, cwd) =>
        Effect.flatMap(declarationsAt(sv, trak, cwd), (at) =>
          Effect.map(
            Effect.forEach([...at.processes.values()], (decl) => current(sv, trak, decl)),
            (runs) => ({ runs, unreadable: at.unreadable }),
          ),
        )
      const list: HostedProcessesShape["list"] = (trak, cwd) =>
        Effect.map(survey(trak, cwd), (at) => at.runs)
      // Every process that has run here, whether or not its checkout still declares it.
      const stopAll: HostedProcessesShape["stopAll"] = (trak) =>
        Effect.forEach(
          [...sv.ran].filter(([key, decl]) => key === keyOf(trak, decl.name)),
          ([, decl]) => Effect.ignore(stop(sv)(trak, decl.name)),
          { concurrency: "unbounded", discard: true },
        )
      const shape: HostedProcessesShape = {
        list,
        survey,
        start: start(sv),
        restart: restart(sv),
        stop: stop(sv),
        stopAll,
        turnEnv: turnEnv(sv),
        reap: reap(sv),
      }
      return shape
    }),
  )
