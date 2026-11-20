// A Checks fake, scripted per check name.
//
// Same shape as the provider fake and for the same reason: a flow test is about
// what the engine does with an outcome, not about `bash`. Whether a script can
// actually be spawned is the shell adapter's contract, and `test/contract` runs
// that against the real thing.

import { Effect, HashMap, Layer, Ref } from "effect"
import type { TrakId } from "../../src/workflow/domain/trak.js"
import type {
  CheckAt,
  CheckOutcome,
  CheckRun,
  ChecksShape,
  CheckUnits,
} from "../../src/workflow/ports/checks.js"
import { Checks } from "../../src/workflow/ports/checks.js"

/**
 * What a named check does, run by run.
 *
 * A list because the interesting flows are about a check CHANGING its mind — it
 * fails, the step fixes it, it passes. The last entry repeats once the list runs
 * out, so "always fails" is one entry rather than a guess about how many
 * iterations the engine will spend.
 */
export type CheckScript = Readonly<Record<string, readonly (CheckOutcome | Held | Proving)[]>>

/**
 * An outcome the script holds back until `until` completes — `onPromptAfter` for a
 * check, and for the same reason: a run that ends at once cannot be pressed against,
 * so *a script still running when a person presses* is a race unless the test holds
 * the script open itself.
 */
export interface Held {
  readonly until: Effect.Effect<void>
  readonly outcome: CheckOutcome
}

export const heldBack = (until: Effect.Effect<void>, outcome: CheckOutcome): Held => ({
  until,
  outcome,
})

/**
 * An outcome — held or not — whose run reports `proves` as proven units, handed back once
 * it ends however it ends, as the shell adapter hands back what a check with `units:` wrote.
 */
export interface Proving {
  readonly proves: readonly string[]
  readonly outcome: CheckOutcome | Held
}

export const proving = (
  proves: readonly string[],
  outcome: CheckOutcome | Held = pass,
): Proving => ({
  proves,
  outcome,
})

/**
 * `command` and `exitCode` are on the outcome because the thing that spawns is the thing
 * that knows them, so a fake that does not spawn still has to answer: a caller reads
 * both off here rather than rebuilding either.
 */
export const pass: CheckOutcome = {
  passed: true,
  output: "",
  command: "bash check.sh",
  exitCode: 0,
}
export const fail = (output: string, exitCode = 1): CheckOutcome => ({
  passed: false,
  output,
  command: "bash check.sh",
  exitCode,
})
/**
 * Passed, and printed something.
 *
 * Beside `pass` rather than a parameter on it, because it is only ever what an
 * **effect** looks like: a check that passed has nothing to say, and an effect that
 * acted outside the checkout has printed the only record that it did.
 */
export const did = (output: string): CheckOutcome => ({
  passed: true,
  output,
  command: "bash effect.sh",
  exitCode: 0,
})

/**
 * Never comes back — the run a person ends. Matched by identity, so the fake can tell
 * it from an outcome that merely happens to say the same thing. It is remembered as
 * in flight, and settled as `cancelled` when the run is interrupted, which is the shell
 * adapter's own promise to a watcher.
 */
export const hangs: CheckOutcome = { passed: false, output: "", command: "bash check.sh" }

export interface ChecksLog {
  /** Every check that ran, by name, in order — assert on fail-fast. */
  readonly ran: readonly string[]
  /** The same runs with where each ran and what it was handed — for the one script that takes arguments. */
  readonly calls: readonly {
    readonly name: string
    readonly cwd: string
    readonly args: readonly string[]
    /** The units it was handed as proven, for a check with `units:`. */
    readonly proven?: readonly string[]
    /** What the engine laid over its environment, where it laid anything. */
    readonly env?: Readonly<Record<string, string>>
  }[]
}

/** What a call was handed beyond its arguments, each only where it was handed anything. */
const handed = (units: CheckUnits | undefined, env: Readonly<Record<string, string>>) => ({
  ...(units === undefined ? {} : { proven: units.proven }),
  ...(Object.keys(env).length === 0 ? {} : { env }),
})

