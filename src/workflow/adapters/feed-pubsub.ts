// The feed, in memory: a sliding PubSub for the live half and a ring for the replay
// half. One process, one feed — this is the adapter a single-writer daemon uses, and
// there is deliberately nothing durable in it. The durable copy is the two JSONL files
// every frame was read out of.
//
// **Sliding, and that is the whole design.** `publish` runs inside `Store.append`,
// which runs inside `advance`, so a feed that blocked would let one browser tab that
// stopped reading stall a turn. `bounded` blocks the publisher; `dropping` throws away
// the newest frames, so a slow reader loses exactly the tail it needs and stays wrong
// with nothing to notice it by. `sliding` throws away the oldest, which is the one loss
// a reader can detect — `Replay.complete` says so, and re-reading repairs it.

import { Effect, Layer, PubSub, Ref, type Scope, Stream } from "effect"
import { Feed, type Frame, type Framed, type Replay } from "../ports/feed.js"

/**
 * How many frames are held for a reconnecting subscriber.
 *
 * It bounds a laptop closing its lid, not a client that has gone away: at one frame
 * per tool call, 256 is a couple of minutes of a busy turn. Past that a subscriber is
 * told it missed frames and re-reads, which is cheap and always correct — so the number
 * trades memory against how often that happens, and nothing depends on it being right.
 */
const BUFFER = 256

export const PubSubFeedLayer = Layer.effect(
  Feed,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.sliding<Framed>(BUFFER)
    // Id and ring in one `Ref` so `Ref.modify` assigns and records atomically. Held
    // apart they could disagree: two traks append at once, and the ring ends up in an
    // order its own ids contradict.
    const held = yield* Ref.make<{ readonly next: number; readonly ring: readonly Framed[] }>({
      next: 0,
      ring: [],
    })

    /**
     * Frames reach the PubSub in whatever order the fibers publishing them are
     * scheduled, which is **not** always id order across traks. One trak's frames are
     * ordered, because its appends hold that trak's permit; two traks have no order to
     * get wrong. A subscriber that sees 11 before 10 keeps the highest id it saw, so
     * resuming loses nothing.
     */
    const publish = (frame: Frame): Effect.Effect<void> =>
      Ref.modify(held, (state) => {
        const framed: Framed = { id: state.next + 1, frame }
        return [framed, { next: framed.id, ring: [...state.ring, framed].slice(-BUFFER) }]
      }).pipe(Effect.flatMap((framed) => Effect.asVoid(PubSub.publish(pubsub, framed))))

    /**
     * **Subscribe before reading the ring, then de-duplicate.** The other order has a
     * hole in it: a frame published between the read and the subscription is in
     * neither half and is gone. This way it is in both, and `seen` drops the copy.
     *
     * `after === 0` is a fresh connection rather than a resume, so it gets no replay —
     * it is about to read the whole state anyway, and handing it the ring would make
     * every connect a burst of patches that miss and refetch.
     */
    const since = (after: number): Effect.Effect<Replay, never, Scope.Scope> =>
      Effect.gen(function* () {
        const dequeue = yield* PubSub.subscribe(pubsub)
        const state = yield* Ref.get(held)
        const { ring } = state
        if (after === 0) return { complete: true, frames: Stream.fromQueue(dequeue) }

        const replay = ring.filter((f) => f.id > after)
        const floor = ring[0]?.id
        // Two ways a subscriber cannot be caught up, and the second is the one that
        // is easy to miss. It has fallen off the back of the ring — or it is quoting
        // an id this feed never issued, which is what a reconnect after a restart
        // looks like: the counter begins again at zero, so the id a client held from
        // the last process is ahead of everything in this one. Answering *complete*
        // there would hand it a stream that silently skips whatever it actually
        // missed. An empty ring is not itself a gap: it only sheds once it is full.
        const known = after <= state.next
        const contiguous = floor === undefined || floor <= after + 1
        const complete = known && contiguous
        const seen = new Set(replay.map((f) => f.id))
        return {
          complete,
          frames: Stream.concat(
            Stream.fromIterable(replay),
            Stream.filter(Stream.fromQueue(dequeue), (f) => !seen.has(f.id)),
          ),
        }
      })

    return { publish, since }
  }),
)
