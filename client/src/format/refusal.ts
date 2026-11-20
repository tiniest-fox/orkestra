/**
 * What a refusal means, in one sentence a person can act on.
 *
 * **One switch, because two surfaces show refusals now.** The New Trak drawer draws a
 * strip when a trak is not started; the plan gate draws a line in the
 * card's body when an approval does not land. Two copies of *which refusal reads how*
 * is the drift `format/tone.ts` exists to prevent one directory over — a wire union
 * projected twice comes back as two vocabularies.
 *
 * **Exhaustive, so a refusal the engine grows is a compile error here** rather than a
 * sentence that quietly reads as "something went wrong". That is `client-style`'s
 * checklist item 1, and this is the union it bites hardest on: a refusal exists precisely
 * because the engine had something specific to say.
 *
 * The sentence only — `Dirty` carries the files it is refusing over and this does not
 * name them, because how many of them fit is a question about the surface drawing it.
 *
 * **A sentence here has to be true wherever the refusal can be earned.** Three routes answer
 * `Dirty`: merging a finished trak, because a merge lands on the host's own tree, and the
 * git bar's pull and reconcile, which move that same tree. So the sentence says what is
 * wrong and leaves *which press to try again* to the button beside it.
 */

import type { RefusalDto } from "../api/types"

export const refusalSaid = (refusal: RefusalDto): string => {
  switch (refusal._tag) {
    case "Dirty":
      return "There is uncommitted work in the tree this would touch. Commit or stash it, then try again."
    case "Driving":
      return "Something is already driving this."
    case "NotParked":
      return "Nothing is being asked here, so there is nothing to answer."
    case "NotFinished":
      return "That trak has not finished."
    case "AtRest":
      return "That trak has already come to rest."
    case "NotAtRest":
      return "That trak is still going."
    // The engine's sentence: it names the pull request and carries git's own account.
    case "BranchNotMoved":
      return `Not re-entered: ${refusal.why}`
    case "NotWaiting":
      return "Nothing is holding that trak, so there is no wait to skip."
    case "NoFailedEffect":
      return "That trak is not stopped on a failed effect, so there is nothing to skip."
    // Deliberately about what is *running* rather than about the position: this is also
    // what a stop, or a filing asked mid-turn, pressed in the instant before the turn is
    // recorded earns, where the screen says an agent is working and the answer is to
    // press again. See the wire contract's own note.
    case "NothingToStop":
      return "Nothing is running here to interrupt."
    case "OnManual":
      return "This trak is on manual, which already stands at every gate."
    case "Archived":
      return "That trak has been archived, so there is no pull request left to merge."
    case "ChildTrak":
      return "A child lands in its parent’s checkout, so it has no pull request to merge."
    case "GoalForbidsAutoMerge":
      return "This trak’s goal does not allow auto-merge."
    // The engine's own sentence, the one the composer is re-asked with when its plan
    // breaks the same rule — it names the step and the rule, which no word here could.
    case "PlanRefused":
      return `That plan can't run as edited: ${refusal.reason}.`
    case "ProposalMoved":
      return "The composer has answered again since these edits were made. Look at the plan that is there now."
    case "DetachedHead":
      return "The checkout is on no branch, so there is nothing to pull into or push from."
    case "NoOrigin":
      return "This repository has no remote named origin."
    case "NoUpstream":
      return "This branch tracks no remote branch, so there is nothing to pull."
    case "Diverged":
      return "This branch and its upstream have both moved on. Pull only fast-forwards, so reconcile instead."
    case "Behind":
      return "The upstream has commits this branch lacks, so a push would be rejected. Pull first."
    case "ToolNotOpen":
      return "That view asked for a tool its server does not open to views."
    // The same words the view's own card draws under it — one sentence for one fact.
    case "NoCheckout":
      return "This trak’s checkout is removed. The view shows its last result and its buttons send nothing."
    case "CliNotStarted":
      return `${refusal.cli} did not start, so your press was not sent. Press again to retry.`
    case "ToolCallFailed":
      return `The tool call failed: ${refusal.reason}`
    // The engine's own sentence: it names the owner, which no word here could.
    case "NotOwner":
      return refusal.reason
    // The engine's own sentence: it names the limit the file broke.
    case "AttachmentRefused":
      return refusal.reason
    case "Conflict":
      return "Merging the upstream would conflict, so nothing was merged."
    // There is no pull request, GitHub could not be asked, or GitHub's own refusal.
    case "PullNotMerged":
      return `The pull request was not merged: ${refusal.why.replace(/\.$/, "")}.`
    case "SubgoalsLive":
      return `These sub-goals are still going: ${refusal.subgoals}. Finish or drop each first.`
    case "GoalBranchRefused":
      return `Nothing was recorded: ${refusal.reason}`
    // The count and not the paths: the press's line has room for one short sentence.
    case "SubgoalConflicted":
      return `Conflicts with ${refusal.into} in ${String(refusal.paths.length)} ${refusal.paths.length === 1 ? "file" : "files"}`
  }
}
