/**
 * One trak of the goal, drawn as the traks list draws it: the real `TrakRow`, opening the
 * trak's own page. The goal shows no summary of a trak of its own.
 *
 * **Everything a row needs arrives through `GoalRows`**, set by the page: the list's
 * summaries by id, the library for a working row's mark, and the breakpoint. A row sits
 * inside a tool's view inside the thread, and nothing between the page and it knows which
 * traks are on screen — the shape `TrakViews` gives a view's card.
 *
 * The page hands the list's rows and the goal's `settled` ones, so a trak put away since
 * it landed or was dropped is still its real row. One neither has yet — opened a moment
 * ago — falls back to the plain row.
 */

import type { ReactNode } from "react"
import { createContext, useContext } from "react"
import type { AgentDto, GoalTrakDto, TrakSummaryDto } from "../../api/types"
import TrakRow from "../traks-list/TrakRow"
import PlannedRow from "./PlannedRow"

export interface GoalRowsValue {
  readonly summaries: ReadonlyMap<string, TrakSummaryDto>
  readonly agents: readonly AgentDto[]
  readonly phone: boolean
}

const Rows = createContext<GoalRowsValue>({ summaries: new Map(), agents: [], phone: false })

/** The provider, so a page can say which summaries the rows under it draw. */
export const GoalRows = ({
  value,
  children,
}: {
  readonly value: GoalRowsValue
  readonly children: ReactNode
}): ReactNode => <Rows value={value}>{children}</Rows>

const AWAY: Record<GoalTrakDto["status"], string> = {
  live: "Opening",
  landed: "Landed",
  dropped: "Dropped",
}

const GoalTrakRow = ({ trak }: { readonly trak: GoalTrakDto }): ReactNode => {
  const { summaries, agents, phone } = useContext(Rows)
  const summary = summaries.get(trak.id)
  if (summary === undefined)
    return (
      <PlannedRow
        title={trak.title}
        mode={trak.mode}
        line={AWAY[trak.status]}
        look={trak.status === "dropped" ? "gone" : "next"}
      />
    )
  return (
    <TrakRow
      trak={summary}
      band={[]}
      // The forge is not asked from a goal: a landed row says what its own state says.
      rungs={undefined}
      agents={agents}
      phone={phone}
      stacked={false}
    />
  )
}

export default GoalTrakRow
