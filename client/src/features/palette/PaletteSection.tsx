/**
 * One section of the palette's answer: a heading with its glyph, its label and a count,
 * which sticks while the section scrolls under it, then the rows.
 */

import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

const PaletteSection = ({
  icon: Icon,
  label,
  count,
  children,
}: {
  readonly icon: LucideIcon
  readonly label: string
  readonly count: string
  readonly children: ReactNode
}): ReactNode => (
  <section aria-label={label} className="flex flex-col">
    <h2 className="sticky top-0 z-10 flex items-center gap-1.5 bg-surface px-3 py-1">
      <Icon size={12} aria-hidden className="text-fg-subtle" />
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      <span className="text-xs text-fg-subtle tabular-nums">· {count}</span>
    </h2>
    {children}
  </section>
)

export default PaletteSection
