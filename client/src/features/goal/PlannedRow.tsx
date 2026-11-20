/**
 * A trak of the goal that is not a trak with a row: one the plan has still to open, one
 * a dropped goal never opened, one opened a moment ago whose row has not arrived, or one
 * the composer proposes at the plan gate. The list row's shape — the mode's disc on the
 * square, the title, a line under it — with a dashed square, which marks a trak that does
 * not exist yet.
 *
 * **A proposed trak's line is drawn whole**, because that is where a person decides on it.
 *
 * No link: there is no trak page to open yet.
 */

import type { ReactNode } from "react"
import type { RunModeDto } from "../../api/types"
import Row from "../../components/Row"
import ModeBadge from "../traks-list/ModeBadge"

/** `next` still to open, `gone` never to be opened, `proposed` waiting on the person. */
type PlannedLook = "next" | "gone" | "proposed"

/* Whole literal class names. An assembled one emits no CSS at all — see `Button`. */
const TITLE: Record<PlannedLook, string> = {
  next: "truncate text-fg-muted",
  gone: "truncate text-fg-subtle line-through",
  proposed: "text-fg",
}

const LINE: Record<PlannedLook, string> = {
  next: "truncate font-mono text-2xs text-fg-subtle",
  gone: "truncate font-mono text-2xs text-fg-subtle",
  proposed: "text-sm text-fg-muted",
}

const PlannedRow = ({
  title,
  mode,
  line,
  look,
}: {
  readonly title: string
  readonly mode: RunModeDto
  readonly line: string
  readonly look: PlannedLook
}): ReactNode => (
  <Row
    leading={
      <ModeBadge mode={mode}>
        <span
          aria-hidden
          className="block size-6 rounded-control border border-dashed border-border"
        />
      </ModeBadge>
    }
  >
    <span className={`min-w-0 text-base font-medium ${TITLE[look]}`}>{title}</span>
    <span className={LINE[look]}>{line}</span>
  </Row>
)

export default PlannedRow
