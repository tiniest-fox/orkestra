/**
 * The pause, as a band on the Traks tab: what it holds, and Resume. **Resume spends**
 * where the goal owes the composer a turn, which starts at once.
 */

import { Pause, Play } from "lucide-react"
import type { ReactNode } from "react"
import Button from "../../components/Button"
import type { GoalPause } from "./usePauseGoal"

const PausedBand = ({ pause }: { readonly pause: GoalPause }): ReactNode => (
  <section
    aria-label="Paused"
    className="flex flex-col gap-3 rounded-surface border border-dashed border-border bg-surface-2 p-3 sm:p-4"
  >
    <div className="flex items-start gap-2">
      <Pause size={14} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-medium text-fg">Paused</h2>
        <p className="text-sm text-fg-muted">
          Nothing new opens and the composer takes no turns. Live traks hold at their next gate.
        </p>
      </div>
    </div>
    <div className="flex flex-wrap gap-2 max-sm:grid max-sm:grid-cols-1">
      <Button icon={Play} busy={pause.isPending} onClick={() => pause.pause(false)}>
        Resume
      </Button>
    </div>
    {pause.said === undefined ? undefined : (
      <p role="alert" className="text-sm text-tone-bad">
        {pause.said}
      </p>
    )}
  </section>
)

export default PausedBand
