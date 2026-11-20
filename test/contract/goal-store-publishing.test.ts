// The publishing decorator over the goal store: first the whole `GoalStore` contract, since
// wrapping a store must not change what a store is; then what it adds — every append, to
// the log or to the transcript, reaches the feed as one `Goal` frame naming the goal,
// after the write.

import { seedLog } from "../support/seed.js"
import { Effect, Fiber, Layer, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { MemoryStoreLayer } from "../../src/workflow/adapters/store-memory.js"
import { MemoryGoalStoreLayer } from "../../src/workflow/adapters/goal-store-memory.js"
import { publishingGoalStore } from "../../src/workflow/adapters/goal-store-publishing.js"
import { PubSubFeedLayer } from "../../src/workflow/adapters/feed-pubsub.js"
import { GoalEvents } from "../../src/workflow/domain/goal.js"
import { GoalId } from "../../src/workflow/domain/trak.js"
import { Feed } from "../../src/workflow/ports/feed.js"
import { GoalStore } from "../../src/workflow/ports/goal-store.js"
import { goalStoreContract } from "./goal-store.js"

const watched = publishingGoalStore(MemoryGoalStoreLayer).pipe(Layer.provideMerge(PubSubFeedLayer))

goalStoreContract({
  label: "publishing (memory)",
  // A fresh `Ref` per Layer build, and the feed rebuilt with it, so frames do not leak.
  layer: () => watched,
  store: () => MemoryStoreLayer,
})

const ID = GoalId.make("goal-1")
const SPEC = { file: "g", title: "G", line: "l", finished: "done", limits: {} }

describe("publishing goal store", () => {
  it("publishes a Goal frame for each append and each transcript line, once written", async () => {
    const seen = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const feed = yield* Feed
          const store = yield* GoalStore
          const replay = yield* feed.since(0)
          const taking = yield* Effect.fork(Stream.runCollect(Stream.take(replay.frames, 2)))
          yield* seedLog(store, ID, [GoalEvents.started(SPEC)])
          yield* seedLog(store, ID, [])
          yield* store.appendTranscript(ID, { _tag: "Text", text: "planning" })
          const frames = yield* Fiber.join(taking).pipe(Effect.timeout("5 seconds"))
          const log = yield* store.events(ID)
          return { frames: [...frames].map((f) => f.frame), logged: log.length }
        }),
      ).pipe(Effect.provide(watched), Effect.orDie),
    )
    expect(seen.frames).toEqual([
      { _tag: "Goal", goal: ID },
      { _tag: "Goal", goal: ID },
    ])
    expect(seen.logged).toBe(1)
  })
})
