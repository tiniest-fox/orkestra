// The archived set, in memory: which traks are put away, whether each has a parent, and
// what each is called.
//
// Nothing durable, on purpose — the log is the only durable thing, and this is a fact
// derived from it that a restart derives again. What is held per trak is a boolean and a
// title, so a repository of thousands of archived traks costs a map of thousands of short
// strings rather than a projection of each.

import { Effect, HashMap, Layer, Ref } from "effect"
import { archived, type Trak, type TrakId } from "../domain/trak.js"
import { Archive, type ArchivedTrak } from "../ports/archive.js"

/** What is kept of one put-away trak. */
interface Held {
  /** Whether it has no parent — the ones the count is of. */
  readonly parentless: boolean
  readonly title: string
}

export const MemoryArchiveLayer = Layer.effect(
  Archive,
  Effect.gen(function* () {
    const held = yield* Ref.make(HashMap.empty<TrakId, Held>())

    const holds = (id: TrakId): Effect.Effect<boolean> =>
      Effect.map(Ref.get(held), (all) => HashMap.has(all, id))

    const count: Effect.Effect<number> = Effect.map(Ref.get(held), (all) =>
      HashMap.reduce(all, 0, (n, trak) => (trak.parentless ? n + 1 : n)),
    )

    const matching = (text: string, limit: number): Effect.Effect<readonly ArchivedTrak[]> =>
      Effect.map(Ref.get(held), (all) => {
        const needle = text.toLowerCase()
        const found: ArchivedTrak[] = []
        for (const [id, trak] of all) {
          if (trak.title.toLowerCase().includes(needle) || id.toLowerCase().includes(needle))
            found.push({ id, title: trak.title })
        }
        return found.sort((a, b) => a.title.localeCompare(b.title)).slice(0, limit)
      })

    // The title a list row would draw: the plan's, and the request until there is one.
    const classify = (trak: Trak): Effect.Effect<void> =>
      Ref.update(held, (all) =>
        archived(trak.state)
          ? HashMap.set(all, trak.id, {
              parentless: trak.parent === undefined,
              title: trak.plan?.title ?? trak.description,
            })
          : HashMap.remove(all, trak.id),
      )

    const forget = (id: TrakId): Effect.Effect<void> =>
      Ref.update(held, (all) => HashMap.remove(all, id))

    return { holds, count, matching, classify, forget }
  }),
)
