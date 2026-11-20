/**
 * `Navigator`'s rail: navigation only — one picked item, marked by the `surface` fill and
 * a 2px accent bar at its left edge, with an optional group label in caps above an item.
 *
 * Each item is a press with an optional leading mark, a title, and a second line cut to
 * one. At a desk the rail is 200px on `canvas` beside the content; narrow, it stacks
 * above, capped and scrolling, and each press takes the 44px touch floor.
 */

import type { ReactNode, Ref } from "react"
import { CAPS } from "./Figure"

export interface RailItem {
  /** React's key; titles may repeat. */
  readonly key: string
  /** The item's name, and its content's accessible name. */
  readonly title: string
  readonly sub: ReactNode
  readonly lead: ReactNode
  /** A label drawn above this item, starting a group. */
  readonly group: string | undefined
  /** The waiting tone on the title, for an item that is owed attention. */
  readonly waiting: boolean
}

const titleInk = (item: RailItem, on: boolean): string => {
  if (item.waiting) return `text-tone-waiting ${on ? "font-semibold" : "font-medium"}`
  return on ? "font-semibold text-fg" : "font-medium text-fg-muted"
}

const NavigatorRail = ({
  items,
  picked,
  onPick,
  narrow,
  ref,
}: {
  readonly items: readonly RailItem[]
  readonly picked: number
  readonly onPick: (index: number) => void
  readonly narrow: boolean
  /** The list inside the scroller, whose height is the rail's whole height. */
  readonly ref: Ref<HTMLDivElement>
}): ReactNode => (
  <div
    className={`flex min-w-0 shrink-0 flex-col overflow-y-auto bg-canvas ${narrow ? "max-h-38.5 border-b border-guide" : "w-50 border-r border-guide"}`}
  >
    <div ref={ref} className="flex min-w-0 flex-col">
      {items.map((item, i) => {
        const on = i === picked
        return (
          <div key={item.key} className="min-w-0">
            {item.group !== undefined && (
              <div className={`px-2.5 pt-2 pb-0.5 ${i > 0 ? "border-t border-guide" : ""} ${CAPS}`}>
                {item.group}
              </div>
            )}
            <button
              type="button"
              aria-pressed={on}
              onClick={() => {
                onPick(i)
              }}
              className={`relative flex w-full min-w-0 cursor-pointer items-start gap-2 px-2.5 py-2 text-left hover:bg-hover-row ${narrow ? "min-h-11" : ""} ${i > 0 && item.group === undefined ? "border-t border-guide" : ""} ${on ? "bg-surface" : ""}`}
            >
              {on && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
              {item.lead !== undefined && <span className="shrink-0 pt-0.5">{item.lead}</span>}
              <span className="flex min-w-0 flex-col">
                <span className={`min-w-0 truncate ${titleInk(item, on)}`}>{item.title}</span>
                {item.sub !== undefined && (
                  <span className="min-w-0 truncate text-sm text-fg-subtle">{item.sub}</span>
                )}
              </span>
            </button>
          </div>
        )
      })}
    </div>
  </div>
)

export default NavigatorRail
