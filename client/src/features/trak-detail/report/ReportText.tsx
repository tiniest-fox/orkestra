/**
 * The trak's title and description as the report carries them: cleaned, cut, and drawn
 * with each removal marked — or, where the engine could not read its list of secrets, the
 * sentence saying they and the note are left out.
 */

import type { ReactNode } from "react"
import type { ReportDto } from "../../../api/types"
import Marked from "./Marked"
import { cutWords, WITHHELD_WORDS } from "./report"

const ReportText = ({ preview }: { readonly preview: ReportDto }): ReactNode => {
  const { trak, cut, withheld } = preview
  if (withheld !== undefined)
    return <p className="text-xs leading-4 text-tone-waiting">{WITHHELD_WORDS}</p>
  return (
    <div className="flex min-w-0 flex-col gap-1 text-xs leading-4">
      <p className="font-medium break-words text-fg">
        <Marked text={trak.title} />
        {cut?.title === undefined ? "" : ` ${cutWords(cut.title)}`}
      </p>
      {trak.description !== "" && (
        <p
          aria-label="The request that goes"
          className="max-h-24 overflow-y-auto break-words whitespace-pre-wrap text-fg-muted"
        >
          <Marked text={trak.description} />
          {cut?.description === undefined ? "" : ` ${cutWords(cut.description)}`}
        </p>
      )}
    </div>
  )
}

export default ReportText
