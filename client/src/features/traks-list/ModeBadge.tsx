/**
 * The trak's run mode, as a small disc on the bottom-right corner of the row's square —
 * the mode's own mark from `format/runMode`, the glyph both mode pickers draw beside its
 * name, so a reader learns one picture per mode in one place.
 *
 * **On the square rather than beside the title or in the trailing slot**: the square already
 * answers *what state, and who is working*, and *who approves* is the same kind of fact.
 * The title's line is the one a narrow row truncates first, and the trailing slot is the
 * row's press.
 *
 * Drawn on every row whatever the mode, `manual` included: a mark that appeared only off
 * the default would make its absence a second way to say `manual`, the same argument
 * `TrakSummaryDto.mode` makes for being required.
 *
 * The square inside keeps every pixel it had — the disc overhangs it, so a row with the
 * badge lines up with one without.
 */

import type { ReactNode } from "react"
import type { RunModeDto } from "../../api/types"
import { MODE_WORDS } from "../../format/runMode"

const ModeBadge = ({
  mode,
  children,
}: {
  readonly mode: RunModeDto
  /** The square the disc sits on — `TrakMark`. */
  readonly children: ReactNode
}): ReactNode => {
  const { name, mark: Mark } = MODE_WORDS[mode]
  return (
    <span className="relative shrink-0">
      {children}
      <span className="absolute -right-1.5 -bottom-1.5 flex size-4 items-center justify-center rounded-pill bg-surface ring-1 ring-border">
        <Mark size={10} role="img" aria-label={`${name} mode`} className="text-fg-subtle" />
      </span>
    </span>
  )
}

export default ModeBadge
