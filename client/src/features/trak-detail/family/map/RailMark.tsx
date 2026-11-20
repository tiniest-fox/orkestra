/**
 * One position as a pressable 24px plate with its corner marks — the mark both rails draw:
 * the desk's `TrakRail` down the drawer's edge, and the phone's `PositionStrip` across it.
 *
 * One file so the two cannot disagree about what a position looks like at this size, which
 * corners it wears, or what its press is named.
 */

import type { ReactNode } from "react"
import { toneInk } from "../../../../format/tone"
import ContinuesMark from "./ContinuesMark"
import { type Corner, cornerClass, type CornerKind, corners } from "./corners"
import type { Spot } from "../family"
import { type Badge, positionName } from "../rows"
import StepMark from "./StepMark"

/**
 * The three corner marks a rail draws, placed by `corners` exactly as the map's are. A
 * rail draws no gate mark and no hand-up — it is orientation rather than the account — and
 * the count is its alone, where the map says it in words.
 */
const DRAWN: readonly CornerKind[] = ["count", "badge", "continues"]

/** The count's own offsets: a wider pill than the discs, so it sits half a step further out. */
const countClass: Record<Corner, string> = { right: "-right-1.5", left: "-left-1.5" }

/**
 * The map's corner badge at the rail's own scale — the same 14px disc and 10px glyph on
 * the same 24px plate, for the entry a wait holds and a compose something asked for.
 *
 * `aria-hidden`, unlike the map's: the button's `positionName` already names the position,
 * and the rail is orientation rather than the account. The map's copy carries the words.
 */
const RailBadge = ({
  glyph: Glyph,
  tone,
  corner,
}: Badge & { readonly corner: Corner }): ReactNode => (
  <span
    aria-hidden
    className={`absolute -top-1 flex size-3.5 items-center justify-center rounded-pill bg-canvas ${toneInk[tone]} ${cornerClass[corner]}`}
  >
    <Glyph size={10} strokeWidth={2.5} />
  </span>
)

const RailMark = ({
  spot,
  current,
  onPick,
  reach = false,
}: {
  readonly spot: Spot
  readonly current: boolean
  readonly onPick: (key: string) => void
  /**
   * Grow the press past the plate without growing the plate — the phone strip's, where a
   * thumb aims. An empty `::before` 10px above and below and 4px either side makes the
   * target 32×44, the strip's full height, and the 8px guide between two marks is exactly
   * where their two reaches meet. A pseudo-element rather than padding, because the ring
   * and the corner marks trace the button's box, and padding would move them off the plate.
   */
  readonly reach?: boolean
}): ReactNode => {
  const at = corners(spot.row, DRAWN)
  return (
    <button
      type="button"
      onClick={() => onPick(spot.key)}
      // The square says how it is going in colour and in motion and in nothing else, so
      // the press is the only place those words exist — and `positionName` is why a row
      // with no `StepStatus` is not named as one that has not started.
      aria-label={positionName(spot.row)}
      aria-current={current ? "step" : undefined}
      // **`flex` is what makes the ring a square around the plate**, and without it the
      // ring hung three or four pixels below. `Plate` is an `inline-flex` `<span>`, so a
      // button that is not a flex container lays it out on a text baseline: the button's
      // box is a line box, taller than the 24px plate by the strut's descender, and all of
      // the difference falls under the mark. The ring traces the button, so it drew a
      // rectangle rather than the square the plate is. `RailSpawn` carries `flex` on its
      // own 14px tile for this reason and this one was the site that missed it.
      //
      // `relative` is load-bearing and not decoration: the desk rail's guide line is an
      // `absolute` sibling, and positioned elements paint over static ones — so without it
      // the line draws across the plate rather than behind it.
      className={`relative flex rounded-control ${current ? "ring-1 ring-accent" : ""} ${
        reach ? "before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-['']" : ""
      }`}
    >
      <StepMark row={spot.row} />
      {/* The numeral at the plate's corner — which step is holding background work open,
          at a glance from any position. The count and not a dot, so it says how much;
          `ring-canvas` cuts it out of the plate rather than laying it on top. Gated on
          `running` for `MapRow.outstanding`'s reason, and aria-hidden: the button's own
          label already names the position, and the desk map carries the count in words.
          On a phone this numeral is the only place the count shows. */}
      {at.get("count") !== undefined && (
        <span
          aria-hidden
          className={`absolute -top-1 flex h-3 min-w-3 items-center justify-center rounded-pill bg-tone-working px-0.5 font-mono text-[8px] font-medium leading-none text-canvas ring-2 ring-canvas ${countClass[at.get("count") ?? "right"]}`}
        >
          {spot.row.outstanding}
        </span>
      )}
      {spot.row.badge !== undefined && at.get("badge") !== undefined && (
        <RailBadge {...spot.row.badge} corner={at.get("badge") ?? "right"} />
      )}
      {/* The map's corner mark, on the same plate at half the drawer's width — a spawn's
          14px tiles carry none: the tile has room for the agent's mark and nothing at its
          corner. */}
      {at.get("continues") !== undefined && (
        <ContinuesMark corner={at.get("continues") ?? "right"} />
      )}
    </button>
  )
}

export default RailMark
