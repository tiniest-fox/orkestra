/**
 * The goal head's `⋯`: Pause or Resume, and drop the goal behind a confirmation in the
 * menu's own popover — `TrakControls`' shape. The goal's title row holds this menu and the
 * way out, and nothing else.
 *
 * The caller decides which items are offered and draws no menu where neither is. The
 * question is `DropQuestion`'s. **On a phone the screen hands `onDrop`**: Drop shuts the
 * popover and reports, and the screen draws the sheet where no later band can paint over it.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import MenuItem from "../../components/MenuItem"
import OverflowMenu from "../../components/OverflowMenu"
import DropQuestion from "./DropQuestion"
import type { GoalDrop as Dropping } from "./useDropGoal"
import type { GoalPause } from "./usePauseGoal"

const GoalMenu = ({
  pausing,
  pause,
  open,
  dropping,
  onDrop,
}: {
  /** `true` offers Pause, `false` Resume, `undefined` neither. */
  readonly pausing: boolean | undefined
  readonly pause: GoalPause
  /** The goal's live traks, or `undefined` where Drop is not offered. */
  readonly open: number | undefined
  readonly dropping: Dropping
  /** A phone's: the screen asks, in a sheet. `undefined` asks in the popover. */
  readonly onDrop: (() => void) | undefined
}): ReactNode => {
  // Held here rather than in the panel, which unmounts its body while shut — so a menu
  // reopened after a cancel is the item again, not the question.
  const [asking, setAsking] = useState(false)
  const cancel = (): void => {
    setAsking(false)
  }
  return (
    <OverflowMenu label="Goal options" onDismiss={cancel}>
      {(shut) =>
        asking && open !== undefined ? (
          <DropQuestion open={open} dropping={dropping} sheet={false} onCancel={cancel} />
        ) : (
          <>
            {pausing !== undefined && (
              <MenuItem
                disabled={pause.isPending}
                onClick={() => {
                  pause.pause(pausing)
                  shut()
                }}
              >
                {pausing ? "Pause" : "Resume"}
              </MenuItem>
            )}
            {open !== undefined && (
              <MenuItem
                onClick={() => {
                  if (onDrop === undefined) {
                    setAsking(true)
                    return
                  }
                  shut()
                  onDrop()
                }}
              >
                Drop this goal
              </MenuItem>
            )}
          </>
        )
      }
    </OverflowMenu>
  )
}

export default GoalMenu
