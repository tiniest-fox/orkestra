/**
 * The pull request's state as a glyph in its tone, off any plate — the side panel's tab and
 * its opener wear it. The mapping is the card's (`headingIcon`, `headingTone`), so the three
 * cannot disagree about a draft.
 *
 * Neutral until the forge has answered this session, for the card's reason: a remembered
 * answer keeps its words and loses its colour. Decorative — the tab's words, or the
 * opener's label, name it.
 */

import type { ReactNode } from "react"
import { toneInk } from "../../../format/tone"
import { headingIcon, headingTone, type Heading } from "./pullRequest"

const PullRequestGlyph = ({
  pull,
  confirmed,
}: {
  readonly pull: Heading
  readonly confirmed: boolean
}): ReactNode => {
  const Glyph = headingIcon(pull)
  return (
    <Glyph
      size={12}
      aria-hidden
      className={`shrink-0 ${toneInk[confirmed ? headingTone(pull) : "neutral"]}`}
    />
  )
}

export default PullRequestGlyph
