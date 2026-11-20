/**
 * The other way out of a failed effect: carry on to the next step without it. Drawn under
 * `TrakResume` on the same notice, in its shape — the press, what it does, and why the last
 * one did not land — so the two read as a pair of answers to one question.
 *
 * `quiet`, for `TrakResume`'s reason: a primary button on an error plate is the
 * one-colour-two-labels collision `styles.css` warns about.
 */

import type { ReactNode } from "react"
import { SkipForward } from "lucide-react"
import Button from "../../../components/Button"
import type { EffectSkipping } from "./useSkipEffects"

const EffectSkip = ({ skipping }: { readonly skipping: EffectSkipping }): ReactNode => (
  <div className="flex min-w-0 flex-col gap-1.5">
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="quiet"
        icon={SkipForward}
        busy={skipping.isPending}
        disabled={skipping.disabled}
        onClick={skipping.skip}
      >
        Skip
      </Button>
      <span className="min-w-0 text-sm text-fg-subtle">
        Goes on to the next step without this effect or any after it.
      </span>
    </div>
    {skipping.said === undefined ? undefined : (
      <span role="alert" className="text-sm text-tone-bad">
        {skipping.said}
      </span>
    )}
  </div>
)

export default EffectSkip
