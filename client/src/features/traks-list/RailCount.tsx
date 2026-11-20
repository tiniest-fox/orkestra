import type { ReactNode } from "react"
import { toneInk, type Tone } from "../../format/tone"

/**
 * A section header's index-rail form: the count in the section's tone, centred over the
 * column the rows' marks sit in, and the title for a screen reader only — `SectionHeader`
 * says when it is drawn.
 */
const RailCount = ({
  title,
  tone,
  count,
}: {
  readonly title: string
  readonly tone: Tone
  readonly count: number | undefined
}): ReactNode => (
  <>
    <span className={`w-6 text-center font-mono text-2xs tabular-nums ${toneInk[tone]}`}>
      {count ?? "\u00a0"}
    </span>
    <span className="sr-only">{title}</span>
  </>
)

export default RailCount
