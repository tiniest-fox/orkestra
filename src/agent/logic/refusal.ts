// logic: the reason an agent is re-asked, cut down to what it can act on.
//
// `ParseError.message` is the tree formatter's account: for a union under a
// refinement it opens with every member's full type expansion and ends with the
// one line the refinement wrote. Measured on a step envelope, 2,283–5,352
// characters of which 82–212 said what was wrong. The agent is the reader, and
// the guidance is the only part that helps it — so the re-ask carries the leaves
// and nothing else.

import { ParseResult } from "effect"

/**
 * Every leaf issue, as `path: message`, one line each.
 *
 * `ArrayFormatter` already walks past the union to the member the discriminator
 * picked, so a refusal from `checkSections` or `checkAmendment` arrives as one
 * entry with an empty path; a missing key arrives as `sections: is missing`.
 */
export const refusalReason = (error: ParseResult.ParseError): string =>
  ParseResult.ArrayFormatter.formatErrorSync(error)
    .map((issue) =>
      issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`,
    )
    .join("\n")
