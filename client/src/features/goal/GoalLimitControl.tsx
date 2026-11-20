/**
 * One limit's control: a bare − n + and a switch after it. The number never goes below 1,
 * so "no limit" is never a place the stepper walks to — it is the switch. Off, the stepper
 * hides and the segment reads "no limit"; on again, it comes back to the last number it
 * held on this screen.
 */

import { Minus, Plus } from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"
import Switch from "../../components/Switch"
import { FIRST, LIMIT_WORDS, type Limit } from "./settings"

const PRESS =
  "flex size-6 shrink-0 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-hover-row hover:text-fg disabled:opacity-35 max-sm:size-11"

const GoalLimitControl = ({
  limit,
  value,
  onChange,
}: {
  readonly limit: Limit
  readonly value: number | undefined
  readonly onChange: (value: number | undefined) => void
}): ReactNode => {
  const [last, setLast] = useState(value ?? FIRST[limit])
  const { unit, max } = LIMIT_WORDS[limit]
  const set = (next: number | undefined): void => {
    if (next !== undefined) setLast(next)
    onChange(next)
  }
  return (
    <span className="inline-flex items-center gap-2">
      {value === undefined ? (
        <span className="font-mono text-sm text-fg-subtle">no limit</span>
      ) : (
        <span className="inline-flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={`Fewer ${unit}`}
            disabled={value <= 1}
            className={PRESS}
            onClick={() => set(Math.max(1, value - 1))}
          >
            <Minus size={12} aria-hidden />
          </button>
          <span className="min-w-8 text-center font-mono text-sm text-fg">{String(value)}</span>
          <button
            type="button"
            aria-label={`More ${unit}`}
            disabled={value >= max}
            className={PRESS}
            onClick={() => set(Math.min(max, value + 1))}
          >
            <Plus size={12} aria-hidden />
          </button>
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={value !== undefined}
        aria-label={`Limit ${unit}`}
        onClick={() => set(value === undefined ? last : undefined)}
        className="flex h-6 items-center justify-center max-sm:h-11 max-sm:min-w-11"
      >
        <Switch on={value !== undefined} />
      </button>
    </span>
  )
}

export default GoalLimitControl
