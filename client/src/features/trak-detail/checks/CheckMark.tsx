/**
 * One check's verdict as a glyph, in the verdict's own tone.
 *
 * `aria-hidden`, because the word is beside it on every row it appears on — `verdictWord`
 * is what a reader actually reads, and `tone-good` and `tone-neutral` are hard to tell
 * apart at this size.
 *
 * **Skipped is a thin minus in subtle ink, not a mark.** A skipped check is the least
 * interesting thing in the grid, and a glyph with the weight of the others made a run of
 * them read as five things wrong. All five verdicts still draw as themselves; `unknown` is a
 * real answer rather than a gap.
 */

import type { ReactNode } from "react"
import { CircleCheck, CircleHelp, CircleX, LoaderCircle, Minus } from "lucide-react"
import type { PullRequestCheckDto } from "../../../api/types"
import { toneInk } from "../../../format/tone"
import { verdictTone } from "../pull-request/pullRequest"

/** `Record` over the union rather than a lookup with a fallback: a sixth verdict on the
 *  wire is then a type error here instead of a glyph nobody chose. */
const ICON: Record<PullRequestCheckDto["verdict"], typeof CircleCheck> = {
  passed: CircleCheck,
  failed: CircleX,
  running: LoaderCircle,
  skipped: Minus,
  unknown: CircleHelp,
}

const CheckMark = ({
  verdict,
}: {
  readonly verdict: PullRequestCheckDto["verdict"]
}): ReactNode => {
  const Icon = ICON[verdict]
  return (
    <Icon
      size={13}
      aria-hidden
      className={`mt-0.5 shrink-0 ${
        verdict === "skipped" ? "text-fg-subtle/60" : toneInk[verdictTone(verdict)]
      } ${verdict === "running" ? "animate-spin" : ""}`}
    />
  )
}

export default CheckMark
