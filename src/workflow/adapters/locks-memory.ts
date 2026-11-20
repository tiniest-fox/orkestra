// The in-process permits `Locks` describes: one semaphore per trak per kind, made on
// first use and kept. The locks of an engine with no external store, and the permits beneath
// the leases of one on an external store.
//
// The map only grows, and that is deliberate rather than overlooked: it is bounded by
// the number of traks this repository has, an entry is two semaphores with one permit
// each, and evicting one would mean deciding it is safe to — which is exactly the fact
// the lock exists because nobody has.
//
// `SynchronizedRef` rather than `Ref` because two fibers reaching a trak for the first
// time at the same moment would otherwise each make a semaphore and each keep the one
// they made — two locks over one trak, which is no lock at all. The synchronised region
// is the lookup only; the permit itself is held outside it, so waiting for one trak
// never blocks another from finding its own.

import { Effect, HashMap, Layer, Option, SynchronizedRef } from "effect"
import type { GoalId, TrakId } from "../domain/trak.js"
import { Locks, type LocksShape } from "../ports/locks.js"

/** The two permits one trak has. */
interface Permits {
  readonly drive: Effect.Semaphore
  readonly log: Effect.Semaphore
}

export const MemoryLocksLayer = Layer.effect(
  Locks,
  Effect.gen(function* () {
    const permits = yield* SynchronizedRef.make(HashMap.empty<TrakId, Permits>())

    const permitsFor = (id: TrakId): Effect.Effect<Permits> =>
      SynchronizedRef.modifyEffect(permits, (held) =>
        Option.match(HashMap.get(held, id), {
          onSome: (made) => Effect.succeed([made, held] as const),
          onNone: () =>
            Effect.map(
              Effect.all({ drive: Effect.makeSemaphore(1), log: Effect.makeSemaphore(1) }),
              (made) => [made, HashMap.set(held, id, made)] as const,
            ),
        }),
      )

    const holding =
      (which: keyof Permits) =>
      (id: TrakId) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        Effect.flatMap(permitsFor(id), (made) => made[which].withPermits(1)(effect))

    // A goal's permit, in a map of its own so a goal and a trak can never share one
    // whatever their ids spell.
    const goals = yield* SynchronizedRef.make(HashMap.empty<GoalId, Effect.Semaphore>())
    const withGoal =
      (id: GoalId) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        Effect.flatMap(
          SynchronizedRef.modifyEffect(goals, (held) =>
            Option.match(HashMap.get(held, id), {
              onSome: (made) => Effect.succeed([made, held] as const),
              onNone: () =>
                Effect.map(
                  Effect.makeSemaphore(1),
                  (made) => [made, HashMap.set(held, id, made)] as const,
                ),
            }),
          ),
          (permit) => permit.withPermits(1)(effect),
        )

    // One process holds every permit, so there is no lease to take, no fence to hand an
    // append and no job another copy could be running.
    const locks: LocksShape = {
      withDrive: holding("drive"),
      withLog: holding("log"),
      withGoal,
      withGoalDrive: () => (effect) => effect,
      fenced: (_id, after) => Effect.succeed({ after }),
      goalFenced: (_id, after) => Effect.succeed({ after }),
      withJob: () => (effect) => effect,
      expiresAfter: undefined,
    }
    return locks
  }),
)
