/**
 * One piece of a spawn on the phone's band: a 128px card in a row of cards.
 *
 * **The card leads with the distinguishing word, never the agent** — a spawn usually
 * fans one agent across every piece, so leading with it would label four cards
 * identically. Where nothing distinguishes (`pieceWord` found no unique word) the
 * piece's own name stands in, truncated.
 *
 * **The state words are gone; only the plate says how a piece is going.** What makes
 * that safe is `TrakStrip`'s failed-first ordering — drop it and the words have to come
 * back. The agent line under the word is the wire's `agent`, which is sent at
 * `AgentWorking` and nowhere else, so most cards carry the word alone.
 *
 * The whole card is the click target through the word's `::after` — `BandPiece`'s
 * device, and its destination too: the parent's drawer standing at this piece, because
 * a `TrakSummaryDto` can name nothing finer than the piece's id.
 */

import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import type { AgentDto, TrakSummaryDto } from "../../api/types"
import type { Rung } from "./pullRung"
import TrakMark from "./TrakMark"
import { rowWords } from "./waitingRow"

const StripPiece = ({
  trak,
  parent,
  word,
  rung,
  agents,
}: {
  readonly trak: TrakSummaryDto
  /** The band's own parent id — `BandPiece` carries why it is never `trak.parent`. */
  readonly parent: string
  /** What tells this piece from its siblings, or `undefined` where nothing does. */
  readonly word: string | undefined
  /** What the forge says about this piece's own branch, where it has said anything. */
  readonly rung?: Rung
  /** The library, for the mark a piece mid-turn wears — `TrakMark`. */
  readonly agents: readonly AgentDto[]
}): ReactNode => {
  const { tone } = rowWords(trak, rung)

  return (
    <li className="relative w-32 shrink-0 rounded-surface border border-border bg-surface p-2 transition-colors hover:bg-hover-row">
      {/* A piece idle inside a live group fades as it does on a desk's band. */}
      <span className={`flex ${trak.idle === true ? "opacity-55 grayscale" : ""}`}>
        <TrakMark trak={trak} tone={tone} rung={rung} agents={agents} />
      </span>
      <span className="mt-1.5 flex min-w-0 flex-col">
        <Link
          to="/traks/$id"
          params={{ id: parent }}
          search={{ spot: trak.id }}
          className={`min-w-0 truncate text-sm font-medium text-fg after:absolute after:inset-0 ${trak.idle === true ? "opacity-60" : ""}`}
        >
          {word ?? trak.title ?? trak.description}
        </Link>
        {trak.agent !== undefined && (
          <span className="truncate font-mono text-2xs text-fg-subtle">{trak.agent}</span>
        )}
      </span>
    </li>
  )
}

export default StripPiece
