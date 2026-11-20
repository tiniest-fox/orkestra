// A memory store that records which trak each read was of, for the cases whose
// subject is a file *not* being opened: the sweep past a put-away trak, the detail
// answered off memory. What is counted is the port's two read methods, so a read the
// publishing decorator makes to seed its cursor counts as much as one a route makes.

import { Effect, Layer } from "effect"
import { MemoryStoreLayer } from "../../src/workflow/adapters/store-memory.js"
import type { TrakId } from "../../src/workflow/domain/trak.js"
import { Store, type StoreShape } from "../../src/workflow/ports/store.js"
import type { StoreFailed } from "../../src/workflow/ports/store-errors.js"

/** Which trak each read was of, in order, per file. */
export interface Reads {
  readonly events: TrakId[]
  readonly transcript: TrakId[]
}

export const noReads = (): Reads => ({ events: [], transcript: [] })

export const countingStore = (reads: Reads): Layer.Layer<Store, StoreFailed> =>
  Layer.effect(
    Store,
    Effect.map(
      Store,
      (inner): StoreShape => ({
        ...inner,
        events: (id) =>
          Effect.tap(inner.events(id), () => Effect.sync(() => reads.events.push(id))),
        transcript: (id) =>
          Effect.tap(inner.transcript(id), () => Effect.sync(() => reads.transcript.push(id))),
      }),
    ),
  ).pipe(Layer.provide(MemoryStoreLayer))

/** How many times one trak's file has been opened. */
export const timesRead = (reads: readonly TrakId[], id: TrakId): number =>
  reads.filter((read) => read === id).length
