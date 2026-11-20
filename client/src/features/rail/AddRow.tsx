import type { ReactNode } from "react"
import { Plus } from "lucide-react"

/** The add row at the foot of the list, or of a team's section. */
const AddRow = ({
  label,
  onPress,
}: {
  readonly label: string
  readonly onPress: () => void
}): ReactNode => (
  <li>
    <button
      type="button"
      onClick={onPress}
      className="flex min-h-11 w-full items-center gap-3 px-gutter py-2.5 text-left text-base text-fg-muted transition-colors hover:bg-hover-row focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-control border border-dashed border-border">
        <Plus size={14} aria-hidden />
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  </li>
)

export default AddRow
