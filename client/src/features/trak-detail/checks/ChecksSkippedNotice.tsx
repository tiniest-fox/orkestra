/**
 * That this document's checks did not run, in the card's body — the second of the two
 * places the card says it, above the document it is about.
 *
 * **Twice, because once is how a step nobody checked comes to look like a step that
 * passed.** The strip's line is 9px mono, read at a glance; this is a sentence in the
 * body, read. The band alone is too easy to pass over.
 *
 * The same mark the switch and the readout plate wear, so a reader meets one glyph from
 * the press to the record it left.
 */

import type { ReactNode } from "react"
import { ShieldOff } from "lucide-react"
import { skippedText } from "./check"

const ChecksSkippedNotice = ({ names }: { readonly names: readonly string[] }): ReactNode => (
  <p className="flex min-w-0 items-start gap-1.5 rounded-control bg-tone-waiting-bg px-2 py-1.5 text-sm text-tone-waiting">
    <ShieldOff size={13} strokeWidth={2.5} aria-hidden className="mt-px shrink-0" />
    <span className="min-w-0">{skippedText(names)}</span>
  </p>
)

export default ChecksSkippedNotice
