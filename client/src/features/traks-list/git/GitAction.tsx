/**
 * The bar's one action as a full-bleed cell: the whole height of whatever it sits in, no
 * fill and no box, so the hairlines beside it are all that divide the bar. Plain words stand in its
 * place where the checkout has no origin or no branch.
 *
 * The strip draws it at the bar's height; the phone's sheet draws it `tap`, a full-width
 * row at the thumb's size. The Fetch cell carries the age of the last fetch, since no
 * chevron menu is beside it to hold one.
 *
 * **It spends nothing.** Each press is `git` against the project checkout; no agent runs.
 */

import type { ReactNode } from "react"
import { CloudUpload, Download, GitMerge, Loader2, RefreshCw } from "lucide-react"
import type { GitActionDto } from "../../../api/types"
import GitCounts from "./GitCounts"
import GitFetched from "./GitFetched"
import type { GitView } from "./gitView"
import type { GitPress } from "./useGitBar"

export const GIT_GLYPH = {
  fetch: RefreshCw,
  pull: Download,
  reconcile: GitMerge,
  push: CloudUpload,
} as const satisfies Record<GitActionDto, unknown>

const GitAction = ({
  view,
  press,
  tap,
}: {
  readonly view: GitView
  readonly press: (press: GitPress) => void
  /** The sheet's full-width row, rather than the strip's cell. */
  readonly tap: boolean
}): ReactNode => {
  const { cell } = view
  if (cell._tag === "None")
    return (
      <span
        className={`flex shrink-0 items-center font-mono text-2xs text-fg-subtle ${tap ? "h-12 justify-center" : "px-5"}`}
      >
        {cell.said}
      </span>
    )
  const Glyph = cell.busy ? Loader2 : GIT_GLYPH[cell.action]
  return (
    <button
      type="button"
      aria-label={cell.verb}
      disabled={!view.idle}
      onClick={() => {
        press({ action: cell.action, stash: false })
      }}
      className={`flex shrink-0 items-center font-medium whitespace-nowrap text-fg transition-colors hover:bg-hover-bare disabled:text-fg-muted ${
        tap ? "h-12 grow justify-center gap-2 px-5 text-base" : "h-full gap-1.5 px-5 text-sm"
      }`}
    >
      <Glyph size={tap ? 16 : 13} aria-hidden className={cell.busy ? "animate-spin" : ""} />
      {cell.verb}
      {(cell.ahead > 0 || cell.behind > 0) && (
        <GitCounts counts={{ _tag: "Apart", ahead: cell.ahead, behind: cell.behind }} />
      )}
      {cell.action === "fetch" && !cell.busy && <GitFetched view={view} lead="· " />}
    </button>
  )
}

export default GitAction
