import type { TrakSummaryDto } from "@orkestra/shared/dto/trak"
import { Context, type Effect } from "effect"
import type { Event } from "../domain/event.js"
import type { Trak, TrakId } from "../domain/trak.js"

/**
 * What the engine knows of each live trak without opening its log: when something last
 * happened to it, whether the log lets it go idle (`mayIdle`), and the list row last
 * built from that log — so a list read and the condition sweep can leave an idle trak's
 * log shut.
 *
 * **Idle is asked against the clock, not classified.** Three days pass with no append, so
 * nothing could move a trak into an idle set; what is kept is the time, and `idleAt`
 * compares it with the `now` it is handed. Whether anything drives the trak is the
 * caller's to ask first, from `Drives`: a trak something drives is never idle.
 *
 * **An append forgets the trak**, from the publishing store or the store watch, so the
 * first read after one reads the log and classifies it again — under the log permit, as
 * `Archive` is, by `src/app/archive.ts`. A row is kept only against the log length it was
 * classified at, so a row built from a read an append has overtaken is dropped rather
 * than served. A daemon restart forgets it all, and the first sweep fills it again.
 */
export interface IdleShape {
  /** Whether the trak is idle at `now`. `false` for one nothing has classified since its last append. */
  readonly idleAt: (id: TrakId, now: number) => Effect.Effect<boolean>
  /** The row kept for the trak, where it is idle at `now` and one was kept. */
  readonly rowAt: (id: TrakId, now: number) => Effect.Effect<TrakSummaryDto | undefined>
  /** Classify the trak from its whole log, and drop any row kept from an older one. */
  readonly classify: (trak: Trak, history: readonly Event[]) => Effect.Effect<void>
  /** Keep `row`, built from the log at `length` events, unless the log has moved since. */
  readonly keep: (id: TrakId, length: number, row: TrakSummaryDto) => Effect.Effect<void>
  /** The trak's log has moved, or the trak is gone: nothing is known of it until it is read. */
  readonly forget: (id: TrakId) => Effect.Effect<void>
}

export class Idle extends Context.Tag("workflow/Idle")<Idle, IdleShape>() {}
