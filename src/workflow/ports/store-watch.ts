import { Context, type Effect, type Scope, type Stream } from "effect"
import type { TranscriptEntry } from "../../agent/types/transcript-entry.js"
import type { Event } from "../domain/event.js"
import type { TrakId } from "../domain/trak.js"
import type { StoreFailed, StoreUndecodable } from "./store-errors.js"

/**
 * One thing an external store's process reports, with no payload: a reader reads the rows.
 *
 * - `log`, `transcript`: a write to that log of a trak or a goal. `seq` is its line count
 *   after the write, `0` after a remove, and `from` the count before it.
 * - `lease`: a take or a release of a trak's lease. `seq` is the fence.
 * - `wake`: a copy asking whichever copy drives the trak to let go of it.
 */
export interface StoreChange {
  readonly of: "trak" | "goal"
  readonly key: string
  readonly kind: "log" | "transcript" | "lease" | "wake"
  readonly seq: number
  readonly from?: number
}

/**
 * The store's own news of every write, from whichever engine copy made it, and the reads
 * that catch up with one. Offered only under an external store, by the layer that speaks to its
 * process, and absent with the file store: one process is the only writer there, and the
 * publishing stores see every append it makes.
 */
export interface StoreWatchShape {
  /**
   * Every change from now until the caller's scope closes. Subscribed before this
   * answers, so a write made after it is in the stream.
   */
  readonly subscribe: Effect.Effect<
    Stream.Stream<StoreChange, StoreFailed>,
    StoreFailed,
    Scope.Scope
  >
  /** Ask the copy driving `id` to let go of it — a takeover's wake, sent to every copy. */
  readonly wake: (id: TrakId) => Effect.Effect<void, StoreFailed>
  /** The trak's events past the first `after`. */
  readonly events: (
    id: TrakId,
    after: number,
  ) => Effect.Effect<readonly Event[], StoreFailed | StoreUndecodable>
  /** The trak's transcript lines past the first `after`. */
  readonly transcript: (
    id: TrakId,
    after: number,
  ) => Effect.Effect<readonly TranscriptEntry[], StoreFailed | StoreUndecodable>
}

export class StoreWatch extends Context.Tag("workflow/StoreWatch")<StoreWatch, StoreWatchShape>() {}
