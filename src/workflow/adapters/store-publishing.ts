// The Store, wrapped so that every append is also something a watcher can see.
//
// **A decorator rather than a second call site.** Both files a trak has are written
// through this port, so wrapping it catches both and `runtime.ts` never learns that
// anything is watching. The alternative — publishing from `Observer` — publishes a
// different set of things than the files hold: `withTranscript` collapses a burst of
// `Thinking` ticks into one line *before* `appendTranscript`, so an Observer-sourced
// frame would carry entries no file contains and `seq` would be wrong from the first
// one.
//
// **The projection is the point, not an optimisation.** `Store.append` is handed events
// and knows nothing about what the trak became, which is the one thing every watcher
// wants and the thing it must not recompute for itself. One writer is what makes an
// in-memory projection safe to keep, so the decorator keeps one: `applyEvent` per
// appended event, seeded once from the log. That yields the trak a frame carries and
// the line number it occupies without re-reading either file.
//
// **The same projection keeps the `Archive` current.** What an append leaves the trak
// as is the only thing that can put it away or bring it back, and this is the one
// place that knows it without a re-read — so the set a list and the sweep skip is
// classified here, after the write, from what the whole append left. The `Idle` memory
// is told only that the log moved: the store stamps each event's time as it writes it, so
// the events in hand carry none, and the next read classifies from the log as written.
//
// It assumes exactly what `store-file.ts` already assumes: one writer per trak at a
// time, which `Locks.withLog` holds up. Two concurrent appends to one id would
// interleave the read and the write of its cursor, and the seq numbers would then
// disagree with the file they claim to count.
//
// **Under an external store it publishes nothing**, and the store is handed through unchanged.
// Several engine copies write there, so no copy sees every append made, and the store's
// own news of each write is what the store watch (`EngineSeams.watch`) publishes from — every copy the
// same frames, its own appends included.

import { Effect, HashMap, Layer, Option, Ref } from "effect"
import type { TranscriptEntry } from "../../agent/types/transcript-entry.js"
import type { Event } from "../domain/event.js"
import { applyEvent, replayHistory } from "../domain/replay.js"
import type { Trak, TrakId } from "../domain/trak.js"
import { Archive } from "../ports/archive.js"
import { Idle } from "../ports/idle.js"
import { Feed, Frame } from "../ports/feed.js"
import { Store, type StoreShape } from "../ports/store.js"
import { type AppendAt, type AppendFailed, StoreFailed } from "../ports/store-errors.js"
import { StoreWatch } from "../ports/store-watch.js"

/**
 * Where a trak has got to, as far as the feed is concerned: how many lines are in each
 * of its two files, and what its log adds up to.
 */
interface Cursor {
  readonly log: number
  readonly transcript: number
  readonly trak: Trak
}

const decorator = Layer.effect(
  Store,
  Effect.gen(function* () {
    const inner = yield* Store
    if (Option.isSome(yield* Effect.serviceOption(StoreWatch))) return inner
    const feed = yield* Feed
    const archive = yield* Archive
    const idle = yield* Idle
    const cursors = yield* Ref.make(HashMap.empty<TrakId, Cursor>())

    /**
     * The trak's cursor, read once from disk and then kept.
     *
     * The one place this costs anything: seeding reads both files whole, for a line
     * count and a replay. Once per trak per daemon lifetime, against a poll that used
     * to replay every log every 1.5 seconds.
     *
     * **An undecodable log fails the append.** A projection cannot be built from a log
     * this build cannot read, and a frame carrying a guessed state or a guessed line
     * number is worse than a refused write. `advance` never reaches here with one —
     * it reads the log itself first, and fails there.
     */
    const cursor = (id: TrakId): Effect.Effect<Cursor, StoreFailed> =>
      Effect.gen(function* () {
        const held = yield* Ref.get(cursors)
        const found = HashMap.get(held, id)
        if (Option.isSome(found)) return found.value
        const events = yield* inner.events(id)
        const lines = yield* inner.transcript(id)
        const seeded: Cursor = {
          log: events.length,
          transcript: lines.length,
          trak: replayHistory(id, events),
        }
        yield* Ref.update(cursors, (m) => HashMap.set(m, id, seeded))
        return seeded
      }).pipe(
        Effect.catchTag(
          "StoreUndecodable",
          (e) =>
            new StoreFailed({
              reason: `cannot publish appends for a log this build will not read: ${e.reason}`,
            }),
        ),
      )

    /**
     * Durable first, always. A frame is a claim that something was written down, so
     * publishing before the write would make the feed a promise rather than a record —
     * and a failed write would leave every watcher holding an event that is not there.
     */
    const append = (
      id: TrakId,
      events: readonly Event[],
      at: AppendAt,
    ): Effect.Effect<void, AppendFailed> =>
      Effect.gen(function* () {
        if (events.length === 0) return
        const before = yield* cursor(id)
        yield* inner.append(id, events, at)
        // Before the frames: a client re-reads the list on one, and must not be handed the
        // row this append has just made stale.
        yield* idle.forget(id)
        let seq = before.log
        let trak = before.trak
        for (const event of events) {
          seq += 1
          trak = applyEvent(trak, event).trak
          yield* feed.publish(Frame.Appended({ id, seq, event, trak }))
        }
        yield* Ref.update(cursors, (m) => HashMap.set(m, id, { ...before, log: seq, trak }))
        // From what the whole append left, not per event: a close is `Closed` then
        // `WorktreeRemoved` in one append, and only the end state is a fact anyone reads.
        yield* archive.classify(trak)
      })

    const appendTranscript = (
      id: TrakId,
      entry: TranscriptEntry,
    ): Effect.Effect<void, StoreFailed> =>
      Effect.gen(function* () {
        const before = yield* cursor(id)
        yield* inner.appendTranscript(id, entry)
        const seq = before.transcript + 1
        yield* Ref.update(cursors, (m) => HashMap.set(m, id, { ...before, transcript: seq }))
        yield* feed.publish(Frame.Activity({ id, seq, entry }))
      })

    /**
     * The cursor goes with the files. Keeping it would resume a re-created trak at the
     * seq the old one reached, so every frame it published would look like a gap.
     */
    const remove = (id: TrakId): Effect.Effect<void, StoreFailed> =>
      Effect.gen(function* () {
        yield* inner.remove(id)
        yield* Ref.update(cursors, (m) => HashMap.remove(m, id))
        yield* archive.forget(id)
        yield* idle.forget(id)
        yield* feed.publish(Frame.Removed({ id }))
      })

    const decorated: StoreShape = { ...inner, append, appendTranscript, remove }
    return decorated
  }),
)

/**
 * Wrap a Store so its appends reach the `Feed` and keep the `Archive` and `Idle` current.
 *
 * Takes the inner layer rather than naming `FileStoreLayer`, so a test can watch a
 * memory store — the decorator is about the port, and tying it to one adapter would
 * make the only way to test it the slow one.
 */
export const publishingStore = <E, R>(
  inner: Layer.Layer<Store, E, R>,
): Layer.Layer<Store, E, R | Feed | Archive | Idle> => decorator.pipe(Layer.provide(inner))
