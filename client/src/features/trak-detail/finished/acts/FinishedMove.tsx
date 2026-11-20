/**
 * The move: what is on the branch, and where it would go.
 *
 * **Where it stands is what a pull request changes, and `foot` is the whole of it.** On a
 * trak with no forge behind it the move is the card — the destination is the largest thing
 * on the pane, which is the merge's own rule drawn rather than written: a
 * host merge goes wherever the daemon's machine is standing, so it is a fact about somebody
 * else's checkout and it is shown before it is honoured. On a trak whose branch has a pull
 * request the subject is the pull request, and the move is its footer — recessed, under a
 * rule, at the size of the rows above it rather than over them.
 *
 * **A closed trak draws no destination.** An arrow there would promise a merge that is
 * never going to happen; closing is an ending in its own right, so the right-hand side says
 * where the work *is* rather than where it is going. `arrowEnd` is what decides that, and
 * every word on that side of the arrow comes from it — a merged trak names the commit its
 * branch went in as, which is the one destination that survives the merge.
 *
 * **A finished trak with nothing on its branch draws no right-hand side at all**, which is
 * a step past that: the arrow is not hidden, it is not there, and nothing stands where the
 * destination would have. The left column keeps its own width rather than growing into the
 * space, so the card is short instead of stretched — `0 commits` under the branch is the
 * whole of what there is to say, and `arrowEnd` returning nothing is what says it.
 *
 * **Commits, and no diff stat** — no files, no `+/−`, and that is still the design round's
 * choice now that a diff is a request away. Every number here is a count over the log the
 * detail already carries, so the card is right the instant it appears; a `+/−` would put a
 * second request behind a summary whose whole job is to be there already. What the work did
 * to the files is its own surface, one press up on the step bar.
 */

import type { ReactNode } from "react"
import { ArrowRight, GitBranch } from "lucide-react"
import type { EndStateDto } from "../../controls"
import { arrowEnd, type Ending } from "../finished"

const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? "" : "s"}`

const FinishedMove = ({
  state,
  ending,
  into,
  foot,
  moved,
}: {
  readonly state: EndStateDto
  readonly ending: Ending
  /** Where a merge would land, from `GET /api/traks/:id/merge`. `undefined` until it
   *  answers, and at every state with no destination left to ask about. */
  readonly into: { readonly name: string; readonly note: string } | undefined
  /** Whether a pull request stands above it in the same card, which makes this its footer
   *  rather than the whole of it. */
  readonly foot: boolean
  /** Whether anything was kept on the branch — `branchMoved`, read off the log by the
   *  pane. It decides whether there is a right-hand side; `arrowEnd` is what says so. */
  readonly moved: boolean
}): ReactNode => {
  const end = arrowEnd(state, into, moved)
  const name = foot ? "text-sm" : "text-base"

  return (
    <div
      className={`flex flex-col gap-3 ${foot ? "border-t border-border bg-surface-2 px-4 py-3" : "p-4"}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <GitBranch size={13} aria-hidden className="shrink-0 text-fg-subtle" />
            <span className={`min-w-0 truncate font-mono text-fg ${name}`}>
              {ending.branch ?? "no branch"}
            </span>
          </span>
          <span className="font-mono text-2xs text-fg-muted">
            {plural(ending.commits, "commit")}
          </span>
        </span>

        {end !== undefined && (
          <>
            <ArrowRight
              size={16}
              aria-hidden
              className={`shrink-0 text-fg-subtle ${end.unmerged ? "opacity-0" : ""}`}
            />

            <span className="flex min-w-0 flex-col gap-1">
              {end.unmerged ? (
                <span className={`min-w-0 truncate text-fg-muted ${name}`}>{end.name}</span>
              ) : (
                <span className={`min-w-0 truncate font-mono text-fg ${name}`}>{end.name}</span>
              )}
              <span className="font-mono text-2xs text-fg-subtle">{end.note}</span>
            </span>
          </>
        )}
      </div>

      {/* What it took. Every number is a count over the log — none of it is new work, and
          a log with no timestamps says nothing rather than a zero. */}
      <span className="flex flex-wrap items-baseline gap-x-2 border-t border-border pt-2 font-mono text-2xs text-fg-subtle">
        <span>{plural(ending.steps, "step")}</span>
        <span aria-hidden>·</span>
        <span>stopped for you {plural(ending.gates, "time")}</span>
        {ending.elapsed !== undefined && (
          <>
            <span aria-hidden>·</span>
            <span>{ending.elapsed}</span>
          </>
        )}
      </span>
    </div>
  )
}

export default FinishedMove
