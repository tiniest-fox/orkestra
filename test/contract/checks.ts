// The Checks port's contract, written once and run against every implementation.
//
// Everything here is about the boundary between a shell script and the engine:
// what an exit code means, what "output" is, and what happens when a check does
// not come back. The flow tests upstream take an outcome as given — this is the
// only place that finds out whether one is produced correctly.
//
// Each case supplies its own script, because a check IS a script: a fake that
// answered by name would be asserting on itself.

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Fiber, type Layer, Schedule } from "effect"
import { describe, expect, it } from "vitest"
import type { Check } from "../../src/library/types/check.js"
import { TrakId } from "../../src/workflow/domain/trak.js"
import { type CheckOutcome, type CheckRun, Checks } from "../../src/workflow/ports/checks.js"

export interface ChecksUnderTest {
  readonly label: string
  readonly layer: Layer.Layer<Checks>
  /** Real subprocesses need a moment; a fake is instant. */
  readonly timeoutMs: number
}

/** A scratch directory the suite writes its scripts into. */
const scratch = mkdtempSync(join(tmpdir(), "orkestra-checks-"))

const script = (name: string, body: string, timeoutSeconds = 10): Check => {
  const path = join(scratch, `${name}.sh`)
  writeFileSync(path, `#!/bin/bash\n# ---\n# description: ${name}\n# ---\n${body}\n`)
  return {
    name,
    description: name,
    timeoutSeconds,
    askedEverySeconds: undefined,
    exclusive: false,
    cache: true,
    ignoresLinguistGenerated: false,
    units: undefined,
    cacheAcross: "platform" as const,
    path,
  }
}

const WATCHED = TrakId.make("11111111-1111-4111-8111-111111111111")
const UNWATCHED = TrakId.make("22222222-2222-4222-8222-222222222222")

const running =
  (c: ChecksUnderTest) =>
  (check: Check, cwd = scratch): Promise<CheckOutcome> =>
    Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(Checks, (checks) => checks.run(check, cwd)).pipe(
          Effect.timeout(`${c.timeoutMs} millis`),
          Effect.provide(c.layer),
        ),
      ),
    )

/**
 * A run and then the memory of it, in one program — the layer is built per call, so the
 * two halves have to be inside the same one or `live` is asked of a fresh adapter.
 */
const watching =
  (c: ChecksUnderTest) =>
  (check: Check, at = WATCHED): Promise<CheckRun | undefined> =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const checks = yield* Checks
          yield* checks.run(check, scratch, { trak: at, step: 3 })
          return yield* checks.live(at)
        }).pipe(Effect.timeout(`${c.timeoutMs} millis`), Effect.provide(c.layer)),
      ),
    )

/**
 * A watched run interrupted part-way — a person ending it — and then the memory of it.
 * The fiber is interrupted once the run has printed, so the settled output can be seen
 * to be what was watched rather than nothing.
 */
const interrupting =
  (c: ChecksUnderTest) =>
  (check: Check, at = WATCHED): Promise<CheckRun | undefined> =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const checks = yield* Checks
          const fiber = yield* Effect.fork(checks.run(check, scratch, { trak: at, step: 3 }))
          yield* Effect.repeat(checks.live(at), {
            until: (run) => (run?.output ?? "") !== "",
            schedule: Schedule.spaced("10 millis"),
          })
          yield* Fiber.interrupt(fiber)
          return yield* checks.live(at)
        }).pipe(Effect.timeout(`${c.timeoutMs} millis`), Effect.provide(c.layer)),
      ),
    )

