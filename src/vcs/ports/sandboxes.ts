// port: where a trak's checkout lives when it is not on this machine.
//
// Under a project's runner file every trak's checkout is in a sandbox, at the same
// absolute path this machine would give it, and the engine host keeps no checkout there.
// Git carries the commits: this machine's copy of `trak/<id>` is fetched out of the
// sandbox, and every ref read — a branch diff, a conflict prediction, a merge into the
// project — runs here against that copy. A command run *in* the checkout needs nothing
// from this port: the Process layer sends it to the sandbox by its working directory.
//
// The Vcs adapter reads this as an optional service. Left out, or answering `inUse`
// false, every checkout is a linked worktree on this machine, as it is with no runner.
//
// **A file in a sandboxed checkout is reached through here, never through `node:fs`.**
// Every caller that reads or writes one — the `.trak/` projection, a proof image, the
// process declarations and registry, a check's side files and prints, a session file —
// asks `placeOf` first and keeps its own disk code where it answers `undefined`, so a
// project with no runner file reads exactly as before. Bytes cross the runner's pipe as base64,
// both ways, and a tree of files as one tar stream.
//
// **A read never starts a stopped sandbox.** A read runs `exec --if-running` and answers
// `"stopped"` where the sandbox is not running; only work — a turn, a check, an effect, a
// press — starts one, so a method that places a turn's input has no such answer.
//
// **Work holds a sandbox awake, and the engine stops it once nothing has for the runner
// file's `idle_minutes` — `idle_minutes_waiting` instead while the trak waits on a person,
// as `waitingBy` says.** A command that runs beside the work — a declared process —
// wakes a sandbox but does not hold it, so an open page never keeps one billing. The
// first work after a stop, a boot or a lost transport asks the runner first, and makes a
// sandbox that is absent again from this machine's branch — and one whose seed stamp is
// not this engine's, where nothing else holds it and its checkout is clean.

import { Context, type Duration, type Effect, type Scope } from "effect"
import type { CheckoutPlace } from "../logic/paths.js"
import type { GitFailed } from "../types/errors.js"

/** What the runner says of one trak's sandbox. */
export type SandboxState = "running" | "stopped" | "absent"

/** A tunnel held open: its local half, so a crash's next boot can find and kill it. */
export interface Exposed {
  readonly pid: number
}

/** A read's answer from a sandbox that is not running: it ran nothing, and nothing is readable. */
export type Stopped = "stopped"

/** A read's answer where the trak has no sandbox at all — released, or never made. */
export type Absent = "absent"

/**
 * What `stats` reads of one absolute path: its `kind`, with a file's sha-256; the
 * `listing` of a directory's entry names; or the `text` of a file as well as its sha-256 —
 * left out where the file hashes to `unless`.
 */
export interface StatAsked {
  readonly path: string
  readonly read: "kind" | "listing" | "text"
  readonly unless?: string
}

/**
 * One path as `stats` found it, with symlinks followed. `unreadable` is a path that is
 * there and could not be read. A file's `sha` is missing where `listing` was asked, and a
 * directory's `entries`, unsorted, are there only where it was.
 */
export type PathStat =
  | { readonly kind: "absent" | "other" | "unreadable" }
  | { readonly kind: "file"; readonly sha?: string; readonly text?: Uint8Array }
  | { readonly kind: "dir"; readonly entries?: readonly string[] }

