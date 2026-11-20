// Re-entry after a merge: a `Finished` trak's pull request may have gone in while it
// rested, and with a squash merge its commits are in no history of the base. Work added
// on the branch as it stands would carry them into the next pull request, so before a
// re-entry runs anything the branch is moved onto the base — or the re-entry is refused.
//
// Asked on the drive, under the trak's key, by `Drives.reenter` — which both doors that
// re-enter a finished trak on a person's or a goal's word go through: the re-enter route
// and a goal's message. The forge's own send-back needs none of it, since
// it answers a pull request that is still open.

import { Effect, Either } from "effect"
import { Forge } from "../vcs/ports/forge.js"
import { Vcs } from "../vcs/ports/vcs.js"
import { BranchMove, BranchName, CommitSha } from "../vcs/index.js"
import type { BranchMoved } from "../workflow/domain/event.js"
import type { Trak } from "../workflow/domain/trak.js"

/**
 * What re-entering `trak` may go ahead with: the move to record on `Reentered`, nothing
 * where no move was owed, or the sentence a refusal carries — nothing appended, and the
 * branch where it was.
 *
 * **A forge that cannot be asked refuses**, never lets the re-entry through unchecked:
 * going ahead on a branch that may hold merged commits is the fault this exists to stop.
 * A project with no `origin` has no pull request to have merged, so it goes ahead.
 */
export const moveIfMerged = Effect.fn("moveIfMerged")(function* (trak: Trak) {
  const worktree = trak.worktree
  if (trak.state._tag !== "Finished" || worktree === undefined) return goAhead(undefined)
  const branch = worktree.branch
  const listing = yield* (yield* Forge).listing([branch])
  if (listing._tag === "NoOrigin") return goAhead(undefined)
  if (listing._tag === "Unavailable") {
    return refused(
      `could not ask the forge whether ${branch}'s pull request has merged: ${listing.why}`,
    )
  }
  // A missing entry read as no pull request, as `askMerged` reads it: one branch asked is
  // never past the listing's bound, which is the only reason an adapter leaves one out.
  const pull = listing.entries.find((e) => e.branch === branch)?.pull
  if (pull === undefined || pull.state !== "merged") return goAhead(undefined)
  const called = `pull request #${String(pull.number)}`
  if (pull.head === undefined || pull.base === undefined) {
    return refused(`${called} merged, and the forge does not say its head and base`)
  }
  const merged = CommitSha.make(pull.head)
  const base = pull.base
  const stopped = (why: string) =>
    refused(`${called} merged, and moving ${branch} onto origin/${base} stopped: ${why}`)
  const tried = yield* Effect.either(
    (yield* Vcs).moveOntoBase(worktree, merged, BranchName.make(base)),
  )
  if (Either.isLeft(tried)) return stopped(tried.left.reason)
  return BranchMove.$match(tried.right, {
    Moved: ({ onto }) => goAhead({ merged, base, onto }),
    Unmoved: () => goAhead(undefined),
    Refused: ({ why }) => stopped(why),
  })
})

/** Re-entry may go ahead, recording this move where there was one. */
const goAhead = (moved: BranchMoved | undefined): Either.Either<BranchMoved | undefined, string> =>
  Either.right(moved)

/** Re-entry is refused, and this is why. */
const refused = (why: string): Either.Either<BranchMoved | undefined, string> => Either.left(why)
