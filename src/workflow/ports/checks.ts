import { Context, type Effect } from "effect"
import type { Place } from "../../agent/types/place.js"
import type { Check } from "../../library/types/check.js"
import type { TrakId } from "../domain/trak.js"

/**
 * What a check did. `output` is stderr then stdout exactly as the script wrote
 * them — terminal escapes and all, cut only at a backstop far above what a check
 * written for a reader prints. **How much is worth printing is the script's
 * decision**; a reader that wants the bytes without the formatting strips them
 * itself.
 *
 * Kept on a pass too — the transcript is where "what did it say" gets answered,
 * and a passing check that printed a warning is worth reading.
 */
export interface CheckOutcome {
  readonly passed: boolean
  readonly output: string
  /**
   * The line that was spawned, reported by the thing that spawned it — which is what
   * keeps it from being spelled a second time by a caller that would then be guessing.
   */
  readonly command: string
  /**
   * What the script exited with. Absent for the two failures that are not an exit at
   * all — a timeout and a check that could not be spawned — which is why it is optional
   * rather than a sentinel: *did not exit* and *exited zero* are different facts.
   */
  readonly exitCode?: number
  /**
   * The runners-only guard's refusal, where it — or the env script before it — was never
   * spawned because of the guard (`ProcessFailed.runnersOnly`). Absent on every other run.
   */
  readonly runnersOnly?: string
  /** The ref holding the sandbox's uncommitted changes, where readying it for the run lost them — `ProcessFailed.carried`. */
  readonly carried?: string
  /** Where the script ran. Absent where it was never spawned. */
  readonly place?: Place
}

/**
 * The position a check is running at, and absent for one that belongs to no plan.
 * `call` is the tool call an agent started it with, and absent for a run the engine
 * started itself.
 */
export interface CheckAt {
  readonly trak: TrakId
  readonly step: number
  readonly call?: string
}

/**
 * A check run as a watcher sees it: what is running, and what it has printed so far.
 *
 * **The only account of a passing run**, because nothing writes one down: `ChecksPassed`
 * names the checks and keeps none of their output. So this is memory, it is the process's
 * own, and a daemon restart loses it — a failing run keeps its output on `CheckFailed`
 * and is the case that survives.
 *
 * `command` is the line as spawned, absolute path and all. A surface that wants it
 * shorter shortens it; inventing a relative form the engine did not run would be the
 * boundary asserting something it cannot check.
 */
export interface CheckRun {
  readonly step: number
  /** The check's own, from its filename — `verify`. */
  readonly name: string
  readonly command: string
  /** The check file's `timeout_seconds`, so a surface can say *of 5m00s*. */
  readonly limit: number
  readonly startedAt: number
  readonly output: string
  /** How many `CheckOutput` frames have gone out for this run — the gap detector. */
  readonly chunks: number
  /**
   * The tool call an agent started this run with — `CheckAt.call`. A run carrying one
   * judged no document, so a surface draws it at the call rather than on a card.
   */
  readonly call?: string
  /** Waiting for the exclusive turn, and nothing has run yet. Absent once it runs. */
  readonly queued?: true
  /** Where the script runs, from the moment it is spawned. */
  readonly place?: Place
  /** Absent while it is still running. */
  readonly finished?: {
    readonly verdict: CheckVerdict
    readonly exitCode?: number
    readonly at: number
  }
}

/**
 * How a watched run ended. **Three, and `cancelled` is not a failure**: a run a person
 * ended has no verdict of its own, so a surface that read it as `failed` would say the
 * work is wrong when nothing has said so. `CheckOutcome` has no third case because a
 * cancelled run never reaches its caller — the interruption unwinds past it.
 */
export type CheckVerdict = "passed" | "failed" | "cancelled"

/**
 * The two files a check with `units:` is handed, as what goes in and what comes out.
 * The files themselves are the adapter's: it writes `proven` to one, names both in the
 * script's environment, and reads the other back once the run has ended.
 */
