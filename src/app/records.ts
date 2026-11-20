// The corpus: every trak whose checkout is gone as a folder you can open, under
// `.orkestra/records/`.
//
// **Two callers, one writer.** An ending writes the trak that just came to it; `pnpm
// ork records` rewrites the lot. They are the same function, so the corpus a backfill
// produces and the corpus a merge appends to cannot be two different formats — which
// is also what makes a change to a record's *contents* a re-run rather than a
// migration. A change to `folder` is not: the rewrite writes the new path and never
// deletes the old one, so every trak already on disk is left with a stale second copy
// that a cross-trak grep still finds. Moving the folder is a migration.
//
// Here rather than in `workflow/` because it drives nothing: it reads logs and writes
// files, takes no custody, and touches no trak's state. `src/app/drive.ts` is the only
// thing in this module that may `advance`, and this needs none of it.

import { Effect } from "effect"
import {
  keptInCorpus,
  record,
  recordFiles,
  relatedTraks,
  type Related,
  type TrakRecord,
} from "../workflow/domain/record.js"
import { replayHistory } from "../workflow/domain/replay.js"
import type { Event } from "../workflow/domain/event.js"
import type { TrakId } from "../workflow/domain/trak.js"
import { Store } from "../workflow/ports/store.js"
import type { StoreFailed } from "../workflow/ports/store-errors.js"
import { Workspace, type WorkspaceFailed } from "../workflow/ports/workspace.js"

type RecordsError = StoreFailed | WorkspaceFailed

/**
 * The logs a record wants beside its own, and an absent one is not an error.
 *
 * A parent or a child can have been wiped, and a log this build cannot decode is the
 * same case from here — `record` renders a missing relative as an unlinked id and a
 * roll-up short of that trak's spend, which is a truthful record of what is on disk.
 */
const relatedLogs = (
  id: TrakId,
  history: readonly Event[],
): Effect.Effect<Related, StoreFailed, Store> =>
  Effect.gen(function* () {
    const store = yield* Store
    const found = new Map<TrakId, readonly Event[]>()
    for (const other of relatedTraks(id, history)) {
      const log = yield* store
        .events(other)
        .pipe(Effect.catchTag("StoreUndecodable", () => Effect.succeed<readonly Event[]>([])))
      if (log.length > 0) found.set(other, log)
    }
    return found
  })

/**
 * The record, with the logs it is joined to already read.
 *
 * The one call both a reader and the corpus go through, so `pnpm ork record`, the
 * markdown route and the folder on disk can never disagree about what a spawn cost.
 */
export const trakRecord = (
  id: TrakId,
  history: readonly Event[],
): Effect.Effect<TrakRecord, StoreFailed, Store> =>
  Effect.map(relatedLogs(id, history), (related) => record(id, history, related))

/**
 * One trak's folder, written or replaced.
 *
 * Replacing rather than appending is what makes a second run a no-op: the folder is
 * a function of the log, and the log only grows at the end.
 */
const writeRecord = (
  id: TrakId,
  history: readonly Event[],
): Effect.Effect<string, RecordsError, Store | Workspace> =>
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const r = yield* trakRecord(id, history)
    yield* workspace.keepRecord(r.folder, recordFiles(r))
    return r.folder
  })

/**
 * The trak that just ended, filed, and a failure to file it kept off the ending.
 *
 * **Written for the states `keptInCorpus` names and at no other moment.** A trak that
 * merged, was archived or was abandoned has lost the checkout that held
 * `.orkestra/.trak/`, so this is the only way its documents survive; a finished one
 * still holds it, and filing there too would give a trak that goes on to merge a
 * second folder on the merge day.
 *
 * The ending is on the log already; a corpus that could not be written is worth a
 * line in the daemon's output and nothing more. Failing the drive here would leave a
 * trak at rest reported as failed, which is the one wrong answer available.
 */
export const keepRecord = (id: TrakId): Effect.Effect<void, never, Store | Workspace> =>
  Effect.gen(function* () {
    const store = yield* Store
    const history = yield* store.events(id)
    if (!keptInCorpus(replayHistory(id, history))) return
    yield* writeRecord(id, history)
  }).pipe(
    Effect.catchAll((e) => Effect.logError(`could not keep the record of ${id}: ${e.reason}`)),
  )

/**
 * Every trak whose checkout is gone, rewritten from its log.
 *
 * **Writes and never deletes**, so a trak someone wiped keeps an orphan folder. Cheap
 * to live with, and the alternative — clearing the corpus root first — is an `rm -rf`
 * one bad argument away from a directory a person has been reading for months.
 *
 * A log this build cannot decode is left out rather than fatal, which is the
 * precedent `GET /api/traks` already sets: a whole-corpus regenerate that dies on one
 * line is worse than one short a trak.
 */
export const writeCorpus = (): Effect.Effect<
  readonly string[],
  StoreFailed | WorkspaceFailed,
  Store | Workspace
> =>
  Effect.gen(function* () {
    const store = yield* Store
    const written: string[] = []
    for (const id of yield* store.list()) {
      const history = yield* store
        .events(id)
        .pipe(Effect.catchTag("StoreUndecodable", () => Effect.succeed<readonly Event[]>([])))
      if (history.length === 0) continue
      if (!keptInCorpus(replayHistory(id, history))) continue
      written.push(yield* writeRecord(id, history))
    }
    return written.sort((a, b) => a.localeCompare(b))
  })
