// The project's setup script running in the background, held in this engine's memory —
// see `Setups`. A run is forked on the runtime this layer was built with rather than the
// caller's fiber, so it outlives the drive that started it and carries none of that
// drive's state: an append it makes is a press's, with no lease fence. `stop` ends one,
// and closing the layer ends every run still going.

import { Deferred, Effect, FiberMap, Layer, Ref } from "effect"
import type { TrakId } from "../domain/trak.js"
import type { CheckOutcome } from "../ports/checks.js"
import { Setups } from "../ports/setups.js"

/** One run: what it settled on, and how many of its waiters report a failure. */
interface Run {
  readonly outcome: Deferred.Deferred<CheckOutcome>
  readonly reporting: Ref.Ref<number>
}

export const MemorySetupsLayer = Layer.scoped(
  Setups,
  Effect.gen(function* () {
    const runs = yield* Ref.make<ReadonlyMap<TrakId, Run>>(new Map())
    const fibers = yield* FiberMap.make<TrakId>()
    const fork = yield* FiberMap.runtime(fibers)()

    const start = (id: TrakId, run: Effect.Effect<void>) =>
      Effect.gen(function* () {
        const held = (yield* Ref.get(runs)).get(id)
        if (held !== undefined && !(yield* Deferred.isDone(held.outcome))) return
        const next: Run = {
          outcome: yield* Deferred.make<CheckOutcome>(),
          reporting: yield* Ref.make(0),
        }
        yield* Ref.update(runs, (all) => new Map(all).set(id, next))
        fork(id, run)
      })

    const settle = (id: TrakId, outcome: CheckOutcome) =>
      Effect.gen(function* () {
        const held = (yield* Ref.get(runs)).get(id)
        if (held === undefined) return false
        yield* Deferred.succeed(held.outcome, outcome)
        return (yield* Ref.get(held.reporting)) > 0
      })

    const outcome = (id: TrakId, reports: boolean) =>
      Effect.flatMap(Ref.get(runs), (all) => {
        const held = all.get(id)
        if (held === undefined) return Effect.succeed(undefined)
        const count = (by: number) =>
          reports ? Ref.update(held.reporting, (n) => n + by) : Effect.void
        return Effect.acquireUseRelease(
          count(1),
          () => Deferred.await(held.outcome),
          () => count(-1),
        )
      })

    // `remove` interrupts and awaits: once it returns the script is killed and nothing after
    // it in the run has happened or will. The outcome is interrupted after, so a waiter that
    // somehow outlived its drive ends rather than hanging on a run that is gone.
    const stop = (id: TrakId) =>
      Effect.gen(function* () {
        yield* FiberMap.remove(fibers, id)
        const held = (yield* Ref.get(runs)).get(id)
        if (held === undefined) return
        yield* Ref.update(runs, (all) => {
          const left = new Map(all)
          left.delete(id)
          return left
        })
        yield* Deferred.interrupt(held.outcome)
      })

    return {
      stop,
      start,
      started: (id: TrakId) => Effect.map(Ref.get(runs), (all) => all.has(id)),
      settle,
      outcome,
    }
  }),
)
