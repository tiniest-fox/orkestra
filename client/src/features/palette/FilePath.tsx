/**
 * A file as the palette names it: a badge with its extension, then the whole path in
 * mono with the folder muted and the name bright — so a file reads as a different kind of
 * thing from a trak, which is set in sans.
 */

import type { ReactNode } from "react"
import Marked from "./Marked"
import { badgeOf, folderOf, nameOf } from "./matches"

const FilePath = ({
  path,
  query,
}: {
  readonly path: string
  readonly query: string
}): ReactNode => (
  <>
    <span
      aria-hidden
      className="flex h-5 w-9 shrink-0 items-center justify-center rounded-control border border-border font-mono text-2xs text-fg-muted"
    >
      {badgeOf(path)}
    </span>
    <span className="min-w-0 truncate font-mono text-sm">
      <span className="text-fg-subtle">{folderOf(path)}</span>
      <span className="text-fg">
        <Marked text={nameOf(path)} query={query} />
      </span>
    </span>
  </>
)

export default FilePath
