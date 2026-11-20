// In-memory goal store, for flow tests. Encodes on the way in and decodes on the way out,
// as the memory trak store does, so a goal event that will not round-trip fails here
// rather than on disk.

import { Clock, Effect, Either, Layer, Ref } from "effect"
import { decodeTranscriptEntry, encodeTranscriptEntry } from "../../agent/types/transcript-entry.js"
import { decodeGoalEvent, encodeGoalEvent, stampedGoal } from "../domain/goal.js"
import type { GoalId } from "../domain/trak.js"
import { GoalStore } from "../ports/goal-store.js"
import { StoreConflict, StoreFailed, StoreUndecodable } from "../ports/store-errors.js"

interface Files {
  readonly log: readonly unknown[]
  readonly transcript: readonly unknown[]
}

const EMPTY: Files = { log: [], transcript: [] }

const undecodable = (e: { readonly message: string }) => new StoreUndecodable({ reason: e.message })

export const MemoryGoalStoreLayer = Layer.effect(
  GoalStore,
  Effect.gen(function* () {
    const ref = yield* Ref.make<ReadonlyMap<GoalId, Files>>(new Map())
    const add = (id: GoalId, file: keyof Files, lines: readonly unknown[]) =>
      Ref.update(ref, (held) => {
        const before = held.get(id) ?? EMPTY
        return new Map(held).set(id, { ...before, [file]: [...before[file], ...lines] })
      })
    const read = (id: GoalId, file: keyof Files) =>
      Effect.map(Ref.get(ref), (held) => (held.get(id) ?? EMPTY)[file])
    return {
      // `fence` is accepted and ignored, as the memory trak store ignores it.
      append: (id, events, { after }) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const encoded = yield* Effect.forEach(events, (e) =>
            encodeGoalEvent(stampedGoal(e, now)),
          ).pipe(Effect.mapError((e) => new StoreFailed({ reason: `encode failed: ${e.message}` })))
          // The check and the write in one `modify`, so no other fiber's append lands between.
          const checked = yield* Ref.modify(
            ref,
            (held): readonly [Either.Either<void, StoreConflict>, ReadonlyMap<GoalId, Files>] => {
              const before = held.get(id) ?? EMPTY
              if (before.log.length !== after) {
                const found = before.log.length
                return [Either.left(new StoreConflict({ id, after, found })), held]
              }
              return [
                Either.void,
                new Map(held).set(id, { ...before, log: [...before.log, ...encoded] }),
              ]
            },
          )
          yield* checked
        }),
      events: (id) =>
        Effect.flatMap(read(id, "log"), (lines) =>
          Effect.forEach(lines, (line) => Effect.mapError(decodeGoalEvent(line), undecodable)),
        ),
      list: () => Effect.map(Ref.get(ref), (held) => [...held.keys()]),
      appendTranscript: (id, entry) =>
        Effect.flatMap(
          Effect.mapError(
            encodeTranscriptEntry(entry),
            (e) => new StoreFailed({ reason: `encode failed: ${e.message}` }),
          ),
          (encoded) => add(id, "transcript", [encoded]),
        ),
      transcript: (id) =>
        Effect.flatMap(read(id, "transcript"), (lines) =>
          Effect.forEach(lines, (line) =>
            Effect.mapError(decodeTranscriptEntry(line), undecodable),
          ),
        ),
    }
  }),
)
