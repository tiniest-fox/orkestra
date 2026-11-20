/**
 * The stop that takes the chat bar's send button's place while an agent works and the
 * field is empty — `ChatBar`'s `control` slot. Drawn by a trak's bar and a goal's, so the
 * interruption looks and behaves the same under either.
 *
 * Primary and at the send's own measure, because it *is* the send button. `busy` covers
 * the whole kill — a goal's route waits for it before answering, and a trak's answers first
 * and is drawn as `stopPressTaken` while the trak is `Stopping` — and it is non-submittable
 * throughout: the server cannot tell a deliberate press from a double one.
 */

import type { ReactNode } from "react"
import { forwardRef } from "react"
import type { LucideProps } from "lucide-react"
import { Square } from "lucide-react"
import Button from "../../../components/Button"
import type { Stopping } from "../useStop"

/**
 * The stop's glyph, filled. lucide ships stroke drawings only, and `fill="currentColor"`
 * gives a clean silhouette only where the glyph is one closed path — `Square` is, which is
 * what makes it the one mark that both says stop and takes a fill. A wrapper rather than
 * a prop on `Button`, which renders `<Icon size />` and passes nothing else through; a
 * `forwardRef` one, because `LucideIcon` is that type and `Button`'s `icon` asks for it.
 */
const SquareFilled = forwardRef<SVGSVGElement, LucideProps>((props, ref) => (
  <Square {...props} ref={ref} fill="currentColor" />
))
SquareFilled.displayName = "SquareFilled"

const StopControl = ({
  stopping,
  label,
}: {
  readonly stopping: Stopping
  /** What the press is called, naming who it stops. */
  readonly label: string
}): ReactNode => (
  <Button
    variant="primary"
    size="lg"
    icon={SquareFilled}
    aria-label={label}
    busy={stopping.isPending}
    disabled={stopping.disabled}
    onClick={stopping.stop}
  />
)

export default StopControl
