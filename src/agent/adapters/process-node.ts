// Node implementation of the Process port.
//
// Four rules, each of which cost someone a debugging session:
//
//  1. stdin is never inherited. An inherited stdin on a background process
//     group causes SIGTTIN on any read, which silently STOPS the whole group.
//     It is 'ignore', or a pipe — closed at spawn unless the spec holds it
//     open, so a child never waits on input that is not coming.
//  2. detached: true, so the child leads its own process group and kill(-pid)
//     reaches it and its children without touching ours. It does not reach
//     everything the child *started*: Claude Code puts each Bash tool
//     invocation in a group of its own, which is why killGroup walks the
//     descendants before it escalates.
//  3. SIGCONT before SIGTERM. A stopped process queues SIGTERM without
//     delivering it and stays stopped forever.
//  4. The environment is inherited MINUS the engine's own `ORKESTRA_*`, and minus
//     whatever the spec withholds — see `logic/spawn-env.ts`. Every spawn the
//     engine makes comes through here, which is why the rule lives here and
//     not at each caller. The only other `node:child_process` call under
//     `src/` is `src/ui.ts`, the daemon's own parent, which passes those
//     variables down deliberately; a third would put the leak back with
//     nothing failing.
//
// The first three are carried over from orkestra-agent.

// oxlint-disable-next-line eslint/no-restricted-imports -- the node layer every Process is built over
import { spawn as nodeSpawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { Deferred, Effect, Layer, Stream } from "effect"
import { spawnEnv } from "../logic/spawn-env.js"
import { Process, type ProcessShape, type ProcessSpec, type Spawned } from "../ports/process.js"
import { ProcessFailed } from "../types/errors.js"

/**
 * How long a signalled group has to end before the SIGKILL. Production never passes
 * another value — `provider-hazards` says why it is never shortened. Only the Process
 * contract test does, so its escalation cases do not sit out two seconds each.
 */
const GRACE_MS = 2000

/** How often the grace period asks whether the signalled groups are gone yet. */
const GRACE_POLL_MS = 20

/** Signals a whole process group; `false` means it was already gone. */
const signalGroup = (group: number, sig: NodeJS.Signals | 0): boolean => {
  try {
    process.kill(-group, sig)
    return true
  } catch {
    // Already gone, or never formed a group. Nothing to do.
    return false
  }
}

/** A pipe wherever something is written, and nothing a child could wait on otherwise. */
const stdinOf = (spec: ProcessSpec): "ignore" | "pipe" =>
  spec.stdin === undefined && spec.preamble === undefined && !spec.holdStdin ? "ignore" : "pipe"

/** The spawn-time input: the preamble, then `stdin` — closed after unless the spec holds it. */
const writeInput = (stdin: NodeJS.WritableStream, spec: ProcessSpec): void => {
  if (spec.preamble !== undefined) stdin.write(spec.preamble)
  if (spec.holdStdin) {
    if (spec.stdin !== undefined) stdin.write(`${spec.stdin}\n`)
  } else {
    stdin.end(spec.stdin ?? "")
  }
}

const spawnProcess = (spec: ProcessSpec): Effect.Effect<Spawned, ProcessFailed> =>
  Effect.async<Spawned, ProcessFailed>((resume) => {
    const child = nodeSpawn(spec.command, [...spec.args], {
      cwd: spec.cwd,
      env: spawnEnv({ ...process.env, ...spec.inherits }, spec.env, spec.withhold), // rule 4
      // rule 1: never *inherit* stdin. A pipe is fine — it is not a terminal,
      // so there is no SIGTTIN. Unless the spec holds it open, it closes as
      // soon as the content is written, so the child never waits on input that
      // is not coming.
      stdio: [stdinOf(spec), "pipe", "pipe"],
      detached: true, // rule 2
    })

    child.once("error", (e) => {
      resume(Effect.fail(new ProcessFailed({ command: spec.command, reason: e.message })))
    })

    child.once("spawn", () => {
      const pid = child.pid
      if (pid === undefined) {
        resume(Effect.fail(new ProcessFailed({ command: spec.command, reason: "no pid" })))
        return
      }

      // Every write to the child's stdin needs an error path, and this is it. A child
      // that closed its end — dying, or alive and no longer reading — turns the next
      // write into an EPIPE `'error'` on the stream, and an `'error'` nobody listens for
      // is an uncaught exception that ends this process and every trak it is driving.
      // The spawn-time write below is microseconds after the pipe opened; the ones a
      // held pipe takes later — a person's stop press, the close once the level empties —
      // land at any time at all, including the window between the child dying and Node
      // destroying the socket, which none of `writableEnded` and `destroyed` covers.
      // Recorded rather than only swallowed, so `send` and `endInput` refuse afterwards.
      let stdinFailure: Error | undefined
      child.stdin?.on("error", (e) => {
        stdinFailure ??= e
      })

      if (child.stdin !== null) writeInput(child.stdin, spec)

      // stderr is drained into a buffer so a full pipe can never block the child.
      let stderr = ""
      child.stderr?.setEncoding("utf8")
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk
      })

      // The iterator is taken now, at the spawn, rather than on the first pull. readline's
      // iterator queues only the `'line'` and `'close'` events emitted after it exists, and
      // the interface reads stdout from the moment it is made — so a child that printed and
      // exited before anyone pulled lost every line and the close with them, and its
      // stream waited forever. That was a turn whose agent had answered and gone, stuck in
      // AgentWorking with nothing after `Spawned`. A queue nobody reads pauses stdout past
      // 1024 lines, which is the backpressure a slow reader already gets.
      const stdout = child.stdout
      const pending =
        stdout === null
          ? undefined
          : createInterface({ input: stdout, crlfDelay: Number.POSITIVE_INFINITY })[
              Symbol.asyncIterator
            ]()
      const lines =
        pending === undefined
          ? Stream.empty
          : Stream.fromAsyncIterable(
              { [Symbol.asyncIterator]: () => pending },
              (e) =>
                new ProcessFailed({
                  command: spec.command,
                  reason: e instanceof Error ? e.message : String(e),
                }),
            )

      // Listened for now, at the spawn, and kept: `'close'` fires once, and a caller that
      // reads the output to its end before asking for the exit can ask after it fired —
      // under load the close can land in the same tick stdout ends — and would wait forever.
      const closed = Effect.runSync(
        Deferred.make<{ readonly code: number | undefined; readonly signal: string | undefined }>(),
      )
      child.once("close", (code, sig) => {
        Effect.runSync(
          Deferred.succeed(closed, { code: code ?? undefined, signal: sig ?? undefined }),
        )
      })
      const exited: Effect.Effect<
        {
          readonly code: number | undefined
          readonly signal: string | undefined
          readonly stderr: string
        },
        ProcessFailed
      > = Effect.map(Deferred.await(closed), (end) => ({ ...end, stderr }))

      /** The one refusal both writes share: the pipe is not there to write down. */
      const notOpen = (why: string): ProcessFailed =>
        new ProcessFailed({ command: spec.command, reason: `stdin is not open: ${why}` })

      const heldStdin = (): NonNullable<typeof child.stdin> | ProcessFailed => {
        const stdin = child.stdin
        if (!spec.holdStdin || stdin === null) return notOpen("not held")
        if (stdinFailure !== undefined) return notOpen(stdinFailure.message)
        if (stdin.writableEnded || stdin.destroyed) return notOpen("ended")
        return stdin
      }

      // One line per write, newline included: the held pipe carries a line
      // protocol, and a frame without its terminator is one the child never acts
      // on. Settled on the write's own callback rather than on `write` returning, so
      // an EPIPE the kernel reports for THIS write is this send's failure — not a
      // success followed by an error somebody else reads later.
      const send = (line: string): Effect.Effect<void, ProcessFailed> =>
        Effect.async<void, ProcessFailed>((done) => {
          const stdin = heldStdin()
          if (stdin instanceof ProcessFailed) {
            done(Effect.fail(stdin))
            return
          }
          stdin.write(`${line}\n`, (e) => {
            if (e === undefined || e === null) {
              done(Effect.void)
              return
            }
            // Recorded here as well as on the stream's own event, which may land a
            // tick later: the close that follows a failed stop must already know.
            stdinFailure ??= e
            done(Effect.fail(notOpen(e.message)))
          })
        })

      // Idempotent — a pipe already ended is the outcome asked for — but a pipe that has
      // already failed is refused, for `send`'s reason.
      const endInput: Effect.Effect<void, ProcessFailed> = Effect.suspend(() => {
        const stdin = child.stdin
        if (stdin === null || stdin.writableEnded || stdin.destroyed) {
          return stdinFailure === undefined
            ? Effect.void
            : Effect.fail(notOpen(stdinFailure.message))
        }
        if (stdinFailure !== undefined) return Effect.fail(notOpen(stdinFailure.message))
        stdin.end()
        return Effect.void
      })

      resume(Effect.succeed({ pid, lines, exited, send, endInput }))
    })
  })

