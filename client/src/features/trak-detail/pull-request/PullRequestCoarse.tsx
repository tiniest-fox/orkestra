/**
 * The card's three sections drawn from the traks list's answer alone — every verdict, and
 * none of the rows under two of them.
 *
 * **The whole point is that nothing here moves when the detail lands.** Checks and Review
 * hold the space their rows are coming into, in the shape of the row: a tick box and a name
 * for a check, a bordered block for a conversation. The verdicts above them are rewritten —
 * *Some checks are failing* becomes *2 failing of 5* — and that was weighed and accepted,
 * because splitting every headline so the coarse word stayed put was a larger change to all
 * three sections than it was worth.
 *
 * **Exactly one placeholder row per waiting section**, and it is a choice rather than a
 * count derived from the verdict: nothing here knows how many checks are coming, so a
 * guessed number would be the card correcting itself out loud. One is the smallest claim
 * that still holds a shape.
 *
 * **Merging draws no placeholder at all** — it reads three fields this answer already
 * carries, so it is finished the moment the card appears. `PullRequestMerging` carries that
 * argument; the asymmetry is deliberate and it is on screen.
 */

import type { ReactNode } from "react"
import type { PullRequestSummaryDto } from "../../../api/types"
import Skeleton from "../../../components/Skeleton"
import PullRequestMerging from "./PullRequestMerging"
import PullRequestSection from "./PullRequestSection"
import { coarseChecks, reviewHeadline } from "./pullRequest"
import type { Picked } from "./picks/reentryBody"

const PullRequestCoarse = ({
  pull,
  picked,
  onToggle,
}: {
  readonly pull: PullRequestSummaryDto
  readonly picked: readonly Picked[]
  /** Absent where the state offers no more work, which draws the rows with no ticks. */
  readonly onToggle: ((picked: Picked) => void) | undefined
}): ReactNode => (
  <>
    <PullRequestSection heading="Checks" verdict={coarseChecks(pull.checks)} withheld>
      <Skeleton shape="checks" count={1} pulse />
    </PullRequestSection>
    {/* Nothing to count in hand, so no unanswered count rides on the decision — which is
        exactly what `reviewHeadline` says of `0`, rather than a second wording. */}
    <PullRequestSection heading="Review" verdict={reviewHeadline(pull.decision, 0)} withheld>
      <Skeleton shape="threads" count={1} pulse />
    </PullRequestSection>
    <PullRequestMerging pull={pull} picked={picked} onToggle={onToggle} withheld />
  </>
)

export default PullRequestCoarse
