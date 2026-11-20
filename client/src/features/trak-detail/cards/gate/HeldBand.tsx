/**
 * That a document's entry was held on a person's press until they accepted it, inside the
 * document it is about — `UnattendedBand`'s mirror, for the other outcome.
 *
 * **A band in the card, for `UnattendedBand`'s reason**: inside the card the subject is
 * structural, and it lands where the mark of what happened to the gate belongs. It leads
 * with the hold's own mark in the person's colour rather than the machine's, because a hold
 * is a thing a person pressed — where *automatically approved* is a thing the engine read.
 *
 * **`held for you` is the whole band, and the engine stamped it.** A hold is spent by
 * `applyEvent` as the step it holds is accepted, and that entry is recorded there — a
 * `Held` mark on `TrakDetailDto.marks` — rather than read back off the log, where an
 * entry a hold held and one the mode took look alike. Nothing under the heading: where
 * the press was made and which gates stood are not recorded, and a line guessing at
 * either read as nonsense beside a fact. What is not claimed is whether the mode *would*
 * have gone past, so the band never says a gate the mode would have stood at anyway was
 * taken from it.
 */

import type { ReactNode } from "react"
import { Hand } from "lucide-react"

const HeldBand = (): ReactNode => (
  <div
    className="flex min-w-0 items-baseline gap-2 border-b border-border p-2.5"
    // An alpha rather than an opaque mix, for `UnattendedBand`'s reason: it composites
    // over whatever ground the card ends up on.
    style={{ background: "color-mix(in oklab, var(--color-source-human) 7%, transparent)" }}
  >
    <Hand
      size={11}
      strokeWidth={2.5}
      aria-hidden
      className="shrink-0 translate-y-0.5 text-source-human"
    />
    <span className="shrink-0 font-mono text-2xs uppercase tracking-wider text-fg-subtle">
      held for you
    </span>
  </div>
)

export default HeldBand
