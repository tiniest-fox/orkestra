// Each trak's action at the seam in this engine's memory, published as it moves — see
// `SeamStatuses`.

import { Effect, Layer, Ref } from "effect"
import { TrakId } from "../domain/trak.js"
import { Feed, Frame } from "../ports/feed.js"
import { type SeamStatus, SeamStatuses } from "../ports/seam-status.js"

export const MemorySeamStatusesLayer = Layer.effect(
  SeamStatuses,
  Effect.gen(function* () {
    const feed = yield* Feed
    const held = yield* Ref.make<ReadonlyMap<string, SeamStatus>>(new Map())

    /** Change one trak's status, and say so. */
    const change = (trak: string, status: SeamStatus | undefined) =>
      Effect.gen(function* () {
        const before = yield* Ref.modify(held, (all) => {
          const next = new Map(all)
          if (status === undefined) next.delete(trak)
          else next.set(trak, status)
          return [all.get(trak), next]
        })
        // Clearing what was never set says nothing; every `set` is a move.
        if (before === undefined && status === undefined) return
        yield* feed.publish(Frame.SeamStatus({ id: TrakId.make(trak), status }))
      })

    return {
      set: (trak, status) => change(trak, status),
      clear: (trak) => change(trak, undefined),
      of: (trak) => Effect.map(Ref.get(held), (all) => all.get(trak)),
    }
  }),
)
