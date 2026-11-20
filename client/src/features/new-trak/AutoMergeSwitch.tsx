/**
 * Whether the engine merges this trak's pull request on its own — asked here as the trak
 * starts. Afterwards it is the run-mode picker's, and at `Finished` the finished band's.
 *
 * **A switch row rather than a fourth segment**, because it answers a second question
 * beside the mode rather than another answer to the same one: any mode may merge itself.
 * The row is the strip's own shape — one segment's edge, ground and type — so the foot
 * reads as two answers about the trak, and `Switch` draws the state the row holds, as on
 * the trak's own mode panel. It opens on the last choice, as the mode does — see
 * `useAutoMerge`.
 *
 * **`pt-1 pb-1` keeps the footer's rhythm.** `ModePicker` ends on half a gap and
 * `ChatBar` starts on half a gap, so a band between them pays both halves.
 */

import type { ReactNode } from "react"
import { GitMerge } from "lucide-react"
import Switch from "../../components/Switch"

const AutoMergeSwitch = ({
  on,
  onToggle,
}: {
  readonly on: boolean
  readonly onToggle: (on: boolean) => void
}): ReactNode => (
  <div className="shrink-0 bg-canvas px-4 pb-1 pt-1">
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => {
        onToggle(!on)
      }}
      className="flex w-full min-w-0 items-center gap-1.5 rounded-control border border-border bg-surface px-3 py-1.5 text-left transition-colors hover:bg-hover-row max-sm:min-h-11"
    >
      <GitMerge
        size={13}
        aria-hidden
        className={`shrink-0 ${on ? "text-accent" : "text-fg-subtle"}`}
      />
      <span className={`whitespace-nowrap text-base font-medium ${on ? "text-accent" : "text-fg"}`}>
        Auto-merge
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-fg-subtle">
        merge the pull request once its checks pass
      </span>
      <Switch on={on} />
    </button>
  </div>
)

export default AutoMergeSwitch
