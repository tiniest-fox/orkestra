// Each trak's sandbox outage, in memory: the engine's own reading of a provider it cannot
// reach, which a restart rightly forgets — see `Outages`.

import { Clock, Effect, Layer, Ref } from "effect"
import { type Outage, Outages } from "../ports/outages.js"

export const MemoryOutagesLayer = Layer.effect(
  Outages,
  Effect.gen(function* () {
    const held = yield* Ref.make<ReadonlyMap<string, Outage>>(new Map())
    const set = (trak: string, outage: Outage | undefined) =>
      Ref.update(held, (all) => {
        const next = new Map(all)
        if (outage === undefined) next.delete(trak)
        else next.set(trak, outage)
        return next
      })
    return {
      of: (trak) => Effect.map(Ref.get(held), (all) => all.get(trak)),
      failed: (trak, failure) =>
        Effect.gen(function* () {
          const before = (yield* Ref.get(held)).get(trak)
          const outage: Outage = {
            kind: failure.kind,
            said: failure.said,
            since: before?.since ?? (yield* Clock.currentTimeMillis),
            spent: before?.spent ?? false,
          }
          yield* set(trak, outage)
          return outage
        }),
      spend: (trak) =>
        Effect.flatMap(Ref.get(held), (all) => {
          const before = all.get(trak)
          return before === undefined ? Effect.void : set(trak, { ...before, spent: true })
        }),
      ended: (trak) => set(trak, undefined),
    }
  }),
)