export interface CheckUnits {
  /**
   * For the script to skip: proven under the check's label on this tree, or, for a check
   * with `fingerprint:`, on a tree whose files every input of the unit agrees with.
   */
  readonly proven: readonly string[]
  /**
   * The tools a recorded test may spawn, for a check with `fingerprint:`: the adapter runs
   * it with the recording hook loaded and hands `finished` the directory it recorded into.
   */
  readonly sealed?: readonly string[]
  /**
   * Handed every complete line the script appended, once the run has ended however it
   * ended — a pass, a failure, a timeout, or an interruption, which is why it is a
   * callback rather than part of the outcome. A last line with no newline is one the
   * script was still writing, and is left out. `recording` is the directory the hook wrote
   * into, removed once this returns.
   */
  readonly finished: (units: readonly string[], recording?: string) => Effect.Effect<void>
}

/**
 * Running a check. In `workflow` rather than beside `Process` in `agent/`
 * because the contract here is "exit code and output", not "drive an agent" —
 * and because which checks run is a decision this module makes.
 *
 * **No error channel, on purpose.** A check that cannot be spawned at all is a
 * check that failed, with the spawn error as its output. Letting that escape
 * would fail `advance` after the state had already moved to `CheckRunning`,
 * leaving a trak with no in-flight command and no event able to move it — the
 * same stranding `orGiveUp` exists to prevent for an exhausted `elicit`.
 */
export interface ChecksShape {
  /**
   * `at` is who is watching, and two of the three callers pass none.
   *
   * The project's setup script belongs to no position, so there is nothing for a frame
   * to name and nobody standing at a gate to read it. A step's `effects:` *do* belong to
   * one and are still silent, for a different reason: what an effect printed is kept on
   * `EffectsRan` and drawn per position, and one published run is held per trak — so a
   * watched effect would replace that position's `verify` in memory and be paired to its
   * newest document as that document's verdict, drawing `open-pr passed` where a check's
   * result goes.
   *
   * A run with no `at` publishes nothing and is not remembered.
   */
  readonly run: (
    check: Check,
    cwd: string,
    at?: CheckAt,
    /**
     * Positional arguments after the script, `$1` onward. Empty for every script but
     * `deploy.sh`, which is handed the merge commit: the one fact a script cannot read
     * off the directory it runs in, because the deploy is of a commit that is on no
     * branch of ours.
     */
    args?: readonly string[],
    /** Only for a check with `units:`; see `CheckUnits`. */
    units?: CheckUnits,
    /**
     * Laid over the script's captured environment, after the strip of the engine's own
     * `ORKESTRA_*` — the one way a variable of that family reaches a script.
     */
    env?: Readonly<Record<string, string>>,
    /**
     * The script belongs to the project rather than a checkout — `deploy.sh` — and this is
     * its path from the project's root. Where the project has a place of its own
     * (`Sandboxes.project`, under an external store) the file at that path in the place's
     * checkout runs, with the env script before it, in place of `cwd` and `check.path`,
     * starting a stopped sandbox, and both are handed of the engine's environment only the
     * runner's `pass:` (`ProcessSpec.inProject`, `passOnly`). `check.path` is the file this
     * machine read, which under an external store is in a copy of a commit the place does
     * not hold. Elsewhere `check.path` runs in `cwd` as any script does.
     */
    inProject?: string,
  ) => Effect.Effect<CheckOutcome>
  /**
   * The most recent run at this trak — in flight, or the last one to finish.
   *
   * What a watcher that missed the frames reads instead of a file, which is the whole
   * reason it is on the port rather than computed at the boundary: a surface showing a
   * live console has to survive its own refetch, and there is nothing on disk to survive
   * with. Replaced when the trak's next check starts, and gone when the process is.
   */
  readonly live: (id: TrakId) => Effect.Effect<CheckRun | undefined>
}

export class Checks extends Context.Tag("workflow/Checks")<Checks, ChecksShape>() {}
