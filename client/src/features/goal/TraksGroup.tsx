/**
 * One group of the goal's Traks tab: a mono heading with its count over the rows, as one
 * bordered list. A group with nothing in it is not drawn.
 */

import type { ReactNode } from "react"

const TraksGroup = ({
  title,
  count,
  children,
}: {
  readonly title: string
  readonly count: number
  readonly children: ReactNode
}): ReactNode =>
  count === 0 ? undefined : (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h2 className="flex items-center gap-2 font-mono text-2xs uppercase tracking-wider text-fg-subtle">
        {title}
        <span>{count}</span>
      </h2>
      <ul className="flex flex-col overflow-hidden rounded-surface border border-border bg-surface [&>li+li]:border-t [&>li+li]:border-border">
        {children}
      </ul>
    </section>
  )

export default TraksGroup
