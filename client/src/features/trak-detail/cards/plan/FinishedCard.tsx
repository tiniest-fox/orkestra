/**
 * The composer's finish, drawn as the plan it is — where it hands work off.
 *
 * A finish that opens traks on the main line takes the plan gate a proposal takes, and
 * the person asked for one screen for both: *they are both plans*. So this is
 * `ProposalCard`'s shell with no steps in it — the same head shape, the same presses in
 * the same slot, the same band when nobody stood there — and what a plan with nothing to
 * run says in place of a step count is `The work is done`. The composer's reason for
 * finishing goes where a proposal's rationale goes, because that is the card's own line
 * for the composer's account of the plan.
 *
 * Drawn only for a finish carrying a hand-off or a goal. A plain finish is a sentence and
 * takes no gate, and `ComposerOutputView` keeps drawing it as one.
 *
 * **The head is cut at a phone's measure** — `The work is do…` beside the presses at 358
 * — which the round measured and accepted: what is lost is the head's words, never the
 * press, and the count survives on the block's own label.
 */

import type { ReactNode } from "react"
import { GitBranch } from "lucide-react"
import type { ComposerOutputDto, MarkDto } from "../../../../api/types"
import CardShell from "../CardShell"
import HandOffs from "./HandOffs"
import ProposedGoal from "./ProposedGoal"
import HeldBand from "../gate/HeldBand"
import UnattendedBand from "../gate/UnattendedBand"
import { handOffCount, type HandOffBase } from "./handOff"

type Finished = Extract<ComposerOutputDto, { type: "finished" }>

const FinishedCard = ({
  finished,
  actions,
  atGate,
  handOffBase,
  opened,
  goalOpened,
}: {
  readonly finished: Finished
  readonly actions?: ReactNode
  /** What happened at this plan's gate — `ProposalCard`'s argument. */
  readonly atGate: MarkDto | undefined
  /** The branch the hand-offs would be cut from while the gate is open, or the goal they go to. */
  readonly handOffBase: HandOffBase
  /** The traks they were opened as, once the gate went past. */
  readonly opened: readonly string[] | undefined
  /** The goal its proposal started as, once the trak finished. */
  readonly goalOpened: string | undefined
}): ReactNode => {
  const texts = finished.handOff ?? []
  const after = [
    ...(texts.length === 0 ? [] : [handOffCount(texts.length, handOffBase)]),
    ...(finished.goal === undefined ? [] : ["a new goal"]),
  ]
  return (
    <CardShell
      icon={GitBranch}
      head={["The work is done", ...after].join(" · ")}
      actions={actions}
      band={
        atGate === undefined ? undefined : atGate._tag === "Held" ? (
          <HeldBand />
        ) : (
          <UnattendedBand why={atGate} />
        )
      }
    >
      <p className="whitespace-pre-wrap text-base leading-5 text-fg-muted">{finished.reason}</p>
      <HandOffs texts={texts} base={handOffBase} opened={opened} />
      {finished.goal !== undefined && <ProposedGoal text={finished.goal} opened={goalOpened} />}
    </CardShell>
  )
}

export default FinishedCard
