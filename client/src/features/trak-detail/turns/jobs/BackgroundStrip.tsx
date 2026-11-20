/**
 * The live list of background work, attached to the chat bar's top edge — the only
 * surface that is about *now*, and the only statement of what is still outstanding.
 *
 * **Load-bearing rather than cosmetic**: the engine waits for background work with no
 * limit, so while a step is only waiting this list is the one thing that tells a person
 * a stop needs pressing. It empties to nothing — with no background work the bar is
 * exactly the bar. `tone-working` blue because the work is in flight and owes nobody
 * anything, three rows before the list scrolls, a count and the longest duration above
 * it only once it overflows, and an icon-only stop press on each row.
 *
 * The ceiling is three rows plus a 12px sliver of the next, so a scroller a person
 * cannot see is never quietly lying about its length — the numbers are the row heights
 * at the two widths (30px, and 44px at the phone's touch floor).
 */

import { CircleDashed } from "lucide-react"
import type { ReactNode } from "react"
import { elapsedText } from "../../../../format/activity"
import Elapsed from "../activity/Elapsed"
import type { OutstandingJob } from "./outstanding"
import StopPress from "./StopPress"
import type { StoppingJob } from "../../useStopJob"

/** Rows shown whole before the list scrolls — the settled `bar.rows`. */
const ROWS_SHOWN = 3

const BackgroundStrip = ({
  jobs,
  stopping,
}: {
  readonly jobs: readonly OutstandingJob[]
  /** The press, while something is driving the trak for a stop to reach. `undefined`
   *  draws the list with no press — a reader scrolled back on a dead turn. */
  readonly stopping: StoppingJob | undefined
}): ReactNode => {
  if (jobs.length === 0) return undefined
  const overflows = jobs.length > ROWS_SHOWN
  const oldest = jobs.reduce<number | undefined>(
    (found, job) =>
      job.since !== undefined && (found === undefined || job.since < found) ? job.since : found,
    undefined,
  )
  const longest = oldest === undefined ? undefined : elapsedText(oldest, Date.now())

  return (
    <div className="flex min-w-0 flex-col rounded-t-control border-x border-t border-border bg-tone-working-bg">
      {/* The count only appears once the list stops showing all of it: above a strip you
          can see whole it would be the same fact twice; above a scroller it is the only
          thing that says how much is out of sight. */}
      {overflows ? (
        <span className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-1">
          <CircleDashed size={10} aria-hidden className="shrink-0 text-tone-working" />
          <span className="min-w-0 truncate font-mono text-2xs uppercase tracking-wider text-tone-working">
            {jobs.length} running
          </span>
          {longest === undefined ? undefined : (
            <span className="ml-auto shrink-0 font-mono text-2xs text-fg-subtle">
              longest {longest}
            </span>
          )}
        </span>
      ) : undefined}
      <ol
        aria-label="Background work"
        className="flex min-w-0 flex-col divide-y divide-border overflow-y-auto overscroll-contain max-h-[123px] max-sm:max-h-[195px]"
      >
        {jobs.map((job) => {
          const name = job.description ?? job.taskId
          const running = job.since === undefined ? undefined : elapsedText(job.since, Date.now())
          return (
            <li
              key={job.taskId}
              className="flex min-w-0 shrink-0 items-center gap-2 px-3 py-1.5 max-sm:py-2"
            >
              <CircleDashed size={11} aria-hidden className="shrink-0 text-tone-working" />
              {/* The name truncates and the clock and the press do not — the press has to
                  stay reachable at a phone's width whatever the command says. */}
              <span className="min-w-0 truncate font-mono text-xs text-fg">{name}</span>
              <span className="ml-auto flex shrink-0 items-center gap-2">
                {running === undefined ? undefined : <Elapsed text={running} />}
                {stopping === undefined ? undefined : (
                  <StopPress
                    label={name}
                    disabled={stopping.disabled}
                    onPress={() => stopping.stop(job.taskId)}
                  />
                )}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export default BackgroundStrip
