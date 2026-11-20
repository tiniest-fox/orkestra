/**
 * What the phone's git-action tab says. The tab is a glyph alone and opens the sheet rather
 * than pressing, so the corner badge is all it says at rest and the label is what it says
 * aloud.
 *
 * **A dismissed problem outranks a count**, as its word did on the old band: an amber `!`.
 * Then how far behind, in the working tone, since behind is what a Pull or a Reconcile
 * acts on — 99+ above 99. Then how far ahead, neutral, when nothing is behind. Reconcile's
 * ahead count is therefore not on the tab; the sheet says it.
 */

import type { Tone } from "../../../format/tone"
import type { GitView } from "./gitView"

export interface TabBadge {
  readonly text: string
  readonly tone: Tone
}

const MOST = 99

const count = (n: number): string => (n > MOST ? `${String(MOST)}+` : String(n))

/** The problem the band no longer raises, which the tab carries instead. */
const dismissed = (view: GitView) => (view.risen ? undefined : view.problem)

export const actionBadge = (view: GitView): TabBadge | undefined => {
  if (dismissed(view) !== undefined) return { text: "!", tone: "waiting" }
  const { cell } = view
  if (cell._tag === "None" || cell.busy) return undefined
  if (cell.behind > 0) return { text: count(cell.behind), tone: "working" }
  if (cell.ahead > 0) return { text: count(cell.ahead), tone: "neutral" }
  return undefined
}

/** "Pull, 3 behind", "Reconcile, 12 ahead, 128 behind", "Pull, refused", "no origin". */
export const actionLabel = (view: GitView): string => {
  const { cell } = view
  if (cell._tag === "None") return `Git: ${cell.said}`
  const problem = dismissed(view)
  const said =
    problem === undefined
      ? [
          cell.ahead > 0 ? `${String(cell.ahead)} ahead` : undefined,
          cell.behind > 0 ? `${String(cell.behind)} behind` : undefined,
        ]
      : [problem.word.toLowerCase()]
  return [cell.verb, ...said].filter((part) => part !== undefined).join(", ")
}
