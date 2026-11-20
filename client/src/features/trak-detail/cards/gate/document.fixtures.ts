/**
 * What an artifact's document looks like, for the atelier catalogue.
 *
 * `DocumentDto` is `{ sections: Record<string, string> }` — a type that says a document has
 * named prose in it and nothing whatever about what the prose is, which is exactly the
 * case a derived panel cannot fill. One value here unblocks both `ArtifactCard` and
 * `ArtifactBody`, neither of which this file names: the match is by assignability.
 *
 * The sections are written long enough to wrap, because a card whose every section is one
 * short line is a picture of a layout that never happens.
 */

import type { DocumentDto } from "../../../../api/types"
import { makeDocument } from "../../../../fixtures"

export const proposal: DocumentDto = makeDocument({
  sections: {
    Summary:
      "Split the catalogue walk so a union props type becomes one entry with a branch knob, rather than one entry per branch.",
    Approach:
      "Derive each branch separately, then fold the results back together. Props every branch shares stay unconditional; the rest carry the branch they belong to and are gated on a knob naming it.",
    Risks:
      "A branch is usually an intersection rather than a plain object, so filtering constituents for Object alone silently drops all of them and the split never happens.",
  },
})

export const short: DocumentDto = makeDocument({
  sections: {
    Summary: "Bump the provider client to the streaming API.",
  },
})

export const empty: DocumentDto = makeDocument({ sections: {} })
