/**
 * A sub-goal row's foot on its parent's Traks tab: one segment per planned trak, the
 * landed ones in the state's ink, and one empty bar while nothing is planned — the traks
 * list banner's rail. `undefined` is a sub-goal not opened yet.
 */

import type { ReactNode } from "react"
import type { GoalDto } from "../../api/types"
import { goalSolid, goalWords } from "../../format/goal"

const SubgoalRail = ({ goal }: { readonly goal: GoalDto | undefined }): ReactNode => {
  const planned = goal?.planned ?? 0
  const landed = goal?.landed ?? 0
  const solid = goal === undefined ? "" : goalSolid[goalWords(goal).ink]
  return (
    <span aria-hidden className="flex h-1 gap-0.5">
      {planned === 0 ? (
        <span className="flex-1 bg-border" />
      ) : (
        Array.from({ length: planned }, (_, i) => (
          <span
            // oxlint-disable-next-line react/no-array-index-key -- one segment per planned trak, positional
            key={i}
            className={`flex-1 ${i < landed ? solid : "bg-border"}`}
          />
        ))
      )}
    </span>
  )
}

export default SubgoalRail
