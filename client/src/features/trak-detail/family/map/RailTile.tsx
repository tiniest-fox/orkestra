/**
 * One position of a spawn's piece as a pressable 14px tile — what both rails draw inside a
 * spawn: the desk's `RailSpawn` in columns, and the phone's `StripSpawn` in rows.
 */

import type { ReactNode } from "react"
import Plate from "../../../../components/Plate"
import type { Spot } from "../family"
import { positionName } from "../rows"

const RailTile = ({
  spot,
  current,
  onPick,
}: {
  readonly spot: Spot
  readonly current: boolean
  readonly onPick: (key: string) => void
}): ReactNode => {
  // **The same mark the full-size squares draw, and nothing decided here.** `MapRow.mark`
  // is the agent on a step and the kind's glyph on every other row, so a piece's ending —
  // which carries no `StepStatus` — is the flag without this tile coercing that absence to
  // anything. The name and the segment read `spot.row.status` straight for the same
  // reason: coerced to `todo`, a merged piece announces itself as not started and its ring
  // travels. `positionName` is the shared rule for the name.
  const Mark = spot.row.mark
  return (
    <button
      type="button"
      onClick={() => onPick(spot.key)}
      aria-label={positionName(spot.row)}
      aria-current={current ? "step" : undefined}
      className={`flex rounded-tile ${current ? "ring-1 ring-accent" : ""}`}
    >
      {/* The mark sits still: the travelling segment is the running signal at both sizes,
          and two things moving on one 14px tile is one signal drawn twice. */}
      <Plate tone={spot.row.tone} size="tile" running={spot.row.status === "running"}>
        <Mark size={10} aria-hidden />
      </Plate>
    </button>
  )
}

export default RailTile
