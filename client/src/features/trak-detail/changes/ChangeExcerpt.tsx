/**
 * One file's lines as a change map opens them: its hunks drawn as the Changes tab draws
 * them, cut at `EXCERPT_LINES`, and the way out to the whole file on that tab.
 *
 * **The cap is 48 lines**: enough to
 * read a typical edit in place, short enough that an open file does not push every bucket
 * below it off the page. The rest is one press away rather than drawn.
 */

import type { ReactNode } from "react"
import { ArrowUpRight } from "lucide-react"
import type { FileChangeDto } from "../../../api/types"
import { capHunks, omittedWords } from "./changes"
import ChangeHunk from "./ChangeHunk"
import { useHighlight } from "./useHighlight"

export const EXCERPT_LINES = 48

const ChangeExcerpt = ({
  file,
  gutter,
  onOpen,
}: {
  readonly file: FileChangeDto
  readonly gutter: "pair" | "new"
  /** Lands the Changes tab on this file. */
  readonly onOpen: () => void
}): ReactNode => {
  const painted = useHighlight(file)
  const nothing = omittedWords(file)
  const { shown, hidden } = capHunks(file.hunks, EXCERPT_LINES)
  return (
    <div className="flex min-w-0 flex-col">
      {nothing === undefined ? (
        <div className="min-w-0 overflow-x-auto border-y border-border bg-surface">
          {shown.map((hunk, i) => (
            // Hunks are positional, carry no id, and a file's diff is replaced whole.
            // oxlint-disable-next-line react/no-array-index-key
            <ChangeHunk key={i} hunk={hunk} gutter={gutter} painted={painted?.[i]} />
          ))}
        </div>
      ) : (
        <p className="border-y border-border bg-surface-2 px-3 py-2 text-sm text-fg-muted">
          {nothing}
        </p>
      )}
      <div className="flex min-w-0 items-center justify-between gap-3 px-3 py-1.5">
        <span className="text-xs text-fg-subtle">
          {hidden > 0
            ? `${String(hidden)} more lines in this file`
            : nothing === undefined
              ? "The whole change to this file"
              : ""}
        </span>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium whitespace-nowrap text-accent hover:underline max-sm:min-h-11"
        >
          Open in Changes
          <ArrowUpRight size={12} strokeWidth={2.25} aria-hidden />
        </button>
      </div>
    </div>
  )
}

export default ChangeExcerpt