/** What the run itself answers: the exit, the output, and the line it spawned. */
const outcomeCases = (c: ChecksUnderTest): void => {
  const run = running(c)
  describe(`Checks contract: ${c.label}`, () => {
    it("passes on exit 0", async () => {
      expect(await run(script("clean", "exit 0"))).toMatchObject({ passed: true })
    })

    it("fails on any non-zero exit", async () => {
      expect(await run(script("broken", "exit 1"))).toMatchObject({ passed: false })
      expect(await run(script("worse", "exit 7"))).toMatchObject({ passed: false })
    })

    it("carries what the check said, so the agent has something to fix", async () => {
      const outcome = await run(script("noisy", `echo "found a secret on line 12"; exit 1`))
      expect(outcome.output).toContain("found a secret on line 12")
    })

    it("puts stderr before stdout — diagnostics are what explain a failure", async () => {
      const outcome = await run(script("both", `echo "on stdout"; echo "on stderr" >&2; exit 1`))
      expect(outcome.output.indexOf("on stderr")).toBeLessThan(outcome.output.indexOf("on stdout"))
    })

    it("keeps a report far bigger than a kilobyte whole", async () => {
      // The engine stopped deciding how much of a check's output is worth reading —
      // that is the script's call, because it is the only thing that knows which of its
      // lines is the failure. A tail here cut every stored failure above its detail
      // block, so the gate said how many tests failed and never which.
      const outcome = await run(script("detailed", `seq 1 5000; echo LAST; exit 1`))
      expect(outcome.output).toContain("LAST")
      expect(outcome.output.startsWith("1\n")).toBe(true)
      expect(outcome.output.length).toBeGreaterThan(20_000)
    })

    it("cuts a runaway report at the backstop, keeping the end", async () => {
      // What is left of the old tail: a script printing megabytes writes into an event
      // the drawer refetches every time it opens, and unlike a bad run that is
      // permanent. Two orders of magnitude above anything a check meant for a reader
      // prints, so a sane one never meets it.
      const outcome = await run(script("runaway", `seq 1 40000; echo LAST; exit 1`))
      expect(outcome.output).toContain("LAST")
      expect(outcome.output.startsWith("1\n")).toBe(false)
      expect(outcome.output.length).toBeLessThan(140_000)
    })

    it("keeps the terminal's escapes, because its readers disagree about them", async () => {
      // The drawer renders the colour, the agent's prompt strips it, a terminal already
      // understands it. So the log keeps the union and each reader subtracts — stripping
      // here would be the one subtraction nobody could undo.
      const outcome = await run(script("coloured", `printf '\\033[31mred\\033[0m\\n'; exit 1`))
      expect(outcome.output).toContain("\u001B[31m")
    })

    it("treats a check that never returns as a failure, and says so", async () => {
      const outcome = await run(script("hangs", "sleep 30", 0.3))
      expect(outcome.passed).toBe(false)
      expect(outcome.output).toContain("timed out")
    })

    it("runs in the directory it was given", async () => {
      // Asserted by finding a file relative to `.` rather than by comparing
      // $PWD: on macOS the scratch path is under a symlink, so the string a
      // shell reports and the string we passed are both right and different.
      writeFileSync(join(scratch, "sentinel"), "")
      expect(await run(script("where", "test -f ./sentinel || exit 1"))).toMatchObject({
        passed: true,
      })
    })

    it("inherits the environment, so a check finds the tools a human would", async () => {
      expect(await run(script("has-path", `test -n "$PATH" || exit 1`))).toMatchObject({
        passed: true,
      })
    })

    it("reports the exit code, and reports none for a failure that was not an exit", async () => {
      // *Did not exit* and *exited zero* are different facts, which is why this is
      // optional rather than a sentinel — a gate saying `exit 0` about a check that
      // timed out would be the engine inventing an answer the script never gave.
      expect(await run(script("code", "exit 7"))).toMatchObject({ exitCode: 7 })
      expect(await run(script("clean-code", "exit 0"))).toMatchObject({ exitCode: 0 })
      expect((await run(script("stalls", "sleep 30", 0.3))).exitCode).toBeUndefined()
    })

    it("reports the line it spawned, on every way out", async () => {
      // Reported by the thing that spawns, so no caller rebuilds it — a second copy
      // would be a guess that stays right only until this file changes.
      const ran = await run(script("named", "exit 1"))
      expect(ran.command).toContain("named.sh")
      const timedOut = await run(script("named-slow", "sleep 30", 0.3))
      expect(timedOut.command).toContain("named-slow.sh")
    })

    it("hands the arguments it was given to the script, as $1 onward", async () => {
      // The one script that takes any is `deploy.sh`, handed the merge commit — a fact
      // that is on no branch of ours, so nothing in the directory could say it.
      const outcome = await Effect.runPromise(
        Effect.scoped(
          Effect.flatMap(Checks, (checks) =>
            checks.run(script("args", `echo "got $1 and $2"; exit 0`), scratch, undefined, [
              "9f31c07",
              "second",
            ]),
          ).pipe(Effect.timeout(`${c.timeoutMs} millis`), Effect.provide(c.layer)),
        ),
      )
      expect(outcome).toMatchObject({ passed: true })
      expect(outcome.output).toContain("got 9f31c07 and second")
      expect(outcome.command).toContain("9f31c07")
    })

    it("reports a check it cannot run at all as a failure, not a crash", async () => {
      // The whole reason the port has no error channel: escaping here would fail
      // `advance` after the state had already moved to CheckRunning.
      const missing: Check = {
        name: "missing",
        description: "not on disk",
        timeoutSeconds: 5,
        askedEverySeconds: undefined,
        exclusive: false,
        cache: true,
        ignoresLinguistGenerated: false,
        units: undefined,
        cacheAcross: "platform" as const,
        path: join(scratch, "nothing-here.sh"),
      }
      expect(await run(missing)).toMatchObject({ passed: false })
    })
  })
}

