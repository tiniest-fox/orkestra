/**
 * A hosted process's state as a glyph in its tone — the one mark every surface of the
 * pane uses, so a tab, the opener and the stopped screen cannot disagree about a state.
 *
 * `wash` is where it sits on a tone wash already (the header plate), and takes the bare
 * form — `hostedGlyph` carries why. Decorative: the state is always in words beside it,
 * in the line under the name, a tab's title or the opener's label.
 */

import type { ReactNode } from "react"
import type { HostedStateDto } from "../api/types"
import { toneInk } from "../format/tone"
import { hostedGlyph, hostedTone } from "../format/hosted"

const ProcessGlyph = ({
  tag,
  size = 12,
  wash = false,
}: {
  readonly tag: HostedStateDto["_tag"]
  readonly size?: number
  readonly wash?: boolean
}): ReactNode => {
  const Glyph = hostedGlyph(tag, wash)
  return (
    <Glyph
      size={size}
      aria-hidden
      className={`shrink-0 ${wash ? "" : toneInk[hostedTone(tag)]} ${
        tag === "Preparing" || tag === "Starting" ? "animate-spin motion-reduce:animate-none" : ""
      }`}
    />
  )
}

export default ProcessGlyph
