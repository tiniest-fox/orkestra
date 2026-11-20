/**
 * One window's meter: the fill is the share used, in the window's tone over its tone's
 * track, and a thin tick overhanging the track is the share of the window's time gone —
 * fill past the tick is ahead of pace. A window that has reset since the reading draws an
 * empty track and no tick, since the time gone in a window nobody has read is a guess.
 */

import type { ReactNode } from "react"
import { toneSolid, toneTrack } from "../../../format/tone"
import type { WindowView } from "./usageView"

const TRACK: Record<"thin" | "cell" | "panel", string> = {
  thin: "h-1",
  cell: "h-1.5",
  panel: "h-2",
}

const UsageMeter = ({
  window: w,
  width,
  height,
}: {
  readonly window: WindowView
  /** CSS px, or `100%` for the panel's full-width meters. */
  readonly width: number | "100%"
  /** The track's height: `thin` beside another CLI's in the phone tab, `panel` in the panel. */
  readonly height: "thin" | "cell" | "panel"
}): ReactNode => {
  const used = w.reset ? 0 : w.used
  return (
    <span
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(used)}
      aria-label={
        w.reset
          ? `${w.label}: reset since the reading`
          : `${w.label}: ${String(Math.round(used))}% used${w.gone === undefined ? "" : `, ${String(Math.round(w.gone))}% of the window gone`}`
      }
      className="relative inline-block shrink-0"
      style={{ width }}
    >
      <span className={`block ${TRACK[height]} overflow-hidden rounded-pill ${toneTrack[w.tone]}`}>
        <span
          className={`block h-full ${toneSolid[w.tone]}`}
          style={{ width: `${String(used)}%` }}
        />
      </span>
      {!w.reset && w.gone !== undefined && (
        <span
          aria-hidden
          className="absolute -top-0.5 -bottom-0.5 w-px bg-fg"
          style={{ left: `calc(${String(w.gone)}% - 0.5px)` }}
        />
      )}
    </span>
  )
}

export default UsageMeter