/**
 * `ps` output, or `undefined` if it refused. Read via `ps` rather than anything
 * platform-specific — `ps` is the one interface macOS and Linux agree on, and this
 * repo reads `/proc` only where `ps` cannot answer: whether a pid is a thread.
 */
const psLines = (args: readonly string[]): Effect.Effect<readonly string[] | undefined> =>
  Effect.gen(function* () {
    // `/`, which holds nothing `ps` could read: a test's recording accepts `ps` only from
    // there or from a directory the test made.
    const spawned = yield* spawnProcess({
      command: "ps",
      args,
      cwd: "/",
      env: {},
      stdin: undefined,
      holdStdin: false,
    })
    const out = yield* Stream.runCollect(spawned.lines)
    const exited = yield* spawned.exited
    return exited.code === 0 ? [...out] : undefined
  }).pipe(Effect.orElseSucceed(() => undefined))

/**
 * When a process started, as `ps -o lstart=` prints it — `Thu Sep 17 12:31:38 2026`
 * on macOS and Linux alike. `undefined` covers both "the process is gone" and "ps
 * refused", which the caller treats identically: a stray it cannot verify is a
 * stray it must not kill. Never a wall-clock read at spawn: `lstart` is whole
 * seconds, so a `Date.now()` recorded beside it would never compare equal and the
 * reaper would decline everything with nothing saying why.
 */
