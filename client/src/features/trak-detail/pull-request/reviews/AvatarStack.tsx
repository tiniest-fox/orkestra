/**
 * Several people as one mark, for a section that is representing them rather than listing
 * them — the Review verdict's right-hand side.
 *
 * **It names everybody it stands for**, including the ones behind the `+n`, because the
 * discs themselves are the only thing on that line that says who reviewed.
 */

import type { ReactNode } from "react"
import Avatar from "./Avatar"

/** How many discs before the rest become a count. */
const SHOWN = 4

const AvatarStack = ({ people }: { readonly people: readonly string[] }): ReactNode => {
  // Deduplicated first: one person reviewing twice is ordinary — `threadKey`'s docstring is
  // where that is written down — and `who` is the React key here, so a duplicate is two
  // identical faces and a key collision.
  const everyone = [...new Set(people)]
  const shown = everyone.slice(0, SHOWN)
  const rest = everyone.length - shown.length
  return everyone.length === 0 ? null : (
    <span className="flex shrink-0 items-center" aria-label={`Reviewed by ${everyone.join(", ")}`}>
      {shown.map((who, at) => (
        <span key={who} className={at === 0 ? "" : "-ml-1.5"}>
          <span className="block rounded-pill ring-2 ring-surface">
            <Avatar who={who} />
          </span>
        </span>
      ))}
      {rest > 0 && (
        <span className="ml-1 text-2xs text-fg-subtle" title={everyone.slice(SHOWN).join(", ")}>
          +{String(rest)}
        </span>
      )}
    </span>
  )
}

export default AvatarStack
