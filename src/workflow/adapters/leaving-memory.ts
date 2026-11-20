// The engine's shutdown state, set once by the drives' release, the traks this copy is
// letting go of, and the detached commands a close leaves running while it stays — see
// `Leaving`.

import { Effect, HashSet, Layer, Ref } from "effect"
import { Leaving } from "../ports/leaving.js"

export const MemoryLeavingLayer = Layer.effect(
  Leaving,
  Effect.gen(function* () {
    const leaving = yield* Ref.make(false)
    const lettingGo = yield* Ref.make(HashSet.empty<string>())
    const kept = yield* Ref.make<ReadonlySet<string>>(new Set())
    return {
      now: Ref.get(leaving),
      leaves: (trak: string) =>
        Effect.zipWith(Ref.get(leaving), Ref.get(lettingGo), (all, some) =>
          all ? true : HashSet.has(some, trak),
        ),
      leave: Ref.set(leaving, true),
      letGo: (trak: string) => Ref.update(lettingGo, HashSet.add(trak)),
      regain: (trak: string) => Ref.update(lettingGo, HashSet.remove(trak)),
      keep: (execId) => Ref.update(kept, (held) => new Set([...held, execId])),
      rejoined: (execId) =>
        Ref.update(kept, (held) => new Set([...held].filter((id) => id !== execId))),
      keeps: (execId) =>
        Effect.zipWith(
          Ref.get(leaving),
          Ref.get(kept),
          (left, held) => left || (execId !== undefined && held.has(execId)),
        ),
    }
  }),
)
