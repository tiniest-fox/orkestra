// The goal store, wrapped so every append is also a frame a goal screen can watch for.
//
// The trak store's decorator in miniature (`store-publishing.ts`), and the same rule:
// durable first, then the frame, so a frame is a record rather than a promise. Unlike
// it this keeps no cursor and no projection — the frame says only *this goal moved*,
// and the watcher re-reads it. Under an external store it publishes nothing, for the trak store's
// reason: the store watch (`EngineSeams.watch`) publishes from the store's own news of each write.

import { Effect, Layer, Option } from "effect"
import { Feed, Frame } from "../ports/feed.js"
import { GoalStore, type GoalStoreShape } from "../ports/goal-store.js"
import { StoreWatch } from "../ports/store-watch.js"

const decorator = Layer.effect(
  GoalStore,
  Effect.gen(function* () {
    const inner = yield* GoalStore
    if (Option.isSome(yield* Effect.serviceOption(StoreWatch))) return inner
    const feed = yield* Feed
    const decorated: GoalStoreShape = {
      ...inner,
      append: (id, events, at) =>
        events.length === 0
          ? Effect.void
          : Effect.andThen(inner.append(id, events, at), feed.publish(Frame.Goal({ goal: id }))),
      appendTranscript: (id, entry) =>
        Effect.andThen(inner.appendTranscript(id, entry), feed.publish(Frame.Goal({ goal: id }))),
    }
    return decorated
  }),
)

/** Wrap a goal store so its appends reach the `Feed`. Takes the inner layer, as `publishingStore` does. */
export const publishingGoalStore = <E, R>(
  inner: Layer.Layer<GoalStore, E, R>,
): Layer.Layer<GoalStore, E, R | Feed> => decorator.pipe(Layer.provide(inner))
