/**
 * Which slice of the work the diff is showing — a flush tab strip directly under the
 * navigator, at `GateStrip`'s height and treatment.
 *
 * **The strip owns the hairline between its segments**, `TabBar`'s rule: whether a segment
 * is first is a fact about the bar rather than about the segment, so a strip whose parts
 * each carried a `border-l` grows a wrong edge the moment one of them is absent — which is
 * exactly what the third row is.
 *
 * The total sits on the right in mono at the smallest step, which is the same place and the
 * same weight `GateStrip` puts its verdict.
 */

import type { ReactNode } from "react"
import { GitCommitHorizontal, GitCompare, Pencil } from "lucide-react"
import Tab from "../../../components/Tab"
import { ALL, UNCOMMITTED, type Slice } from "./slices"

/** The two fixed rows have a mark each; a step's row wears the commit. */
const glyph = (at: string) =>
  at === ALL ? GitCompare : at === UNCOMMITTED ? Pencil : GitCommitHorizontal

const SlicePicker = ({
  slices,
  at,
  total,
  onPick,
}: {
  readonly slices: readonly Slice[]
  readonly at: string
  /** `26 files +1147 −259`, or `undefined` while there is nothing to count. */
  readonly total: string | undefined
  readonly onPick: (at: string) => void
}): ReactNode => (
  <div className="flex h-8 shrink-0 items-stretch justify-between gap-2 border-b border-border bg-surface pr-3">
    <div className="flex min-w-0 items-stretch [&>*+*]:border-l [&>*+*]:border-border">
      {slices.map((slice) => (
        <Tab
          key={slice.at}
          label={slice.label}
          icon={glyph(slice.at)}
          current={slice.at === at}
          onClick={() => {
            onPick(slice.at)
          }}
        />
      ))}
    </div>

    {total !== undefined && (
      <span className="flex shrink-0 items-center font-mono text-2xs text-fg-muted">{total}</span>
    )}
  </div>
)

export default SlicePicker
