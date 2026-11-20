// The randomness boundary: `Math.random` and `randomUUID` are allowed here and
// nowhere below. Tests take determinism by providing a different Layer, which is
// what `Ids` is a port for — seeding the draw would be a knob nothing needs.

import { randomUUID } from "node:crypto"
import { Effect, Layer } from "effect"
import { SessionId } from "../../agent/types/session.js"
import { Vcs, type VcsShape } from "../../vcs/ports/vcs.js"
import type { GitFailed } from "../../vcs/types/errors.js"
import { phraseFrom } from "../domain/phrase.js"
import { TrakId } from "../domain/trak.js"
import { Ids, type IdsShape } from "../ports/ids.js"
import { Store, type StoreShape } from "../ports/store.js"
import type { StoreFailed } from "../ports/store-errors.js"

/**
 * How many names to try before giving up and calling it a bug.
 *
 * There are 15 million of them and a checkout holds tens of traks, so a hundred
 * consecutive collisions is not bad luck — it is a draw that has stopped being
 * random, or a taken-check answering yes to everything. Dying is right for both:
 * the alternative is a route that hangs while spawning a git process per turn of
 * a loop that will never end.
 */
const ATTEMPTS = 100

/**
 * A name nothing holds.
 *
 * **Taken means the store knows it *or* git has a branch under it, and both
 * halves are load-bearing.** Wiping a trak removes its event log and touches
 * neither the branch nor the recorded base ref, so a branch with no records
 * behind it is one request away — and that is the silent case, a new trak
 * adopting a dead one's commits and measuring its work against that trak's fork
 * point. The store alone would not see it.
 *
 * `drawn` is the third half, and it is the one nothing outside this process can
 * supply: a spawn mints an id per child in a single command and writes none of
 * them until the events are appended, so four children checked against the store
 * alone can all be handed the same name with every check passing.
 */
const mint = (
  draw: () => string,
  drawn: Set<string>,
  store: StoreShape,
  vcs: VcsShape,
): Effect.Effect<TrakId, StoreFailed | GitFailed> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const name = draw()
      if (drawn.has(name)) continue
      const known = yield* store.list()
      if (known.some((id) => id === name)) continue
      if (yield* vcs.hasBranch(name)) continue
      drawn.add(name)
      return TrakId.make(name)
    }
    return yield* Effect.die(`no free trak name in ${ATTEMPTS} draws`)
  })

/**
 * Ids, with the draw handed in — the seam a test uses to make a collision happen
 * on purpose, which random words otherwise never will.
 *
 * The taken-check is a dependency of the *layer* rather than an argument at the
 * call site, so the redraw is written once and every caller of `newTrakId` is
 * unchanged. Both dependencies are already wired everywhere this is.
 */
export const phraseIds = (draw: () => string): Layer.Layer<Ids, never, Store | Vcs> =>
  Layer.effect(
    Ids,
    Effect.gen(function* () {
      const store = yield* Store
      const vcs = yield* Vcs
      const drawn = new Set<string>()
      // One at a time, so `drawn` cannot be read by a second mint in the window
      // between this one checking the name and claiming it. A spawn's `forEach`
      // is sequential today and this does not depend on it staying that way —
      // the failure a concurrent draw would produce is two traks on one branch,
      // and it would be silent.
      const once = yield* Effect.makeSemaphore(1)
      return {
        newSessionId: Effect.sync(() => SessionId.make(randomUUID())),
        newTrakId: once.withPermits(1)(mint(draw, drawn, store, vcs)),
        newExecId: Effect.sync(() => randomUUID()),
      } satisfies IdsShape
    }),
  )

/** Three words for a trak, a v4 UUID for a session. */
export const PhraseIdsLayer = phraseIds(() => phraseFrom(Math.random))
