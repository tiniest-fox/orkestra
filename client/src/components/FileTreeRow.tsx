/**
 * One file's row in `FileTree`: its kind as a letter in the diff's ink, its name, a
 * rename's old name, its reason under the name, its counts or the warning that the diff
 * lacks it, and a chevron where it opens.
 *
 * **The reason is cut at two lines while shut and whole once open.** So a file is a press
 * where it has a body to open *or* where its reason is cut: otherwise a long reason on a
 * file with no sketch and no lines could never be read in full. A file with neither would
 * open onto nothing, and is no press.
 *
 * **Whether the reason is cut is measured, not guessed**, in a layout effect on the row's
 * own note, before the first paint and again whenever it is resized. An open row keeps the
 * answer it had shut, since nothing in it is clamped to ask.
 */

import type { ReactNode } from "react"
import { useLayoutEffect, useRef, useState } from "react"
import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react"
import type { ChangeKind } from "../format/changeMap"
import CodeSpans from "./CodeSpans"
import type { TreeFile } from "./FileTree"

const LETTER: Readonly<Record<ChangeKind, string>> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
}

const INK: Readonly<Record<ChangeKind, string>> = {
  added: "text-diff-added",
  modified: "text-diff-modified",
  deleted: "text-diff-deleted",
  renamed: "text-diff-modified",
}

const WORD: Readonly<Record<ChangeKind, string>> = {
  added: "Added",
  modified: "Changed",
  deleted: "Deleted",
  renamed: "Renamed",
}

/** What sits at the row's right edge: the warning, or the counts. */
const Tally = ({ file }: { readonly file: TreeFile }): ReactNode => {
  if (file.missing)
    return (
      <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs leading-5 text-tone-waiting">
        <TriangleAlert size={12} strokeWidth={2.25} aria-hidden />
        not in the diff
      </span>
    )
  if (file.counts === undefined) return undefined
  return (
    <span className="shrink-0 whitespace-nowrap font-mono text-sm leading-5 tabular-nums">
      <span className="text-diff-added">+{file.counts.added}</span>{" "}
      <span className="text-diff-deleted">−{file.counts.deleted}</span>
    </span>
  )
}

const FileTreeRow = ({
  file,
  name,
  indent,
  open,
  narrow,
  onToggle,
}: {
  readonly file: TreeFile
  /** The name the tree gives it — the last segment of its path. */
  readonly name: string
  readonly indent: number
  readonly open: boolean
  readonly narrow: boolean
  readonly onToggle: () => void
}): ReactNode => {
  const note = useRef<HTMLSpanElement>(null)
  const [cut, setCut] = useState(false)
  useLayoutEffect(() => {
    const node = note.current
    if (node === null || open) return undefined
    // To within a pixel of rounding.
    const measure = (): void => {
      setCut(node.scrollHeight > node.clientHeight + 1)
    }
    measure()
    const resized = new ResizeObserver(measure)
    resized.observe(node)
    return () => {
      resized.disconnect()
    }
    // `cut` too: it turns the row from a `div` into a `button`, which mounts a new note, and
    // an observer left on the detached one reads 0 and turns the cut back off.
  }, [open, file.why, cut])
  const pressable = file.body !== undefined || cut
  const Chevron = open ? ChevronDown : ChevronRight
  const row = (
    <>
      <abbr
        title={WORD[file.kind]}
        className={`w-2.5 shrink-0 font-mono text-sm leading-5 no-underline ${INK[file.kind]}`}
      >
        {LETTER[file.kind]}
      </abbr>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="min-w-0 font-mono text-sm leading-5 break-all text-fg">
          <span className={file.kind === "deleted" ? "line-through decoration-fg-subtle/60" : ""}>
            {name}
          </span>
          {file.oldPath !== undefined && (
            <span className="text-xs text-fg-subtle"> ← {file.oldPath.split("/").at(-1)}</span>
          )}
        </span>
        {file.why !== undefined && (
          <span
            ref={note}
            className={`min-w-0 text-xs text-fg-subtle ${open ? "" : "line-clamp-2"}`}
          >
            <CodeSpans text={file.why} />
          </span>
        )}
      </span>
      <Tally file={file} />
      {pressable && <Chevron size={12} aria-hidden className="mt-1 shrink-0 text-fg-subtle" />}
    </>
  )
  const frame = `flex w-full min-w-0 items-start gap-1.5 py-1 pr-2.5 text-left ${narrow ? "min-h-11" : ""}`
  if (!pressable)
    return (
      <div style={{ paddingLeft: indent }} className={frame}>
        {row}
      </div>
    )
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      style={{ paddingLeft: indent }}
      className={`${frame} cursor-pointer hover:bg-hover-row ${open ? "bg-hover-row" : ""}`}
    >
      {row}
    </button>
  )
}

export default FileTreeRow
