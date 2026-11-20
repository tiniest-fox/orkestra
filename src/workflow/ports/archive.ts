import { Context, type Effect } from "effect"
import type { Trak, TrakId } from "../domain/trak.js"

/**
 * The traks that are put away — the ids `archived` answers true for — so a reader can
 * leave them out without opening their logs. Most of a repository's traks are here,
 * and none of them is waiting on anything or drawn as a row.
 *
 * **Decided by one full pass at boot and kept current by every append.** The daemon is
 * the only writer, so an append is the only thing that moves a trak in or out; the
 * publishing store classifies what each append leaves the trak as, and the first sweep
 * classifies every log it reads. A tail scan would be cheaper and is wrong: an ending is
 * not the last event on a log, and a scan searching back for one finds a `Closed` that a
 * later event has moved past, and hides a live trak.
 *
 * **A reader classifies under the trak's log permit**, so a read cannot land its answer
 * after an append has already moved the trak — `src/app/archive.ts` is the one reader.
 * A daemon restart forgets it all, and the boot pass is what fills it again.
 *
 * **It keeps each one's title as well as whether it has a parent**, so a search can find a
 * put-away trak by name without opening the log the set exists to keep shut.
 */
export interface ArchiveShape {
  /** Whether this trak is put away. `false` for one nothing has classified yet. */
  readonly holds: (id: TrakId) => Effect.Effect<boolean>
  /**
   * How many put-away traks have no parent — what a list's archived header counts,
   * because every header there counts groups, and an archived child is under its
   * parent or is nobody's row.
   */
  readonly count: Effect.Effect<number>
  /**
   * The put-away traks whose title or id holds `text`, ignoring case — children too,
   * since a search is after a name rather than a row — at most `limit`, by title.
   */
  readonly matching: (text: string, limit: number) => Effect.Effect<readonly ArchivedTrak[]>
  /** Put the trak in or out, from what its log adds up to now. */
  readonly classify: (trak: Trak) => Effect.Effect<void>
  /** The trak is gone. */
  readonly forget: (id: TrakId) => Effect.Effect<void>
}

/** A put-away trak as a search finds it: what it is called, and its id. */
export interface ArchivedTrak {
  readonly id: TrakId
  readonly title: string
}

export class Archive extends Context.Tag("workflow/Archive")<Archive, ArchiveShape>() {}
