/**
 * What the trak spent, as the fifth section of the trak view: one figure, one bar sliced
 * by position, and its pieces in a sentence under it.
 *
 * **One bar, and the pieces are outside it.** A piece runs in its own checkout under its
 * own session, so its spend is never part of its parent's — drawn in, the parent's
 * breakdown would be a lie about what the parent ran, and merged, it would be the
 * double-counting the work set out to remove. The sentence says so in words.
 *
 * **No ceiling and no words after the figure.** A trak has nothing to be a percentage of,
 * and *in context* here would make six windows' worth spent over a day read as six
 * million tokens sitting in one — `TokenHead` carries why the two absences differ.
 */

import type { ReactNode } from "react"
import EmptySection from "../../../components/EmptySection"
import TokenBar from "./TokenBar"
import TokenHead from "./TokenHead"
import { type PiecesSpend, rampSegments, tokens, total, type TrakUsage } from "./usage"

/** The figure and its mark as one word, so the glyph cannot break onto a line of its own. */
const Figure = ({ n }: { readonly n: number }): ReactNode => (
  <span className="inline-flex items-baseline gap-1 whitespace-nowrap align-baseline">
    <span className="font-mono tabular-nums text-fg-muted">{tokens(n)}</span>
  </span>
)

const Pieces = ({ pieces }: { readonly pieces: PiecesSpend }): ReactNode => {
  const all = pieces.read === pieces.pieces
  return (
    <p className="text-2xs text-fg-subtle">
      {all
        ? `its ${String(pieces.pieces)} pieces spent `
        : `${String(pieces.read)} of its ${String(pieces.pieces)} pieces have answered so far, and spent `}
      <Figure n={total(pieces.spend)} /> between them, outside this bar
    </p>
  )
}

const TrakSpend = ({ usage }: { readonly usage: TrakUsage }): ReactNode =>
  total(usage.own) === 0 ? (
    <EmptySection shape="decisions">Nothing measured yet.</EmptySection>
  ) : (
    <div className="flex min-w-0 flex-col gap-4">
      <TokenHead used={total(usage.own)} ceiling={undefined} bare={undefined} />
      <TokenBar segments={rampSegments(usage.positions)} ceiling={undefined} />
      {usage.pieces !== undefined && <Pieces pieces={usage.pieces} />}
    </div>
  )

export default TrakSpend
