/**
 * Why a document was taken with nobody reading it, inside the document it is about.
 *
 * **A band in the card, not a box above it.** A box floating above it is a second object
 * with no subject: several rows on the map carry
 * the mark and the box named none of them. Inside the card the subject is structural — it
 * is this document's warrant because it is in this document — and it lands the reason where
 * the Approve button would have been.
 *
 * **It leads with the bolt the map's mark wears, in the same colour.** The two are one fact
 * at two altitudes: the map says which rows, and this says why. If the mark ever stops
 * being a bolt this moves with it.
 *
 * **`automatically approved` names what happened to the *gate*, and nothing in the log
 * corroborates it.** Running unattended writes no `HumanActed` — the engine advances rather
 * than recording that somebody pressed something — so there is no event behind this phrase
 * and nobody should go looking for one. It is derived from the plan, by the rule that took
 * the gate.
 *
 * **The rung is a claim and says so.** The other clauses are absences the engine read off
 * the plan and the log — no unplanned work, no second turn, no round of fixing that has
 * stopped landing — where the rung is the word the turn wrote about itself, taken at face
 * value. Drawing the two identically would overstate the second.
 */

import type { ReactNode } from "react"
import { Check, Zap } from "lucide-react"
import type { UnattendedDto } from "../../../../api/types"

/** One line of the warrant: what was asked, and what answered it. */
interface Clause {
  readonly claim: string
  readonly by: string
}

/**
 * The clauses, in the order `decide` asks them.
 *
 * `Mode` has one and no evidence to give beyond the word the trak was started with, which
 * is the honest shape of it: at that mode the reason and the setting are one sentence.
 */
const clauses = (why: UnattendedDto): readonly Clause[] => {
  switch (why._tag) {
    case "Mode":
      return [{ claim: "nobody reads this trak's documents", by: "the mode it was started in" }]
    case "Uneventful":
      return [
        { claim: `ambiguity: ${why.ambiguity}`, by: "what the turn said it ran into" },
        { claim: "one turn here", by: "nothing was asked and no check failed" },
        { claim: "no unplanned work", by: "nothing raised the plan does not have" },
      ]
    case "Resolving":
      return [{ claim: "a conflict on its pull request", by: "auto-merge sent it back to resolve" }]
  }
}

/**
 * What the mode is doing, at the far end of the label row — and **only the word the trak
 * was started with, with no rule beside it.**
 *
 * What actually stops a gate here is whichever of several things fired first, and the one
 * most likely to fire is the rung the turn wrote. Printing a rule as *stops at N* would
 * name a bound with the authority of a number and usually the wrong one.
 */
const counted = (why: UnattendedDto): string | undefined =>
  why._tag === "Uneventful" ? "smart · nothing asked for a person" : undefined

const UnattendedBand = ({ why }: { readonly why: UnattendedDto }): ReactNode => {
  const count = counted(why)
  return (
    <div
      className="flex min-w-0 flex-col gap-1.5 border-b border-border p-2.5"
      // An alpha rather than an opaque mix, so it composites over whatever ground the card
      // ends up on — the same reason `--color-hover-*` are alphas.
      style={{ background: "color-mix(in oklab, var(--color-source-machine) 7%, transparent)" }}
    >
      <span className="flex min-w-0 items-baseline gap-2">
        <Zap
          size={11}
          fill="currentColor"
          strokeWidth={2.25}
          aria-hidden
          className="shrink-0 translate-y-0.5 text-source-machine"
        />
        <span className="shrink-0 font-mono text-2xs uppercase tracking-wider text-fg-subtle">
          automatically approved
        </span>
        {count === undefined ? undefined : (
          <span className="ml-auto shrink-0 font-mono text-2xs text-fg-subtle">{count}</span>
        )}
      </span>

      <ul className="flex min-w-0 flex-col gap-0.5">
        {clauses(why).map((c) => (
          <li key={c.claim} className="flex min-w-0 items-baseline gap-1.5">
            <Check size={11} aria-hidden className="shrink-0 translate-y-px text-tone-good" />
            <span className="shrink-0 font-mono text-2xs text-fg-muted">{c.claim}</span>
            <span className="min-w-0 truncate font-mono text-2xs text-fg-subtle">{c.by}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default UnattendedBand
