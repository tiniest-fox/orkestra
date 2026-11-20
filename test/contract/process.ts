// The Process port's contract, written once and run against every
// implementation.
//
// Only the killing is here, because that is the guarantee nothing above this
// file can check: every flow test takes "the turn is over" as given, and a stray
// build left running in a worktree Orkestra is about to commit shows up nowhere
// in an event log. Real subprocesses throughout — a fake that reported a pid
// dead would be asserting on itself.

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, type Either, type Layer, Option, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { Process, type ProcessShape } from "../../src/agent/ports/process.js"
import type { ProcessFailed } from "../../src/agent/types/errors.js"

/** Where every process here runs, and so every child it starts: a directory of the test's own. */
const WORK = mkdtempSync(join(tmpdir(), "process-contract-"))

export interface ProcessUnderTest {
  readonly label: string
  readonly layer: Layer.Layer<Process>
  /**
   * The same implementation with a short kill grace, for the one case that sits the
   * grace out in full. The cases that prove the grace is *not* waited out keep `layer`:
   * against a short grace a regression would cost too little to see.
   */
  readonly shortGrace?: Layer.Layer<Process>
}

/**
 * A process that survives SIGTERM and starts a child in a process group of its
 * own, then prints that child's pid — the shape Claude Code has when it is
 * running a Bash command, reproduced without spending anything.
 */
const HOLDER = `
  const { spawn } = require("node:child_process")
  process.on("SIGTERM", () => {})
  const child = spawn("sh", ["-c", "sleep 30"], { detached: true, stdio: "ignore" })
  child.unref()
  console.log(String(child.pid))
  setInterval(() => {}, 1000)
`

/**
 * The holder's opposite: it dies on SIGTERM and does nothing about the child it
 * started in a group of its own — Playwright's shape when a check times out in its
 * browser tier, with the `webServer` as the child.
 */
const ABANDONER = `
  const { spawn } = require("node:child_process")
  const child = spawn("sh", ["-c", "sleep 30"], { detached: true, stdio: "ignore" })
  child.unref()
  console.log(String(child.pid))
  setInterval(() => {}, 1000)
`

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** A SIGKILL is not synchronous, and the kernel still has to reap. */
const goneWithin = async (pid: number, ms: number): Promise<boolean> => {
  if (!alive(pid)) return true
  if (ms <= 0) return false
  await new Promise((resolve) => setTimeout(resolve, 50))
  return goneWithin(pid, ms - 50)
}

/** Spawns `script`, reads the pid it prints, then lets the scope close. */
const strayOf =
  (script: string) =>
  (p: ProcessShape): Effect.Effect<number, unknown> =>
    Effect.scoped(
      Effect.flatMap(
        p.spawn({
          command: process.execPath,
          args: ["-e", script],
          cwd: WORK,
          env: {},
          stdin: undefined,
          holdStdin: false,
        }),
        (spawned) =>
          Effect.map(Stream.runHead(spawned.lines), (head) =>
            Number(Option.getOrElse(head, () => "0")),
          ),
      ),
    )

/** Spawns something that has already exited by the time the scope closes. */
const alreadyExited = (p: ProcessShape): Effect.Effect<unknown, unknown> =>
  Effect.scoped(
    Effect.flatMap(
      p.spawn({
        command: "sh",
        args: ["-c", "exit 0"],
        cwd: WORK,
        env: {},
        stdin: undefined,
        holdStdin: false,
      }),
      (spawned) => spawned.exited,
    ),
  )

/**
 * A live process that ends on the SIGTERM its scope sends, released mid-run — a search
 * stopped at its cap is this shape. Its pid comes back so the test can see it gone.
 */
const endsOnTerm = (p: ProcessShape): Effect.Effect<number, unknown> =>
  Effect.scoped(
    Effect.map(
      p.spawn({
        command: "sleep",
        args: ["30"],
        cwd: WORK,
        env: {},
        stdin: undefined,
        holdStdin: false,
      }),
      (spawned) => spawned.pid,
    ),
  )

/**
 * A held-open stdin, end to end: the spawn's own content and a later `send` both
 * reach the child, and `endInput` is what lets it exit. `cat` is the probe
 * because it echoes exactly what the pipe carried and ends exactly at EOF — a
 * child that exits 0 here has seen the pipe close, which is the one thing a
 * non-held spawn does at spawn time and a held one must not.
 */
const heldEcho = (p: ProcessShape): Effect.Effect<readonly string[], unknown> =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawned = yield* p.spawn({
        command: "cat",
        args: [],
        cwd: WORK,
        env: {},
        stdin: "first",
        holdStdin: true,
      })
      yield* spawned.send("second")
      yield* spawned.endInput
      const lines = yield* Stream.runCollect(spawned.lines)
      const exited = yield* spawned.exited
      return exited.code === 0 ? [...lines] : []
    }),
  )

/**
 * A held-open stdin whose child has closed its end and is still alive: the shape a
 * stop press takes when it races the turn's end. `exec 0<&-` closes fd 0 and the sleep
 * keeps the process there to be written to, so the write is an EPIPE on a socket Node
 * has not destroyed — the one case `writableEnded` and `destroyed` cannot see. Both
 * writes must come back as failures on the port, and this process must still be here
 * to read them.
 */
