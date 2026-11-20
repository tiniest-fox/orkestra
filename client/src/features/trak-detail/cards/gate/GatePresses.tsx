/**
 * The gate's presses, in the header of the card holding what is being decided about:
 * take what is on the table, and send the composer your words from here.
 *
 * **Two gates, one approval.** The composer's plan and a step's filed work are both taken
 * with `Approve` on the same route, and they are two states carrying two step indices — so
 * which of them is on offer is asked twice, exhaustively, in `controls.ts`, and never
 * widened into one switch over both. A control drawn one state too wide ends the trak
 * instead of being refused.
 *
 * **Recompose is welded to Approve where both are offered, and the weld is the point.** At
 * a gate with a document on the table, recomposing commits this step's work before the
 * composer runs — pressing it *is* approving, and then some. A separate press beside
 * Approve reading only *Recompose* would say the work is being left behind, which it is
 * not. So the two share one plate: the radius flattened where they meet, one hairline
 * between, the second half quiet, and a `+` for its glyph.
 *
 * **The plan gate is the one card that draws Approve without a recompose**, because a
 * `Replan` there is refused — `Chat` already talks to the composer. Every step gate with
 * nothing filed keeps its presses beside the chat bar rather than on its card, so the
 * recompose-alone shape below is drawn for none of them; it stays as the honest rendering
 * of a slot given a recompose and no approval, which the page never builds.
 *
 * **The weld is drawn by hand, and `components/` has no primitive for it.** `rounded-r-none`
 * and `rounded-l-none` are written out rather than composed — `Button` sets
 * `rounded-control` in its own size table, and a later utility of the same specificity
 * wins on source order. `components/README` carries whether a two-target group becomes a
 * primitive; until it does, this is the one place it is drawn.
 *
 * It is placed by `DrawerPane` into the card holding whatever is being approved, which is
 * where a gate's presses go.
 */

import type { ReactNode } from "react"
import { Check, Plus, Route } from "lucide-react"
import Button from "../../../../components/Button"
import type { Approval } from "../../useApprove"
import type { Recomposing } from "../../chat-bar/useRecompose"

/** The refusal the last press earned, beside the presses rather than over the document. */
const Said = ({ said }: { readonly said: string | undefined }): ReactNode =>
  said === undefined ? undefined : (
    <span role="alert" className="min-w-0 truncate text-sm text-tone-bad">
      {said}
    </span>
  )

const GatePresses = ({
  approval,
  recomposing,
}: {
  /** The approval, where the gate has something to take. `undefined` at the three that do not. */
  readonly approval?: Approval
  /** The recompose, where it is drawn here rather than beside the bar. */
  readonly recomposing?: Recomposing
}): ReactNode => (
  <>
    {/* What is on screen is still true, and a person who reads why it did not land presses
        the same button again. */}
    <Said said={approval?.said} />
    {approval !== undefined && recomposing !== undefined ? (
      <span className="flex shrink-0 [&>*:first-child]:rounded-r-none [&>*:last-child]:rounded-l-none [&>*:last-child]:border-l-0">
        <Button
          size="sm"
          icon={Check}
          busy={approval.isPending}
          disabled={approval.disabled}
          onClick={approval.approve}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="quiet"
          icon={Plus}
          disabled={recomposing.asking}
          onClick={recomposing.open}
        >
          Recompose
        </Button>
      </span>
    ) : approval !== undefined ? (
      /* `busy` makes it non-submittable while the drive is starting rather than merely
         spinning; `disabled` covers somebody else already driving. */
      <Button
        size="sm"
        icon={Check}
        busy={approval.isPending}
        disabled={approval.disabled}
        onClick={approval.approve}
      >
        Approve
      </Button>
    ) : recomposing !== undefined ? (
      <Button
        size="sm"
        variant="quiet"
        icon={Route}
        disabled={recomposing.asking}
        onClick={recomposing.open}
      >
        Recompose
      </Button>
    ) : undefined}
  </>
)

export default GatePresses
