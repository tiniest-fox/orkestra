/**
 * A trak row's status line: the words in their tone, and whichever of the wait and the
 * forge's answer the other displaced, after them — kept quiet, because the leader has
 * already moved the row out of the pile the displaced answer filed it in and may not also
 * delete what that answer said. `waitingRow` decides which of the two leads.
 *
 * Its own file because two rows draw it: `TrakRow`, and `ArchivedTrakRow`, which the
 * palette draws for a trak no summary is sent for.
 */

import type { ReactNode } from "react"
import { toneInk, type Tone } from "../../format/tone"

const StatusLine = ({
  label,
  tone,
  aside,
}: {
  readonly label: string
  readonly tone: Tone
  readonly aside: string | undefined
}): ReactNode => (
  <span className={`flex min-w-0 flex-wrap gap-x-2 font-mono text-2xs ${toneInk[tone]}`}>
    <span>{label}</span>
    {aside !== undefined && (
      <span className="text-fg-subtle">
        <span aria-hidden>· </span>
        {aside}
      </span>
    )}
  </span>
)

export default StatusLine
