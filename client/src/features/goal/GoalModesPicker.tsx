/**
 * Which run modes the goal's traks may open on — New Trak's mode strip, in its place
 * above the chat bar, except that more than one segment can be chosen. The goal file the
 * composer drafts carries the set as its `modes:`.
 *
 * Segment for segment `new-trak/ModePicker`, whose docstring argues each class; only the
 * label over it and the toggle are this file's.
 */

import type { ReactNode } from "react"
import type { RunModeDto } from "../../api/types"
import { MODE_WORDS, MODES } from "../../format/runMode"
import type { GoalModes } from "./modes"

const look = (chosen: boolean): string =>
  chosen ? "bg-accent text-accent-ink" : "text-fg-muted hover:bg-hover-row"

const GoalModesPicker = ({
  chosen,
  onToggle,
}: {
  readonly chosen: GoalModes
  readonly onToggle: (mode: RunModeDto) => void
}): ReactNode => (
  <div className="shrink-0 bg-canvas px-4 pb-1 pt-3">
    <span
      id="goal-modes"
      className="mb-1.5 block font-mono text-2xs uppercase tracking-wider text-fg-subtle"
    >
      Traks it may open
    </span>
    <div
      role="group"
      aria-labelledby="goal-modes"
      className="flex overflow-hidden rounded-control border border-border bg-surface [&>*+*]:border-l [&>*+*]:border-border"
    >
      {MODES.map((mode) => {
        const { name, phrase, mark: Mark } = MODE_WORDS[mode]
        const on = chosen.includes(mode)
        return (
          <button
            key={mode}
            type="button"
            aria-pressed={on}
            onClick={() => {
              onToggle(mode)
            }}
            className={`flex min-w-0 flex-1 basis-0 flex-col gap-0.5 px-3 py-1.5 text-left transition-colors ${look(on)}`}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <Mark size={13} className="shrink-0" aria-hidden />
              <span className="truncate text-base font-medium">{name}</span>
            </span>
            <span className={`truncate text-sm ${on ? "" : "text-fg-subtle"}`}>{phrase}</span>
          </button>
        )
      })}
    </div>
  </div>
)

export default GoalModesPicker
