/**
 * A turn's head line — its number and the clock it started at, and its place at the
 * row's end — drawn only where the turn ran remotely.
 *
 * **Only there, because the place is the only thing it carries.** A turn has no header of its
 * own; this line exists to give a remote turn's pill a row, and a local turn keeps the shape it
 * always had, since local work draws no place mark at all.
 */

import type { ReactNode } from "react"
import { PlayCircle } from "lucide-react"
import PlacePill from "../../../components/PlacePill"
import { clockAt } from "../../../format/hosted"
import Line from "./activity/Line"
import { placeOfTurn, type Turn } from "./turns"

const TurnHead = ({
  turn,
  nth,
}: {
  readonly turn: Turn | undefined
  readonly nth: number
}): ReactNode => {
  const place = placeOfTurn(turn)
  if (place?._tag !== "Remote") return undefined
  const at = turn?.entries[0]?.at
  return (
    <li className="min-w-0">
      <Line lead={<PlayCircle size={12} aria-hidden className="text-fg-subtle" />}>
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-xs text-fg-muted">
            Turn {nth}
            {at === undefined ? "" : ` · ${clockAt(at)}`}
          </span>
          <span className="ml-auto flex min-w-0">
            <PlacePill place={place} />
          </span>
        </span>
      </Line>
    </li>
  )
}

export default TurnHead
