// The publishing decorator, held to two separate promises.
//
// The first is the whole `Store` contract: wrapping a store must not change what a
// store *is*. That is most of this file's value and it costs one call — anything the
// decorator breaks about round-tripping, isolation or absence fails there rather than
// in a flow test three layers up.
//
// The second is what it adds. Those cases are here rather than in `store.ts` because
// they are not the port's promise: a plain `FileStoreLayer` publishes nothing and is
// not wrong for it.

import { seedLog } from "../support/seed.js"
import { Effect, Layer, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { MemoryRunsLayer } from "../../src/workflow/adapters/runs-memory.js"
import { MemoryArchiveLayer } from "../../src/workflow/adapters/archive-memory.js"
import { MemoryIdleLayer } from "../../src/workflow/adapters/idle-memory.js"
import { MemoryStoreLayer } from "../../src/workflow/adapters/store-memory.js"
import { PubSubFeedLayer } from "../../src/workflow/adapters/feed-pubsub.js"
import { publishingStore } from "../../src/workflow/adapters/store-publishing.js"
import { NoteEntry } from "../../src/agent/types/transcript-entry.js"
import { Events } from "../../src/workflow/domain/event.js"
import { TrakId } from "../../src/workflow/domain/trak.js"
import { Archive } from "../../src/workflow/ports/archive.js"
import { Feed, type Frame } from "../../src/workflow/ports/feed.js"
import { Store } from "../../src/workflow/ports/store.js"
import { storeContract } from "./store.js"

const watched = publishingStore(MemoryStoreLayer).pipe(
  Layer.provideMerge(PubSubFeedLayer),
  Layer.provideMerge(MemoryArchiveLayer),
  Layer.provideMerge(MemoryIdleLayer),
)

storeContract({
  label: "publishing (memory)",
  // A fresh `Ref` per Layer build is isolation enough, exactly as for the bare
  // memory store — and the feed is rebuilt with it, so frames do not leak either.
  layer: () => watched,
  runs: () => MemoryRunsLayer,
})

const ID = TrakId.make("trak-1")

/**
 * Subscribe, run `body` against `layer`, and collect the frames it caused.
 *
 * At module scope rather than inside the `describe` so the seeding case — which has to
 * build its own layer around a store with history in it — can reach it without nesting
 * a fifth callback.
 */
const collect = <A>(
  layer: Layer.Layer<Store | Feed>,
  body: Effect.Effect<A, unknown, Store>,
  count: number,
): Effect.Effect<readonly Frame[], unknown> =>
  Effect.scoped(
    Effect.gen(function* () {
      const feed = yield* Feed
      const replay = yield* feed.since(0)
      const taking = yield* Effect.fork(Stream.runCollect(Stream.take(replay.frames, count)))
      yield* body
      const framed = yield* taking.pipe(Effect.timeout("5 seconds"))
      return [...framed].map((f) => f.frame)
    }),
  ).pipe(Effect.provide(layer))

/** The append the seeding case makes once the decorator is wrapped around a live log. */
const restart = Effect.flatMap(Store, (store) => seedLog(store, ID, [Events.restarted(undefined)]))

describe("publishing store", () => {
  const framesOf = <A>(
    body: Effect.Effect<A, unknown, Store>,
    count: number,
  ): Promise<readonly Frame[]> =>
    Effect.runPromise(collect(watched, body, count).pipe(Effect.orDie))

  it("numbers a log frame by its line, and says what the trak became", async () => {
    const frames = await framesOf(
      Effect.flatMap(Store, (store) =>
        seedLog(store, ID, [Events.trakCreated("do the thing"), Events.worktreeFailed("no git")]),
      ),
      2,
    )
    // 1-based and per file, so a watcher can tell a gap from a fresh start. `state`
    // is the projection after each event in turn, not after the batch — a watcher
    // that replayed the batch itself would be keeping a second state machine.
    expect(
      frames.map((f) => (f._tag === "Appended" ? [f.seq, f.trak.state._tag] : f._tag)),
    ).toEqual([
      [1, "Preparing"],
      [2, "Failed"],
    ])
  })

  it("carries the trak each append made, whole", async () => {
    // Not the state alone: everything a screen draws that the log derives — the mode
    // here, the plan and the marks on a longer log — is on the trak the decorator
    // already replayed, and a frame that picked fields would be a second list to keep
    // in step with the full read. The boundary picks; the publisher hands over the lot.
    const frames = await framesOf(
      Effect.flatMap(Store, (store) =>
        seedLog(store, ID, [Events.trakCreated("do the thing", undefined, "smart")]),
      ),
      1,
    )
    expect(
      frames.map((f) =>
        f._tag === "Appended" ? [f.trak.id, f.trak.description, f.trak.mode] : f._tag,
      ),
    ).toEqual([[ID, "do the thing", "smart"]])
  })

  it("counts the transcript in its own file", async () => {
    const frames = await framesOf(
      Effect.flatMap(Store, (store) =>
        Effect.zipRight(
          seedLog(store, ID, [Events.trakCreated("do the thing")]),
          store.appendTranscript(ID, NoteEntry.make({ text: "Thinking" })),
        ),
      ),
      2,
    )
    // Both are `seq: 1`. They count different files, which is the whole reason a
    // frame says which kind it is before it says its number.
    expect(
      frames.map((f) => (f._tag === "Appended" || f._tag === "Activity" ? f.seq : -1)),
    ).toEqual([1, 1])
  })

  it("carries on numbering from a log it did not write", async () => {
    // The seeding path, and the one case that needs the decorator wrapped around a
    // store with history already in it: a daemon restarted against a live trak must
    // not begin at 1, or every watcher reads the log as having been truncated.
    //
    // The wrapping happens inside the test because that is the only way to hand the
    // decorator a store it did not start with — `publishingStore(MemoryStoreLayer)`
    // builds a fresh `Ref` and there is nothing there to seed from.
    const frames = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const inner = yield* Store
          yield* seedLog(inner, ID, [Events.trakCreated("x"), Events.worktreeFailed("no git")])

          const over = publishingStore(Layer.succeed(Store, inner)).pipe(
            Layer.provideMerge(PubSubFeedLayer),
            Layer.provideMerge(MemoryArchiveLayer),
            Layer.provideMerge(MemoryIdleLayer),
          )
          return yield* collect(over, restart, 1)
        }),
      ).pipe(Effect.orDie, Effect.provide(MemoryStoreLayer)),
    )
    // Two events were already on the log, so the first frame this decorator publishes
    // is line 3 — not line 1.
    expect(frames.map((f) => (f._tag === "Appended" ? f.seq : -1))).toEqual([3])
  })

  it("says a trak is gone rather than leaving watchers holding a seq for it", async () => {
    const frames = await framesOf(
      Effect.flatMap(Store, (store) =>
        Effect.zipRight(seedLog(store, ID, [Events.trakCreated("x")]), store.remove(ID)),
      ),
      2,
    )
    expect(frames.map((f) => f._tag)).toEqual(["Appended", "Removed"])
  })

  it("publishes nothing for an empty append", async () => {
    // `store-file.ts` early-returns on an empty batch, so a frame here would be the
    // decorator inventing a write that never happened.
    const frames = await framesOf(
      Effect.flatMap(Store, (store) =>
        Effect.zipRight(seedLog(store, ID, []), seedLog(store, ID, [Events.trakCreated("x")])),
      ),
      1,
    )
    expect(frames.map((f) => (f._tag === "Appended" ? f.seq : -1))).toEqual([1])
  })
})

describe("publishing store — the archive", () => {
  it("keeps the archive current from what each append leaves the trak as", async () => {
    // The set a list and the sweep skip is classified here, off the same projection
    // the frame carries: an archive in flight puts the trak in, and the git failure
    // that takes the archive back to `Failed` takes it out again. Removing the trak
    // forgets it, so a re-created one starts live.
    const held = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Store
        const archive = yield* Archive
        yield* seedLog(store, ID, [Events.trakCreated("x")])
        const live = yield* archive.holds(ID)
        yield* seedLog(store, ID, [Events.abandoned("not worth it")])
        const abandoning = yield* archive.holds(ID)
        const counted = yield* archive.count
        yield* seedLog(store, ID, [Events.worktreeFailed("git refused")])
        const failed = yield* archive.holds(ID)
        yield* seedLog(store, ID, [Events.abandoned("not worth it")])
        yield* store.remove(ID)
        const removed = yield* archive.holds(ID)
        return { live, abandoning, counted, failed, removed }
      }).pipe(Effect.orDie, Effect.provide(watched)),
    )
    expect(held).toStrictEqual({
      live: false,
      abandoning: true,
      counted: 1,
      failed: false,
      removed: false,
    })
  })
})
