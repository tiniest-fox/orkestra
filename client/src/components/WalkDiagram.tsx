/**
 * A walkthrough step's lifeline diagram: the actors as small boxes across the top, a
 * dashed lifeline down from each, and one row per hop of the path.
 *
 * **The picked hop is lit and its actors ringed; the hops before it stay, faint, as the
 * trail; the hops after it are not drawn**, but their rows are kept, so every step of a
 * path draws the diagram at one height. A hop back is the same straight stroke with its
 * head mirrored, and a step on one actor is a small box on that actor's lane.
 */

import type { ReactNode } from "react"
import type { WalkStep } from "../format/walkthrough"

/** A lane's centre, as a percentage of the width. */
const centre = (lane: number, lanes: number): number => ((lane + 0.5) * 100) / lanes

/** An open arrowhead with its point on the lane it arrives at, mirrored for a hop back. */
const Arrowhead = ({ right, lit }: { readonly right: boolean; readonly lit: boolean }) => (
  <svg
    width={8}
    height={10}
    viewBox="0 0 8 10"
    fill="none"
    className={`absolute top-0 -translate-y-1/2 overflow-visible ${right ? "right-0" : "left-0 -scale-x-100"} ${lit ? "text-accent" : "text-fg-subtle"}`}
  >
    <path
      d="M2.5 1 L7 5 L2.5 9"
      stroke="currentColor"
      strokeWidth={lit ? 2 : 1}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/** One hop's row: the stroke between its first and last actor, or a box on its one. */
const Hop = ({
  at,
  lanes,
  lit,
}: {
  readonly at: readonly number[]
  readonly lanes: number
  readonly lit: boolean
}): ReactNode => {
  const from = at[0] ?? 0
  const to = at.at(-1) ?? from
  const line = lit ? "border-accent" : "border-fg-subtle"
  if (from === to)
    return (
      <span
        style={{ left: `${String(centre(from, lanes))}%` }}
        className={`absolute top-1/2 h-3 w-2 -translate-x-1/2 -translate-y-1/2 rounded-tile bg-surface ${lit ? "border-2" : "border"} ${line}`}
      />
    )
  return (
    <span
      style={{
        left: `${String(centre(Math.min(from, to), lanes))}%`,
        width: `${String((Math.abs(to - from) * 100) / lanes)}%`,
      }}
      className="absolute top-1/2 block h-0"
    >
      <span
        className={`absolute inset-x-0 top-0 -translate-y-1/2 ${lit ? "border-t-2" : "border-t"} ${line}`}
      />
      <Arrowhead right={to > from} lit={lit} />
    </span>
  )
}

const WalkDiagram = ({
  actors,
  steps,
  at,
}: {
  readonly actors: readonly string[]
  readonly steps: readonly WalkStep[]
  /** The picked step. */
  readonly at: number
}): ReactNode => {
  const lanes = actors.length
  const lit = steps[at]?.at ?? []
  const columns = { gridTemplateColumns: `repeat(${String(lanes)}, minmax(0, 1fr))` }
  return (
    <div aria-hidden className="flex min-w-0 flex-col gap-1">
      <div style={columns} className="grid min-w-0">
        {actors.map((name, lane) => (
          <span key={name} className="flex min-w-0 justify-center px-1">
            <span
              className={`min-w-0 truncate rounded-control border border-guide px-1.5 text-center text-sm leading-5 ${lit.includes(lane) ? "bg-surface font-semibold text-fg ring-1 ring-accent" : "bg-canvas font-medium text-fg-subtle"}`}
            >
              {name}
            </span>
          </span>
        ))}
      </div>
      <div className="relative min-w-0">
        {actors.map((name, lane) => (
          <span
            key={name}
            style={{ left: `${String(centre(lane, lanes))}%` }}
            className="absolute inset-y-0 border-l border-dashed border-guide"
          />
        ))}
        {steps.map((step, i) => (
          // A path's steps are positional and never reorder.
          // oxlint-disable-next-line react/no-array-index-key
          <div key={i} className={`relative h-5.5 ${i < at ? "opacity-35" : ""}`}>
            {i <= at && <Hop at={step.at} lanes={lanes} lit={i === at} />}
          </div>
        ))}
      </div>
    </div>
  )
}

export default WalkDiagram
