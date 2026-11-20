import type { ReactNode } from "react"
import Plate from "../../components/Plate"
import type { TrakSummaryDto } from "../../api/types"
import type { Rungs } from "./pullRung"
import TrakIcon from "./TrakIcon"
import { rowMark, rowWords } from "./waitingRow"

/**
 * One trak's 14px tile, its color drained — an idle row's mark, each of its pieces, and
 * each group a `+N more` line hides. Named for a reader who cannot see it.
 */
const IdleTile = ({
  trak,
  rungs,
}: {
  readonly trak: TrakSummaryDto
  readonly rungs: Rungs
}): ReactNode => {
  const rung = rungs.get(trak.id)
  const { label, tone } = rowWords(trak, rung)
  return (
    <span
      role="img"
      aria-label={label ?? trak.title ?? trak.description}
      className="flex opacity-55 grayscale"
    >
      <Plate tone={tone} size="tile">
        <TrakIcon name={rowMark(trak, rung).icon} size={10} />
      </Plate>
    </span>
  )
}

export default IdleTile
