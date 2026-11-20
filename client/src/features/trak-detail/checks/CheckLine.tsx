/**
 * One check that is not failing, as a line in the grid: its glyph and its name.
 *
 * **The name and nothing beside it, because three of these share a row.** The verdict is
 * the glyph's colour to look at and a word only a screen reader hears — a grid that also
 * printed the word, the time and a link per check is back to one tall column. The failing
 * ones are cards above the grid with all of that on them, drawn by `PullRequestChecks`; a
 * run's log is never fetched at any verdict, so a passing check has nothing to open anyway.
 *
 * **Skipped and unknown recede in the ink as well as in the glyph.** Neither is a result,
 * and a name in the same ink as a passing check's reads as one more thing that ran.
 */

import type { ReactNode } from "react"
import type { PullRequestCheckDto } from "../../../api/types"
import CheckMark from "./CheckMark"
import { verdictWord } from "../pull-request/pullRequest"

const CheckLine = ({ check }: { readonly check: PullRequestCheckDto }): ReactNode => {
  const back = check.verdict === "skipped" || check.verdict === "unknown"
  return (
    <span className="flex min-w-0 items-center gap-1.5 py-0.5">
      <CheckMark verdict={check.verdict} />
      <span
        className={`min-w-0 truncate font-mono text-2xs ${back ? "text-fg-subtle" : "text-fg-muted"}`}
      >
        {check.name}
      </span>
      <span className="sr-only">{verdictWord(check.verdict)}</span>
    </span>
  )
}

export default CheckLine
