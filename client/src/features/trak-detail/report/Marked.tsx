/**
 * A cleaned text as it goes out, each redaction mark drawn as a removal so the person can
 * see that something was taken out and where.
 */

import type { ReactNode } from "react"
import { piecesOf } from "./report"

const Marked = ({
  text,
  block = false,
}: {
  readonly text: string
  /** One line of the log, on a line of its own. */
  readonly block?: boolean
}): ReactNode => (
  <span className={block ? "block" : undefined}>
    {piecesOf(text).map((piece) =>
      piece.removed ? (
        <span key={piece.key} className="rounded-tile bg-tone-waiting-bg px-1 text-tone-waiting">
          removed
        </span>
      ) : (
        <span key={piece.key}>{piece.text}</span>
      ),
    )}
  </span>
)

export default Marked
