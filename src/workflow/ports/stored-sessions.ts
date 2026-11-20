import { Context, type Effect } from "effect"
import type { StoreFailed } from "./store-errors.js"

/**
 * A sandboxed turn's session file kept in the store as well as under this machine's
 * home, so an engine copy on another machine — one whose home never held it — can resume
 * it. Offered only under an external store, by the layer that speaks to its process: with none,
 * the sandbox and this machine's home are the only copies, as they always were.
 *
 * `path` is the session file's path relative to the home, which is also its key in the
 * store, so it is the same on every copy and in every sandbox.
 */
export interface StoredSessionsShape {
  /** Put this machine's copy into the store, with its modification time. Nothing where there is none. */
  readonly save: (path: string) => Effect.Effect<void, StoreFailed>
  /**
   * Write the store's copy into this machine's home, stamped with the time it was put
   * with — only where the store holds one and the home's copy is missing or older.
   */
  readonly restore: (path: string) => Effect.Effect<void, StoreFailed>
}

export class StoredSessions extends Context.Tag("workflow/StoredSessions")<
  StoredSessions,
  StoredSessionsShape
>() {}
