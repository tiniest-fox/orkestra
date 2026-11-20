/** The line teaching the meter's tick, drawn once under every CLI's section. */

import type { ReactNode } from "react"

const UsageTick = (): ReactNode => (
  <p className="flex items-center gap-2 border-t border-border pt-2 text-xs text-fg-subtle">
    <span aria-hidden className="inline-block h-2 w-px shrink-0 bg-fg" />
    Tick is the share of the window gone. Fill past it is ahead of pace.
  </p>
)

export default UsageTick
