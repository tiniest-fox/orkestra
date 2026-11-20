/** `replan`'s view: what it added to the plan and took off it, and why. */

import type { ReactNode } from "react"
import type { PlanChange } from "../thread"

const ReplanView = ({
  change,
  why,
}: {
  readonly change: PlanChange
  readonly why: string
}): ReactNode => (
  <div className="flex flex-col gap-1 px-3 py-2 text-sm">
    {change.added.length === 0 && change.dropped.length === 0 ? (
      <span className="text-fg-muted">No change.</span>
    ) : undefined}
    {change.added.map((t) => (
      <span key={`+${t.title}`} className="text-fg">
        <span className="font-mono text-tone-good">+ </span>
        {t.title}
      </span>
    ))}
    {change.dropped.map((t) => (
      <span key={`-${t.title}`} className="text-fg-muted line-through">
        <span className="font-mono">− </span>
        {t.title}
      </span>
    ))}
    <p className="text-xs text-fg-muted">{why}</p>
  </div>
)

export default ReplanView
