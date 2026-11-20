// In-memory store, for tests. The encode/decode round-trip is exercised here, so a
// test on this store still proves every event it writes serializes.

import { Clock, Effect, Either, Layer, Ref } from "effect"
import { decodeTranscriptEntry, encodeTranscriptEntry } from "../../agent/types/transcript-entry.js"
import type { McpView } from "../../agent/types/mcp.js"
import { decodeEvent, encodeEvent, stamped } from "../domain/event.js"
import { Store, type StoreShape, type StoreVersions } from "../ports/store.js"
import { StoreConflict, StoreFailed, StoreUndecodable } from "../ports/store-errors.js"
import type { TrakId } from "../domain/trak.js"

interface State {
  readonly log: ReadonlyMap<TrakId, readonly unknown[]>
  readonly transcripts: ReadonlyMap<TrakId, readonly unknown[]>
  /**
   * How many times each trak's two files have been written, a remove counting as a
   * write to both — so a trak removed and made again never reads as unchanged, which
   * a line count would say once it reached the same length.
   */
  readonly writes: ReadonlyMap<TrakId, StoreVersions>
}

const UNWRITTEN: StoreVersions = { log: "0", transcript: "0" }

/** The next version of one of a trak's files. */
const written = (
  writes: ReadonlyMap<TrakId, StoreVersions>,
  id: TrakId,
  file: keyof StoreVersions,
): ReadonlyMap<TrakId, StoreVersions> => {
  const before = writes.get(id) ?? UNWRITTEN
  return new Map(writes).set(id, { ...before, [file]: String(Number(before[file]) + 1) })
}

const makeMemoryStore: Effect.Effect<StoreShape> = Effect.gen(function* () {
  const ref = yield* Ref.make<State>({ log: new Map(), transcripts: new Map(), writes: new Map() })

  // `fence` is accepted and ignored: leases exist only under an external store.
  const append: StoreShape["append"] = (id, events, { after }) =>
    Effect.gen(function* () {
      // Stamped here rather than by the caller, so a flow test's log carries times
      // too — see `stamped`. One reading for the batch: they were written together.
      const now = yield* Clock.currentTimeMillis
      // Encode on write: if an event isn't serializable, we find out now.
      const encoded = yield* Effect.forEach(events, (e) => encodeEvent(stamped(e, now))).pipe(
        Effect.mapError((e) => new StoreFailed({ reason: `encode failed: ${e.message}` })),
      )
      // The check and the write in one `modify`, so no other fiber's append lands between.
      const checked = yield* Ref.modify(
        ref,
        (s): readonly [Either.Either<void, StoreConflict>, State] => {
          const log = s.log.get(id) ?? []
          if (log.length !== after) {
            return [Either.left(new StoreConflict({ id, after, found: log.length })), s]
          }
          return [
            Either.void,
            {
              ...s,
              log: new Map(s.log).set(id, [...log, ...encoded]),
              writes: written(s.writes, id, "log"),
            },
          ]
        },
      )
      yield* checked
    })

  const versions: StoreShape["versions"] = (id) =>
    Ref.get(ref).pipe(Effect.map((s) => s.writes.get(id) ?? UNWRITTEN))

  const events: StoreShape["events"] = (id) =>
    Effect.gen(function* () {
      const s = yield* Ref.get(ref)
      const raw = s.log.get(id) ?? []
      return yield* Effect.forEach(raw, (u) => decodeEvent(u)).pipe(
        Effect.mapError((e) => new StoreUndecodable({ reason: `decode failed: ${e.message}` })),
      )
    })

  const list: StoreShape["list"] = () => Ref.get(ref).pipe(Effect.map((s) => [...s.log.keys()]))

  // Encoded on write and decoded on read, for the reason the log is: an entry that is
  // not serializable has to fail here rather than the first time a file store sees it.
  const appendTranscript: StoreShape["appendTranscript"] = (id, entry) =>
    Effect.gen(function* () {
      const encoded = yield* encodeTranscriptEntry(entry).pipe(
        Effect.mapError((e) => new StoreFailed({ reason: `encode failed: ${e.message}` })),
      )
      yield* Ref.update(ref, (s) => ({
        ...s,
        transcripts: new Map(s.transcripts).set(id, [...(s.transcripts.get(id) ?? []), encoded]),
        writes: written(s.writes, id, "transcript"),
      }))
    })

  const transcript: StoreShape["transcript"] = (id) =>
    Effect.gen(function* () {
      const s = yield* Ref.get(ref)
      return yield* Effect.forEach(s.transcripts.get(id) ?? [], (u) =>
        decodeTranscriptEntry(u),
      ).pipe(
        Effect.mapError((e) => new StoreUndecodable({ reason: `decode failed: ${e.message}` })),
      )
    })

  // Held as given: a view is decoded data already, and nothing here reads it back off
  // bytes. Keyed by trak and call together, since a call id is unique only to its turn.
  const views = yield* Ref.make<ReadonlyMap<string, McpView>>(new Map())
  const saveView: StoreShape["saveView"] = (id, call, kept) =>
    Ref.update(views, (all) => new Map(all).set(`${id}/${call}`, kept))
  const view: StoreShape["view"] = (id, call) =>
    Effect.map(Ref.get(views), (all) => all.get(`${id}/${call}`))

  const remove: StoreShape["remove"] = (id) =>
    Ref.update(ref, (s) => {
      const log = new Map(s.log)
      const transcripts = new Map(s.transcripts)
      log.delete(id)
      transcripts.delete(id)
      return { log, transcripts, writes: written(written(s.writes, id, "log"), id, "transcript") }
    }).pipe(
      Effect.zipRight(
        Ref.update(views, (all) => new Map([...all].filter(([key]) => !key.startsWith(`${id}/`)))),
      ),
    )

  return {
    append,
    versions,
    events,
    list,
    appendTranscript,
    transcript,
    saveView,
    view,
    remove,
  }
})

export const MemoryStoreLayer = Layer.effect(Store, makeMemoryStore)
