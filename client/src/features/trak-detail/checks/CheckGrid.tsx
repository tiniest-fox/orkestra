/**
 * Every check that is not failing, three across at desk width and one on a phone.
 *
 * **One flat list in verdict order, with no heading per status.** A heading per group
 * costs a line each and the glyphs already say it. Running first, then passed, then the two
 * that are not results, so the eye meets the same order the counted verdict lists them in.
 *
 * CSS columns rather than a grid, so the list fills down the first column before it starts
 * the second — twenty names read as a list that happens to be folded, not as a table.
 */

import type { ReactNode } from "react"
import type { PullRequestCheckDto } from "../../../api/types"
import CheckLine from "./CheckLine"
import { checkKey } from "../pull-request/pullRequest"

/** The order a reader meets them, which is also the order the counted verdict lists them in. */
const VERDICTS: readonly PullRequestCheckDto["verdict"][] = [
  "running",
  "passed",
  "skipped",
  "unknown",
]

const CheckGrid = ({ checks }: { readonly checks: readonly PullRequestCheckDto[] }): ReactNode => (
  <div className="gap-x-5 sm:columns-3">
    {VERDICTS.flatMap((verdict) => checks.filter((check) => check.verdict === verdict)).map(
      (check) => (
        // `break-inside-avoid`, or a column boundary can fall between a glyph and its name.
        <div key={checkKey(check)} className="break-inside-avoid">
          <CheckLine check={check} />
        </div>
      ),
    )}
  </div>
)

export default CheckGrid
