/**
 * The ⌘K palette. It
 * only searches: traks, archived ones below the live, then files by path, then lines in
 * files. On a desk it is a 620px panel over a wash, near the top of the window; on a phone
 * it is the whole screen, the field and a Cancel at its head.
 *
 * **No keyboard movement and no footer.** The picked design drew no mark on a selected
 * row, so ↑↓ and ↵ would have moved a selection nobody could see; the person dropped them.
 * Escape and a press on the wash shut it.
 *
 * Over the whole window at `z-40`, and a `dialog`, as every overlay is.
 */

import type { KeyboardEvent, MouseEvent, ReactNode } from "react"
import { Search, X } from "lucide-react"
import type { AgentDto, TrakSummaryDto } from "../../api/types"
import { findAll, foundNothing } from "./matches"
import PaletteResults from "./PaletteResults"
import type { PaletteSearch } from "./usePaletteSearch"

const Field = ({
  search,
  tap,
}: {
  readonly search: PaletteSearch
  readonly tap: boolean
}): ReactNode => (
  <label
    className={`flex min-w-0 flex-1 items-center gap-2 rounded-control border border-border bg-canvas px-2.5 ${tap ? "h-11 text-base" : "h-8 text-sm"}`}
  >
    <Search size={tap ? 16 : 13} aria-hidden className="shrink-0 text-fg-subtle" />
    <input
      // The palette exists to be typed into; opening it is asking for the cursor.
      // oxlint-disable-next-line jsx-a11y/no-autofocus
      autoFocus
      // Text with the role, not `type="search"`: the browser draws its own clear press on
      // that type, beside the one this field already has.
      type="text"
      role="searchbox"
      aria-label="Search traks, files and text"
      placeholder="Search traks, files and text"
      value={search.query}
      onChange={(event) => {
        search.setQuery(event.target.value)
      }}
      className="min-w-0 flex-1 bg-transparent font-mono text-fg outline-none placeholder:font-sans placeholder:text-fg-subtle"
    />
    {search.query !== "" && (
      <button
        type="button"
        aria-label="Clear"
        onClick={() => {
          search.setQuery("")
        }}
        className={`-mr-2.5 flex shrink-0 items-center justify-center text-fg-subtle ${tap ? "size-11" : "size-8"}`}
      >
        <X size={tap ? 16 : 12} aria-hidden />
      </button>
    )}
  </label>
)

const Palette = ({
  search,
  traks,
  archivedCount,
  paths,
  agents,
  phone,
  onClose,
  onFile,
}: {
  readonly search: PaletteSearch
  /** The live traks the list holds. */
  readonly traks: readonly TrakSummaryDto[]
  /** How many traks are put away — what the no-match sentence counts with the live. */
  readonly archivedCount: number
  /** Every file git sees, or none until the tree has answered. */
  readonly paths: readonly string[]
  readonly agents: readonly AgentDto[]
  readonly phone: boolean
  readonly onClose: () => void
  /** Open a file in the Files panel, at a line where a match named one. */
  readonly onFile: (path: string, line?: number) => void
}): ReactNode => {
  const query = search.query.trim()
  const found = findAll(query, traks, paths, search.archived, search.lines)
  const said = phone ? "px-3 py-4 text-base" : "px-3 py-4 text-sm"
  const body =
    query === "" ? (
      <p className={`${said} text-fg-subtle`}>
        Find a trak by its title, archived ones too, or a file by its path or by any text in it.
      </p>
    ) : foundNothing(found) && search.answered ? (
      <p className={`${said} text-fg-muted`}>
        Nothing matches <span className="font-mono text-fg">{query}</span> in{" "}
        {(traks.length + archivedCount).toLocaleString("en-GB")} traks or{" "}
        {paths.length.toLocaleString("en-GB")} files.
      </p>
    ) : (
      <PaletteResults
        found={found}
        query={query}
        agents={agents}
        phone={phone}
        onTrak={onClose}
        onFile={(path) => {
          onFile(path)
        }}
        onLine={onFile}
      />
    )
  const escape = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") onClose()
  }

  if (phone)
    return (
      <div
        role="dialog"
        aria-label="Search"
        onKeyDown={escape}
        className="fixed inset-0 z-40 flex flex-col bg-surface pt-safe-t pb-safe-b"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 pt-1 pb-2">
          <Field search={search} tap />
          <button type="button" onClick={onClose} className="min-h-11 px-1 text-base text-accent">
            Cancel
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{body}</div>
      </div>
    )

  return (
    <div
      role="dialog"
      aria-label="Search"
      onKeyDown={escape}
      onClick={(event: MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className="fixed inset-0 z-40 flex justify-center bg-scrim pt-16"
    >
      <div className="flex h-fit max-h-125 w-155 max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-surface border border-border bg-surface shadow-modal">
        <div className="flex shrink-0 border-b border-border p-2">
          <Field search={search} tap={false} />
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{body}</div>
      </div>
    </div>
  )
}

export default Palette
