/**
 * The icon-only press that stops one background job — the same press wherever the job is
 * named: the strip's rows and a job's card — and, in the check console's band, the check
 * that is running. The filled square is the system's one stop mark, from the chat bar's own stop.
 *
 * A plain `<button>` rather than `Button`, because the press is a 24px bordered
 * square `Button` has no size for — so it carries the phone's 44px floor by hand
 * (`max-sm:size-11`), which is `client-style`'s rule for a control drawn outside
 * `Button`/`MenuItem`.
 */

import { Square } from "lucide-react"
import type { ReactNode } from "react"

const StopPress = ({
  label,
  disabled,
  onPress,
}: {
  /** What is being stopped, for the accessible name — the job's own words. */
  readonly label: string
  readonly disabled: boolean
  readonly onPress: () => void
}): ReactNode => (
  <button
    type="button"
    aria-label={`Stop ${label}`}
    disabled={disabled}
    onClick={onPress}
    className="flex size-6 shrink-0 items-center justify-center rounded-control border border-border bg-surface text-fg-muted transition-colors hover:border-accent/60 hover:text-fg disabled:opacity-50 max-sm:size-11"
  >
    <Square size={11} aria-hidden fill="currentColor" className="shrink-0" />
  </button>
)

export default StopPress
