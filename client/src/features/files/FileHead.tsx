/**
 * The viewer's band: the path with its folder muted and cut from the left so the name
 * always shows, a markdown file's view toggle on a desk, the line count and language, and
 * a press that copies the path. `lead` is the press the caller puts at the left — back.
 *
 * On a phone the count drops under the path, so the path keeps the band's width.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import { Check, Copy } from "lucide-react"

const FileHead = ({
  path,
  facts,
  tap,
  toggle,
  lead,
}: {
  readonly path: string
  /** What the band says about the file — its line count and language, or its size. */
  readonly facts: string | undefined
  readonly tap: boolean
  /** Drawn between the path and the facts: the view toggle of a markdown file on a desk. */
  readonly toggle: ReactNode
  readonly lead: ReactNode
}): ReactNode => {
  // Keyed by the path rather than reset by a timer: the mark says this path was copied,
  // and goes the moment another file is open.
  const [copied, setCopied] = useState<string | undefined>(undefined)
  const cut = path.lastIndexOf("/")
  const folder = cut === -1 ? "" : path.slice(0, cut + 1)
  const name = path.slice(cut + 1)
  const Glyph = copied === path ? Check : Copy
  return (
    <div
      className={`flex shrink-0 items-center gap-2 border-b border-border bg-surface pr-2 pl-1 ${tap ? "h-14" : "h-9"}`}
    >
      {lead}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline font-mono text-sm">
          {/* `rtl` cuts the folder from its start, so the end beside the name survives;
              `bdi` keeps the slashes reading left to right. */}
          <span className="min-w-0 truncate text-fg-subtle" dir="rtl">
            <bdi>{folder}</bdi>
          </span>
          <span className="shrink-0 text-fg">{name}</span>
        </span>
        {tap && facts !== undefined && (
          <span className="font-mono text-2xs text-fg-subtle">{facts}</span>
        )}
      </span>
      {toggle}
      {!tap && facts !== undefined && (
        <span className="shrink-0 pl-2 font-mono text-2xs text-fg-subtle">{facts}</span>
      )}
      <button
        type="button"
        aria-label={copied === path ? "Path copied" : "Copy path"}
        onClick={() => {
          void navigator.clipboard.writeText(path).then(() => setCopied(path))
        }}
        className={`flex shrink-0 items-center justify-center rounded-control text-fg-muted hover:bg-hover-bare ${tap ? "size-11" : "size-6"}`}
      >
        <Glyph size={tap ? 16 : 13} aria-hidden />
      </button>
    </div>
  )
}

export default FileHead
