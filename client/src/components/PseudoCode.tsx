/**
 * Pseudo-code in the rules-pseudo notation, coloured as tiniestfox colours it
 * (`format/pseudo`, with the `--color-syntax-*` palette).
 *
 * **`edge` draws it inside a dashed line marked `pseudo`**, tiniestfox's own frame, so a
 * sketch opened inside a figure is never read as code that runs. A ```pseudo fence takes no
 * edge: its figure's header band already says what it is.
 */

import type { ReactNode } from "react"
import type { PseudoHue } from "../format/pseudo"
import { pseudoRuns } from "../format/pseudo"

/** Whole class names, because Tailwind finds a class by reading the source. */
const INK: Readonly<Record<PseudoHue, string>> = {
  keyword: "text-syntax-keyword",
  string: "text-syntax-string",
  constant: "text-syntax-constant",
  tag: "text-syntax-tag",
  name: "text-syntax-name",
  call: "text-syntax-call",
  comment: "text-syntax-comment italic",
  rule: "text-syntax-rule",
  hole: "text-syntax-hole",
}

/** The code type every figure draws in: 11px mono on 16px lines, 8 by 10 of padding. */
export const CODE = "min-w-0 overflow-x-auto px-2.5 py-2 font-mono text-sm leading-4"

const PseudoCode = ({
  source,
  edge,
}: {
  readonly source: string
  readonly edge: boolean
}): ReactNode => {
  const lines = (
    <div className={`${CODE} whitespace-pre`}>
      {pseudoRuns(source).map((runs, i) => (
        // A line has no identity of its own, and the block is rebuilt whole.
        // oxlint-disable-next-line react/no-array-index-key
        <div key={i}>
          {runs.length === 0
            ? " "
            : runs.map((run, j) => (
                // oxlint-disable-next-line react/no-array-index-key
                <span key={j} className={run.hue === undefined ? undefined : INK[run.hue]}>
                  {run.text}
                </span>
              ))}
        </div>
      ))}
    </div>
  )
  if (!edge) return lines
  return (
    <div className="relative min-w-0 rounded-control border border-dashed border-guide bg-canvas">
      <span className="absolute top-0.5 right-1.5 font-mono text-2xs leading-3 text-fg-subtle">
        pseudo
      </span>
      {lines}
    </div>
  )
}

export default PseudoCode