export interface SandboxesShape {
  /** Whether this project's checkouts are in sandboxes now. Read on every call, as the runner file is. */
  readonly inUse: Effect.Effect<boolean>
  /**
   * Whether `trak`'s checkout is in its sandbox: `inUse`, less a trak placed on this
   * machine (`ports/host-traks.ts`). What a caller about one trak asks instead of `inUse`.
   */
  readonly holds: (trak: string) => Effect.Effect<boolean>
  /**
   * Make or find the trak's sandbox, start it, and make the directory `path` there —
   * where the checkout goes, empty on a new sandbox. Idempotent.
   */
  readonly create: (trak: string, path: string) => Effect.Effect<void, GitFailed>
  /** What the runner reports. Starts nothing. */
  readonly status: (trak: string) => Effect.Effect<SandboxState, GitFailed>
  /**
   * The provider's own id for the trak's sandbox, from the `id` line `create` or `status`
   * last printed. Asks the runner nothing: `undefined` where neither has run since boot,
   * the sandbox was released, or the runner prints no such line.
   */
  readonly idOf: (trak: string) => Effect.Effect<string | undefined>
  /**
   * Every trak this project has a sandbox for, in any state and in no order — the one
   * call that names no trak. Starts nothing, and the ids are the runner's: a trak this
   * engine has never heard of is one whose sandbox outlived its log.
   *
   * **The whole set, or a failure.** A caller acts on what is *missing* from the answer,
   * so a short one is worse than none: it reads as a sandbox that is already gone. A
   * runner that can enumerate only part of what the provider holds fails the verb.
   */
  readonly list: Effect.Effect<readonly string[], GitFailed>
  /**
   * Bring `<port>` in the trak's sandbox, on `127.0.0.1` or else `::1`, to the same port on
   * this machine's loopback, for as long as the scope is open — closing it ends the tunnel. Answers the
   * pid of the tunnel's local half once it is spawned, which is before it listens.
   */
  readonly expose: (trak: string, port: number) => Effect.Effect<Exposed, GitFailed, Scope.Scope>
  /**
   * The reverse: `127.0.0.1:<port>` in the trak's sandbox reaches the same port on this
   * machine's loopback — the engine's own, for a turn's MCP tools — for as long as the
   * scope is open. Answers once the tunnel's local half is spawned, as `expose` does, with
   * the pid of that first one.
   *
   * **A tunnel that ends while the scope is open is opened again, with backoff**, and the
   * first time it ends `unreached` is handed what the runner said — once per scope, since
   * a turn whose tools dropped is told so once.
   */
  readonly reach: (
    trak: string,
    port: number,
    unreached: (said: string) => Effect.Effect<void>,
  ) => Effect.Effect<Exposed, GitFailed, Scope.Scope>
  /**
   * Whether `GET /api/health` on `127.0.0.1:<port>` inside the trak's sandbox answers 200
   * within `within` — asked from there through a runner exec, so it passes through the
   * `reach` relay and tunnel to the engine as the session's MCP calls do. Fails with the
   * last reason it did not, or with the runner's failure. Tried once, and never starts a
   * stopped sandbox.
   */
  readonly healthThrough: (
    trak: string,
    port: number,
    within: Duration.Duration,
  ) => Effect.Effect<void, GitFailed>
  /** Delete the sandbox, checkout and all. Idempotent. */
  readonly release: (trak: string) => Effect.Effect<void, GitFailed>
  /**
   * `runner.sh kill` for the command the trak's sandbox runs as `execId`, tried once. A
   * command already gone is nothing to do; a runner that could not reach the sandbox, or
   * that exited non-zero, fails with its failure on `GitFailed.runner`, for the seam
   * operation to classify and retry.
   */
  readonly kill: (trak: string, execId: string) => Effect.Effect<void, GitFailed>
  /**
   * Run `git` on this machine in `cwd`, with `args` built around a remote that reaches
   * the repository at `path` in the trak's sandbox — git's own transport, carried by the
   * runner. A non-zero exit, or a runner that lost the sandbox, fails under `op`.
   * **A lost sandbox is tried again**, so `args` has to be safe to run twice — a forced
   * fetch or push of one ref is.
   */
  readonly transfer: (
    trak: string,
    op: string,
    cwd: string,
    path: string,
    args: (remote: string) => readonly string[],
  ) => Effect.Effect<void, GitFailed>
  /**
   * `call` — commands the Process layer sends into `trak`'s sandbox — tried again while
   * the runner cannot reach it, as a `transfer` is: through the trak's outage window inside
   * `waitingOutOutages`, and three tries otherwise. **`call` has to leave the same whether
   * it runs once or twice**, since a lost connection says nothing of whether it ran.
   */
  readonly retried: <A>(
    trak: string,
    op: string,
    call: Effect.Effect<A, GitFailed>,
  ) => Effect.Effect<A, GitFailed>
  /**
   * The trak whose sandbox holds `path`, and `path` as the sandbox spells it — or
   * `undefined`, with no runner file, for a path in no trak's checkout, or in the checkout
   * of a trak placed on this machine, where this machine's disk is the one to read.
   */
  readonly placeOf: (path: string) => Effect.Effect<CheckoutPlace | undefined>
  /**
   * The project's own place — sandbox `project`, its checkout at the cache checkout's
   * path — where a spawn naming the project runs: under an external store with a runner in use.
   * `undefined` otherwise, and such a spawn runs on this machine. Every other method
   * answers that sandbox's id as it answers a trak's; an absent one is made empty, since
   * each spawn there fetches its checkout from `origin` first.
   */
  readonly project: Effect.Effect<CheckoutPlace | undefined>
  /**
   * Make the directory `at` hold `files`, by their paths relative to it — `replace`
   * removes everything else there first. A turn's or a check's input, so a stopped
   * sandbox is started. A file is text or, for one a person attached, its bytes.
   */
  readonly place: (
    at: CheckoutPlace,
    files: ReadonlyMap<string, string | Uint8Array>,
    replace: boolean,
  ) => Effect.Effect<void, GitFailed>
  /**
   * `text` as the file `name` under the directory `at`, written beside it and renamed
   * over it so a reader never sees half of one. Nothing where the directory is gone, so a
   * late write never makes a removed checkout again. `false` where the sandbox is stopped.
   */
  readonly write: (
    at: CheckoutPlace,
    name: string,
    text: string,
  ) => Effect.Effect<boolean, GitFailed>
  /**
   * Every regular file under the directory `at`, by its path relative to it — none where
   * there is no such directory. Held in memory, so only for a directory of a few small
   * files; `moveOut` takes one of any size. `wake` is for the read a press makes on its way
   * to work — a process started from a page — and starts a stopped sandbox rather than
   * answering `"stopped"`. Without `wake`, a trak with no sandbox answers `"absent"` at once
   * rather than being tried again as a lost connection.
   */
  readonly collect: (
    at: CheckoutPlace,
    options: { readonly wake: boolean },
  ) => Effect.Effect<ReadonlyMap<string, Uint8Array> | Stopped | Absent, GitFailed>
  /**
   * Every regular file under the directory `at`, written under `into` on this machine by
   * its path relative to `at`, and the directory removed in the sandbox — nothing where
   * there is no such directory. Sent compressed and written to disk as it arrives, so the
   * engine never holds more of it than one file. A name that would land outside `into` is
   * not written. Never wakes a stopped sandbox.
   */
  readonly moveOut: (at: CheckoutPlace, into: string) => Effect.Effect<void | Stopped, GitFailed>
  /**
   * The regular file `requested` names inside the directory `at`, after both are
   * resolved through their symlinks in the sandbox — `undefined` where it names nothing
   * there, including a path that resolves outside it.
   */
  readonly readInside: (
    at: CheckoutPlace,
    requested: string,
  ) => Effect.Effect<Uint8Array | undefined | Stopped, GitFailed>
  /**
   * Every path `asked` names, read in one `exec` and answered in the same order — what a
   * check's prints are held against, where the checkout is in the trak's sandbox.
   */
  readonly stats: (
    trak: string,
    asked: readonly StatAsked[],
  ) => Effect.Effect<readonly PathStat[] | Stopped, GitFailed>
  /**
   * The file at `path` under the sandbox's home copied to the same path under this
   * machine's, where the sandbox's is newer, and stamped with the sandbox's time — so the
   * two read as level until either changes. A read: a stopped sandbox is left as it is.
   */
  readonly copyHomeBack: (trak: string, path: string) => Effect.Effect<void, GitFailed>
  /**
   * The file at `path` under this machine's home copied into the sandbox's, where it is
   * newer than the sandbox's copy or the sandbox has none — a sandbox made again after it
   * was lost. Nothing where this machine has no such file. A turn's input, so a stopped
   * sandbox is started. Answers whether the sandbox holds the file once it is done: `false`
   * is a file neither side has, which a turn resuming from it cannot resume.
   */
  readonly copyHomeIn: (trak: string, path: string) => Effect.Effect<boolean, GitFailed>
  /**
   * Work is about to run in the trak's sandbox, and holds it awake until the scope
   * closes; its idle stop counts from the last hold to close. Where the engine has not
   * seen the sandbox since it last stopped it — or since boot, or since `lost` — the
   * runner is asked first, and a sandbox it reports absent, or stamped with another seed
   * version, is made again by what `remakeWith` was handed. Answers the sandbox's incarnation, a number that moves each
   * time it is made again, so a file sent to the one before is known not to be there.
   *
   * Whether the caller is the trak's own work is `asWork`'s to say, never the command's.
   * Outside it — a declared process's start, an MCP view's press, a route — a failure owed
   * to the trak's next work fails the call without being taken, and a stale remake the
   * call wakes tells `leftBehindTo`'s recorder rather than spending its failure on the call.
   */
  readonly awake: (trak: string) => Effect.Effect<number, GitFailed, Scope.Scope>
  /**
   * `work` as the trak's own — what a drive runs for a step, and nothing else. Its sandbox
   * calls take a failure owed to the trak's next work, and fail on a stale remake's as
   * their own step's. Everything a drive's command forks inherits it.
   */
  readonly asWork: <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  /** A command found the trak's sandbox unreachable: the next `awake` asks the runner again. */
  readonly lost: (trak: string) => Effect.Effect<void>
  /**
   * Whether an `awake` since the last ask found the trak's sandbox stopped, so the next
   * command run there is what starts it again — for a caller that says so while it does.
   * Asking clears it.
   */
  readonly resuming: (trak: string) => Effect.Effect<boolean>
  /**
   * What makes a sandbox again. Handed once, at boot, because it is built over the layers
   * built over this one; until then an absent sandbox is left for the work to fail on,
   * and a stale one is kept.
   */
  readonly remakeWith: (remake: Remake) => Effect.Effect<void>
  /**
   * A person's Rebuild: the sandbox made again by `Remake.stale`, its uncommitted changes
   * carried. **Never while anything holds it** — then queued in this engine's memory and
   * started once the last hold closes, and an engine restart forgets it. Answers where it
   * stands. A failure is logged and told to `leftBehindTo`'s recorder; where the recorder
   * does not record it — a drive is moving the trak — it is owed to that trak's next work
   * in the sandbox, which fails on it.
   */
  readonly rebuild: (trak: string) => Effect.Effect<Rebuild>
  /** Where a person's Rebuild stands, or `undefined` where none is owed. */
  readonly rebuildOf: (trak: string) => Effect.Effect<Rebuild | undefined>
  /**
   * How a remake that left the uncommitted changes behind reaches the trak, handed once at
   * boot by the layer over the drives, which are built over this one. Told of such a remake
   * where nothing of the trak's own work met it — a Rebuild, or a stale remake a declared
   * process woke; where the trak's work woke it, that work fails on it instead. Where the
   * recorder answers that it did not record it, because a drive is moving the trak, the
   * failure is owed to the trak's next work in the sandbox — never to a process start —
   * so the drive fails on it rather than remaking from the branch.
   */
  readonly leftBehindTo: (record: LeftBehind) => Effect.Effect<void>
  /**
   * What an idle stop runs inside, handed once at boot for `remakeWith`'s reason: the
   * engine's job lease for the sandbox, so two engine copies never stop one at once. Until
   * then, and with nothing handed, the stop runs as it is.
   */
  readonly stopIdleUnder: (guard: IdleGuard) => Effect.Effect<void>
  /**
   * Whether a trak waits on a person, handed once at boot because the store is built over
   * this layer. Asked once `idle_minutes` have passed with nothing holding the sandbox, and
   * every `idle_minutes` after while it answers true, up to `idle_minutes_waiting`. Until
   * then, and with nothing handed, no trak waits.
   */
  readonly waitingBy: (waiting: Waiting) => Effect.Effect<void>
  /**
   * What starts a person's interactive shell in the sandbox at `at` — the runner's `shell`
   * verb — carrying the variables `carried` names beside the runner's own `pass:` and the
   * host's named secrets a sandbox inherits. `undefined` with no runner file. Starts nothing and runs nothing: the line is the
   * caller's to run, in a terminal, and every secret value is the caller's to supply.
   */
  readonly shell: (
    at: CheckoutPlace,
    carried: readonly string[],
  ) => Effect.Effect<SandboxShell | undefined>
}