const startTime = (pid: number): Effect.Effect<string | undefined> =>
  psLines(["-p", String(pid), "-o", "lstart="]).pipe(
    Effect.map((lines) => {
      const line = (lines ?? []).join(" ").trim()
      return line === "" ? undefined : line
    }),
  )

interface PsRow {
  readonly pid: number
  readonly ppid: number
  readonly pgid: number
}

/** One `pid ppid pgid` row, or nothing if the line is a header or garbage. */
const psRow = (line: string): readonly PsRow[] => {
  const [pid, ppid, pgid] = line.trim().split(/\s+/).map(Number)
  if (pid === undefined || ppid === undefined || pgid === undefined) return []
  return [pid, ppid, pgid].some(Number.isNaN) ? [] : [{ pid, ppid, pgid }]
}

/**
 * The distinct process groups below `pid`, excluding `pid`'s own and ours.
 *
 * A descendant that never called `setsid` is already in `pid`'s group and needs
 * no separate signal; one that did — every Bash tool invocation Claude Code
 * makes — is reachable only by its own group id.
 */
const strayGroups = (rows: readonly PsRow[], pid: number): readonly number[] => {
  const children = new Map<number, PsRow[]>()
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row])
  const ours = rows.find((row) => row.pid === process.pid)?.pgid
  const groups = new Set<number>()
  const seen = new Set<number>([pid])
  let frontier: readonly number[] = [pid]
  while (frontier.length > 0) {
    const next = frontier.flatMap((p) => children.get(p) ?? []).filter((row) => !seen.has(row.pid))
    for (const row of next) {
      seen.add(row.pid)
      // Group 0 means "the caller's own group" to kill(2), and 1 is init's.
      if (row.pgid !== pid && row.pgid !== ours && row.pgid > 1) groups.add(row.pgid)
    }
    frontier = next.map((row) => row.pid)
  }
  return [...groups]
}

/** The groups below `pid` as `ps` sees them now; nothing when `ps` refuses. */
const descendantGroups = (pid: number): Effect.Effect<readonly number[]> =>
  Effect.map(psLines(["-eo", "pid=,ppid=,pgid="]), (lines) =>
    strayGroups(lines?.flatMap(psRow) ?? [], pid),
  )

/**
 * SIGCONT -> SIGTERM -> (grace) -> SIGKILL, to the group and to any group its
 * descendants made for themselves.
 *
 * The SIGTERM is what does the real work on a healthy agent: `claude` kills its
 * own tool tree while handling the signal, and the shell running a command dies
 * before `claude` does. The SIGKILL reaches only the group, so an agent that
 * has not finished cleaning up within the grace period would leave that shell
 * running, reparented to pid 1 and recorded nowhere anything can find it again.
 * Hence the walk.
 *
 * **The walk runs before the SIGTERM as well as after the grace period.** A process
 * that dies on SIGTERM without stopping what it started takes the only path from `pid`
 * to those groups with it. Playwright is the one that did: a `verify` check timed out in
 * its browser tier, the SIGTERM ended Playwright before it stopped its `webServer`, and
 * the server lived on under pid 1 holding the worktree's e2e ports, so every later
 * `verify` there failed on *"is already used"*. The second walk is still needed for a
 * group a descendant makes during the grace period.
 */
