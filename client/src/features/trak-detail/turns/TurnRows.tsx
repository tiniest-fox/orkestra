/**
 * A run of a turn's rows, as list items — a stretch of activity, a delegation's card, a
 * backgrounded job's, an MCP tool's view or a check the agent ran, each drawn by its own
 * component.
 *
 * Apart from `TurnSection` because that section draws two such runs where a person spoke
 * after the answer: what led to the document, and the exchange below it. The list
 * element is the caller's, so the rows take the gap of whatever they sit in.
 */

import type { ReactNode } from "react"
import { Fragment } from "react"
import {
  type groupEntries,
  isChecked,
  isDelegation,
  isJob,
  isViewed,
  runningSince,
} from "../../../format/transcriptRows"
import type { StoppingJob } from "../useStopJob"
import ActivityGroup from "./activity/ActivityGroup"
import SubagentGroup from "./activity/SubagentGroup"
import JobCard from "./jobs/JobCard"
import CheckCallCard from "./views/CheckCallCard"
import ViewCard from "./views/ViewCard"

const TurnRows = ({
  rows,
  live,
  stopJob,
}: {
  readonly rows: ReturnType<typeof groupEntries>
  /** Whether something is driving the turn these rows belong to. */
  readonly live: boolean
  readonly stopJob: StoppingJob | undefined
}): ReactNode =>
  rows.map((row, j) => (
    // oxlint-disable-next-line react/no-array-index-key -- append-only transcript
    <Fragment key={j}>
      {isDelegation(row) ? (
        // A delegation stays open for the rest of the turn by design — a
        // backgrounded one runs while the parent keeps working — so it is live
        // wherever it sits, where a run is only live at the end of the turn.
        <SubagentGroup delegation={row} live={live} />
      ) : isJob(row) ? (
        // A job is live wherever it sits for the delegation's reason: the turn
        // went on without it, so the card it needs a clock on is rarely last.
        <JobCard job={row} live={live} stopJob={live ? stopJob : undefined} />
      ) : isViewed(row) ? (
        // A view is part of the answer, so it is a card between the runs on either
        // side of it — and it reads the trak it belongs to from the page, not from here.
        <ViewCard viewed={row} />
      ) : isChecked(row) ? (
        // A check the agent ran is a view of the same kind, and it reads the trak's run
        // from the page as a view reads its views.
        <CheckCallCard checked={row} driving={live} />
      ) : (
        <ActivityGroup
          group={row}
          // A run is live as the last thing that happened, **or** while it still
          // holds a call nothing has reported on: a delegation's card, a pause and
          // a kind nobody catalogued all land after a call that is still open, so
          // the row a person is actually waiting on is routinely not the last one,
          // and asking only for the last group took the clock off the one case it
          // exists for. `runningSince` is what decides a call is still open, and a
          // turn nothing is driving is `live` false whole — which is what keeps a
          // turn that died mid-call from counting up forever.
          live={live && (j === rows.length - 1 || runningSince(row) !== undefined)}
          // The turn's own custody, which is a different question and the one a
          // retry pause's dots are asked: that row draws wherever it sits.
          driving={live}
        />
      )}
    </Fragment>
  ))

export default TurnRows