/**
 * What a watcher gets: a run remembered while it happens, and nothing at all for one
 * that belongs to no position.
 *
 * Its own group rather than more cases above, because these two questions are asked of
 * different methods — everything above is what `run` answers its caller, and this is
 * what `live` answers somebody who was not the caller.
 */
const watchingCases = (c: ChecksUnderTest): void => {
  const watched = watching(c)
  describe(`Checks contract: ${c.label}, watched`, () => {
    it("remembers a watched run, with what a person watching it needs", async () => {
      const seen = await watched(script("watched", `echo "line one"; echo "line two"; exit 0`))
      expect(seen).toMatchObject({
        step: 3,
        name: "watched",
        limit: 10,
        finished: { verdict: "passed", exitCode: 0 },
      })
      // Held after it finishes rather than cleared: the run is what somebody standing at
      // the gate is reading, and a console that emptied the moment a check passed would
      // be one nobody could ever look at.
      expect(seen?.output).toContain("line two")
      expect(seen?.command).toContain("watched.sh")
    })

    it("settles a run that was interrupted as ended, on what it had printed", async () => {
      // Interruption unwinds past every ordinary exit, so without this the adapter would
      // hold the run unfinished and hand it to every reload as still going. What was
      // watched stays: nothing exited, so there is no report to put in its place.
      const seen = await interrupting(c)(script("ended", `echo "line one"; sleep 30`))
      expect(seen).toMatchObject({ name: "ended", finished: { verdict: "cancelled" } })
      expect(seen?.finished?.exitCode).toBeUndefined()
      expect(seen?.output).toContain("line one")
    })

    it("publishes the output while the check is still running", async () => {
      // The whole point: a `verify` is minutes long, so a watcher that only heard at the
      // end would watch nothing. The sleep is what makes the assertion mean *during* —
      // the first line goes out while the script is still asleep, and a run that
      // collected its output and reported it once would end on zero.
      const seen = await watched(script("chatty", `echo "one"; sleep 0.5; echo "two"; exit 0`))
      expect(seen?.chunks).toBeGreaterThanOrEqual(1)
      expect(seen?.output).toContain("two")
    })

    it("remembers nothing about a run nobody is watching", async () => {
      // The project's setup script belongs to no position, so there is nothing for a
      // frame to name and nobody standing at a gate to read it. Both halves are in one
      // program, because the layer is built per call and asking a fresh adapter would
      // answer nothing whatever the run did.
      const seen = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const checks = yield* Checks
            yield* checks.run(script("unwatched", "exit 0"), scratch)
            return yield* checks.live(UNWATCHED)
          }).pipe(Effect.timeout(`${c.timeoutMs} millis`), Effect.provide(c.layer)),
        ),
      )
      expect(seen).toBeUndefined()
    })
  })
}

/** Run this against any Checks implementation. */
export const checksContract = (c: ChecksUnderTest): void => {
  outcomeCases(c)
  watchingCases(c)
}
