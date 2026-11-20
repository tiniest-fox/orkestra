/**
 * A sub-goal the composer proposes on its plan-gate card: the door's ring, the title, its
 * line and its `Done when` finished state, each whole — this is where the person approves
 * its spec, so nothing is cut.
 */

import type { ReactNode } from "react"
import type { PlannedSubgoalDto } from "../../api/types"
import GoalRing from "../traks-list/GoalRing"

const SubgoalProposedRow = ({ sub }: { readonly sub: PlannedSubgoalDto }): ReactNode => (
  <li className="flex items-start gap-4 px-gutter py-2.5">
    <GoalRing ink={undefined} mark="door" landed={0} planned={0} />
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-base font-medium text-fg">{sub.title}</span>
      <span className="text-sm text-fg-muted">{sub.line}</span>
      <span className="text-sm text-fg-muted">
        <span className="font-mono text-2xs uppercase tracking-wider text-fg-subtle">
          Done when{" "}
        </span>
        {sub.finished}
      </span>
    </div>
  </li>
)

export default SubgoalProposedRow
