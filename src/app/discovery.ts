// Which project a command is for, and how a client finds the daemon serving it.
//
// **The port is derived from the path, so nothing has to be told it.** A project gets
// the same pair every boot, which is what makes a worktree's URL worth bookmarking and
// what lets `ork` reach its own engine without an environment variable or a config file.
// Two worktrees of one repository are different paths and get different pairs, so both
// can serve at once.
//
// The project is the directory the command was run from unless `--dir` names another —
// so one checkout of this engine can serve a repository that is not it, and two engines
// started from here for two repositories get two pairs and two records.
//
// **The bind is the mutex; the record is a hint.** Two daemons cannot share a port, so
// whichever binds first is the engine for that checkout and the other fails loudly.
// `daemon.json` exists only so a client does not have to probe — it is written after
// binding, removed on a clean exit, and may be stale after a kill -9, which is why
// anything reading it confirms with `GET /api/health` rather than trusting it.
//
// **The record also carries the daemon's bearer token, so it is written mode 0600.** The
// guard in front of the API (`app/guard.ts`) accepts it in place of a session cookie,
// which is what lets `ork` work against a gated engine with nothing typed. The file
// lives in the gitignored `.orkestra/.database/`, and only the person who started the
// engine can read it.
//
// In `app/` rather than beside `orkestraDir`: which port the engine binds is a fact
// about the daemon, and `library/` is about `.orkestra` definitions.

import { createHash } from "node:crypto"
import { existsSync, realpathSync } from "node:fs"
import { readFile, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { join, resolve } from "node:path"
import { Effect, Schema, type Scope } from "effect"
import { orkestraDir } from "../library/adapters/library-fs.js"
import { writePrivate } from "./access.js"
import { version } from "./packaged.js"

/**
 * How `pnpm ui` tells the two halves it spawns which project they are for.
 *
 * The same channel the two port numbers travel on, and for the same reason: `ui:both`
 * is a fixed `concurrently` command line, so a flag cannot be threaded through it. A
 * `--dir` on the command itself wins over this.
 *
 * **It reaches the two halves and stops.** Nothing the daemon then spawns inherits it —
 * `agent/logic/spawn-env.ts` strips the whole `ORKESTRA_` family from every spawned
 * environment, because a turn or a check running in a worktree has to resolve its
 * project from where it stands.
 */
export const PROJECT_DIR_ENV = "ORKESTRA_PROJECT_DIR"

const DIR_FLAG = "--dir"

/** A resolved project root, and the arguments that were not about choosing it. */
export interface ProjectDir {
  readonly root: string
  /** `args` with `--dir` and its value removed, so a positional parse can follow. */
  readonly rest: readonly string[]
}

/**
 * One canonical absolute path for a project root, because that string is hashed into a
 * port pair and compared against what `/api/health` reports.
 *
 * `realpathSync.native` rather than the JS `realpathSync`: on a case-insensitive volume
 * only the native one folds the spelling back to what is on disk, and a repository
 * reachable as both `…/GitHub/harbor` and `…/Github/harbor` would otherwise be two
 * projects — two pairs, two `daemon.json` records, and a health answer that never
 * matches. A path that does not exist keeps its resolved spelling; saying so is the
 * `.orkestra` walk-up's job, not this one's.
 */
export const canonical = (dir: string): string => {
  const absolute = resolve(dir)
  try {
    return realpathSync.native(absolute)
  } catch {
    return absolute
  }
}

/**
 * The project these arguments are about: `--dir <path>` or `--dir=<path>`, else
 * `$ORKESTRA_PROJECT_DIR`, else where the command was run.
 *
 * Throws when `--dir` is given without a path. A boot that quietly fell back to the
 * current directory would drive the wrong repository, which is the one failure here
 * nothing downstream could detect.
 */
export const projectDir = (args: readonly string[]): ProjectDir => {
  const rest: string[] = []
  let given: string | undefined
  let sawFlag = false
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? ""
    if (arg === DIR_FLAG) {
      sawFlag = true
      given = args[i + 1]
      i += 1
    } else if (arg.startsWith(`${DIR_FLAG}=`)) {
      sawFlag = true
      given = arg.slice(DIR_FLAG.length + 1)
    } else {
      rest.push(arg)
    }
  }
  if (sawFlag && (given === undefined || given.trim() === "")) {
    throw new Error(`${DIR_FLAG} needs a path — the repository to run against.`)
  }
  const named = process.env[PROJECT_DIR_ENV]
  const raw = given ?? (named === undefined || named === "" ? process.cwd() : named)
  return { root: canonical(raw), rest }
}

/**
 * The window a pair is drawn from: 31000–46999, as 8000 adjacent pairs.
 *
 * Below macOS's ephemeral range (49152–65535), so nothing here collides with a port the
 * kernel is handing out, and above the crowded low thousands where every other dev
 * server lives. A pair is `(even, even + 1)` so the two numbers a person reads are
 * adjacent.
 */
export const FIRST_PORT = 31_000
export const PAIRS = 8_000

