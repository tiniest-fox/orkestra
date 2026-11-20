/**
 * A goal's progress as traks landed of planned: one mark per planned trak, the landed
 * ones filled, and the count beside them. Nothing is drawn for a goal with no plan yet.
 * A goal at rest draws it; the traks list's banner draws its own rail as its bottom edge.
 */

import type { ReactNode } from "react"

const Progress = ({
  landed,
  planned,
}: {
  readonly landed: number
  readonly planned: number
}): ReactNode =>
  planned === 0 ? undefined : (
    <span className="flex items-center gap-2">
      <span aria-hidden className="flex flex-1 gap-0.5">
        {Array.from({ length: planned }, (_, i) => (
          <span
            // oxlint-disable-next-line react/no-array-index-key -- one mark per planned trak, positional
            key={i}
            className={`h-1.5 flex-1 rounded-pill ${i < landed ? "bg-tone-good" : "bg-border"}`}
          />
        ))}
      </span>
      <span className="font-mono text-xs text-fg-muted">
        {`${String(landed)} of ${String(planned)} landed`}
      </span>
    </span>
  )

export default Progress
