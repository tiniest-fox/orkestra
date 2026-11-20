/**
 * A put-away trak, as the ⌘K palette finds it — `TrakRow`'s parts with what an archived
 * trak has: its title and its id. The engine builds no summary for one, so there is no
 * state, instruction or activity to draw, and a row that pretended otherwise would be a
 * summary invented at the surface.
 *
 * The same `Row`, the same plate holding the archive glyph every archived state wears
 * (`stateIcon`), the same title link covering the row, and the same `StatusLine` — so a
 * live trak and a put-away one read as the same kind of thing, one of them muted.
 */

import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import Plate from "../../components/Plate"
import Row from "../../components/Row"
import type { ArchivedTrakDto } from "../../api/types"
import StatusLine from "./StatusLine"
import TrakIcon from "./TrakIcon"

const ArchivedTrakRow = ({ trak }: { readonly trak: ArchivedTrakDto }): ReactNode => (
  <Row
    leading={
      <Plate tone="neutral">
        <TrakIcon name="archive" size={14} />
      </Plate>
    }
  >
    <Link
      to="/traks/$id"
      params={{ id: trak.id }}
      className="min-w-0 truncate text-base font-medium text-fg-muted after:absolute after:inset-0"
    >
      {trak.title}
    </Link>
    <StatusLine label="Archived" tone="neutral" aside={trak.id} />
  </Row>
)

export default ArchivedTrakRow
