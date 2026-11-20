/**
 * One piece of a spawn, as a column on its parent's band: the child trak drawn small.
 *
 *     ┌────┐ Port /events to the new adapter
 *     │ ⚑  │ Move the /events route across, response byte-identical
 *     └────┘ Ready to merge
 *
 * **The child's own three lines, not a row of its plan.** A step's row
 * would need the agent, the instruction and a commit, and none of the agent, the commit
 * or (for a piece that has failed or finished) the instruction is on the wire. Drawing
 * the trak instead needs nothing new, and lets the row say what a step cannot: a piece
 * waiting to be landed wears the `waiting` plate and the words *Ready to merge* rather
 * than the green check of a step that merely completed — or, where the forge has answered
 * about the piece's own branch, whatever its `Rung` says instead.
 *
 * **The instruction line is drawn only where it says something the title does not.**
 * `childPlan` makes a piece's plan title its first step's instruction, so for a real
 * child standing at that first step `title` and `instruction` are the same string — and
 * at a fifth of the row's width that is one truncated sentence printed twice. A piece of
 * several steps repeats only there. The two states that read correctly today, `Failed`
 * and `Finished`,
 * are the ones carrying no instruction at all, which is why the duplication was easy to
 * miss against a hand-written fixture.
 *
 * **The plate is the list's own**, at the same 24px a parent and an ordinary trak wear,
 * so nobody has to learn a second alphabet for a child. The lines are the row's too —
 * what makes this small is the column, not a second type scale.
 *
 * **Nothing here names the piece.** A spawn usually fans one agent across every piece,
 * so a head would read `implementer` four times; the instruction is what tells them
 * apart, which is what was settled.
 *
 * **The whole column is the click target, through the title's `::after`** — the same
 * device `TrakRow` uses and for the same reason, so the hover tint is telling the truth
 * about where a press goes. That link is also the whole of why the band raises no
 * controls of its own: a piece at a gate is still approved and answered one press away.
 *
 * **It goes to the parent, standing at this piece.** A subtrak has no drawer of its own —
 * `?spot=` is what carries which piece, and `useSpot` carries why it is in the URL. The id
 * is all this surface can name: a `TrakSummaryDto` has no plan and no log, so it cannot
 * build a position key, and only the parent's drawer can turn one into a position.
 */

import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import type { AgentDto, TrakSummaryDto } from "../../api/types"
import { toneInk } from "../../format/tone"
import { idleAge } from "./idle"
import type { Rung } from "./pullRung"
import TrakMark from "./TrakMark"
import { rowWords } from "./waitingRow"

const BandPiece = ({
  trak,
  parent,
  rung,
  agents,
}: {
  readonly trak: TrakSummaryDto
  /** The trak this piece hangs under, by id — the band's own, never `trak.parent`, which
   *  may name a parent the list does not hold and so does not draw a band for. */
  readonly parent: string
  /** What the forge says about this piece's own branch, where it has said anything — a
   *  piece waiting to be landed has a pull request like any other trak. */
  readonly rung?: Rung
  /** The library, for the mark a piece mid-turn wears — `TrakMark`. */
  readonly agents: readonly AgentDto[]
}): ReactNode => {
  // The rung's words where there are any, exactly as a row reads them — and a held
  // piece's, which beat the rung's for the reason a row's do.
  const { label, tone } = rowWords(trak, rung)
  const name = trak.title ?? trak.description
  // A piece idle on its own inside a live group fades like an idle row and says its age
  // after its state word; the group stays live, so the piece keeps its place on the band.
  const idle = trak.idle === true
  const age = idle ? idleAge(trak.active, Date.now()) : undefined

  return (
    <li className="relative flex min-w-0 items-start gap-2.5 rounded-control px-2 py-1 transition-colors hover:bg-hover-row">
      <span className={`flex shrink-0 ${idle ? "opacity-55 grayscale" : ""}`}>
        <TrakMark trak={trak} tone={tone} rung={rung} agents={agents} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <Link
          to="/traks/$id"
          params={{ id: parent }}
          search={{ spot: trak.id }}
          className={`min-w-0 truncate text-base font-medium text-fg after:absolute after:inset-0 ${idle ? "opacity-60" : ""}`}
        >
          {name}
        </Link>
        {trak.instruction !== undefined && trak.instruction !== name && (
          <span className="truncate text-sm text-fg-muted">{trak.instruction}</span>
        )}
        {label !== undefined && (
          <span className="truncate font-mono text-2xs">
            <span className={toneInk[tone]}>{label}</span>
            {age !== undefined && <span className="text-fg-subtle"> · {age}</span>}
          </span>
        )}
      </span>
    </li>
  )
}

export default BandPiece
