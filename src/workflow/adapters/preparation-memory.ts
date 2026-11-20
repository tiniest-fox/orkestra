// Each trak's preparations in this engine's memory, published as they move — see
// `Preparation`. An entry is taken out however its work ends, so an interrupted
// preparation does not stand on a screen after it.

import { Effect, Equal, Layer, Ref } from "effect"
import type { PreparingPhase } from "../../vcs/types/preparing.js"
import { Preparation } from "../../vcs/ports/preparation.js"
import { TrakId } from "../domain/trak.js"
import { Feed, Frame } from "../ports/feed.js"

interface Entry {
  readonly key: number
  readonly phase: PreparingPhase
}

/** The newest entry's preparation, which is the one a trak is in. */
const newest = (all: ReadonlyMap<string, readonly Entry[]>, trak: string) =>
  all.get(trak)?.at(-1)?.phase

export const MemoryPreparationLayer = Layer.effect(
  Preparation,
  Effect.gen(function* () {
    const feed = yield* Feed
    const held = yield* Ref.make<ReadonlyMap<string, readonly Entry[]>>(new Map())
    const keys = yield* Ref.make(0)

    /** Change one trak's entries, and say so where the newest moved. */
    const change = (trak: string, f: (entries: readonly Entry[]) => readonly Entry[]) =>
      Effect.gen(function* () {
        const [before, after] = yield* Ref.modify(held, (all) => {
          const entries = f(all.get(trak) ?? [])
          const next = new Map(all)
          if (entries.length === 0) next.delete(trak)
          else next.set(trak, entries)
          return [[newest(all, trak), newest(next, trak)] as const, next]
        })
        if (Equal.equals(before, after)) return
        yield* feed.publish(Frame.Preparing({ id: TrakId.make(trak), phase: after }))
      })

    return {
      enter: (trak, phase) =>
        Effect.map(
          Effect.acquireRelease(
            Effect.tap(
              Ref.getAndUpdate(keys, (n) => n + 1),
              (key) => change(trak, (entries) => [...entries, { key, phase }]),
            ),
            (key) => change(trak, (entries) => entries.filter((e) => e.key !== key)),
          ),
          (key) => (moved: PreparingPhase) =>
            change(trak, (entries) =>
              entries.map((e) => (e.key === key ? { key, phase: moved } : e)),
            ),
        ),
      of: (trak) => Effect.map(Ref.get(held), (all) => newest(all, trak)),
    }
  }),
)
