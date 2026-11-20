/**
 * The one per-turn figure the transcript carries: what a turn a person cut short had
 * spent when they cut it.
 *
 * **A cut turn and no other.** A figure on every turn teaches a reader to skip the
 * column, and then the one worth seeing is skipped with it; a turn that filed has its
 * spend in the chat bar's spend row. So most transcripts carry no stamp at all, and that is the
 * answer rather than a gap.
 *
 * **It says why it is there, and which press it was.** A bare figure on one turn and not
 * its neighbour is legible only to a reader who already knows the rule, and nobody reading
 * a transcript does. The two cuts wear the words and the glyph the rest of the pane already
 * uses for them: the stop's octagon in the waiting tone, and for a filing the same
 * *Asked to file* and package mark `WhyRan` heads the next turn with — a stamp calling it
 * a stop would be the surface naming one press as the other.
 *
 * A foot on the turn rather than a row of it — anchored right, in the transcript's own
 * mono — and inside the turn's own list so it takes the pane's one gap from the row above.
 */

import type { ReactNode } from "react"
import { Octagon, PackageCheck } from "lucide-react"
import { type Spend, tokens, total, type TurnSpend } from "./usage"

const TurnSpent = ({
  spend,
  cut,
}: {
  readonly spend: Spend
  readonly cut: NonNullable<TurnSpend["cut"]>
}): ReactNode => (
  <li className="flex min-w-0 items-baseline justify-end gap-1.5 pr-1">
    {cut === "stopped" ? (
      <Octagon size={10} className="shrink-0 self-center text-tone-waiting" aria-hidden />
    ) : (
      <PackageCheck size={10} className="shrink-0 self-center text-fg-subtle" aria-hidden />
    )}
    <span className="font-mono text-2xs text-fg-subtle">
      {cut === "stopped" ? "stopped after" : "asked to file after"}
    </span>
    <span className="font-mono text-2xs tabular-nums text-fg-muted">{tokens(total(spend))}</span>
  </li>
)

export default TurnSpent
