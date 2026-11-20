/**
 * The rule a proposed plan draws where its order splits into *now* and *later*: a dashed
 * line across the list in the working blue, an hourglass, and the condition names alone.
 *
 * **The names and nothing else.** No "waits until", no description of what each script
 * asks and no interval. A condition is named by its script's filename, or by one
 * of the two the engine answers itself, and either reads on its own to the person who
 * wrote the agent file.
 *
 * **The rule does not touch the step.** It is a row of its own between two tiles, so the
 * tile below it reads exactly as one above it does — the split is a fact about the order,
 * not a property of the step that happens to be first past it. `waits.ts` decides where
 * one goes.
 *
 * **In a column, the names wrap and the line gives way.** A piece's column is about 100px
 * on a phone, so a rule that led with a line and truncated the names cut `staging-ready`
 * to `stagin…` — the one thing on the rule that carries meaning. The column form drops the
 * leading line, lets the names break, and squeezes the trailing line to whatever is left.
 *
 * **At the plan gate a step's own wait can be removed.** `struck` are the names a person
 * took off, drawn after the live ones as `ClockRule` draws a struck clock, and `end` is
 * the press that removes or restores them.
 */

import type { ReactNode } from "react"
import { Hourglass } from "lucide-react"

/**
 * `squeeze` lets the line shrink to nothing beside names that have taken the measure;
 * `faded` is a rule whose every name was struck, faded as `ClockRule` fades a struck clock.
 */
const Line = ({
  squeeze = false,
  faded,
}: {
  readonly squeeze?: boolean
  readonly faded: boolean
}): ReactNode => (
  <span
    aria-hidden
    className={`h-0 flex-1 border-t border-dashed border-tone-working ${squeeze ? "min-w-0" : "min-w-3"}${faded ? " opacity-60" : ""}`}
  />
)

const NONE: readonly string[] = []

const WaitRule = ({
  names,
  column = false,
  struck = NONE,
  end,
}: {
  /** The conditions this rule names, the step's own first. Empty only beside `struck`. */
  readonly names: readonly string[]
  /** Inside a spawn's column: no leading line, and the names wrap rather than cut. */
  readonly column?: boolean
  /** The step's own wait a person removed at the plan gate, drawn struck and first until they approve. */
  readonly struck?: readonly string[]
  /** A press at the rule's end — the plan gate's remove, or the undo on a struck wait. */
  readonly end?: ReactNode
}): ReactNode => {
  const faded = names.length === 0
  return (
    <div className="flex min-w-0 items-center gap-2">
      {column ? undefined : <Line faded={faded} />}
      <span
        className={`inline-flex min-w-0 items-baseline gap-x-1.5 font-mono text-2xs ${column ? "flex-wrap" : ""}`}
      >
        <Hourglass size={11} aria-hidden className="shrink-0 self-center text-tone-working" />
        <span className={column ? "min-w-0 break-words" : "min-w-0 truncate"}>
          {/* The struck name first: it is the step's own, which a live rule also leads with. */}
          {struck.map((name, i) => (
            <span key={name}>
              {i > 0 ? <span className="text-fg-subtle">, </span> : undefined}
              <span className="text-tone-working line-through opacity-60">{name}</span>
            </span>
          ))}
          {names.map((name, i) => (
            <span key={name}>
              {i > 0 || struck.length > 0 ? <span className="text-fg-subtle">, </span> : undefined}
              <span className="text-tone-working">{name}</span>
            </span>
          ))}
        </span>
      </span>
      <Line squeeze={column} faded={faded} />
      {end}
    </div>
  )
}

export default WaitRule
