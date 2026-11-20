/**
 * The pinned file index down the left of the diff.
 *
 * **No `+N −M` here.** The counts live on the file's own header, which is where you are
 * when you want them — repeating them in a 160px column costs the basename its room and
 * says the same thing twice on one screen.
 *
 * **A coloured dot rather than a glyph.** Four shapes at 11px are more alike than two
 * colours are; the round marks are `styles.css`'s `diff-*` scale, which exists because the
 * tones are too dark to read at this size.
 *
 * **Where you are is an accent tint plus an inset bar** — the system's own separation of
 * *selected* from *hovered*, and it follows the diff's scroll rather than only a press.
 */

import type { ReactNode } from "react"
import type { IndexRow } from "../../../format/fileTree"
import { CHANGE_MARK } from "./ChangeFile"

const ChangeIndex = ({
  rows,
  at,
  omitted,
  onPick,
}: {
  readonly rows: readonly IndexRow[]
  /** The path of the file under the top of the diff, or `undefined` before the first
   *  measurement. */
  readonly at: string | undefined
  /** How many files the cap dropped, said here as well as at the foot of the diff — an
   *  index that stopped without saying so reads as a complete list. */
  readonly omitted: number | undefined
  readonly onPick: (path: string) => void
}): ReactNode => (
  <nav aria-label="Files changed" className="w-40 shrink-0 overflow-y-auto py-1">
    {rows.map((row) =>
      row.kind === "dir" ? (
        <p
          key={`d:${String(row.depth)}:${row.label}`}
          style={{ paddingLeft: `${String(6 + row.depth * 10)}px` }}
          className="truncate py-0.5 font-mono text-2xs text-fg-subtle"
        >
          {row.label}
        </p>
      ) : (
        <button
          key={row.path}
          type="button"
          aria-current={row.path === at ? "true" : undefined}
          onClick={() => {
            onPick(row.path)
          }}
          style={{ paddingLeft: `${String(6 + row.depth * 10)}px` }}
          className={`relative flex h-[22px] w-full items-center gap-1.5 pr-2 text-left transition-colors ${
            row.path === at ? "bg-accent/10" : "hover:bg-hover-row"
          }`}
        >
          {row.path === at && (
            <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-accent" />
          )}
          <span aria-hidden className={`size-2 shrink-0 rounded-pill ${CHANGE_MARK[row.change]}`} />
          <span className="min-w-0 truncate font-mono text-sm text-fg">{row.label}</span>
        </button>
      ),
    )}

    {omitted !== undefined && omitted > 0 && (
      <p className="px-1.5 py-1 text-2xs text-fg-subtle">{String(omitted)} more not shown</p>
    )}
  </nav>
)

export default ChangeIndex
