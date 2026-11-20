// The Feed port's contract, written once and run against every implementation.
//
// Everything here is about the two ways a watcher goes quietly wrong, neither of which
// shows up as an error anywhere:
//
//   · a frame published in the gap between subscribing and reading the buffer is in
//     neither half, so a projection is short one event and nothing says so;
//   · a subscriber that asked from before the buffer's floor gets a stream starting in
//     the middle, which looks exactly like a stream that is complete.
//
// The second is what `Replay.complete` exists for, and it is the only assertion in this
// file that could not be written after the fact from the frames themselves.

import { Effect, Fiber, type Layer, type Scope, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { Events } from "../../src/workflow/domain/event.js"
import { emptyTrak, TrakId } from "../../src/workflow/domain/trak.js"
import { Feed, Frame, type Framed } from "../../src/workflow/ports/feed.js"

export interface FeedUnderTest {
  readonly label: string
  readonly layer: Layer.Layer<Feed>
  /** How many frames the implementation holds for a reconnecting subscriber. */
  readonly buffer: number
}

const ID = TrakId.make("trak-1")

/** A frame whose only job is to be distinguishable — `seq` is the marker. */
const appended = (seq: number): Frame =>
  Frame.Appended({
    id: ID,
    seq,
    event: Events.trakCreated(`event ${String(seq)}`),
    trak: emptyTrak(ID),
  })

const seqsOf = (frames: readonly Framed[]): readonly number[] =>
  frames.flatMap((f) => (f.frame._tag === "Appended" ? [f.frame.seq] : []))

/** Run this against any Feed implementation. */
export const feedContract = (c: FeedUnderTest): void => {
  /**
   * Run one case, with a timeout so a frame that never arrives fails rather than hangs.
   *
   * `Scope` is in the requirement because `since` subscribes into the caller's — which
   * is the port saying a subscription is released when whoever asked for it goes away.
   */
  const drive = <A>(body: Effect.Effect<A, never, Feed | Scope.Scope>): Promise<A> =>
    Effect.runPromise(
      Effect.scoped(body.pipe(Effect.timeout("5 seconds"), Effect.orDie, Effect.provide(c.layer))),
    )

  describe(`Feed contract (${c.label})`, () => {
    it("hands a live subscriber what is published after it subscribes", async () => {
      const seqs = await drive(
        Effect.gen(function* () {
          const feed = yield* Feed
          const replay = yield* feed.since(0)
          const taking = yield* Effect.fork(Stream.runCollect(Stream.take(replay.frames, 2)))
          yield* feed.publish(appended(1))
          yield* feed.publish(appended(2))
          return seqsOf([...(yield* Fiber.join(taking))])
        }),
      )
      expect(seqs).toEqual([1, 2])
    })

    it("gives a fresh subscriber no replay", async () => {
      // `after === 0` is a connection, not a resume: it is about to read the whole
      // state anyway, and handing it the buffer makes every connect a burst of
      // patches that miss and refetch.
      const seqs = await drive(
        Effect.gen(function* () {
          const feed = yield* Feed
          yield* feed.publish(appended(1))
          const replay = yield* feed.since(0)
          const taking = yield* Effect.fork(Stream.runCollect(Stream.take(replay.frames, 1)))
          yield* feed.publish(appended(2))
          return seqsOf([...(yield* Fiber.join(taking))])
        }),
      )
      expect(seqs).toEqual([2])
    })

    it("replays what a resuming subscriber missed, then carries on live", async () => {
      const seqs = await drive(
        Effect.gen(function* () {
          const feed = yield* Feed
          yield* feed.publish(appended(1))
          yield* feed.publish(appended(2))
          yield* feed.publish(appended(3))
          // Resuming after the first: two buffered, then one that has not happened yet.
          const replay = yield* feed.since(1)
          const taking = yield* Effect.fork(Stream.runCollect(Stream.take(replay.frames, 3)))
          yield* feed.publish(appended(4))
          return seqsOf([...(yield* Fiber.join(taking))])
        }),
      )
      expect(seqs).toEqual([2, 3, 4])
    })

    it("delivers a frame published while it was subscribing exactly once", async () => {
      // The gap this contract exists for. An implementation that reads the buffer
      // before subscribing drops such a frame; one that does neither carefully
      // delivers it twice, and a duplicate append is worse than a missing one.
      const seqs = await drive(
        Effect.gen(function* () {
          const feed = yield* Feed
          yield* feed.publish(appended(1))
          const replay = yield* feed.since(0).pipe(
            // Publishing between the subscribe and the buffer read is what the
            // implementation has to survive; racing a publish against the whole of
            // `since` is the closest a caller can get to arranging it.
            Effect.zipLeft(feed.publish(appended(2)), { concurrent: true }),
          )
          const taking = yield* Effect.fork(Stream.runCollect(Stream.take(replay.frames, 1)))
          yield* feed.publish(appended(3))
          const got = seqsOf([...(yield* Fiber.join(taking))])
          return got
        }),
      )
      // Either it saw 2 (published during the subscribe) or it did not; what it may
      // never do is see it twice, and the next frame must still arrive.
      expect(seqs.length).toBe(1)
      expect([2, 3]).toContain(seqs[0])
    })

    it("says so when a subscriber asked from before the buffer", async () => {
      const { complete, missed } = await drive(
        Effect.gen(function* () {
          const feed = yield* Feed
          for (let i = 1; i <= c.buffer + 2; i += 1) yield* feed.publish(appended(i))
          const stale = yield* feed.since(1)
          const fresh = yield* feed.since(c.buffer + 1)
          return { complete: fresh.complete, missed: stale.complete }
        }),
      )
      // Frame 2 has been slid out, so a subscriber holding 1 cannot be caught up and
      // has to be told. One still inside the buffer can.
      expect(missed).toBe(false)
      expect(complete).toBe(true)
    })

    it("says so when a subscriber quotes an id this feed never issued", async () => {
      // What a reconnect after a restart looks like: the counter begins again at
      // zero, so an id the client held from the last process is ahead of everything
      // in this one. Answering *complete* would hand it a stream that skips whatever
      // it actually missed, and nothing downstream could tell.
      const complete = await drive(
        Effect.gen(function* () {
          const feed = yield* Feed
          yield* feed.publish(appended(1))
          return (yield* feed.since(4_000)).complete
        }),
      )
      expect(complete).toBe(false)
    })

    it("never blocks a publisher, subscribers or none", async () => {
      // `publish` runs inside `Store.append`, which runs inside `advance`. A feed
      // that waited on a reader would let one stalled watcher stop a turn, so this
      // publishes far past the buffer with a subscriber that never reads.
      const published = await drive(
        Effect.gen(function* () {
          const feed = yield* Feed
          yield* feed.since(0)
          for (let i = 1; i <= c.buffer * 2; i += 1) yield* feed.publish(appended(i))
          return true
        }),
      )
      expect(published).toBe(true)
    })
  })
}
