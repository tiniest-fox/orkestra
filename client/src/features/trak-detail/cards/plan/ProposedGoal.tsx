/**
 * The goal a composer proposed on its finish — drawn on the card that offers the plan
 * gate, and again once the trak has finished and the goal exists.
 *
 * `HandOffs`' treatment, beside it: the machine tint, the mono label in the machine ink,
 * one box for the composer's words. A goal is the other work a finish opens outside this
 * trak, and the two read as one family. The label says when it starts, because nothing
 * opens at the gate itself: the goal waits for the trak to finish.
 *
 * **Afterwards it points**: once `opened` names the goal, the label goes past tense and
 * links to it, and the words stay — the goal drafts its own file from them, so they are
 * still what the reader is about to see. The link is the label line itself, so below the
 * breakpoint the line grows to the 44px touch floor rather than staying a 14px row. `FinishedView` has the log and not the answer, so
 * it passes no words and draws the link alone.
 */

import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { SquareArrowOutUpRight, Target } from "lucide-react"

const LABEL =
  "flex min-w-0 items-center gap-1.5 font-mono text-2xs uppercase tracking-wider text-source-machine"
const BOX = "min-w-0 rounded-surface bg-source-machine/10 px-3 py-2.5"

const ProposedGoal = ({
  text,
  opened,
}: {
  /** The proposal, in the composer's own markdown. Absent draws the link alone. */
  readonly text?: string
  /** The goal it started as — `goalOpenedAt`. `undefined` while the trak has not finished. */
  readonly opened: string | undefined
}): ReactNode => (
  <section
    aria-label={opened === undefined ? "A new goal" : "Opened as a goal"}
    className="flex min-w-0 flex-col gap-2"
  >
    {opened === undefined ? (
      <span className={LABEL}>
        <Target size={11} strokeWidth={2.5} aria-hidden className="shrink-0 translate-y-px" />
        <span className="min-w-0 truncate">New goal · once this trak finishes</span>
      </span>
    ) : (
      <Link
        to="/goals/$id"
        params={{ id: opened }}
        className={`${LABEL} hover:underline max-sm:min-h-11`}
      >
        <Target size={11} strokeWidth={2.5} aria-hidden className="shrink-0 translate-y-px" />
        <span className="min-w-0 truncate">Opened as a goal</span>
        <SquareArrowOutUpRight size={11} aria-hidden className="shrink-0" />
      </Link>
    )}
    {text !== undefined && (
      <div className={BOX}>
        <p className="min-w-0 whitespace-pre-wrap text-base leading-5 text-fg-muted">{text}</p>
      </div>
    )}
  </section>
)

export default ProposedGoal
