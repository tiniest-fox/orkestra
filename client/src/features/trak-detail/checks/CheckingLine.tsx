/**
 * The line that stands where a card's head will be while nothing is known yet — the
 * pull request card's, and the deploy block's.
 *
 * **It occupies the head's space rather than reserving it.** The card used to draw nothing
 * until its answer arrived, so the head appeared under the reader and the merge press
 * re-parented beneath it — a jump on every load of a finished trak. A line at roughly the
 * head's own height says the same thing and is not a hole.
 *
 * **It says what it is looking for, where the traks list's row says only *Asking
 * GitHub…*.** Both wordings were on offer and the difference was kept: a row is one line
 * among many and a card has the room to name the thing — which is why the words are the
 * caller's.
 */

import type { ReactNode } from "react"
import { Loader2 } from "lucide-react"

const CheckingLine = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <div className="flex items-center gap-2.5 px-4 py-4 text-sm text-fg-subtle">
    <Loader2 size={13} aria-hidden className="shrink-0 animate-spin" />
    <span>{children}</span>
  </div>
)

export default CheckingLine
