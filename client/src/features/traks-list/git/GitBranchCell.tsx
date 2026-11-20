/**
 * The head of the strip's git block: the branch name, and the press that opens its card. **The card
 * toggles from the branch and shuts on Escape, on focus leaving, or on a press anywhere
 * outside it.** The first two are `OverflowMenu`'s handlers, with its reasoning about focus
 * that lands nowhere; the third is `useTapOutside`, because Safari never focuses the
 * branch's button, so a press elsewhere raises no blur. A press inside the card is inside,
 * so a person can select a line of git's output in it without shutting it.
 */

import type { FocusEvent, KeyboardEvent, ReactNode } from "react"
import { useCallback, useRef, useState } from "react"
import { GitBranch } from "lucide-react"
import { useTapOutside } from "../../../hooks/useTapOutside"
import GitCard from "./GitCard"
import type { GitView } from "./gitView"

const GitBranchCell = ({ view }: { readonly view: GitView }): ReactNode => {
  const [card, setCard] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const shut = useCallback(() => {
    setCard(false)
  }, [])
  useTapOutside(root, card, shut)
  return (
    <span
      ref={root}
      className="relative flex min-w-0"
      onKeyDown={(event: KeyboardEvent<HTMLSpanElement>) => {
        if (event.key === "Escape") setCard(false)
      }}
      onBlur={(event: FocusEvent<HTMLSpanElement>) => {
        if (event.currentTarget.contains(event.relatedTarget)) return
        if (event.relatedTarget === null && event.target.matches(":disabled")) return
        setCard(false)
      }}
    >
      <button
        type="button"
        aria-label={`Project checkout: ${view.head}`}
        aria-expanded={card}
        aria-haspopup="dialog"
        onClick={() => {
          setCard(!card)
        }}
        className="flex min-w-0 items-center gap-1.5 px-3 text-sm text-fg transition-colors hover:bg-hover-bare"
      >
        <GitBranch size={13} aria-hidden className="shrink-0 text-fg-muted" />
        <span
          className={`max-w-120 truncate font-mono ${view.detached ? "text-fg-muted italic" : ""}`}
        >
          {view.head}
        </span>
      </button>
      {card && (
        <div
          role="dialog"
          aria-label="Project checkout"
          tabIndex={-1}
          className="absolute right-0 bottom-full mb-2 w-90 rounded-surface border border-border bg-surface p-3 shadow-menu outline-none"
        >
          <GitCard view={view} />
        </div>
      )}
    </span>
  )
}

export default GitBranchCell
