/**
 * Rendered | Source, in the band of a markdown file on a desk — two words in a recessed
 * well, the current one raised, so both views are always named and the lit one is the
 * view on screen.
 */

import type { ReactNode } from "react"
import { Code, FileText } from "lucide-react"
import type { FileView } from "./useFileBrowser"

const SEGMENTS = [
  { view: "rendered", word: "Rendered", Glyph: FileText },
  { view: "source", word: "Source", Glyph: Code },
] as const

const ViewToggle = ({
  view,
  onView,
}: {
  readonly view: FileView
  readonly onView: (view: FileView) => void
}): ReactNode => (
  <span
    role="group"
    aria-label="View"
    className="ml-2 flex h-6 shrink-0 items-stretch gap-0.5 rounded-control bg-surface-2 p-0.5"
  >
    {SEGMENTS.map(({ view: value, word, Glyph }) => {
      const on = view === value
      return (
        <button
          key={value}
          type="button"
          aria-pressed={on}
          onClick={() => onView(value)}
          className={`flex items-center gap-1 rounded-control px-2 text-xs font-medium transition-colors ${on ? "bg-surface text-fg ring-1 ring-border" : "text-fg-muted hover:text-fg"}`}
        >
          <Glyph size={12} aria-hidden />
          {word}
        </button>
      )
    })}
  </span>
)

export default ViewToggle
