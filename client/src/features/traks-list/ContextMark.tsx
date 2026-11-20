/**
 * How full a row's context window is, as a 14px ring at the far right of the row — past
 * the activity line and the press, beside the way in.
 *
 * A ring rather than a bar because it costs about a fifth of the width, which is what
 * makes the far-right slot affordable: a bar there pushes the activity line in, a ring
 * sits beside the chevron and takes nothing from it. What it gives up is precision at the
 * low end — an arc of three degrees reads as *empty* — which is the true reading of a
 * window that has just been opened.
 *
 * `source-human` for the arc, because it is not a status: a tone here would say the row
 * had failed or was waiting. The track is the neutral one every plate's chase runs on.
 */

import type { ReactNode } from "react"

const SIZE = 14
const THICKNESS = 3

const ContextMark = ({
  share,
  says,
}: {
  /** In `[0, 1]` of the window; more is drawn full. */
  readonly share: number
  /** The whole sentence, for the tooltip and the accessible name. */
  readonly says: string
}): ReactNode => {
  const r = (SIZE - THICKNESS) / 2
  const c = 2 * Math.PI * r
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${String(SIZE)} ${String(SIZE)}`}
      className="shrink-0"
      role="img"
      aria-label={says}
    >
      <title>{says}</title>
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={r}
        fill="none"
        strokeWidth={THICKNESS}
        className="stroke-tone-neutral-track"
      />
      {/* From twelve o'clock, which is the only start a reader assumes. */}
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={r}
        fill="none"
        strokeWidth={THICKNESS}
        strokeDasharray={`${String(c * Math.min(1, share))} ${String(c)}`}
        transform={`rotate(-90 ${String(SIZE / 2)} ${String(SIZE / 2)})`}
        className="stroke-source-human"
      />
    </svg>
  )
}

export default ContextMark