/**
 * The project root's path decides the pair, so it has to be the canonical spelling
 * `projectDir` returns — a second spelling of one directory hashes to a second pair. A
 * git worktree is a different path from its repository, which is the whole point.
 */
export const basePort = (root: string): number =>
  FIRST_PORT + (createHash("sha1").update(root).digest().readUInt32BE(0) % PAIRS) * 2

/** The pair after this one, wrapping at the end of the window. */
export const nextPair = (api: number): number => FIRST_PORT + ((api - FIRST_PORT + 2) % (PAIRS * 2))

/**
 * How many pairs a search walks before giving up. A stale server on this project's
 * pair costs one step; twenty means something is holding forty ports and a fresh
 * number would not help anyway.
 */
export const PAIR_ATTEMPTS = 20

// Loopback, explicitly — what `src/serve.ts` binds unless told `--host`, the rule
// `client/vite.config.ts` follows outright, and the address a probe has to test, since a
// port free on one interface is not free on another.
const HOST = "127.0.0.1"

/**
 * Whether a port can be bound right now. Racy by construction — something may take it
 * between this closing and a daemon binding — but the loser of that race is a boot that
 * fails loudly rather than two servers sharing a number.
 */
export const portFree = (port: number): Promise<boolean> =>
  new Promise((done) => {
    const probe = createServer()
    probe.once("error", () => done(false))
    probe.listen(port, HOST, () => probe.close(() => done(true)))
  })

/** A pair to bind, or the engine this project already has on it. */
export interface Pair {
  readonly api: number
  readonly client: number
  /** The pair is taken, and the engine holding it is this project's own. */
  readonly ours: boolean
}

/**
 * The pair at `api`, the next free one after it, or the one `root`'s own engine is
 * already on.
 *
 * **Stepping past a taken pair is right only when somebody else is on it.** Two projects
 * can hash to one pair, and the second must move — but a pair held by *this* project's
 * engine means one is already running, and stepping there would start a second daemon
 * over the same `.orkestra/.database/`. Exclusion is a permit inside the one process that
 * writes (`src/app/drive.ts`), so a second process shares no permit with the first and
 * `adopt` cannot refuse it: both would drive one trak and append to one log across a gap
 * nothing guards. `/api/health` reports the project root, which is what tells the two
 * cases apart.
 *
 * Recursive rather than a loop because the search is the shape `no-await-in-loop` exists
 * to rule out the *other* case of: probing the next pair is only worth doing once this one
 * has answered, so `Promise.all` over the window would bind forty ports to use two.
 */
export const pickPair = async (root: string, api: number, left: number): Promise<Pair> => {
  if (left === 0) {
    throw new Error(
      `no free port pair for ${root} in ${String(PAIR_ATTEMPTS)} tries, up to ` +
        `${String(api)} — something is holding a lot of ports, or a previous engine ` +
        `did not shut down`,
    )
  }
  if ((await portFree(api)) && (await portFree(api + 1)))
    return { api, client: api + 1, ours: false }
  if ((await answeringFor(api)) === root) return { api, client: api + 1, ours: true }
  return pickPair(root, nextPair(api), left - 1)
}

/**
 * What `GET /api/health` answers, and what makes discovery sound.
 *
 * **`cwd` is the load-bearing field.** A daemon whose derived pair was taken steps to
 * another one, so the number a client computes is a guess — and a worktree of the same
 * repository can be sitting on it. Comparing project roots is what stops one worktree's
 * `ork` driving another's traks, which is a failure nothing downstream could detect.
 *
 * It carries the **project root** the daemon serves, canonical as `projectDir` returns
 * it. That is the daemon's own directory unless it was started with `--dir`, and the
 * field keeps its name because both sides of every comparison read this one answer.
 *
 * `client` is the build id of the bundle served at `/`, for a page to compare with its
 * own — `bundleId` in `client-bundle.ts`, and absent where there is none. Nothing here reads
 * it, so `HealthResponse` leaves it undeclared and an engine without it still decodes.
 *
 * `store` is whether the store process answers, and absent where the project has no store
 * file. Nothing here reads it either.
 */
export interface Health {
  readonly cwd: string
  readonly version: string
  readonly client?: string
  readonly store?: { readonly up: boolean; readonly reason?: string }
}

export const health = (
  root: string,
  client: string | undefined,
  store?: Health["store"],
): Health => ({
  cwd: root,
  version: version(),
  ...(client === undefined ? {} : { client }),
  ...(store === undefined ? {} : { store }),
})

/**
 * The line an engine prints on stdout as its first-boot migration starts, before it opens
 * the store (`store-migrate.ts`). A supervisor that sees it stops holding the engine to its
 * boot limit and waits for as long as lines keep coming (`src/supervisor/engine.ts`). Here,
 * because the supervisor may import this file and no other of the engine's.
 */
export const MIGRATING = "store: moving the file logs into the store"

/** The reading side of `Health`. Both halves of the contract, kept next to each other. */
const HealthResponse = Schema.Struct({ cwd: Schema.String, version: Schema.String })

