// The one way a surface reads a trak it might not want: past the `Archive` first, and
// classifying what it reads. The list and the sweep both go through here, which is what
// makes the sweep's first pass at boot the pass that fills the set — every log is read
// once, by whichever of the two reaches it first, and a put-away trak is never opened
// again by either.
//
// **Under the trak's log permit**, because a read that classified after an append had
// moved the trak would land the older answer on top of the newer one: a trak closed
// between the read and the classification would stay live until its next append, and
// one whose archive failed in that window would stay hidden. Every append holds the
// same permit, so the two are ordered and the classification is always of the log as it
// is. A read holds it for a file read and nothing else — the rule `Locks` states.
//
// **It classifies the `Idle` memory as well**, under the same permit and for the same
// reason, from the same read — so a trak's first read after an append is what learns
// whether it may go idle and when it was last active.

import { Effect } from "effect"
import { replayHistory } from "../workflow/domain/replay.js"
import { archived, type Trak, type TrakId } from "../workflow/domain/trak.js"
import type { Event } from "../workflow/domain/event.js"
import { Archive } from "../workflow/ports/archive.js"
import { Idle } from "../workflow/ports/idle.js"
import { Locks } from "../workflow/ports/locks.js"
import { Store } from "../workflow/ports/store.js"
import type { StoreFailed, StoreUndecodable } from "../workflow/ports/store-errors.js"

/** A trak that is not put away, with the log it was replayed from. */
export interface Live {
  readonly trak: Trak
  readonly events: readonly Event[]
}

/**
 * The trak and its log, or nothing for one that is put away — without a read where the
 * set already says so. A log this build cannot decode escapes as it does from `Store`,
 * for the caller to leave out on its own terms.
 */
export const liveTrak = (
  id: TrakId,
): Effect.Effect<
  Live | undefined,
  StoreFailed | StoreUndecodable,
  Store | Archive | Idle | Locks
> =>
  Effect.gen(function* () {
    const archive = yield* Archive
    if (yield* archive.holds(id)) return undefined
    const store = yield* Store
    const locks = yield* Locks
    const idle = yield* Idle
    return yield* locks.withLog(id)(
      Effect.gen(function* () {
        const events = yield* store.events(id)
        const trak = replayHistory(id, events)
        yield* archive.classify(trak)
        yield* idle.classify(trak, events)
        return archived(trak.state) ? undefined : { trak, events }
      }),
    )
  })
