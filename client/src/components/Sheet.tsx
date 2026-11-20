/**
 * A bottom sheet over the phone's list, behind a wash — `ChangeSheet`'s machinery: `fixed
 * inset-0` at `z-40` in the caller's own tree with no portal, focus taken onto the sheet
 * before paint, Escape as a handler on this node, and a press on the wash shutting it.
 * The card pays the home indicator's inset itself, since no bar sits under it.
 *
 * **It is capped short of the top, and `tall` holds it there** — for a process's log, which
 * is a scroller of its own and would otherwise be as short as its first lines.
 *
 * Three callers: the git bar's card, its processes, and the project's file tree. `label` is
 * what each names its dialog.
 *
 * **The 16px gutter is inside the scroller, never on the card.** `overflow-y-auto` clips
 * the x axis too, so a row that runs edge to edge with `-mx-4` against padding outside the
 * scroller loses 16px each side — the git sheet's presses do that, and land exactly on the
 * scroller's edges this way round. `flush` drops the gutter for content that is edge to
 * edge as a whole, such as the file tree, and pads its own text.
 */

import type { KeyboardEvent, MouseEvent, ReactNode } from "react"
import { useLayoutEffect, useRef } from "react"

const Sheet = ({
  label,
  onClose,
  tall,
  flush = false,
  children,
}: {
  readonly label: string
  /** No gutter: the content runs to both edges and pads what it needs itself. */
  readonly flush?: boolean
  readonly onClose: () => void
  readonly tall: boolean
  readonly children: ReactNode
}): ReactNode => {
  const sheet = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    sheet.current?.focus()
  }, [])

  return (
    <div
      ref={sheet}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className="fixed inset-0 z-40 flex flex-col justify-end bg-scrim outline-none"
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") onClose()
      }}
      onClick={(event: MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={`flex min-h-0 flex-col rounded-t-sheet bg-surface pt-2 pb-foot shadow-modal ${tall ? "h-[85%]" : "max-h-[85%]"}`}
      >
        <span aria-hidden className="mx-auto mb-3 block h-1 w-9 shrink-0 rounded-pill bg-border" />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className={`flex flex-1 flex-col ${flush ? "" : "px-4"}`}>{children}</div>
        </div>
      </div>
    </div>
  )
}

export default Sheet
