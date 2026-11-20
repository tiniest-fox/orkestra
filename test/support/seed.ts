// A test writing a log into the state it starts from, on a trak's or a goal's store.
//
// The engine passes the count of the read its decision rests on. A test seeding a log
// decides nothing from it, so this reads the count just before appending.

import { Effect } from "effect"
import type {
  AppendAt,
  AppendFailed,
  StoreFailed,
  StoreUndecodable,
} from "../../src/workflow/ports/store-errors.js"

interface Log<Id, Ev> {
  readonly events: (id: Id) => Effect.Effect<readonly Ev[], StoreFailed | StoreUndecodable>
  readonly append: (
    id: Id,
    events: readonly Ev[],
    at: AppendAt,
  ) => Effect.Effect<void, AppendFailed>
}

/** Append `events` after whatever the log holds now. */
export const seedLog = <Id, Ev>(
  log: Log<Id, Ev>,
  id: Id,
  events: readonly Ev[],
): Effect.Effect<void, AppendFailed | StoreUndecodable> =>
  Effect.flatMap(log.events(id), (held) => log.append(id, events, { after: held.length }))
