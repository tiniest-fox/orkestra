/**
 * Drop this goal? — the question the goal head's `⋯` asks before it acts. Drawn in the menu's
 * popover at a desk by `GoalMenu`, and on a phone as a `ConfirmSheet` by `GoalScreen`, after
 * the tabs and the foot: inside the header it would be painted under every later band of
 * the drawer, since the header is a stacking context at the same rung.
 *
 * Its one line says the goal stops for good and, where any are live, how many of its traks
 * keep running as the person's own — nothing is archived with it.
 */

import type { ReactNode } from "react"
import ConfirmSheet from "../../components/ConfirmSheet"
import Confirmation from "../../components/Confirmation"
import type { GoalDrop as Dropping } from "./useDropGoal"

/** What the drop does, true of this goal. */
const dropScope = (open: number): string =>
  open === 0
    ? "The goal stops for good, and its composer takes no more turns."
    : `The goal stops for good, and its composer takes no more turns. ${open === 1 ? "Its 1 trak keeps" : `Its ${String(open)} traks keep`} running as your own.`

const DropQuestion = ({
  open,
  dropping,
  sheet,
  onCancel,
}: {
  /** The goal's live traks. */
  readonly open: number
  readonly dropping: Dropping
  /** A phone's sheet, rather than the panel in the popover. */
  readonly sheet: boolean
  readonly onCancel: () => void
}): ReactNode => {
  const Ask = sheet ? ConfirmSheet : Confirmation
  return (
    <Ask
      heading="Drop this goal?"
      press="Drop"
      busy={dropping.isPending}
      said={dropping.said}
      onCancel={onCancel}
      onConfirm={dropping.drop}
    >
      {dropScope(open)}
    </Ask>
  )
}

export default DropQuestion
