// The detail's file-derived half, kept: a trak's decoded log and transcript, each held
// under the version it was read at, and read again only once the file has moved.
//
// Here rather than in `workflow/` for the reason the sweep and the deploy memory are:
// it appends nothing and drives nothing. What it adds is memory for the one route that
// reads both of a trak's files whole. The page a person has open polls that route, and
// every poll was a read and a decode of everything the trak had ever logged — the
// bigger the trak, the slower its own page. `Store.versions` is a stat per file, so a
// poll that finds nothing moved costs two stats and no decode; one that finds the
// transcript moved, as every tool call during a turn moves it, re-reads the transcript
// and keeps the log.
//
// **Nothing durable, and nothing the files do not already hold.** The versions are
// taken *before* the read rather than after: a write landing between the two leaves
// the entry newer than its version says, and the next ask sees a version that does
// not match and reads again. Taken after, the same write would leave the entry older
// than its version says, and nothing would ever re-read it. No permit is held either —
// the worst a racing append can cause is one read too many.
//
// **Bounded to the last few traks asked for**, because an entry is one trak's whole
// decoded history: a daemon running for a month would otherwise come to hold every
// trak anyone had opened, which is the projection of every trak the archive split
// exists to avoid.

import { Context, Effect, Layer, Ref } from "effect"
import type { TranscriptEntry } from "../agent/types/transcript-entry.js"
import type { Event } from "../workflow/domain/event.js"
import { replayHistory } from "../workflow/domain/replay.js"
import type { Trak, TrakId } from "../workflow/domain/trak.js"
import { Store, type StoreShape, type StoreVersions } from "../workflow/ports/store.js"
import type { StoreFailed, StoreUndecodable } from "../workflow/ports/store-errors.js"

/** How many traks' files are held at once: a page per open tab, and not many tabs. */
const KEPT = 8

/** A trak's two files, decoded, and the log replayed. */
export interface TrakFiles {
  readonly trak: Trak
  readonly events: readonly Event[]
  readonly transcript: readonly TranscriptEntry[]
}

/** One trak's files as last read, and the versions they were read at. */
interface Held {
  readonly versions: StoreVersions
  readonly files: TrakFiles
}

export interface DetailsShape {
  /**
   * The trak's files as they are now: off memory for each file the store says has
   * not moved since it was last read here, and read for the other. A trak the store
   * has nothing for reads as an empty log, as it does from the store itself.
   */
  readonly files: (id: TrakId) => Effect.Effect<TrakFiles, StoreFailed | StoreUndecodable>
}

export class Details extends Context.Tag("app/Details")<Details, DetailsShape>() {}

/**
 * The map with this trak's entry newest, and the oldest dropped past `KEPT`. A `Map`
 * rather than a `HashMap` because insertion order is the whole eviction policy.
 */
const keeping = (
  all: ReadonlyMap<TrakId, Held>,
  id: TrakId,
  entry: Held,
): ReadonlyMap<TrakId, Held> => {
  const next = new Map(all)
  next.delete(id)
  next.set(id, entry)
  for (const oldest of next.keys()) {
    if (next.size <= KEPT) break
    next.delete(oldest)
  }
  return next
}

/** The log half: kept where its version has not moved, else read and replayed. */
const logOf = (
  store: StoreShape,
  id: TrakId,
  kept: Held | undefined,
  now: StoreVersions,
): Effect.Effect<Pick<TrakFiles, "trak" | "events">, StoreFailed | StoreUndecodable> =>
  kept !== undefined && kept.versions.log === now.log
    ? Effect.succeed({ trak: kept.files.trak, events: kept.files.events })
    : Effect.map(store.events(id), (events) => ({ trak: replayHistory(id, events), events }))

/** The transcript half, on the same rule. */
const transcriptOf = (
  store: StoreShape,
  id: TrakId,
  kept: Held | undefined,
  now: StoreVersions,
): Effect.Effect<readonly TranscriptEntry[], StoreFailed | StoreUndecodable> =>
  kept !== undefined && kept.versions.transcript === now.transcript
    ? Effect.succeed(kept.files.transcript)
    : store.transcript(id)

export const DetailsLayer = Layer.effect(
  Details,
  Effect.gen(function* () {
    const store = yield* Store
    const held = yield* Ref.make<ReadonlyMap<TrakId, Held>>(new Map())

    const files = (id: TrakId): Effect.Effect<TrakFiles, StoreFailed | StoreUndecodable> =>
      Effect.gen(function* () {
        const kept = (yield* Ref.get(held)).get(id)
        // Before either read — see the module header.
        const now = yield* store.versions(id)
        const { trak, events } = yield* logOf(store, id, kept, now)
        const transcript = yield* transcriptOf(store, id, kept, now)
        const read: TrakFiles = { trak, events, transcript }
        yield* Ref.update(held, (all) => keeping(all, id, { versions: now, files: read }))
        return read
      })

    return { files }
  }),
)
