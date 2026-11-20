/**
 * A merge that did not go in, on the finished pane: what was refused, what git said or
 * which files were in the way, and the press that commits the destination and merges.
 *
 * **Under the ending's own sentence and above the move card**, on the card's own surface
 * with the whole of the tone spent on the head — not the red ground `FailedNotice`'s
 * `Shell` takes, because nothing was lost: the work is on its branch and the checkout is
 * held, exactly as the sentence above says. The triangle, not the slash, for the same
 * reason — it is the glyph a refusal that changed nothing wears, on `RefusalNotice` and
 * on this pane's own overridden-checks line. It sits here rather than at the top of the pane
 * or in the press band, on a plain plate rather than a tinted one.
 *
 * **Git's output is drawn verbatim and capped**, the engine's command prefix on its own
 * line above it, on the recess every process's bytes take — `GateFace`'s block. At forty
 * files it is the pane, and a 160px scroller is what keeps the move card and the presses
 * within reach on a phone.
 *
 * **The file list sits on a recessed wash of its own**, so a list cut at the same cap reads
 * as *more below* rather than as broken text: the ground is outside the scroller and stays
 * put while the rows move under it. Each path clips its folder and keeps its basename,
 * because at 375px `truncate` on a whole path throws away the one word that says which
 * file it is.
 *
 * **The commit press is quiet, and Merge in the band stays the loud one.** `GitCommitVertical`
 * rather than `GitMerge`, which the Merge press already wears: the commit is the half of this
 * press that Merge does not do. One press, no confirmation: a naming step or an Archive-style
 * panel would only slow it down.
 *
 * `basis-64` on the cost sentence is what makes the phone answer fall out rather than be
 * switched on: it sits beside the press wherever 256px are left and takes its own line
 * where they are not.
 */

import type { ReactNode } from "react"
import { GitCommitVertical, TriangleAlert } from "lucide-react"
import AnsiText from "../../../../components/AnsiText"
import Button from "../../../../components/Button"
import type { MergeRefusal } from "./mergeRefusal"
import { gitSaid } from "./mergeRefusal"
import type { CommitAndMerge } from "./useCommitAndMerge"

/** One path, the folder clipped and the basename kept. */
const Path = ({ path }: { readonly path: string }): ReactNode => {
  const cut = path.lastIndexOf("/") + 1
  return (
    <li className="flex min-w-0 font-mono text-xs leading-5 text-fg-muted first:pt-1.5 last:pb-1.5">
      {cut > 0 && <span className="min-w-0 truncate">{path.slice(0, cut)}</span>}
      <span className="shrink-0">{path.slice(cut)}</span>
    </li>
  )
}

/** What git said, whole: the engine's prefix as its own line, the rest on the recess. */
const Said = ({ said }: { readonly said: string }): ReactNode => {
  const { command, output } = gitSaid(said)
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {command !== undefined && (
        <span className="min-w-0 truncate font-mono text-2xs text-fg-subtle">{command}</span>
      )}
      <div className="min-w-0 overflow-hidden rounded-control border border-border bg-surface-2">
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-xs text-fg-muted">
          <AnsiText text={output} />
        </pre>
      </div>
    </div>
  )
}

/** The paths the pre-check named, where git never spoke. */
const Files = ({ files }: { readonly files: readonly string[] }): ReactNode => (
  <div className="min-w-0 rounded-control border border-border bg-surface-2 px-2">
    <ul className="flex max-h-40 min-w-0 flex-col gap-0.5 overflow-y-auto">
      {files.map((file) => (
        <Path key={file} path={file} />
      ))}
    </ul>
  </div>
)

const MergeRefused = ({
  refusal,
  commit,
}: {
  readonly refusal: MergeRefusal
  /** The hook keyed to the trak this plate is about. Drawn only where `refusal.commit`
   *  names a parent — the route refuses a trak at the top, and the client never asks. */
  readonly commit: CommitAndMerge
}): ReactNode => (
  <div
    role="alert"
    className="flex min-w-0 flex-col gap-2 rounded-surface border border-border bg-surface px-3 py-2.5"
  >
    <span className="flex items-center gap-1.5 font-mono text-2xs uppercase tracking-wider text-tone-bad">
      <TriangleAlert size={11} aria-hidden />
      {refusal.head}
    </span>
    {/* `TrakFailure`'s measure and ink, so the two plates read as one thing. */}
    <p className="text-base leading-5 text-fg-muted">{refusal.line}</p>
    {refusal.said === undefined ? <Files files={refusal.files} /> : <Said said={refusal.said} />}
    {refusal.commit !== undefined && (
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button
            variant="quiet"
            icon={GitCommitVertical}
            busy={commit.isPending}
            disabled={commit.disabled}
            onClick={commit.commit}
          >
            {refusal.commit.press}
          </Button>
          <span className="min-w-0 flex-1 basis-64 text-sm text-fg-subtle">
            {refusal.commit.says}
          </span>
        </div>
        {commit.said !== undefined && <p className="text-sm text-tone-bad">{commit.said}</p>}
      </div>
    )}
  </div>
)

export default MergeRefused
