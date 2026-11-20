/**
 * The press that starts a held step with its wait unmet, drawn in the head row of
 * whichever block carries the wait — the held card, or the deploy block where the wait
 * is the deploy's — beside the countdown.
 *
 * **Small and quiet, never the pane's loudest thing.** It spends money, and it belongs to
 * the wait it forces rather than to the ending: the ending's own presses are still the
 * four at the pane's foot. *Skip the wait* over *Run it now* — it says what it does to the
 * wait rather than to the step.
 *
 * `Button` carries the touch floor below the breakpoint; nothing here adds to it.
 */

import type { ReactNode } from "react"
import Button from "../../../components/Button"
import type { Skipping } from "./useSkipWait"

const SkipPress = ({ skipping }: { readonly skipping: Skipping }): ReactNode => (
  <Button
    size="sm"
    variant="quiet"
    busy={skipping.isPending}
    disabled={skipping.disabled}
    onClick={skipping.skip}
  >
    Skip the wait
  </Button>
)

export default SkipPress
