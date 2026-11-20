/**
 * Every goal over the list's sections, as one block. A goal going is a full `GoalBanner`, a goal at
 * rest folds to a one-line `GoalRestRow`, and a dashed `GoalNewRow` closes the block, so a
 * goal can be started from the list whatever is going. `goalOrder` owns the order.
 *
 * **One card per goal, two pixels apart, and only the block's outer corners round**: the
 * first card its top ones and the New goal row, always last, its bottom ones. Square
 * corners between cards are what make the stack read as one thing rather than a pile.
 *
 * **A sub-goal is drawn inside its parent's card**, as a tile while it is live and not at
 * all once it ends — `SubgoalTiles`. One whose parent the list does not hold is a goal of
 * its own here, so it is not lost.
 *
 * While no goal is shown the block is `GoalDoor` alone, the banner's own anatomy, so the
 * page keeps one height whether a goal is shown or not.
 */

import type { ReactNode } from "react"
import type { GoalDto } from "../../api/types"
import GoalBanner from "./GoalBanner"
import GoalDoor from "./GoalDoor"
import GoalNewRow from "./GoalNewRow"
import GoalRestRow from "./GoalRestRow"
import { goalOrder } from "./goalOrder"
import SubgoalTiles from "./SubgoalTiles"

const GoalStack = ({
  goals,
  open,
  phone,
  onDismiss,
  dismissing,
}: {
  /** The goals not dismissed. */
  readonly goals: readonly GoalDto[]
  /** The id of the goal open in the drawer, if one is. */
  readonly open: string | undefined
  readonly phone: boolean
  readonly onDismiss: (id: string) => void
  /** The goal a dismissal is in flight for: its row alone greys Dismiss out. */
  readonly dismissing: string | undefined
}): ReactNode => {
  if (goals.length === 0)
    return (
      <div className="mt-3 flex flex-col">
        <GoalDoor />
      </div>
    )
  const ids = new Set(goals.map((g) => g.id))
  const { going, rest } = goalOrder(
    goals.filter((g) => g.parent === undefined || !ids.has(g.parent.id)),
  )
  return (
    <div className="mt-3 flex flex-col gap-0.5">
      {going.map((g, i) => (
        <GoalBanner
          key={g.id}
          goal={g}
          open={open === g.id}
          first={i === 0}
          tiles={<SubgoalTiles parent={g} goals={goals} phone={phone} />}
        />
      ))}
      {rest.map((g, i) => (
        <GoalRestRow
          key={g.id}
          goal={g}
          open={open === g.id}
          first={going.length === 0 && i === 0}
          phone={phone}
          onDismiss={() => onDismiss(g.id)}
          dismissing={dismissing === g.id}
        />
      ))}
      <GoalNewRow />
    </div>
  )
}

export default GoalStack
