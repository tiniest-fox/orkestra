import type { ReactNode } from "react"

/**
 * The `+N more` line under a cut pile of idle rows, and the `Show fewer` line once it is
 * open: an idle row's own box, its tile column left empty so the words start where the
 * titles do. A row of the pile as far as the dividers are concerned — `data-idle`.
 */
const IdleMore = ({
  onPress,
  expanded,
  children,
}: {
  readonly onPress: () => void
  readonly expanded: boolean
  readonly children: ReactNode
}): ReactNode => (
  <li data-idle>
    <button
      type="button"
      onClick={onPress}
      aria-expanded={expanded}
      className="flex min-h-11 w-full items-center gap-4 px-gutter text-left font-mono text-2xs text-fg-subtle transition-colors hover:bg-hover-row hover:text-fg-muted sm:min-h-7"
    >
      <span aria-hidden className="w-6 shrink-0" />
      {children}
    </button>
  </li>
)

export default IdleMore
