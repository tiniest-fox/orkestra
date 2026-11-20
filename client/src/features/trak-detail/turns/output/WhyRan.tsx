/**
 * Why a turn ran again, at the point in the sequence where it happened.
 *
 * **Two shapes, because the two are not the same kind of thing**, and neither is a rule
 * across the pane. A separator saying *first attempt* announces something ordinary; what
 * earns a mark is the *second* turn, and what it earns is an answer to *why was there
 * one*.
 *
 * A failed check is something that **happened**, like every other line here, so it is an
 * ordinary `Line` in the same two columns: a warning glyph in the lead, the check's name
 * in red. A check failing is news, not a chapter break.
 *
 * A human's message is the one thing on this surface a person **wrote**, and the only
 * thing addressed *to* the agent rather than reported about it — so it takes the shape
 * everything addressed to an agent takes, anchored right. Being conventional about the
 * one element every reader has already learnt somewhere else costs nothing.
 */

import type { ReactNode } from "react"
import { PackageCheck, RotateCcw, TriangleAlert } from "lucide-react"
import type { Why } from "../../filed"
import Line from "../activity/Line"
import Said from "./Said"

const WhyRan = ({ why }: { readonly why: Why }): ReactNode => {
  if (why._tag === "Said")
    return (
      <li className="flex min-w-0 justify-end pl-10 max-sm:pl-0">
        <Said text={why.text} attachments={why.attachments} />
      </li>
    )

  return (
    // No air of its own. This row is where one turn ends and the next begins, and `Line`'s
    // 2px alone would leave it flush against the last row of the turn before it and the
    // first row of its own — a boundary marker with nothing either side of it to mark. The
    // list's gap is what separates it, symmetrically and by the same amount as everything
    // else, so a second helping here would make the one row that says *a boundary* the one
    // row spaced unlike its neighbours.
    <li className="min-w-0">
      <Line
        lead={
          why._tag === "CheckFailed" ? (
            <TriangleAlert size={12} className="text-tone-bad" />
          ) : why._tag === "Filing" ? (
            // The bar's own mark for the press, so the row reads as what was pressed.
            <PackageCheck size={12} className="text-fg-subtle" />
          ) : (
            <RotateCcw size={12} className="text-fg-subtle" />
          )
        }
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span
            className={`shrink-0 font-mono text-xs ${
              why._tag === "CheckFailed" ? "text-tone-bad" : "text-fg"
            }`}
          >
            {why._tag === "CheckFailed"
              ? `${why.name} failed`
              : why._tag === "Filing"
                ? "Asked to file"
                : "Restarted"}
          </span>
          <span className="min-w-0 truncate font-mono text-xs text-fg-subtle">
            {why._tag === "CheckFailed"
              ? "re-entering the agent to fix it"
              : why._tag === "Filing"
                ? "handing over what it has"
                : "the turn was cut off"}
          </span>
        </span>
      </Line>
    </li>
  )
}

export default WhyRan
