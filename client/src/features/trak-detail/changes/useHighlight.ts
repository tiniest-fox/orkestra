/**
 * One file's diff, coloured: which strings the grammar runs over, and where each token
 * lands back on the rows.
 *
 * **Two whole sides per hunk, never the rows in order.** A hunk interleaves old and new
 * text, and a grammar run over that sees a file that never existed. `sidesOf` splits it
 * into the old text and the new text, each tokenised whole, and `placed` says which side
 * and which row every line of the hunk came from. `hooks/useTokens` does the colouring,
 * and everything about how is its.
 */

import type { FileChangeDto } from "../../../api/types"
import type { Tok } from "../../../hooks/useTokens"
import { useTokens } from "../../../hooks/useTokens"
import { languageOf, sidesOf } from "./changes"

/**
 * A file's rows, coloured: `painted[hunk][line]` is the tokens for that row of that hunk.
 *
 * A row with no source behind it — the no-newline marker — gets an empty entry rather than
 * none, so the rows stay indexed by their place in the hunk; a caller draws that row's own
 * text for it.
 */
export type Painted = readonly (readonly (readonly Tok[])[])[]

/**
 * `undefined` while it loads, for a language nothing here has a grammar for, and if the
 * chunk never arrives — the caller draws the line as written in all three cases.
 */
export const useHighlight = (file: FileChangeDto): Painted | undefined => {
  const sides = file.hunks.map(sidesOf)
  const painted = useTokens(
    languageOf(file.path),
    sides.flatMap((side) => [side.old, side.new]),
  )
  if (painted === undefined) return undefined
  return sides.map((side, i) => {
    // The two sides of hunk `i` sit at `2i` and `2i + 1`, the order they were handed over.
    const byside = { old: painted[2 * i] ?? [], new: painted[2 * i + 1] ?? [] }
    return side.placed.map((at) => (at === undefined ? [] : (byside[at.side][at.row] ?? [])))
  })
}
