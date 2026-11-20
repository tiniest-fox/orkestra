/**
 * A trak's leading square on the list: **who is working, where an agent is, and what the
 * trak is doing everywhere else.**
 *
 * A row mid-turn is the one question the list cannot answer today — *Working…* is true of
 * half a screen at once — so that row and no other **gives its glyph to the agent**. Every
 * other row keeps the mark it has always drawn: composing, all five gates, spawning,
 * merging, closing, closed, failed. The list gains *who* exactly where the question is
 * *who*, and gives up none of the twenty-one states `stateIcon` tells apart.
 *
 * **The travelling segment is a separate question and three rows take it**: an agent's
 * turn, a check run, and a finished branch whose forge checks are still going. It says
 * *this is happening now*, which is a fact about the trak rather than about whose glyph is
 * in the box — `stateIcon` decides it, here and for the rung both.
 *
 * **A trak with no agent turn in flight never draws an agent-shaped mark.** The wire is
 * what decides it — `TrakSummaryDto.agent` is sent at `AgentWorking` and nowhere else —
 * so this file makes no judgement about which states are which and cannot drift from the
 * engine's.
 *
 * **A finished trak's mark is the forge's, where the forge has answered.** The rung
 * carries it and `stateIcon` takes it; the two can never be in flight at once, because
 * the wire sends `agent` at `AgentWorking` alone and a rung exists at `Finished` alone.
 * A trak held behind a condition wears the dashed ring over both, where the wait leads
 * the row — `rowMark` decides that, for the reason its pile is composed above `sectionOf`:
 * the wait is a fact beside the state, not a case inside its switch.
 *
 * One component for two callers, `TrakRow` and `BandPiece`, because the alternative is
 * two copies of *which glyph, and does the segment run* that can disagree about a piece
 * and its parent.
 */

import type { ReactNode } from "react"
import Plate from "../../components/Plate"
import type { AgentDto, TrakSummaryDto } from "../../api/types"
import { agentGlyph } from "../../format/glyph"
import type { Tone } from "../../format/tone"
import type { Rung } from "./pullRung"
import TrakIcon from "./TrakIcon"
import { rowMark } from "./waitingRow"

const TrakMark = ({
  trak,
  tone,
  rung,
  agents,
}: {
  readonly trak: TrakSummaryDto
  /** The caller's, which it already has for the status line beside this — the rung's
   *  where there is one, and `trakLabel`'s otherwise. */
  readonly tone: Tone
  /** What the forge says about a finished trak's branch, where it has said anything.
   *  It replaces the glyph and the motion both — `stateIcon` carries why. */
  readonly rung?: Rung
  /** The library, for the mark. Empty while the query is out — `agentGlyph` says what
   *  that draws, and it is never a state glyph pretending to be an agent. */
  readonly agents: readonly AgentDto[]
}): ReactNode => {
  const { icon, running } = rowMark(trak, rung)
  const Agent = trak.agent === undefined ? undefined : agentGlyph(agents, trak.agent)
  return (
    <Plate tone={tone} running={running}>
      {Agent === undefined ? <TrakIcon name={icon} size={14} /> : <Agent size={14} aria-hidden />}
    </Plate>
  )
}

export default TrakMark
