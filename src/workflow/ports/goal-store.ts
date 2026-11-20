import { Context, type Effect } from "effect"
import type { TranscriptEntry } from "../../agent/types/transcript-entry.js"
import type { GoalEvent } from "../domain/goal.js"
import type { GoalId } from "../domain/trak.js"
import type { AppendAt, AppendFailed, StoreFailed, StoreUndecodable } from "./store-errors.js"

/**
 * A goal's two files — `log.jsonl` and `transcript.jsonl` under
 * `.orkestra/.database/goals/<id>/` — behind a port of its own rather than more methods
 * on `Store`, because every one of those is keyed by `TrakId` and typed by the trak's
 * `Event`, and a goal is neither. The same two failures, for the same reasons.
 */
export interface GoalStoreShape {
  /** Fails as `StoreConflict` unless the log is still `at.after` events long. */
  readonly append: (
    id: GoalId,
    events: readonly GoalEvent[],
    at: AppendAt,
  ) => Effect.Effect<void, AppendFailed>
  readonly events: (
    id: GoalId,
  ) => Effect.Effect<readonly GoalEvent[], StoreFailed | StoreUndecodable>
  readonly list: () => Effect.Effect<readonly GoalId[], StoreFailed>
  readonly appendTranscript: (
    id: GoalId,
    entry: TranscriptEntry,
  ) => Effect.Effect<void, StoreFailed>
  readonly transcript: (
    id: GoalId,
  ) => Effect.Effect<readonly TranscriptEntry[], StoreFailed | StoreUndecodable>
}

export class GoalStore extends Context.Tag("workflow/GoalStore")<GoalStore, GoalStoreShape>() {}
