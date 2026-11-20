/**
 * One word for what is waiting on a person, or `undefined` where nothing is.
 *
 * **It names a destination, not an action — except `Archive`.** The row renders every
 * other word as a link into the trak, and nothing on this list spends. So this is allowed
 * to say `Review` where the button it leads to says `Approve`: one is what you are going
 * there to do, the other is the control you press when you have. `Archive` asks for its
 * confirmation on the row itself (`RowArchive`).
 *
 * The trak's own state stays the authority on what it actually offers, and this is not a
 * second copy of it: it answers a different question with a different return type, and
 * a disagreement between them costs a link that lands on a page with nothing to press
 * rather than an action the engine refuses. Both switch on `state` and only on `state`
 * — never on `lastGate`, which is the engine's memory of a gate a trak may have left.
 *
 * Exhaustive, so a state the server grows is a compile error here too.
 */

import type { TrakStateDto } from "../../api/types"

/**
 * The six asks inside `AwaitingHuman`, in the words of what you go there to do.
 * `Decide` covers checks and stuck because both put a judgement in front of a
 * person rather than a document — take it anyway, skip, or ask for another plan.
 */
const gateAction = (kind: Extract<TrakStateDto, { _tag: "AwaitingHuman" }>["kind"]): string => {
  switch (kind) {
    case "approval":
      return "Review"
    case "answers":
      return "Answer"
    case "conversation":
      return "Reply"
    case "permission":
      return "Allow"
    case "checks":
    case "stuck":
      return "Decide"
  }
}

export const rowAction = (state: TrakStateDto): string | undefined => {
  switch (state._tag) {
    case "AwaitingProposal":
      return "Approve"
    case "AwaitingComposerAnswers":
      return "Answer"
    case "AwaitingHuman":
      return gateAction(state.kind)
    // `Archive`, whatever the status beside it reads — "Ready to merge" on a branch
    // with no pull request, "Finished — nothing to merge" on one nothing was committed
    // to, and the forge's own answer where there is one, up to and including a row
    // filed under MERGED. One word for all seven finished piles, which is what keeps
    // this switch on `state` alone: the rung never has to reach it. Merging is not
    // offered here — it writes to whatever branch the machine is standing on, so it
    // shows the destination and asks, which the wire does not carry (see `ActionBar`
    // and `src/app/routes/merge.ts`). Putting the trak away is the one thing this list can
    // do with a finished trak, so it is the one it names — and does, behind the drawer's
    // own confirmation.
    case "Finished":
      return "Archive"
    // The destination's own word. Every failure is retryable — `Failure` in
    // `src/workflow/domain/trak.ts` — and `/resume` re-issues the command for the
    // position it stopped at.
    case "Failed":
      return "Retry"
    // Everything else is the engine's, or is over. A row with no word here shows
    // what the trak is doing instead.
    case "Preparing":
    case "Composing":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Abandoning":
    case "Merging":
    case "Closing":
    case "Closed":
    case "Merged":
    case "Abandoned":
      return undefined
  }
}
