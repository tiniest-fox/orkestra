/**
 * What a child's composer handed up to its parent, printed whole on the child's own
 * finished pane.
 *
 * **A thing this trak sent, not a thing it said.** It is the one line on a finished trak
 * addressed to somebody other than the reader, so it takes its own block at the foot of
 * the pane — below the presses, not above the card and not in the ending's own words.
 * `source-machine` tint because a composer wrote it; the parent is not named, since the
 * pane is already the parent's drawer standing at this piece.
 *
 * **Not clamped.** `handUp` is unbounded prose and usually will be — a composer writing to
 * the only party that can act on it does not write one line — and nowhere else on the
 * client prints it whole: the parent's re-compose row joins it with every other hand-up
 * into one caption, unattributed, and cuts that at five lines.
 */

import type { ReactNode } from "react"
import { ArrowUpFromDot } from "lucide-react"

const HandedUp = ({ text }: { readonly text: string }): ReactNode => (
  <section
    aria-label="Work for the parent"
    className="flex min-w-0 flex-col gap-1.5 rounded-surface bg-source-machine/10 px-3 py-2.5"
  >
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-2xs uppercase tracking-wider text-source-machine">
      <ArrowUpFromDot size={11} strokeWidth={2.5} aria-hidden className="shrink-0 translate-y-px" />
      Work for the parent
    </span>
    <p className="min-w-0 text-base leading-5 text-fg-muted">{text}</p>
  </section>
)

export default HandedUp
