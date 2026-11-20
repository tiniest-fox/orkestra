// Where a finished trak's merge would go, and whether it would go in: the destination's
// uncommitted files and the conflict prediction. Read by the Merge press and its preview in
// `routes/merge.ts`, and by the forge sweep's local auto-merge, so a press and the sweep
// refuse over the same files and predict the same conflict.
//
// **Re-derived here rather than shared with the runtime's**, because `app/` may not import
// it — a child's destination is its parent's checkout, which is a fact on the *parent's*
// log and nowhere else, and a goal branch's is the engine's checkout of it.

import { Effect } from "effect"
import { MergeInto } from "../vcs/index.js"
import { Vcs } from "../vcs/ports/vcs.js"
import type { Trak, TrakState } from "../workflow/domain/trak.js"
import { replayHistory } from "../workflow/domain/replay.js"
import { Store } from "../workflow/ports/store.js"

/**
 * The states a merge is on the table at: the two `mergeRoute` takes a press from —
 * `Finished`, and a merge git refused — and `Merging`, the same press watched running.
 *
 * **An exhaustive switch and not a chain of `===`**, which is the whole of what it buys
 * over the two comparisons it replaced: a state added to the ending set fails the build
 * here rather than falling silently out of the prediction. `toStateDto` is the same
 * shape for the same reason.
 */
const mergeOnTheTable = (state: TrakState): boolean => {
  switch (state._tag) {
    case "Finished":
    case "Merging":
      return true

    case "Failed":
      return state.kind === "merge"

    case "Preparing":
    case "Composing":
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "ConditionRunning":
    case "AwaitingHuman":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "Integrating":
    case "Abandoning":
    case "Closing":
    case "Closed":
    case "Merged":
    case "Abandoned":
      return false
  }
}

/**
 * Would this merge conflict? Asked only where a merge is on the table.
 *
 * **A `git` process per call, so the states are the gate.** `mergeOnTheTable` names
 * them; anywhere else the question is about a press nobody is being offered, and the
 * answer would be a process per poll per trak for nothing.
 */
export const wouldConflict = (trak: Trak) =>
  Effect.gen(function* () {
    const worktree = trak.worktree
    if (worktree === undefined) return undefined
    if (!mergeOnTheTable(trak.state)) return undefined
    const parent = trak.parent
    if (parent === undefined) {
      const into =
        trak.goal !== undefined && trak.goalBranch !== undefined
          ? MergeInto.Goal({ goal: trak.goal, branch: trak.goalBranch })
          : MergeInto.Host()
      return yield* (yield* Vcs).wouldConflict(into, worktree.branch)
    }
    const store = yield* Store
    const into = replayHistory(parent.id, yield* store.events(parent.id)).worktree
    // A parent with no checkout has nowhere for this to land, which the press
    // itself reports as `its parent has no checkout to merge into`. Nothing to
    // predict, rather than a prediction of `false`.
    if (into === undefined) return undefined
    return yield* (yield* Vcs).wouldConflict(
      MergeInto.Checkout({ worktree: into }),
      worktree.branch,
    )
  })

/**
 * The parent's checkout a child merges into, off the parent's own log — `undefined`
 * for a trak with no parent, and for a parent that never got one.
 *
 */
export const parentCheckout = (trak: Trak) =>
  Effect.gen(function* () {
    const parent = trak.parent
    if (parent === undefined) return undefined
    const store = yield* Store
    return replayHistory(parent.id, yield* store.events(parent.id)).worktree
  })

/**
 * What is uncommitted in the tree a merge would go into: the host's for a trak at the
 * top, the parent's checkout for a child, and nothing for a trak on a goal branch. A parent with no checkout has nothing to be
 * dirty, and the merge itself is what says so.
 */
export const destinationDirty = (trak: Trak) =>
  Effect.gen(function* () {
    const vcs = yield* Vcs
    // The engine's checkout of a goal branch holds nobody's edits: nothing to refuse over.
    if (trak.goalBranch !== undefined && trak.parent === undefined) return []
    if (trak.parent === undefined) return yield* vcs.dirty()
    const into = yield* parentCheckout(trak)
    return into === undefined ? [] : yield* vcs.dirty(into)
  })
