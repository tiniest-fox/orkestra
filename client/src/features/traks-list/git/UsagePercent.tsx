/** A window's share used in its tone's ink — or `reset`, where it has reset since the reading. */

import type { ReactNode } from "react"
import { toneInk } from "../../../format/tone"
import type { WindowView } from "./usageView"

const UsagePercent = ({ window: w }: { readonly window: WindowView }): ReactNode =>
  w.reset ? (
    <span className="text-fg-muted">reset</span>
  ) : (
    <span
      className={`font-mono tabular-nums ${w.tone === "neutral" ? "text-fg" : toneInk[w.tone]}`}
    >
      {`${String(Math.round(w.used))}%`}
    </span>
  )

export default UsagePercent
