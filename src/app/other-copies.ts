// What this engine copy knows of the traks other copies drive, under an external store: the
// `OtherCopies` that `src/app/drive.ts` reads, built over the store's leases. Offered by
// `src/app/layers.ts` beside `Leases` and only where `Leases` is, so the two cannot be
// out of step. Apart from `drive.ts` so that a flow test, which never has an external store,
// does not import the `Leases` port.

import { Clock, Effect, HashMap, Option, PubSub, Queue, Ref } from "effect"
import type { TrakId } from "../workflow/domain/trak.js"
import type { LeaseRow, LeasesShape } from "../workflow/ports/leases.js"
import type { StoreFailed } from "../workflow/ports/store-errors.js"
import type { StoreWatchShape } from "../workflow/ports/store-watch.js"
import type { OtherCopiesShape } from "./drive.js"

/** How often a takeover reads the lease again while it waits and no change arrives. */
const LET_GO_POLL = "1 second"

/**
 * What this copy knows of the traks other engine copies drive, read off the store's leases.
 *
 * `elsewhere` reads the lease row, for a press and a takeover to answer by; `heldThere`
 * answers the list from when each trak was last read as held, read again once that is a
 * lease length old, since a copy that died stops renewing without saying so.
 */
export const leaseCopies = (
  leases: LeasesShape,
  watch: StoreWatchShape | undefined,
  expiresAfter: number | undefined,
): Effect.Effect<OtherCopiesShape> =>
  Effect.gen(function* () {
    const moved = yield* PubSub.unbounded<TrakId>()
    const seen = yield* Ref.make(HashMap.empty<TrakId, number>())

    /** The trak's lease row while another copy holds it unexpired, or `undefined`. */
    const heldElsewhere = (id: TrakId): Effect.Effect<LeaseRow | undefined, StoreFailed> =>
      leases.read(id).pipe(
        Effect.map((row) =>
          row !== undefined && !row.expired && row.holder !== leases.holder ? row : undefined,
        ),
        Effect.tap((row) =>
          Effect.flatMap(Clock.currentTimeMillis, (now) =>
            Ref.update(seen, (m) =>
              row === undefined ? HashMap.remove(m, id) : HashMap.set(m, id, now),
            ),
          ),
        ),
      )

    // A lease that could not be read lets a press through: the drive's own take is what
    // refuses a trak another copy holds, so the read only spares it the fork. A takeover
    // reads with `heldElsewhere` instead — see `awaitLetGo`.
    const elsewhere = (id: TrakId): Effect.Effect<LeaseRow | undefined> =>
      heldElsewhere(id).pipe(
        Effect.catchTag("StoreFailed", (e) =>
          Effect.as(Effect.logWarning(`${id}: its lease was not read: ${e.reason}`), undefined),
        ),
      )

    const heldThere = (id: TrakId): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        const at = HashMap.get(yield* Ref.get(seen), id)
        if (Option.isNone(at)) return false
        if ((yield* Clock.currentTimeMillis) - at.value < (expiresAfter ?? 0)) return true
        return (yield* elsewhere(id)) !== undefined
      })

    /** Whether another copy holds the trak's lease now. */
    const leaseMoved = (id: TrakId): Effect.Effect<boolean> =>
      Effect.flatMap(elsewhere(id), (row) =>
        Effect.as(PubSub.publish(moved, id), row !== undefined),
      )

    /**
     * Wake the copy driving `id` and wait until it lets go — its drive interrupted and the
     * lease released — or until the lease expires, where that copy is gone. Read again on
     * each change to the trak's lease, and once a second besides, since an expiry is not a
     * change anything sends.
     *
     * **A lease that could not be read fails the takeover** rather than reading as free.
     * Read as free, the takeover forks a drive the holder's lease refuses and answers `202`
     * with the holder's turn still running — the promise `takeOverDrive` makes, broken.
     */
    const awaitLetGo = (id: TrakId): Effect.Effect<void, StoreFailed> =>
      watch === undefined
        ? Effect.void
        : Effect.scoped(
            Effect.gen(function* () {
              if ((yield* heldElsewhere(id)) === undefined) return
              const news = yield* PubSub.subscribe(moved)
              yield* watch.wake(id)
              while ((yield* heldElsewhere(id)) !== undefined) {
                yield* Effect.raceFirst(
                  Effect.repeat(Queue.take(news), { until: (m) => m === id }),
                  Effect.sleep(LET_GO_POLL),
                )
              }
            }),
          )

    return { elsewhere, heldThere, leaseMoved, awaitLetGo }
  })
