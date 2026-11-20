/**
 * The project's tree: a folder opens and shuts, a file is a press that opens it. The file
 * on screen is marked. Folders before files, and a chain of lone folders is one row —
 * `browseTree`. On a phone each row clears the 44px floor.
 */

import type { ReactNode } from "react"
import { ChevronDown, ChevronRight, File, Folder } from "lucide-react"
import type { BrowseRow } from "./browseTree"

/** The panel's 8px, then 14px a level. */
const indentPx = (depth: number): number => 8 + depth * 14

const FileTreeView = ({
  rows,
  selected,
  tap,
  onFolder,
  onFile,
}: {
  readonly rows: readonly BrowseRow[]
  readonly selected: string | undefined
  readonly tap: boolean
  readonly onFolder: (path: string) => void
  readonly onFile: (path: string) => void
}): ReactNode => (
  <ul aria-label="Project files" className="flex flex-col py-1">
    {rows.map((row) => {
      const folder = row.kind === "dir"
      const Chevron = folder && row.open ? ChevronDown : ChevronRight
      const here = row.path === selected
      return (
        <li key={`${row.kind}:${row.path}`}>
          <button
            type="button"
            aria-expanded={folder ? row.open : undefined}
            aria-current={here ? "true" : undefined}
            onClick={() => {
              if (folder) onFolder(row.path)
              else onFile(row.path)
            }}
            style={{ paddingLeft: indentPx(row.depth) }}
            className={`flex w-full min-w-0 items-center gap-1.5 pr-2 text-left font-mono text-sm ${tap ? "min-h-11" : "h-6"} ${here ? "bg-surface-2 text-fg" : "text-fg hover:bg-hover-row"}`}
          >
            {folder ? (
              <Chevron size={12} aria-hidden className="shrink-0 text-fg-subtle" />
            ) : (
              <span aria-hidden className="w-3 shrink-0" />
            )}
            {folder ? (
              <Folder size={13} aria-hidden className="shrink-0 text-fg-subtle" />
            ) : (
              <File size={13} aria-hidden className="shrink-0 text-fg-subtle" />
            )}
            <span className={`truncate ${folder ? "text-fg-muted" : ""}`}>{row.label}</span>
          </button>
        </li>
      )
    })}
  </ul>
)

export default FileTreeView