/**
 * The project root the daemon on `port` reports, or `undefined` when nothing there
 * answers for one. Loopback, like everything else that binds or probes here.
 *
 * **`undefined` is "I could not tell", never "the port is free".** A timeout, a refused
 * connection and a daemon too busy to answer are indistinguishable from out here, and
 * one of those three is a live engine. Every caller has a safe direction and takes it:
 * `pnpm ui` steps to another pair rather than binding on top, `pnpm ui:stop` refuses to
 * signal a pid it could not confirm, and `findEngine` keeps looking.
 *
 * Plain rather than an `Effect`: `E` and `R` are both `never` — there is no failure to
 * expose, because not answering *is* the answer.
 */
export const answeringFor = async (port: number): Promise<string | undefined> => {
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/api/health`, {
      signal: AbortSignal.timeout(1500),
    })
    if (!response.ok) return undefined
    const body: unknown = await response.json()
    const decoded = Schema.decodeUnknownEither(HealthResponse)(body)
    return decoded._tag === "Right" ? decoded.right.cwd : undefined
  } catch {
    return undefined
  }
}

/**
 * Write the record while the daemon is up, and take it away when it stops.
 *
 * Scoped, so a clean exit removes it however the exit happens — and a record left
 * behind therefore means the process died without unwinding, which is the same signal
 * `run.json` carries for a trak.
 *
 * **`port` is the bound one, not the requested one.** They differ whenever `pnpm ui`
 * stepped to a free pair, and writing what was asked for rather than what was granted
 * is how a hint becomes a lie.
 *
 * Failures are ignored: a daemon that cannot write a convenience file is still a
 * daemon, and refusing to serve because of one would trade a working engine for a
 * missing shortcut.
 */
/**
 * What the daemon writes about itself, and what a reader gets back. `cwd` is the
 * project root it serves — the same value `/api/health` reports, so the two can be
 * compared without either side deriving anything.
 */
export interface DaemonRecord {
  readonly pid: number
  readonly port: number
  readonly cwd: string
  /**
   * The bearer the guard accepts for this boot. Optional on the way in, because a
   * record written by an older build has none — and a reader missing it is refused by a
   * gated engine rather than failing to parse the file.
   */
  readonly token?: string | undefined
}

const DaemonRecordFields = Schema.Struct({
  pid: Schema.Number,
  port: Schema.Number,
  cwd: Schema.String,
  token: Schema.optional(Schema.String),
})

const recordPath = (root: string): string => join(root, ".database", "daemon.json")

/**
 * The record this project's daemon left, or `undefined` when there is none.
 *
 * **This is the only thing that knows where the engine actually is.** The derived pair
 * says where it would have *started* looking, and a daemon that stepped past a taken
 * pair is not there — so a check that probes the derivation and stops has not looked for
 * the engine, it has looked at a guess. `port` here is what got bound.
 *
 * Absent is not the same as none running, which is why every caller confirms what it
 * finds against `answeringFor` rather than acting on the record alone: `tsx` SIGKILLs
 * the daemon before its finalizers remove the file, so a record outlives its process
 * routinely, and a `kill -9` leaves one with no daemon at all.
 */
export const readDaemonRecord = (root: string): Effect.Effect<DaemonRecord | undefined, Error> =>
  Effect.gen(function* () {
    const dir = yield* orkestraDir(root).pipe(Effect.mapError((e) => new Error(String(e))))
    const path = recordPath(dir)
    if (!existsSync(path)) return undefined
    const text = yield* Effect.promise(() => readFile(path, "utf8"))
    const parsed: unknown = yield* Effect.try({
      try: (): unknown => JSON.parse(text),
      catch: () => new Error(`${path} is not JSON`),
    })
    return yield* Schema.decodeUnknown(DaemonRecordFields)(parsed).pipe(
      Effect.mapError((e) => new Error(`${path} is not a daemon record: ${e.message}`)),
    )
  })

export const announce = (
  root: string,
  port: number,
  token: string,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const dir = yield* orkestraDir(root)
      const path = recordPath(dir)
      const record = { pid: process.pid, port, startedAt: Date.now(), cwd: root, token }
      // `tryPromise`, not `promise`: a write can still fail — a read-only volume, a
      // directory somebody removed between the two calls — and `writeFile` rejecting is
      // exactly the ordinary failure the comment above means to ignore. `promise`
      // assumes the promise never rejects, so that rejection became a defect `ignore`
      // does not catch, and the "convenience file" took the whole daemon down with it.
      //
      // **The directory is made first.** A fresh project has no `.database/` until a
      // trak writes into it, and a record that silently went unwritten used to cost
      // nothing — now it is the only copy of the token, and a gated engine on a fresh
      // project would be one `ork` could never reach.
      //
      // **Readable by this user alone**, since the record carries the token.
      yield* Effect.tryPromise(() => writePrivate(path, `${JSON.stringify(record)}\n`))
      return path
    }),
    (path) => Effect.promise(() => rm(path, { force: true })),
  ).pipe(Effect.ignore, Effect.asVoid)
