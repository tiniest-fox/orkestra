import { Context, Data, Effect, Schedule } from "effect"
import type { GoalId, TrakId } from "../domain/trak.js"
import type { AppendAt, StoreFailed, StoreFenced } from "./store-errors.js"

/**
 * Another engine copy holds the lease this one asked for (`Leases`, under an external store), so
 * this one does not drive. The caller ends quietly: the copy holding the lease is the one
 * driving.
 */
export class LeaseHeld extends Data.TaggedError("LeaseHeld")<{
  readonly key: string
}> {
  override get message(): string {
    return `${this.key}: another engine copy holds its lease`
  }
}

/**
 * Who may write a trak's or a goal's log, and when: permits inside one process, and under
 * an external store leases across engine copies.
 *
 * `advance` is read-modify-write with nothing guarding the gap: it reads the log,
 * applies the event, and appends. Two of those for one id running at once both read
 * the same log, and the second's append is refused as `StoreConflict` — a failure, where
 * these permits make it a wait. `store-file.ts` assumes exactly one appender per trak at
 * a time, and these are what hold that up inside one process — `Runs.claim` is the
 * cross-process half and cannot see two fibers.
 *
 * **Two permits rather than one, because two things want different lengths of it.**
 * A *drive* holds a trak for a whole turn — a `claude` runs inside it — so that two
 * drives of one trak never interleave. A change a person makes to how the trak is run
 * has to land *during* that turn without killing it, so it takes only the *log*
 * permit: the read-decide-append inside `advance`, released before any command runs.
 * A drive takes the log permit too, on every `advance` it makes, which is what orders
 * the two against each other.
 *
 * Three rules, and all are load-bearing:
 *
 *   · **The drive permit is taken at the outermost drive, never inside `advance`.**
 *     `advance` re-enters itself for the same id after every command, and a semaphore
 *     is not re-entrant — a drive permit taken inside it deadlocks on the first command
 *     it runs. The log permit is safe there precisely because it is released before
 *     the recursion.
 *   · **No fiber ever holds two drive permits.** A child's drive takes the child's,
 *     ends, and only then does landing take the parent's.
 *   · **Nothing holding a log permit waits for anything.** It is held across a read
 *     and a write and released, which is what keeps a drive permit and a log permit
 *     for the same trak, nested, from being a lock order anyone has to remember.
 *
 * **Under an external store a drive also holds a lease**, renewed while it runs, and every
 * append it makes carries the lease's fence — `fenced` hands it to the append. A press
 * appends with no fence, as it takes no drive permit. A drive whose renewal finds the
 * lease taken is interrupted and fails as `StoreFenced`, letting go of the trak through
 * `Leaving` so a detached turn the new holder rejoins runs on; one that misses the renewal
 * is refused at its next append, with the same failure.
 */
export interface LocksShape {
  /**
   * Run `effect` as this trak's one drive, waiting if another fiber here is driving it,
   * and refused as `LeaseHeld` where another engine copy holds its lease.
   */
  readonly withDrive: (
    id: TrakId,
  ) => <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | LeaseHeld | StoreFailed | StoreFenced, R>
  /** Run `effect` as this trak's one appender, waiting if another fiber is mid-append. */
  readonly withLog: (
    id: TrakId,
  ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  /**
   * Run `effect` as this goal's one appender — the read, the check and the append a
   * tool call, a press and the watcher each make. One permit, because a goal's turn is
   * kept single by the map that runs it rather than by a permit, and every writer of
   * its log takes this one.
   */
  readonly withGoal: (
    id: GoalId,
  ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  /**
   * Run `effect` as this goal's driver across engine copies: its lease, where there are
   * leases, and nothing more where there are not — the map that runs a goal's turns keeps
   * them single inside one process.
   */
  readonly withGoalDrive: (
    id: GoalId,
  ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | LeaseHeld | StoreFailed, R>
  /** Where an append to this trak's log is made from: `after`, and the drive's fence where this fiber holds one. */
  readonly fenced: (id: TrakId, after: number) => Effect.Effect<AppendAt>
  /** `fenced`, for a goal's log. */
  readonly goalFenced: (id: GoalId, after: number) => Effect.Effect<AppendAt>
  /**
   * Run `effect` as the one copy running the job `name`, holding its lease while it runs
   * and interrupting it if another copy takes the lease. `undefined`, without running it,
   * where another copy holds the job — and where the lease could not be asked for, which
   * is a pass skipped rather than a pass run twice. With no leases it simply runs.
   */
  readonly withJob: (
    name: string,
  ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A | undefined, E, R>
  /**
   * How long a lease outlives its last renewal, in milliseconds — and so how often a copy
   * looks for one another copy stopped renewing. `undefined` where these are permits
   * inside one process, and nothing expires.
   */
  readonly expiresAfter: number | undefined
}

export class Locks extends Context.Tag("workflow/Locks")<Locks, LocksShape>() {}

/**
 * Run `loop` — a sweep that never ends by itself — as the job `name`, on whichever copy
 * holds that job's lease, for as long as it holds it. Another copy asks again each
 * `expiresAfter`, so it takes the job over once the holder stops renewing. With no leases
 * it is `loop`.
 */
export const heldJob = <R>(
  name: string,
  loop: Effect.Effect<void, never, R>,
): Effect.Effect<void, never, R | Locks> =>
  Effect.flatMap(Locks, (locks) =>
    locks.expiresAfter === undefined
      ? loop
      : Effect.asVoid(
          Effect.repeat(locks.withJob(name)(loop), Schedule.spaced(locks.expiresAfter)),
        ),
  )
