/**
 * A sub-goal the parent's plan holds and its composer has not opened: the sub-goal row's
 * shape with the door's grey ring, `Not opened yet` leading its line, and an empty rail.
 * No link, since there is no page to open. `gone` is one a parent at rest never opened,
 * struck through.
 */

import type { ReactNode } from "react"
import type { PlannedSubgoalDto } from "../../api/types"
import GoalRing from "../traks-list/GoalRing"
import SubgoalRail from "./SubgoalRail"

const SubgoalPendingRow = ({
  planned,
  gone,
}: {
  readonly planned: PlannedSubgoalDto
  readonly gone: boolean
}): ReactNode => (
  <li>
    <span className="flex flex-col gap-0.5 px-3 py-2.5">
      <span className="flex h-5 items-center gap-2">
        <span className="flex h-5 w-7 shrink-0 items-center justify-center">
          <GoalRing ink={undefined} mark="door" landed={0} planned={0} />
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-base font-medium ${gone ? "text-fg-subtle line-through" : "text-fg-muted"}`}
        >
          {planned.title}
        </span>
      </span>
      <span className="truncate pl-9 text-sm text-fg-subtle">
        <span className="font-medium">{gone ? "Never opened" : "Not opened yet"} · </span>
        {planned.line}
      </span>
    </span>
    <SubgoalRail goal={undefined} />
  </li>
)

export default SubgoalPendingRow
