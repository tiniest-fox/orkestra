import { Data, Effect } from "effect"

export class StoreFailed extends Data.TaggedError("StoreFailed")<{
  readonly reason: string
}> {
  /** The reason, as the `Error` message — `FileStoreLayer` and `FileRunsLayer` can both
   * fail a boot with this, and `serve.ts` reports one by rendering the `Cause`. */
  override get message(): string {
    return this.reason
  }
}

/**
 * A stored line will not decode: the bytes were read, and they are not this
 * protocol — a log written against a variant that has since been deleted, or a
 * line a killed process left half-written.
 *
 * **Apart from `StoreFailed` because the two license different answers.** A
 * surface may choose to leave an undecodable trak out, and `GET /api/traks`
 * does; leaving out a trak whose *disk* would not answer reports "there are
 * four traks" when the honest answer is "I could not tell". One tag rather
 * than a field on `StoreFailed`, so `catchTag` is the only way to absorb it
 * and a `catchAll` cannot take both by accident.
 *
 * Only the two read methods raise it. A write encodes rather than decodes, so
 * it has nothing to fail this way.
 */
export class StoreUndecodable extends Data.TaggedError("StoreUndecodable")<{
  readonly reason: string
}> {}

/**
 * Where an append is made from: `after` is how many events the log held when the caller
 * read it, and `fence` the fencing token of the lease the caller drives under, where it
 * holds one.
 *
 * **`after` is the read the decision was made on, never a fresh count.** Counting again
 * just before the append would make the check pass against a log the caller never looked
 * at, which is the lost write this exists to refuse.
 */
export interface AppendAt {
  readonly after: number
  readonly fence?: number
}

/**
 * The log is no longer `after` events long: something else appended between the
 * caller's read and its write. With one engine `Locks` keeps that from happening, so
 * this names a second writer.
 *
 * **Never caught and retried by the appender.** A retry of the write alone would land
 * a decision made over a log it never saw. Whatever retries does so a level up, as a
 * fresh read and a fresh decision: `readAgainOnConflict`, for the press on another
 * engine copy that an external store makes possible.
 */
export class StoreConflict extends Data.TaggedError("StoreConflict")<{
  readonly id: string
  readonly after: number
  readonly found: number
}> {
  override get message(): string {
    return `${this.id}: appended after ${this.after} events, and the log holds ${this.found}`
  }
}

/**
 * The lease the append was fenced with is no longer the trak's: another holder took it.
 * Raised only by an adapter that checks `fence`; the file and memory adapters accept a
 * fence and ignore it. The drive that gets this has lost its trak and ends.
 */
export class StoreFenced extends Data.TaggedError("StoreFenced")<{
  readonly id: string
  readonly fence: number
}> {
  override get message(): string {
    return `${this.id}: fence ${this.fence} no longer holds the lease`
  }
}

/**
 * `append`, read and decided again where the store refused it as `StoreConflict`. Under an
 * external store a press on another engine copy appends with no permit this copy holds, so a
 * drive's read can be one event short by the time it writes; the whole read-decide-append
 * runs again, never the write alone. With one engine the permit keeps that from happening,
 * and a conflict there is still reported once the tries run out.
 */
export const readAgainOnConflict = <A, E extends { readonly _tag: string }, R>(
  append: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.retry(append, { while: (e) => e._tag === "StoreConflict", times: 3 })

/** What an append can fail with. */
export type AppendFailed = StoreFailed | StoreConflict | StoreFenced
