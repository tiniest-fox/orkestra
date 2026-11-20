/**
 * The rule a proposed plan draws where a step waits on a clock of its own: the same
 * dashed line across the list that `WaitRule` draws for a condition, an alarm clock, and
 * the instant with its countdown after it.
 *
 * **The same shape as the condition's rule, on purpose.** A clock is a better-known reason
 * for the split the rule already says — everything below runs later — so it is a row of
 * its own between two tiles, in `WaitRule`'s measurements, rather than a mark on the step
 * or a section of the card. Where a step waits on both, its clock's rule sits above the
 * condition's: the instant is the outer floor, and the condition is the nearer gate and
 * belongs nearer its tile. The two rules meeting with nothing between them is the cost.
 *
 * **The instant, then the countdown, and nothing else.** No *not before*, no *waits
 * until* — the condition's rule carries the names and nothing else, and a clock earning
 * extra words would be arguing against the rule it reuses. Relative words go stale once
 * the day turns; the poll redraws them. The countdown ticks off `useCountdown`, which is
 * the one clock allowed in a component, and says *due now* rather than a frozen zero once
 * the instant has passed — a plan can sit at its gate long enough for that.
 */

import type { ReactNode } from "react"
import { AlarmClock } from "lucide-react"
import { useCountdown } from "./useCountdown"
import { dueWords, whenWords } from "./waiting"

const Line = ({ faded }: { readonly faded: boolean }): ReactNode => (
  <span
    aria-hidden
    className={`h-0 min-w-3 flex-1 border-t border-dashed border-tone-working${faded ? " opacity-60" : ""}`}
  />
)

const ClockRule = ({
  until,
  struck = false,
  end,
}: {
  /** The resolved instant, epoch milliseconds — `AgentStepDto.waitUntil`. */
  readonly until: number
  /** A clock a person has taken off the step at the plan gate, drawn until they approve. */
  readonly struck?: boolean
  /** A press at the rule's end — the plan gate's remove, or the undo on a struck clock. */
  readonly end?: ReactNode
}): ReactNode => {
  // Always a number: the target is never absent here, so the fallback is unreachable.
  const left = useCountdown(until) ?? 0
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Line faded={struck} />
      <span
        className={`inline-flex min-w-0 items-baseline gap-x-1.5 font-mono text-2xs${struck ? " line-through opacity-60" : ""}`}
      >
        <AlarmClock size={11} aria-hidden className="shrink-0 self-center text-tone-working" />
        <span className="min-w-0 truncate text-tone-working">
          {whenWords(until, Date.now())}
          <span className="text-fg-subtle"> · {dueWords(left)}</span>
        </span>
      </span>
      <Line faded={struck} />
      {end}
    </div>
  )
}

export default ClockRule
