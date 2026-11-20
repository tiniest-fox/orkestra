/** A run mode's own mark, inline beside a planned trak's title — `format/runMode`'s glyph. */

import type { ReactNode } from "react"
import type { RunModeDto } from "../../../api/types"
import { MODE_WORDS } from "../../../format/runMode"

const ModeMark = ({ mode }: { readonly mode: RunModeDto }): ReactNode => {
  const { name, mark: Mark } = MODE_WORDS[mode]
  return (
    <Mark size={11} role="img" aria-label={`${name} mode`} className="shrink-0 text-fg-subtle" />
  )
}

export default ModeMark
