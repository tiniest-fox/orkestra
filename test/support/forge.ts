// A `Forge` that says one thing.
//
// Unlike the agent and the checks, there is nothing here to match a request
// against: the port takes a branch, and a flow test's branch is derived from a
// generated trak id — so keying a script on it would only be re-deriving `vcs/`'s
// naming inside a fake. One answer per run is what every case actually wants.
//
// Whether the real adapter reaches `gh` once or three times for one request is
// not asked here. That is a fact about the adapter, and it is asserted where the
// adapter is real and the `Process` is the fake.

import { Effect, Layer } from "effect"
import { Forge, type ForgeShape } from "../../src/vcs/ports/forge.js"
import { ForgeAnswer, ForgeListing, ForgeMerge, ForgeOpen } from "../../src/vcs/index.js"

/** A forge that merges nothing — every fake whose case is not about the merge. */
export const refusesMerge: ForgeShape["merge"] = () =>
  Effect.succeed(ForgeMerge.Refused({ why: "this fake merges nothing" }))

/** A forge that opens nothing — every fake whose case is not about a goal's pull request. */
export const refusesOpen: ForgeShape["openPullRequest"] = () =>
  Effect.succeed(ForgeOpen.Refused({ why: "this fake opens nothing" }))

/**
 * `listing` defaults to an answer with no entries rather than to the same fact as
 * `answer`: the two are different questions and a fake that derived one from the other
 * would answer *there is a pull request on every branch* the moment a case set one. A
 * case about the listing passes its own.
 *
 * It ignores the branches it is handed, for the reason above: a fake that built entries
 * from the question would be re-deriving the adapter's own rule inside a fake, and every
 * case that cares says what it wants back.
 */
export const forgeSaying = (
  answer: ForgeAnswer,
  listing: ForgeListing = ForgeListing.Listed({ entries: [] }),
): Layer.Layer<Forge> =>
  Layer.succeed(Forge, {
    pullRequest: () => Effect.succeed(answer),
    listing: () => Effect.succeed(listing),
    merge: refusesMerge,
    openPullRequest: refusesOpen,
  } satisfies ForgeShape)

/** What every flow that is not about a pull request should see. */
export const noPullRequest: Layer.Layer<Forge> = forgeSaying(ForgeAnswer.None())
