/**
 * The mark on a position that was put into an earlier position's conversation — the
 * corner device the unread-gate bolt and the hand-up arrow established, at the plate's
 * top-right corner.
 *
 * **Which corner it takes is `corners.ts`'s and no surface's**, along with every other
 * mark a plate carries — it is last in that precedence, so it has the right corner on a
 * row carrying nothing else and steps left behind one that does. The offsets are that
 * file's `cornerClass`, so a disc's corner is one string here and on the map's bolt.
 *
 * **It only makes the fact findable.** Which conversation, and whether it was actually
 * joined, is the sentence at the head of the position's own pane — `ContinuesNotice` —
 * so this carries the glyph, the words for a reader who cannot see it, and nothing else.
 */

import type { ReactNode } from "react"
import { CornerDownRight } from "lucide-react"
import { type Corner, cornerClass } from "./corners"

/** The one glyph a continuation wears, wherever a surface draws it. */
export const ContinuesGlyph = CornerDownRight

const ContinuesMark = ({ corner = "right" }: { readonly corner?: Corner }): ReactNode => (
  <span
    className={`absolute -top-1 flex size-3.5 items-center justify-center rounded-pill bg-canvas text-fg-subtle ${cornerClass[corner]}`}
  >
    <ContinuesGlyph size={10} strokeWidth={2.75} aria-hidden />
    <span className="sr-only">continues an earlier conversation</span>
  </span>
)

export default ContinuesMark
