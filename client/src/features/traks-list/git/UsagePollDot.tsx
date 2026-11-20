/** The mark that one of the engine's turns on this CLI is running, so it is reading again. */

import type { ReactNode } from "react"

const UsagePollDot = (): ReactNode => (
  <span
    aria-label="polling"
    role="img"
    className="inline-block size-1.5 shrink-0 animate-breathe rounded-pill bg-tone-working motion-reduce:animate-none"
  />
)

export default UsagePollDot
