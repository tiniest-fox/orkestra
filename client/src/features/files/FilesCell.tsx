/**
 * The strip's Files cell, at its left edge: the press that opens the Files panel and
 * shuts it again. Drawn as the processes cell is, and lit while the panel is open.
 */

import type { ReactNode } from "react"
import { FileText } from "lucide-react"

const FilesCell = ({
  open,
  onClick,
}: {
  readonly open: boolean
  readonly onClick: () => void
}): ReactNode => (
  <button
    type="button"
    aria-expanded={open}
    aria-haspopup="dialog"
    onClick={onClick}
    className={`flex items-center gap-1.5 px-3 text-sm text-fg transition-colors hover:bg-hover-bare ${open ? "bg-surface-2" : ""}`}
  >
    <FileText size={13} aria-hidden className="text-fg-muted" />
    Files
  </button>
)

export default FilesCell