const heldPipeClosedByChild = (
  p: ProcessShape,
): Effect.Effect<readonly (Either.Either<void, ProcessFailed> | string)[], unknown> =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawned = yield* p.spawn({
        command: "sh",
        args: ["-c", "exec 0<&- ; sleep 3"],
        cwd: WORK,
        env: {},
        stdin: undefined,
        holdStdin: true,
      })
      // Long enough for the shell to run `exec 0<&-`.
      yield* Effect.sleep("300 millis")
      const sent = yield* Effect.either(spawned.send("late"))
      const ended = yield* Effect.either(spawned.endInput)
      return [sent, ended]
    }),
  )

/**
 * A live process's start time, read twice while it runs and once after the scope
 * has killed it — the three answers `reap` relies on: present, stable, then gone.
 */
const startTimes = (
  p: ProcessShape,
): Effect.Effect<
  {
    readonly first: string | undefined
    readonly second: string | undefined
    readonly after: string | undefined
  },
  unknown
> =>
  Effect.gen(function* () {
    const { pid, first, second } = yield* Effect.scoped(
      Effect.gen(function* () {
        const spawned = yield* p.spawn({
          command: "sh",
          args: ["-c", "sleep 30"],
          cwd: WORK,
          env: {},
          stdin: undefined,
          holdStdin: false,
        })
        return {
          pid: spawned.pid,
          first: yield* p.startTime(spawned.pid),
          second: yield* p.startTime(spawned.pid),
        }
      }),
    )
    yield* Effect.promise(() => goneWithin(pid, 5000))
    return { first, second, after: yield* p.startTime(pid) }
  })

/**
 * A process that has printed, exited and closed before anything asks how it exited — a
 * rejoined command replaying its output to a reader slower than it. The exit is asked
 * for only then, and has to answer all the same.
 */
const askedAfterClose = (p: ProcessShape) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawned = yield* p.spawn({
        command: "sh",
        args: ["-c", "echo done"],
        cwd: WORK,
        env: {},
        stdin: undefined,
        holdStdin: false,
      })
      const lines = yield* Stream.runCollect(spawned.lines)
      yield* Effect.promise(() => goneWithin(spawned.pid, 5000))
      yield* Effect.sleep("200 millis")
      const exited = yield* spawned.exited.pipe(Effect.timeout("5 seconds"))
      return { lines: [...lines], code: exited.code }
    }),
  )

/** Runs `body` on the Process `layer` provides. */
const runOn =
  (layer: Layer.Layer<Process>) =>
  <A>(body: (p: ProcessShape) => Effect.Effect<A, unknown>): Promise<A> =>
    Effect.runPromise(Effect.flatMap(Process, body).pipe(Effect.provide(layer), Effect.orDie))

/** Run this against any Process implementation. */
export const processContract = (c: ProcessUnderTest): void => {
  const run = runOn(c.layer)

  describe(`Process contract: ${c.label}`, () => {
    it("kills what the process started, not only the process", async () => {
      // The agent's own SIGTERM handler is what tears its tool tree down, so
      // the holder ignores SIGTERM to force the escalation — the path where a
      // group kill reaches the agent and leaves a shell behind on pid 1,
      // running whatever it was running.
      const strayPid = await runOn(c.shortGrace ?? c.layer)(strayOf(HOLDER))
      expect(strayPid).toBeGreaterThan(0)
      expect(await goneWithin(strayPid, 5000)).toBe(true)
    }, 20_000)

    it("kills what the process started when the process itself dies on SIGTERM", async () => {
      // Its death reparents the child to pid 1, so a walk taken only after the
      // SIGTERM finds nothing to kill.
      const strayPid = await run(strayOf(ABANDONER))
      expect(strayPid).toBeGreaterThan(0)
      expect(await goneWithin(strayPid, 5000)).toBe(true)
    }, 20_000)

    it("does not wait out the grace period for a process that already exited", async () => {
      // A suite of nine 20ms check scripts took 20s when it did.
      const started = Date.now()
      await run(alreadyExited)
      expect(Date.now() - started).toBeLessThan(1500)
    }, 20_000)

    it("releases a live process that ends on SIGTERM without waiting out the grace period", async () => {
      // A search stopped at its cap answered two seconds late when it did.
      const started = Date.now()
      const pid = await run(endsOnTerm)
      expect(Date.now() - started).toBeLessThan(1000)
      expect(await goneWithin(pid, 1000)).toBe(true)
    }, 20_000)

    it("holds stdin open: the spawn's content and a send both arrive, endInput ends it", async () => {
      expect(await run(heldEcho)).toEqual(["first", "second"])
    }, 20_000)

    it("reports a write the child will not read as a failure, and survives it", async () => {
      const [sent, ended] = await run(heldPipeClosedByChild)
      expect(sent).toMatchObject({ _tag: "Left", left: { _tag: "ProcessFailed" } })
      expect(ended).toMatchObject({ _tag: "Left", left: { _tag: "ProcessFailed" } })
    }, 20_000)

    it("answers how a process exited when it is first asked after the process closed", async () => {
      expect(await run(askedAfterClose)).toEqual({ lines: ["done"], code: 0 })
    }, 20_000)

    it("reads a live process's start time, the same each time, and nothing once it is gone", async () => {
      // What the reaper compares: the value recorded at spawn against the one read
      // at the sweep. Stable across reads is the property; a value that drifted
      // would decline every stray, and one that survived the process would kill a
      // reissued pid.
      const { first, second, after } = await run(startTimes)
      expect(first).toBeDefined()
      expect(second).toBe(first)
      expect(after).toBeUndefined()
    }, 20_000)
  })
}
