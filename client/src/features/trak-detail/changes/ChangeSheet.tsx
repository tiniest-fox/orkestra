/**
 * The file index as a sheet over the phone's diff, opened from the pill.
 *
 * **A modal, so it sits behind a wash** — `components/README`'s elevation rule, and
 * `Lightbox` is the pattern for the machinery: `fixed inset-0` at `z-40` in the tree of
 * what opened it, focus taken before paint, Escape as a handler on this component's own
 * node rather than a document listener, and a press on the wash itself closing.
 * `Lightbox` carries why each is the shape it is, including the price — no focus trap.
 *
 * **What it must not look like is the `Drawer`.** A drawer is a region: square, edged,
 * level with the app. This is a card that rises over it — `rounded-t-sheet`, a shadow and
 * no border, with a grab handle saying it is temporary — and the header is a label and
 * the slice's total, not a toolbar. The ways out are the wash, Escape and picking a file,
 * which is why focus lands on the sheet itself: there is no close control to take it.
 *
 * **It rises from the foot and stops short of the top**, so the diff stays visible above
 * it: the sheet is somewhere you go from the code, not a page that replaces it. The card
 * pays the home indicator's inset itself (`pb-safe-b`) — there is no chat bar below this
 * surface to pay it the way the step altitude's does — while its surface still runs to
 * the screen's true edge.
 *
 * **`isolate` keeps the tree's stacked z-indexes inside** — `ChangeTree` numbers its
 * pinned headers against each other, and those values must not compete with anything
 * outside the sheet. `overflow-hidden` is what makes the top corners real: the scroller
 * inside would otherwise square them off.
 */

import type { KeyboardEvent, MouseEvent, ReactNode } from "react"
import { useLayoutEffect, useRef } from "react"
import { omittedFootnote } from "./changes"
import ChangeTree from "./ChangeTree"
import type { FileChangeDto } from "../../../api/types"
import type { TreeNode } from "../../../format/fileTree"

const ChangeSheet = ({
  nodes,
  at,
  total,
  omitted,
  onPick,
  onClose,
}: {
  readonly nodes: readonly TreeNode<FileChangeDto>[]
  /** The path of the file under the top of the diff, which lights its row. */
  readonly at: string | undefined
  /** The slice's own headline — `26 files +1147 −259` — said again here because the
   *  picker that says it first has scrolled away with the top of the stack. */
  readonly total: string
  /** How many files the cap dropped, said here as well as at the foot of the diff — an
   *  index that stopped without saying so reads as a complete list. */
  readonly omitted: number | undefined
  readonly onPick: (path: string) => void
  readonly onClose: () => void
}): ReactNode => {
  const sheet = useRef<HTMLDivElement>(null)
  const note = omittedFootnote(omitted)

  useLayoutEffect(() => {
    sheet.current?.focus()
  }, [])

  return (
    <div
      ref={sheet}
      role="dialog"
      aria-label="Files changed"
      tabIndex={-1}
      // `outline-none` because focus lands here programmatically — a landing place, not a
      // stop (`Lightbox`'s -1), and the UA ring would frame the whole screen.
      className="fixed inset-0 z-40 flex flex-col justify-end bg-scrim outline-none"
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") onClose()
      }}
      onClick={(event: MouseEvent<HTMLDivElement>) => {
        // The wash itself, not the sheet standing on it: a press inside the list must
        // not shut the index it is picking from.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="isolate flex max-h-[85%] min-h-0 flex-col overflow-hidden rounded-t-sheet bg-surface pb-safe-b shadow-modal">
        <span aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-pill bg-border" />

        <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-1.5">
          <span className="font-mono text-2xs uppercase tracking-wider text-fg-subtle">
            Files changed
          </span>
          <span className="font-mono text-2xs text-fg-muted">{total}</span>
        </div>

        <nav className="min-h-0 overflow-y-auto overscroll-contain pb-2">
          <ChangeTree nodes={nodes} at={at} onPick={onPick} />
          {note !== undefined && <p className="px-4 py-2 text-2xs text-fg-subtle">{note}</p>}
        </nav>
      </div>
    </div>
  )
}

export default ChangeSheet
