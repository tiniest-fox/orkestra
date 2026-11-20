/**
 * The plan gate's presses while the plan is editable: the reset, and Approve carrying
 * the number of edits it will send. Why the last press did not land is drawn by the card,
 * in its body — the engine's sentence names a step and a rule, and a head that also holds
 * two presses cuts it to a few words on a phone.
 *
 * **The count is on the press and nowhere else**, because on a phone the card's head is
 * already cut short beside Approve. The reset is drawn only once something differs, since
 * there is nothing to put back before then.
 *
 * `GatePresses` is the same slot at every other gate. This is its plan-gate shape rather
 * than a branch in it, because the press here sends what the card holds and only the card
 * holds it.
 */

import type { ReactNode } from "react"
import { Check, RotateCcw } from "lucide-react"
import Button from "../../../../components/Button"
import type { Approval } from "../../useApprove"

const PlanPresses = ({
  approval,
  count,
  onReset,
  onApprove,
}: {
  readonly approval: Approval
  /** How many edits the press will send. */
  readonly count: number
  readonly onReset: () => void
  readonly onApprove: () => void
}): ReactNode => (
  <>
    {count === 0 ? undefined : (
      <Button
        variant="ghost"
        size="sm"
        icon={RotateCcw}
        aria-label="Reset to proposed"
        title="Reset to proposed"
        disabled={approval.isPending}
        onClick={onReset}
      />
    )}
    <Button
      size="sm"
      icon={Check}
      busy={approval.isPending}
      disabled={approval.disabled}
      onClick={onApprove}
    >
      {count === 0 ? "Approve" : `Approve · ${String(count)}`}
    </Button>
  </>
)

export default PlanPresses
