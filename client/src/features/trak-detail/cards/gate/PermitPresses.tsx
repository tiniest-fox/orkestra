/**
 * A permission gate's two presses, in the footer of the card naming the command: refuse
 * it, quiet, and allow it. Either resumes the step; the engine words the yes, quoting the
 * command the card shows.
 *
 * The left of the row asks the question, and the refusal the last press earned takes its
 * place — wrapping rather than cut, since it is the one sentence saying why nothing
 * happened. On a phone the presses fill a two-column row at the touch floor, Refuse on the
 * left.
 */

import type { ReactNode } from "react"
import { Check, X } from "lucide-react"
import Button from "../../../../components/Button"
import type { Permitting } from "../../usePermit"

const PermitPresses = ({ permitting }: { readonly permitting: Permitting }): ReactNode => (
  <>
    {permitting.said === undefined ? (
      <span className="mr-auto text-sm text-fg-muted max-sm:w-full">Run this command?</span>
    ) : (
      <span role="alert" className="mr-auto min-w-0 text-sm text-tone-bad max-sm:w-full">
        {permitting.said}
      </span>
    )}
    <span className="flex gap-2 max-sm:grid max-sm:w-full max-sm:grid-cols-2 max-sm:[&>*]:w-full">
      <Button
        variant="quiet"
        icon={X}
        disabled={permitting.disabled}
        onClick={() => {
          permitting.send(false)
        }}
      >
        Refuse
      </Button>
      <Button
        icon={Check}
        busy={permitting.isPending}
        disabled={permitting.disabled}
        onClick={() => {
          permitting.send(true)
        }}
      >
        Allow
      </Button>
    </span>
  </>
)

export default PermitPresses