export const scriptedChecks = (
  script: CheckScript = {},
): Effect.Effect<{
  readonly layer: Layer.Layer<Checks>
  readonly log: Effect.Effect<ChecksLog>
}> =>
  Effect.gen(function* () {
    const ran = yield* Ref.make<readonly string[]>([])
    const calls = yield* Ref.make<ChecksLog["calls"]>([])
    const runs = yield* Ref.make(HashMap.empty<TrakId, CheckRun>())

    const run = (
      name: string,
      cwd: string,
      args: readonly string[],
      units: CheckUnits | undefined,
      proves: Ref.Ref<readonly string[]>,
      env: Readonly<Record<string, string>>,
    ): Effect.Effect<CheckOutcome> =>
      Effect.gen(function* () {
        const before = yield* Ref.get(ran)
        yield* Ref.set(ran, [...before, name])
        yield* Ref.update(calls, (held) => [...held, { name, cwd, args, ...handed(units, env) }])
        const outcomes = script[name] ?? []
        const nth = before.filter((r) => r === name).length
        // Past the end, the last outcome stands. An empty script means the check
        // passes, so a test that is not about checks failing says nothing.
        const scripted = outcomes[Math.min(nth, outcomes.length - 1)] ?? pass
        if ("proves" in scripted) yield* Ref.set(proves, scripted.proves)
        const entry = "proves" in scripted ? scripted.outcome : scripted
        if (!("until" in entry)) return entry
        yield* entry.until
        return entry.outcome
      })

    /**
     * Settled in one go rather than started and then ended, because a scripted check
     * has no interval to be in flight during — a flow test asserting on a run reads
     * what a real one leaves behind at a gate, which is the finished shape.
     */
    const record = (at: CheckAt, name: string, outcome: CheckOutcome): Effect.Effect<void> =>
      Ref.update(runs, (held) =>
        HashMap.set(held, at.trak, {
          step: at.step,
          name,
          command: outcome.command,
          limit: 60,
          startedAt: 0,
          output: outcome.output,
          chunks: 0,
          ...(at.call === undefined ? {} : { call: at.call }),
          finished: {
            verdict: outcome.passed ? "passed" : "failed",
            at: 0,
            ...(outcome.exitCode === undefined ? {} : { exitCode: outcome.exitCode }),
          },
        }),
      )

    /**
     * The one outcome with an interval to be in flight during: remembered unfinished,
     * held open forever, and settled `cancelled` by the interruption — the shape the
     * shell adapter leaves behind for the person who ended it.
     */
    const hanging = (at: CheckAt | undefined, name: string): Effect.Effect<CheckOutcome> => {
      const running: CheckRun = {
        step: at?.step ?? 0,
        name,
        command: hangs.command,
        limit: 60,
        startedAt: 0,
        output: "",
        chunks: 0,
      }
      const remember = (seen: CheckRun): Effect.Effect<void> =>
        at === undefined
          ? Effect.void
          : Ref.update(runs, (held) => HashMap.set(held, at.trak, seen))
      return remember(running).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() =>
          remember({ ...running, finished: { verdict: "cancelled", at: 0 } }),
        ),
      )
    }

    const shape: ChecksShape = {
      run: (check, cwd, at, args = [], units, env = {}) =>
        Effect.flatMap(Ref.make<readonly string[]>([]), (proves) =>
          Effect.flatMap(run(check.name, cwd, args, units, proves, env), (outcome) =>
            outcome === hangs
              ? hanging(at, check.name)
              : Effect.as(
                  at === undefined ? Effect.void : record(at, check.name, outcome),
                  outcome,
                ),
          ).pipe(
            Effect.ensuring(
              units === undefined ? Effect.void : Effect.flatMap(Ref.get(proves), units.finished),
            ),
          ),
        ),
      live: (id) =>
        Effect.map(Ref.get(runs), (held) => {
          const held1 = HashMap.get(held, id)
          return held1._tag === "None" ? undefined : held1.value
        }),
    }

    return {
      layer: Layer.succeed(Checks, shape),
      log: Effect.all([Ref.get(ran), Ref.get(calls)]).pipe(
        Effect.map(([r, c]): ChecksLog => ({ ran: r, calls: c })),
      ),
    }
  })
