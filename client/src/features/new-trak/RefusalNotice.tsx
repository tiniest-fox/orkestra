import type { ReactNode } from "react"
import { TriangleAlert } from "lucide-react"
import type { RefusalDto } from "../../api/types"
import { refusalSaid } from "../../format/refusal"

/**
 * Why the engine would not start it.
 *
 * **A strip above the field, not an `EmptyState`.** The shell would cover the sentence
 * the person is holding, and they need it intact: the answer to a refusal is often to
 * press the same button again. Nothing here may take the typed description away.
 *
 * `role="alert"` is what reports it; the tone is on the glyph alone, the same split
 * `EmptyState` makes.
 */
const RefusalNotice = ({ refusal }: { readonly refusal: RefusalDto }): ReactNode => (
  <div role="alert" className="flex flex-col gap-2 rounded-surface bg-tone-bad-bg p-3">
    <span className="flex items-start gap-2">
      <TriangleAlert size={12} aria-hidden className="mt-1 shrink-0 text-tone-bad" />
      {/* The sentence is `format/refusal.ts`'s, and exhaustive there — a second surface
          draws refusals now, and a second copy of this mapping is how the two drift. */}
      <span className="text-base text-fg">{refusalSaid(refusal)}</span>
    </span>
  </div>
)

export default RefusalNotice
