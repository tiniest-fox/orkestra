/**
 * A background job, as a card holding a command the turn went on without.
 *
 * **Deliberately the delegation card's anatomy** — the same inset box, the header
 * reading `<command> · background · <clock>`, the description under the name — because
 * a job is the same idea with a shell command where the subagent would be, and a second
 * card vocabulary for it is how a system grows a surface it cannot name.
 *
 * Two things it says that a delegation's card does not, and both are new facts rather
 * than new appearance:
 *
 * - **an outcome word when the job lands, success included.** A delegation marks only a
 *   failure; here a completion arriving after the agent's answer is the whole point of
 *   the change, and silence on success would hide the thing being built. `completed` is
 *   good ink, `failed` is bad ink, and `stopped` is the ordinary quiet ink — a stop is
 *   a thing a person or the teardown did, never a verdict on the work.
 * - **nothing at all on a job no report ever closed.** A turn torn down before the work
 *   landed left no observation, so the card carries no word and no clock — a duration
 *   counting up there would be the confident wrong fact `runningSince` refuses.
 *
 * The dashed circle is the mark background work wears wherever it is named, in the slot
 * a delegation's caret takes — there is nothing to open, because a shell job's output is
 * not on the wire and the report's summary carries what its landing said.
 */

import { CircleDashed } from "lucide-react"
import type { ReactNode } from "react"
import { elapsedText } from "../../../../format/activity"
import Elapsed from "../activity/Elapsed"
import StopPress from "./StopPress"
import { jobOutcome, type Job } from "../../../../format/transcriptRows"
import type { StoppingJob } from "../../useStopJob"

/** The ink each outcome word takes. `stopped` is deliberately neither good nor bad. */
const OUTCOME_INK = {
  completed: "text-tone-good",
  failed: "text-tone-bad",
  stopped: "text-fg-subtle",
} as const

const JobCard = ({
  job,
  live = false,
  stopJob,
}: {
  readonly job: Job
  /** Whether this turn is the one something is still driving — see `SubagentGroup`. */
  readonly live?: boolean
  /**
   * The per-job stop — the strip's press, again on the card a reader is already looking
   * at. Drawn only while the job runs, and only where the transcript carries the task
   * id the stop route names.
   */
  readonly stopJob?: StoppingJob
}): ReactNode => {
  const { head, report, description, taskId } = job
  const outcome = jobOutcome(job)
  /** Still going: nothing has reported or failed the launch, and the turn is driven. */
  const running = live && outcome === undefined
  const elapsed = running ? elapsedText(head.at, Date.now()) : undefined
  // How long it ran, off the two stamps — a stored fact, not a heartbeat. Quiet, and
  // only beside a word: a bare duration on an unreported job would claim an ending.
  const took =
    outcome === undefined || report?.at === undefined ? undefined : elapsedText(head.at, report.at)

  return (
    <li className="min-w-0">
      <div className="flex min-w-0 flex-col rounded-control border border-border bg-canvas px-2 py-1.5">
        <span className="flex w-full min-w-0 items-center gap-2">
          <CircleDashed
            size={12}
            aria-hidden
            className={`shrink-0 ${running ? "text-tone-working" : "text-fg-subtle"}`}
          />
          {/* The command is the header, because `Bash` in the name column would be the
              same word on every card. A described call keeps it in `command`, its
              `detail` being the description the line below already draws; a call with
              no command falls back to the tool's name. */}
          <span className="min-w-0 truncate font-mono text-xs font-medium text-fg">
            {head.command ?? head.detail ?? head.name}
          </span>
          <span className="shrink-0 font-mono text-2xs text-fg-subtle">background</span>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {outcome === undefined ? undefined : (
              <span className={`font-mono text-2xs ${OUTCOME_INK[outcome]}`}>{outcome}</span>
            )}
            {took === undefined ? undefined : (
              <span className="font-mono text-2xs text-fg-subtle">{took}</span>
            )}
            {elapsed === undefined ? undefined : <Elapsed text={elapsed} />}
            {running && stopJob !== undefined && taskId !== undefined ? (
              <StopPress
                label={description ?? head.detail ?? head.name}
                disabled={stopJob.disabled}
                onPress={() => stopJob.stop(taskId)}
              />
            ) : undefined}
          </span>
        </span>

        {/* What the job is, in the provider's words — under the name, as a delegation's
            description sits. Absent on a transcript from before the join was carried. */}
        {description === undefined ? undefined : (
          <span className="min-w-0 truncate pl-5 font-mono text-xs text-fg-subtle">
            {description}
          </span>
        )}

        {/* The report's last word — the exit code lives here, and it is the one thing
            about the landing the level never said. */}
        {report?.summary === undefined ? undefined : (
          <span className="mt-1 min-w-0 truncate pl-5 font-mono text-xs text-fg-muted">
            {report.summary}
          </span>
        )}
      </div>
    </li>
  )
}

export default JobCard
