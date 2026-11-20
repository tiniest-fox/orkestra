// The idle memory: per live trak, when something last happened to it, whether its log lets
// it go idle, and the list row last built from that log.
//
// Nothing durable, for `archive-memory.ts`'s reason — every fact here is derived from the
// log, and a restart derives it again. A put-away trak holds no entry: `Archive` already
// keeps its log shut, and a row nobody draws is not worth the memory.

import type { TrakSummaryDto } from "@orkestra/shared/dto/trak"
import { Effect, HashMap, Layer, Option, Ref } from "effect"
import { activeAt, leftSince, mayIdle } from "../domain/activity.js"
import { archived, type TrakId } from "../domain/trak.js"
import { Idle } from "../ports/idle.js"

/** What is known of one trak, as of the log at `length` events. */
interface Known {
  readonly length: number
  readonly active: number | undefined
  readonly mayIdle: boolean
  readonly row: TrakSummaryDto | undefined
}

const idleNow = (known: Known, now: number): boolean =>
  known.mayIdle && leftSince(known.active, now)

export const MemoryIdleLayer = Layer.effect(
  Idle,
  Effect.gen(function* () {
    const known = yield* Ref.make(HashMap.empty<TrakId, Known>())
    const entry = (id: TrakId) =>
      Effect.map(Ref.get(known), (all) => Option.getOrUndefined(HashMap.get(all, id)))

    return Idle.of({
      idleAt: (id, now) => Effect.map(entry(id), (k) => k !== undefined && idleNow(k, now)),
      rowAt: (id, now) =>
        // Idle set here rather than kept: a row built two days in is served on the third.
        Effect.map(entry(id), (k) =>
          k?.row !== undefined && idleNow(k, now) ? { ...k.row, idle: true } : undefined,
        ),
      classify: (trak, history) =>
        Ref.update(known, (all) =>
          archived(trak.state)
            ? HashMap.remove(all, trak.id)
            : HashMap.set(all, trak.id, {
                length: history.length,
                active: activeAt(history),
                mayIdle: mayIdle(trak),
                row: undefined,
              }),
        ),
      keep: (id, length, row) =>
        Ref.update(known, (all) =>
          HashMap.modify(all, id, (k) => (k.length === length ? { ...k, row } : k)),
        ),
      forget: (id) => Ref.update(known, (all) => HashMap.remove(all, id)),
    })
  }),
)
