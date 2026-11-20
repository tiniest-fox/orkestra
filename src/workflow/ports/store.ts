import { Context, type Effect } from "effect"
import type { McpView } from "../../agent/types/mcp.js"
import type { TranscriptEntry } from "../../agent/types/transcript-entry.js"
import type { Event } from "../domain/event.js"
import type { TrakId } from "../domain/trak.js"
import type { AppendAt, AppendFailed, StoreFailed, StoreUndecodable } from "./store-errors.js"

/**
 * How each of a trak's two files stands: a token per file that changes whenever the
 * file does, and only then. Two equal tokens mean the file reads the same, which is
 * what lets a reader keep what it decoded and ask this instead of reading again.
 * Opaque: the file store's is the file's own mtime and size, the memory store's a
 * count of writes, and nothing outside the adapter reads either.
 */
export interface StoreVersions {
  readonly log: string
  readonly transcript: string
}

/**
 * Tier 1 (event log) and tier 2 (transcript) behind one port.
 * The whole surface — compare orkestra-store's 55-method trait.
 */
export interface StoreShape {
  /** Fails as `StoreConflict` unless the log is still `at.after` events long. */
  readonly append: (
    id: TrakId,
    events: readonly Event[],
    at: AppendAt,
  ) => Effect.Effect<void, AppendFailed>
  /** The two files' versions, for a trak that has none as much as one that has both. */
  readonly versions: (id: TrakId) => Effect.Effect<StoreVersions, StoreFailed>
  readonly events: (id: TrakId) => Effect.Effect<readonly Event[], StoreFailed | StoreUndecodable>
  readonly list: () => Effect.Effect<readonly TrakId[], StoreFailed>
  readonly appendTranscript: (
    id: TrakId,
    entry: TranscriptEntry,
  ) => Effect.Effect<void, StoreFailed>
  readonly transcript: (
    id: TrakId,
  ) => Effect.Effect<readonly TranscriptEntry[], StoreFailed | StoreUndecodable>
  /**
   * Keep the view an MCP tool's call left, under that call's id — beside the
   * transcript, never in it: a view's HTML is the size of a document, and a transcript
   * line names where it is. Written once, when the call completes, and replaced whole
   * by a second write under the same id.
   */
  readonly saveView: (id: TrakId, call: string, view: McpView) => Effect.Effect<void, StoreFailed>
  /** The view kept for `call`, or `undefined` where none was — an unknown trak included. */
  readonly view: (
    id: TrakId,
    call: string,
  ) => Effect.Effect<McpView | undefined, StoreFailed | StoreUndecodable>
  /**
   * Wipe one trak — the event log, the transcript and every view kept. Unknown id: a
   * no-op. `FileStoreLayer` implements this by removing the whole trak
   * directory, which also deletes any `run.json` a `Runs` implementation
   * keeps beside it — a cross-port dependency this contract does not
   * otherwise know about. A caller that wants custody cleared too must close
   * its `Runs.claim` scope *before* calling `remove`, not around it: the
   * claim's release re-creates the directory it just watched get deleted.
   * See `ork.ts`'s `wipeTraks` for the caller that gets this right.
   */
  readonly remove: (id: TrakId) => Effect.Effect<void, StoreFailed>
}

export class Store extends Context.Tag("workflow/Store")<Store, StoreShape>() {}