/** A shell line with no secret in it: `env` is handed as written, and `inherited` by name from the runner's environment. */
export interface SandboxShell {
  readonly command: readonly [string, ...string[]]
  readonly env: Readonly<Record<string, string>>
  readonly inherited: readonly string[]
}

/**
 * Record on the trak that a remake left its uncommitted changes at `failure.carried`, and
 * answer whether it was recorded — `false` where a drive is moving the trak, which then
 * meets the failure itself.
 */
export type LeftBehind = (trak: string, failure: GitFailed) => Effect.Effect<boolean>

/** A queued Rebuild, waiting on the holds open now, or one running. */
export type Rebuild = "waiting" | "rebuilding"

/** Run an idle stop of the trak's sandbox, or skip it. */
export type IdleGuard = (trak: string, stop: Effect.Effect<void>) => Effect.Effect<void>

/** Whether the trak does nothing until a person acts. */
export type Waiting = (trak: string) => Effect.Effect<boolean>

/** The two ways the first work after a stop or a boot makes a trak's sandbox again. */
export interface Remake {
  /** A sandbox the runner reports absent: the checkout seeded from this machine's `trak/<id>`, then set up. */
  readonly lost: (trak: string) => Effect.Effect<void, GitFailed>
  /**
   * A sandbox seeded by another engine version, or one a person asked to rebuild, whose
   * checkout is at `checkout`: fetched, released, then made again as `lost` makes one with
   * its uncommitted changes carried across — or kept as it is, where it could not be read
   * or an earlier remake's changes are still kept.
   */
  readonly stale: (trak: string, checkout: string) => Effect.Effect<void, GitFailed>
  /**
   * The commit `lost` would seed the trak's checkout from — this machine's `trak/<id>` — or
   * `undefined` where there is none. Named to the person before a lost sandbox is made again.
   */
  readonly startsFrom: (trak: string) => Effect.Effect<string | undefined, GitFailed>
}

export class Sandboxes extends Context.Tag("vcs/Sandboxes")<Sandboxes, SandboxesShape>() {}
