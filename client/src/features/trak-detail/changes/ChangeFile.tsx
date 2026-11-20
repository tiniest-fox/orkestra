/**
 * One file of the diff, as a bordered card.
 *
 * **The card's edge is the file boundary and nothing else is.** A heavier per-file band and
 * a single pinned breadcrumb were both drawn and both rejected — twenty-six grey bars on a
 * pane already carrying washes and syntax colour, and a rule too quiet to catch on a fast
 * scroll. The edge costs 16px of code column and says it once.
 *
 * **`overflow-hidden` is load-bearing**: without it the hunk bands' own grounds square off
 * the rounded corners.
 *
 * **And `shrink-0` is what pays for it.** The card is a flex item in `ChangeList`'s column
 * scroller, and a flex item's automatic minimum size is its content — except where it has
 * overflow of its own, which drops it to zero. Take `shrink-0` away and that zero lets a diff
 * taller than the pane be squeezed into it instead of overflowing: every card compresses to a
 * few rows, the rest is clipped, and no scrollbar appears anywhere, because nothing overflows.
 *
 * **Pressing anywhere in the header folds the file**, not only the chevron — 32px of header
 * with a path in it is the target a reader aims at.
 */

import type { ReactNode } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { FileChangeDto } from "../../../api/types"
import { counts, omittedWords, splitPath } from "./changes"
import ChangeHunk from "./ChangeHunk"
import { useHighlight } from "./useHighlight"

/** The dot's colour, by what happened to the file. A rename is the one change with no side
 *  to be on, so it takes the subtle ink rather than a fourth mark. */
export const CHANGE_MARK: Readonly<Record<FileChangeDto["change"], string>> = {
  added: "bg-diff-added",
  modified: "bg-diff-modified",
  deleted: "bg-diff-deleted",
  renamed: "bg-fg-subtle",
}

const ChangeFile = ({
  file,
  gutter,
  folded,
  onFold,
  hold,
  note,
}: {
  readonly file: FileChangeDto
  /** Which line numbers the gutter carries — `ChangeHunk` says why a phone gives one up. */
  readonly gutter: "pair" | "new"
  readonly folded: boolean
  readonly onFold: (path: string) => void
  /** Hands the card's node up, so the index can scroll to it and know where it starts. */
  readonly hold: (path: string, node: HTMLElement | null) => void
  /** What to say in place of the hunks, over the file's own reason — a generated file's
   *  patch that could not be read. */
  readonly note?: string
}): ReactNode => {
  const { dir, name } = splitPath(file.path)
  const nothing = note ?? omittedWords(file)
  // Called unconditionally, which is the rules of hooks and also the right behaviour: a
  // grammar fetched for a folded card is a grammar already there when it opens.
  const painted = useHighlight(file)
  const Chevron = folded ? ChevronRight : ChevronDown

  return (
    <section
      ref={(node) => {
        hold(file.path, node)
      }}
      aria-label={file.path}
      className="shrink-0 overflow-hidden rounded-surface border border-border bg-surface"
    >
      <button
        type="button"
        onClick={() => {
          onFold(file.path)
        }}
        aria-expanded={!folded}
        className="flex h-8 w-full items-center gap-2 px-2 text-left transition-colors hover:bg-hover-row"
      >
        <Chevron size={13} aria-hidden className="shrink-0 text-fg-subtle" />
        <span aria-hidden className={`size-2 shrink-0 rounded-pill ${CHANGE_MARK[file.change]}`} />
        <span className="min-w-0 flex-1 truncate font-mono text-sm">
          <span className="text-fg-subtle">{dir}</span>
          {/* Colour alone separates the basename from the directory it follows. It carried a
              medium weight as well, and the only other medium on the surface is the slice
              picker's tabs — so the name read as a heading over its own diff. */}
          <span className="text-fg">{name}</span>
          {file.oldPath !== undefined && (
            <span className="pl-1.5 text-2xs text-fg-subtle">was {file.oldPath}</span>
          )}
        </span>
        <span className="shrink-0 font-mono text-2xs text-fg-muted">{counts(file)}</span>
      </button>

      {!folded &&
        (nothing === undefined ? (
          // The scroller is the whole body rather than one per hunk, so every hunk of a
          // file scrolls together and a gutter stays beside the row it labels.
          <div className="overflow-x-auto">
            {file.hunks.map((hunk, i) => (
              // Hunks are positional, carry no id, and a file's diff is replaced whole.
              // oxlint-disable-next-line react/no-array-index-key
              <ChangeHunk key={i} hunk={hunk} gutter={gutter} painted={painted?.[i]} />
            ))}
          </div>
        ) : (
          <p className="border-t border-border bg-surface-2 px-2 py-2 text-sm text-fg-muted">
            {nothing}
          </p>
        ))}
    </section>
  )
}

export default ChangeFile