const killGroup = (pid: number, command: string, graceMs: number): Effect.Effect<void> =>
  Effect.gen(function* () {
    // Signal 0 delivers nothing and only asks whether the group is still there.
    // A process that ran to completion — which is every check that answers, and
    // every agent turn that finishes — is already gone by the time its scope
    // closes, and waiting out the grace period for it charged GRACE_MS to each
    // one. Checks made that visible: a suite of nine 20ms scripts took 20s. Asked
    // before the walk too, so a finished process costs no `ps`.
    if (!signalGroup(pid, 0)) return
    const before = yield* descendantGroups(pid)
    for (const group of [pid, ...before]) signalGroup(group, "SIGCONT")
    for (const group of [pid, ...before]) signalGroup(group, "SIGTERM")
    // The grace is the most a group is given, not a wait every kill pays: a process that
    // ends on the SIGTERM — a `git grep` stopped at its cap — is gone within milliseconds,
    // and sleeping the whole grace made every such search answer two seconds late. A group
    // still alive at the end gets the full grace before the SIGKILL, as before. Returning
    // early loses nothing the second walk could find: it walks from `pid`, which is gone.
    const alive = (): boolean => [pid, ...before].some((group) => signalGroup(group, 0))
    for (let waited = 0; waited < graceMs; waited += GRACE_POLL_MS) {
      if (!alive()) return
      yield* Effect.sleep(`${GRACE_POLL_MS} millis`)
    }
    const after = yield* descendantGroups(pid)
    signalGroup(pid, "SIGKILL")
    for (const group of new Set([...before, ...after])) signalGroup(group, "SIGKILL")
    yield* Effect.logDebug(`killed process group ${pid} (${command})`)
  }).pipe(Effect.ignoreLogged)

/**
 * Whether `pid` is a thread of another process rather than a process. On Linux `kill(tid,
 * 0)` succeeds on a thread id, and after a container restart most numbers in use are
 * threads, so a dead holder's pid reissued to one read as alive. Read from `/proc`, which
 * only Linux has; a thread id is no pid to `kill` elsewhere. Unreadable — gone since the
 * `kill`, or no `/proc` — answers no, leaving the verdict to the `kill`.
 */
const isThreadOfAnother = (pid: number): boolean => {
  try {
    const tgid = /^Tgid:\s*(\d+)$/m.exec(readFileSync(`/proc/${String(pid)}/status`, "utf8"))?.[1]
    return tgid !== undefined && Number(tgid) !== pid
  } catch {
    return false
  }
}

/** The Node Process, with a grace other than `GRACE_MS` only where a test sets one. */
const nodeProcess = (graceMs: number = GRACE_MS): ProcessShape => ({
  spawn: (spec) =>
    Effect.acquireRelease(spawnProcess(spec), (p) => killGroup(p.pid, spec.command, graceMs)), // rule 3

  isAlive: (pid) =>
    Effect.sync(() => {
      try {
        // Signal 0 tests for existence without delivering anything.
        process.kill(pid, 0)
        return !isThreadOfAnother(pid)
      } catch (cause) {
        // `ESRCH` is the only answer that means "no such process". `EPERM` means
        // the opposite — it exists and belongs to someone else — and a bare
        // `catch` read that as dead, which is the same laundering `branchTip`
        // did when it caught every git failure as "there is no such branch": an
        // inconclusive answer turned into a definite verdict.
        //
        // Alive is the safe default for anything unrecognised. Wrongly dead lets
        // `reap` clear a live holder's record and two processes drive one trak,
        // which is what custody exists to prevent; wrongly alive leaves a record
        // `ork wipe` can clear.
        return !(cause instanceof Error && "code" in cause && cause.code === "ESRCH")
      }
    }),

  // The reaper's kill: the process that would have released a scope is gone,
  // along with its finalizer, so this runs the same sequence by hand.
  kill: (pid) => killGroup(pid, `reaped pid ${pid}`, graceMs),

  startTime,

  // Nothing here runs in a sandbox, so there is no remote half to stop.
  killExec: () => Effect.void,
})

export const makeNodeProcess: ProcessShape = nodeProcess()

export const NodeProcessLayer = Layer.succeed(Process, makeNodeProcess)

/** The Node Process with a shorter grace, for a test that sits out the escalation. */
export const nodeProcessLayerWithGrace = (graceMs: number): Layer.Layer<Process> =>
  Layer.succeed(Process, nodeProcess(graceMs))
