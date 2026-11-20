/**
 * One tool call, as its two halves: the tool's own name and what it acted on.
 *
 * They are drawn apart because they are read apart — the name is scanned down a column,
 * the detail is read on the row that caught your eye. The name is the provider's rather
 * than the normalized kind, because it is the word a person watching that CLI saw.
 *
 * It is here rather than in a feature because the list row's activity slot drew the same
 * entry once, and takes `QUIET` from here still. That slot names a run by its phrase now —
 * `latestActivity` in `format/transcriptRows` — so a call is drawn whole only in the drawer.
 *
 * **The detail truncates from whichever end is the throwaway one**, and which that is
 * depends on the kind — `keepsTail` in `format/activity` owns that decision and says why.
 *
 * **It stays inside whatever width its caller gives it**: the detail gives way first, and
 * the name truncates once there is no detail left to give. An MCP tool name is 40–70
 * characters and crosses the wire verbatim, so an unshrinkable name paints outside a
 * 256px list slot and over whatever sits beyond it.
 */

import type { ReactNode } from "react"
import { keepsTail } from "../format/activity"

/**
 * The ink a line the engine wrote takes, beside the calls — quieter than the work.
 * Exported because the list row draws a non-call entry too, and the four classes written
 * twice is the drift this file exists to remove.
 */
export const QUIET = "truncate font-mono text-xs text-fg-subtle"

/**
 * What a call acted on.
 *
 * Tail-first is done with `direction: rtl` rather than a JavaScript slice, so the browser
 * decides where the cut lands at whatever width the caller happens to be — a slice would
 * need a measurement the component does not have. `<bdi>` keeps the path itself reading
 * left to right inside it.
 *
 * `flex-1` is what makes the name beside it shrink last — a `basis: 0` sibling takes no
 * share of a negative free space, `StepBar`'s caption mechanism. Alone in a row it
 * changes nothing: the box stretches, the text stays at its left edge.
 */
export const Detail = ({
  text,
  kind,
}: {
  readonly text: string
  readonly kind: Parameters<typeof keepsTail>[0]
}): ReactNode =>
  keepsTail(kind) ? (
    <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted [direction:rtl] [text-align:left]">
      <bdi>{text}</bdi>
    </span>
  ) : (
    <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted">{text}</span>
  )

const ToolCall = ({
  name,
  detail,
  kind,
}: {
  readonly name: string
  /** `undefined` where the call carried none — the name stands alone. */
  readonly detail: string | undefined
  readonly kind: Parameters<typeof keepsTail>[0]
}): ReactNode => (
  <span className="flex min-w-0 items-baseline gap-2">
    {/* Shrinkable, not `shrink-0`: with a detail beside it the `Detail`'s basis-0 gives
        way first, and without one this truncation is all that holds the slot. */}
    <span className="min-w-0 truncate font-mono text-xs text-fg">{name}</span>
    {detail === undefined ? undefined : <Detail text={detail} kind={kind} />}
  </span>
)

export default ToolCall
