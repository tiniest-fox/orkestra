// One supervised engine per project, or the one already serving it — the supervision
// the desktop shell and a host process share.
//
// The engine is a bundle the root `pnpm build` writes, run by whatever command the caller's
// `EngineLaunch` names — `dist/serve.js` for the desktop shell, and a host's own bundle for
// a host, which reads the variables the host starts it with. The shell runs it on Electron's
// own Node through `ELECTRON_RUN_AS_NODE`, so nothing has to be installed, and a host runs it
// on its own Node. It binds a pair the way `pnpm ui` does — the one derived from the
// project's path, stepping past a pair another project holds — and the caller then talks to
// the engine's own loopback URL.
//
// **One engine per project, so a running one is attached to rather than doubled.** The
// bind is the mutex and `daemon.json` is the hint: a record whose port answers
// `/api/health` with this project's root is an engine somebody else started — a `pnpm
// ui`, a launchd service — and the caller is to leave it alone. Only an engine started
// here has a `child`, and only that one `stopEngine` stops.
//
// A client of the daemon, like `src/cli/`: everything it knows about a trak arrives as a
// DTO, and the port derivation in `src/app/discovery.ts` is the one engine file it uses.

// oxlint-disable-next-line eslint/no-restricted-imports -- starts an engine, from outside it
import { type ChildProcess, spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { Effect, Schema } from "effect"
import { ReloadFailedDto } from "@orkestra/shared/dto/reload"
import { TrakListDto } from "@orkestra/shared/dto/trak"
import {
  answeringFor,
  basePort,
  MIGRATING,
  PAIR_ATTEMPTS,
  pickPair,
  readDaemonRecord,
} from "../app/discovery.js"

export interface Engine {
  readonly root: string
  readonly port: number
  readonly url: string
  /** Absent when the engine was found running rather than started here. */
  readonly child: ChildProcess | undefined
  /** The launch's `teardown`, bound to `root`; only an engine started here carries one. */
  readonly teardown?: () => Promise<void>
  /**
   * The bearer off `daemon.json`, sent on every `/api/` request the shell makes — the
   * rule `src/cli/http.ts` follows: a gated engine refuses anything without it and an
   * open one ignores it. Absent when no record names this port — or, for an engine
   * started here, when its own child wrote none in time.
   */
  readonly token: string | undefined
}

/** The header `token` becomes; nothing when there is none to send. */
export const credential = (engine: Engine): Record<string, string> =>
  engine.token === undefined ? {} : { authorization: `Bearer ${engine.token}` }

/** What an engine that will not boot has to say — the last of what it printed. */
const TAIL_LINES = 30

/**
 * How long a fresh engine gets to answer `/api/health` before the boot is called failed —
 * unless it prints `MIGRATING` first. A first-boot migration of a large project runs past
 * it, and killing one partway costs the migration again.
 */
const BOOT_TIMEOUT_MS = 30_000

/**
 * Once an engine has printed `MIGRATING`, how long it may go without printing a line before
 * the boot is called failed. The migration prints progress well inside it, so only a hung
 * one reaches it.
 */
const STALL_TIMEOUT_MS = 30_000
const POLL_MS = 250

/** How long a stopped engine gets to unwind before it is killed. */
const STOP_GRACE_MS = 5000

/**
 * How long a fresh engine gets to write its record after it answers `/api/health`.
 * `announce` runs after the bind, so the record lands a moment after the boot is seen.
 */
const RECORD_TIMEOUT_MS = 5000

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The engine already serving `root`, or `undefined`. The record first, because it is
 * the only thing that knows where a daemon that stepped past a taken pair ended up;
 * then the derived pair, for an engine whose record a kill left stale.
 */
const attached = async (root: string): Promise<Engine | undefined> => {
  const record = await readRecord(root)
  if (record !== undefined && (await answeringFor(record.port)) === root) {
    return {
      root,
      port: record.port,
      url: urlOf(record.port),
      child: undefined,
      token: record.token,
    }
  }
  const pair = await pickPair(root, basePort(root), PAIR_ATTEMPTS)
  if (!pair.ours) return undefined
  return {
    root,
    port: pair.api,
    url: urlOf(pair.api),
    child: undefined,
    token: await tokenFor(root, pair.api),
  }
}

const readRecord = (root: string) =>
  Effect.runPromise(readDaemonRecord(root)).catch(() => undefined)

/**
 * The record's token, only when the record names `port`: a record a dead daemon left
 * beside a live one on the derived pair would otherwise hand over a token the live one
 * never issued — `findEngine` in `src/cli/http.ts` keeps the same rule.
 */
const tokenFor = async (root: string, port: number): Promise<string | undefined> => {
  const record = await readRecord(root)
  return record?.port === port ? record.token : undefined
}

/**
 * The token the child `pid` announced, polled until it has or the deadline passes.
 *
 * **The pid, not only the port**: an engine that crashed left its record behind, and its
 * successor binds the same derived port and answers health before `announce` rewrites the
 * file — so a port match alone hands over the dead engine's token, which the new one
 * refuses on every request.
 */
const awaitToken = async (
  root: string,
  port: number,
  pid: number | undefined,
  deadline: number,
): Promise<string | undefined> => {
  const record = await readRecord(root)
  if (record?.port === port && (pid === undefined || record.pid === pid)) return record.token
  if (Date.now() > deadline) return undefined
  await wait(POLL_MS)
  return awaitToken(root, port, pid, deadline)
}

const urlOf = (port: number): string => `http://127.0.0.1:${String(port)}/`

/** The last lines a child printed, kept for the report when it dies before answering. */
const tailOf = (child: ChildProcess): (() => string) => {
  const lines: string[] = []
  const take = (chunk: Buffer): void => {
    for (const line of chunk.toString("utf8").split("\n")) {
      if (line !== "") lines.push(line)
    }
    if (lines.length > TAIL_LINES) lines.splice(0, lines.length - TAIL_LINES)
  }
  child.stdout?.on("data", take)
  child.stderr?.on("data", take)
  return () => lines.join("\n")
}

/** How long a boot may take: `bootMs` from the spawn, then `stallMs` past each line once it migrates. */
interface BootLimits {
  readonly bootMs: number
  readonly stallMs: number
}

const BOOT_LIMITS: BootLimits = { bootMs: BOOT_TIMEOUT_MS, stallMs: STALL_TIMEOUT_MS }

/**
 * The moment the boot of `child` is to be called failed, read again on every probe: the boot
 * limit from now, until the child prints `MIGRATING`, and from then the stall limit after
 * the last line it printed on either stream.
 */
const bootDeadline = (child: ChildProcess, limits: BootLimits): (() => number) => {
  const boot = Date.now() + limits.bootMs
  let last: number | undefined
  const seen = (line: string): void => {
    if (last !== undefined || line.startsWith(MIGRATING)) last = Date.now()
  }
  for (const input of [child.stdout, child.stderr]) {
    if (input !== null) createInterface({ input, crlfDelay: Infinity }).on("line", seen)
  }
  return () => (last === undefined ? boot : last + limits.stallMs)
}

/** Gone by exit or by signal; `exitCode` alone is `null` for a child a signal took. */
const exited = (child: ChildProcess): boolean =>
  child.exitCode !== null || child.signalCode !== null

/**
 * Poll until the engine answers for `root`, or the child exits. Recursive rather than
 * a loop for `pickPair`'s reason: the next probe is worth making only once this one has
 * come back.
 */
const awaitBoot = async (
  root: string,
  port: number,
  child: ChildProcess,
  tail: () => string,
  deadline: () => number,
): Promise<void> => {
  if (exited(child)) {
    throw new Error(
      `the engine for ${root} exited with ${String(child.exitCode ?? child.signalCode)} before serving.\n\n${tail()}`,
    )
  }
  if ((await answeringFor(port)) === root) return
  if (Date.now() > deadline()) {
    throw new Error(`the engine for ${root} did not answer on ${String(port)}.\n\n${tail()}`)
  }
  await wait(POLL_MS)
  return awaitBoot(root, port, child, tail, deadline)
}

/** The program and arguments that run one engine in the foreground. */
export interface EngineCommand {
  readonly file: string
  readonly args: readonly string[]
}

/**
 * How to run an engine bundle for a project — the parts that differ between the desktop
 * shell and a host. Whatever `command`
 * runs, its process is the engine as far as this file knows: its exit is the engine's.
 */
export interface EngineLaunch {
  /** Run before the attach check. */
  readonly prepare?: (root: string) => Promise<void>
  /** `port` is also in the child's `ORKESTRA_API_PORT`. */
  readonly command: (root: string, port: number) => EngineCommand
  /**
   * Laid over this process's environment for the child and everything it spawns — the
   * shell's login `PATH` and `ELECTRON_RUN_AS_NODE`, for one.
   */
  readonly env: Readonly<Record<string, string>>
  /** Run once the child is gone, by `stopEngine` — for what outlives the child. Never throws. */
  readonly teardown?: (root: string) => Promise<void>
  /**
   * Handed every line the child prints, on stdout and on stderr, from its first to its
   * last — what a host keeps in its file for the project. Never throws: it runs in a
   * stream's listener, where a throw would take down the caller's whole process.
   */
  readonly output?: (line: string) => void
}

/** The engine bundle at `entry`, run by the Node binary `node`. */
export const nodeLaunch = (
  entry: string,
  node: string,
  env: Readonly<Record<string, string>>,
): EngineLaunch => ({
  command: (root) => ({ file: node, args: [entry, "--dir", root] }),
  env,
})

/**
 * The engine for `root`: attached if one is serving, started otherwise. `limits` is for a
 * test; every caller boots with `BOOT_LIMITS`.
 *
 * `ORKESTRA_API_PORT` names the pair chosen here, and is set after `launch.env`, since
 * the engine on its own binds the derived one and would fail loudly on a pair another
 * project holds.
 */
export const startEngine = async (
  root: string,
  launch: EngineLaunch,
  limits: BootLimits = BOOT_LIMITS,
): Promise<Engine> => {
  await launch.prepare?.(root)
  const found = await attached(root)
  if (found !== undefined) return found

  const pair = await pickPair(root, basePort(root), PAIR_ATTEMPTS)
  const command = launch.command(root, pair.api)
  const child = spawn(command.file, command.args, {
    env: {
      ...process.env,
      ...launch.env,
      ORKESTRA_API_PORT: String(pair.api),
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const tail = tailOf(child)
  const deadline = bootDeadline(child, limits)
  const output = launch.output
  if (output !== undefined) {
    for (const input of [child.stdout, child.stderr]) {
      createInterface({ input, crlfDelay: Infinity }).on("line", output)
    }
  }
  const teardown = launch.teardown
  const started = (token: string | undefined): Engine => ({
    root,
    port: pair.api,
    url: urlOf(pair.api),
    child,
    token,
    ...(teardown === undefined ? {} : { teardown: () => teardown(root) }),
  })
  // From here until the `Engine` is handed back, the child is this function's to kill:
  // a caller that is thrown at has no reference to it, and a child left running would
  // serve the project past quit with nothing naming it as the caller's. That covers the
  // boot and stall deadlines, the record deadline and any failure added later. An engine that
  // would have answered a few seconds after the deadline is killed too, on purpose —
  // the person has just been told it did not start, and one that survives that
  // sentence is the defect. The exited branch kills nothing, harmlessly.
  try {
    await awaitBoot(root, pair.api, child, tail, deadline)
    const token = await awaitToken(root, pair.api, child.pid, Date.now() + RECORD_TIMEOUT_MS)
    return started(token)
  } catch (e) {
    await stopEngine(started(undefined))
    throw e
  }
}

/**
 * Stop an engine `startEngine` started; an attached one is left running. SIGTERM lets the
 * engine interrupt its drives — which kills the `claude` each one left running — and
 * remove its record; a child still there after the grace is killed. The teardown runs
 * after, and also for a child that had already exited, which is how a lost engine's
 * leftovers are cleared.
 */
export const stopEngine = async (engine: Engine): Promise<void> => {
  const child = engine.child
  if (child === undefined) return
  if (!exited(child)) {
    const gone = new Promise<void>((done) => child.once("exit", () => done()))
    child.kill("SIGTERM")
    await Promise.race([gone, wait(STOP_GRACE_MS)])
    if (!exited(child)) child.kill("SIGKILL")
  }
  await engine.teardown?.()
}

/**
 * What the engine says about its traks: `running` when one reports so, `idle` when it
 * answered and none does, `unknown` when it could not be asked.
 *
 * **`unknown` is "I could not tell", never "nothing is running"** — `discovery.ts`'s rule
 * for the same shape of probe. A timeout, a non-2xx and a body that will not decode are
 * what an engine three minutes into a paid turn, or one behind a passphrase, looks like
 * from out here, so a caller stopping an engine on that answer asks the person first.
 * The one case with provably nothing to lose is a child started here that has already
 * exited, and that is `idle` without asking.
 */
export type Running = "running" | "idle" | "unknown"

export const running = async (engine: Engine): Promise<Running> => {
  if (engine.child !== undefined && exited(engine.child)) return "idle"
  try {
    const response = await fetch(`${engine.url}api/traks`, {
      headers: credential(engine),
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) return "unknown"
    const body: unknown = await response.json()
    const decoded = Schema.decodeUnknownEither(TrakListDto)(body)
    if (decoded._tag !== "Right") return "unknown"
    return decoded.right.traks.some((t) => t.running) ? "running" : "idle"
  } catch {
    return "unknown"
  }
}

/**
 * What to ask before stopping engines that answered `answers`: nothing when every one is
 * idle, and otherwise which of the two questions — a turn that is known to be running
 * outranks an engine that could not say.
 */
export const stopQuestion = (answers: readonly Running[]): "none" | "running" | "unknown" => {
  if (answers.every((a) => a === "idle")) return "none"
  return answers.includes("running") ? "running" : "unknown"
}

/**
 * Ask the engine to read its project's files again: `undefined` once it has, or the
 * sentence to show the person who pressed. Nothing running is interrupted, so an engine
 * this caller only attached to is asked the same as one it started.
 */
export const reloadEngine = async (engine: Engine): Promise<string | undefined> => {
  try {
    const response = await fetch(`${engine.url}api/reload`, {
      method: "POST",
      headers: credential(engine),
      signal: AbortSignal.timeout(30_000),
    })
    if (response.ok) return undefined
    const body: unknown = await response.json().catch(() => undefined)
    const decoded = Schema.decodeUnknownEither(ReloadFailedDto)(body)
    if (decoded._tag === "Right") return decoded.right.reason
    return response.status === 404
      ? "This engine is too old to reload its files. Restart it once to get the newer one."
      : `The engine answered ${String(response.status)}.`
  } catch (e) {
    return `The engine could not be reached: ${e instanceof Error ? e.message : String(e)}`
  }
}
