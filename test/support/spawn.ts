// What the `spawn*.test.ts` files share: a child driven and answered by hand, the way
// `app/drive.ts` drives one, and the trak read back off its log. Split across files so
// the themes run on separate workers; every flow there is on real git, so one file of
// all of them was the slowest in `test/e2e/`.

import { Effect } from "effect"
import { child, spawn } from "./flow.js"
import { approveAll } from "./scenario.js"
import { replayHistory } from "../../src/workflow/domain/replay.js"
import { slotAt, type Trak, type TrakId } from "../../src/workflow/domain/trak.js"
import { Store } from "../../src/workflow/ports/store.js"
import type { RuntimeDeps, RuntimeError } from "../../src/workflow/runtime.js"
import { advance, driveChild, landOnParent } from "../../src/workflow/runtime.js"
import { Events } from "../../src/workflow/domain/event.js"

/**
 * What happens at a parked spawn, reduced to what a flow test needs.
 *
 * The daemon runs four children at once and a human answers them one at a time;
 * here it is serial throughout, because the concurrency is `app/drive.ts`'s
 * decision and nothing about the engine's behaviour depends on it.
 */
const answerFor =
  (verdict: "merge" | "drop") =>
  (settled: Trak): Effect.Effect<void, RuntimeError, RuntimeDeps> =>
    Effect.flatMap(
      advance(settled.id, verdict === "merge" ? Events.merged() : Events.closed()),
      landOnParent,
    )

/**
 * The two things a human can say about a finished child, and the only things that
 * land one on its parent.
 *
 * A child holds at `Finished` like every other trak. *Merge* puts its branch into
 * the parent's checkout there and then; *drop* leaves the branch alone and lands
 * it with no sha. Neither is `approveAll`'s business — approving is what a gate
 * takes, and this applies to the trak.
 */
export const mergeChild = answerFor("merge")
export const dropChild = answerFor("drop")

/** Every child of the spawn at `position`, in order, driven to its end and merged. */
export const runChildren = (parent: Trak, position: number) =>
  Effect.gen(function* () {
    const store = yield* Store
    const runs = slotAt(parent, position).children
    for (const [i] of runs.entries()) {
      const started = yield* driveChild(parent, position, i)
      yield* mergeChild(yield* approveAll(started.id, started))
    }
    return replayHistory(parent.id, yield* store.events(parent.id))
  })

/** The trak as it stands now, without acting on it. */
export const current = (id: TrakId) =>
  Effect.gen(function* () {
    const store = yield* Store
    return replayHistory(id, yield* store.events(id))
  })

/** Two lenses on one change, each a `review`: the spawn most themes run. */
export const lenses = spawn(child("review", "security"), child("review", "performance"))
