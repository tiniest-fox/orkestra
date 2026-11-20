import type { ReactNode } from "react"
import Row from "../../components/Row"
import { toneInk } from "../../format/tone"
import RailCount from "./RailCount"
import { SHELL } from "./SectionHeader"

/**
 * What stands where the finished work will be while GitHub is being asked: one header
 * and a short run of ghost rows, spliced in by `TrakSections` while the hold stands
 * (`withHold`).
 *
 * **The header is not a lid.** The block has nothing to fold, so there is no button and
 * no caret — but the caret's *slot* is drawn, because that 11px is what puts every other
 * section label on one vertical line, and a word hanging left of that rail would be the
 * only one on the page. No count either: how many groups are owed a row is known while
 * the piles they land in are not, and a number over ghosts capped below it would
 * disagree with what is drawn.
 *
 * **A ghost is the height of the row it stands for.** It is drawn in the list's own
 * `Row`, so the two agree by construction — `Skeleton`'s `rows` shape is one line, and a
 * finished trak's row is two, a title and a status.
 *
 * **The block is a loading affordance, not a space reservation.** One ghost per group the
 * hold stands in for, up to five — so three finished traks get three rows and a pile of
 * twenty-five gets the same five as ten. It promises nothing about the height the answer
 * will take: a group whose pull request merged lands under a shut lid and draws no row at
 * all, so the page moves when the answer lands whatever this block was. What it buys is
 * that its top edge never moves, and that no finished row is drawn in a pile nobody has
 * vouched for.
 */

/** The most rows the block is, however much finished work there is. */
const CAP = 5

/* Whole literal class names: Tailwind finds classes by scanning source text, so a width
 * assembled at runtime emits no CSS and the bar renders full-width. */
const WIDTHS = ["w-[58%]", "w-[42%]", "w-[66%]", "w-[36%]", "w-[52%]", "w-[47%]"]

const ForgeHold = ({
  /** Every group the hold stands in for — what there is, not what is drawn. A group is
   *  one row however many finished members it has, so the count is of rows owed. */
  count,
  rail,
}: {
  readonly count: number
  /** Beside a wide drawer — `SectionHeader`'s rail form. */
  readonly rail: boolean
}): ReactNode => {
  const drawn = Math.min(count, CAP)
  // The last drawn row dissolves, and only when there is more finished work behind it —
  // a fade with nothing beyond it is a lie about the shape continuing. As a fraction of
  // the block's own height, so the fade starts on a row boundary rather than across one.
  const mask =
    count <= CAP
      ? undefined
      : `linear-gradient(to bottom, #000 0%, #000 ${(((drawn - 1) / drawn) * 100).toFixed(1)}%, transparent 100%)`

  return (
    <section>
      <div className={SHELL}>
        {rail ? (
          // No count: the number of groups owed is not a section's count, and the ghosts
          // under it already say something is on its way.
          <RailCount title="Fetching status…" tone="neutral" count={undefined} />
        ) : (
          <>
            <span aria-hidden className="w-[11px] self-center" />
            <span className={`font-mono text-2xs uppercase tracking-wider ${toneInk.neutral}`}>
              Fetching status…
            </span>
          </>
        )}
      </div>
      {/* `aria-hidden`, because the ghosts are the absence of content and the header
          above is the words the block owes a reader. `pointer-events-none` is what keeps
          `Row`'s hover tint from lighting up a placeholder under the cursor. The pulse is
          the one loading state it is honest about: something really is on its way. */}
      <ul
        aria-hidden
        style={mask === undefined ? undefined : { maskImage: mask, WebkitMaskImage: mask }}
        className="pointer-events-none flex animate-pulse flex-col divide-y divide-border opacity-60"
      >
        {Array.from({ length: drawn }, (_, i) => (
          // Positional and identical in kind; nothing here reorders.
          // oxlint-disable-next-line react/no-array-index-key -- fixed-length placeholder
          <Row
            key={i}
            leading={<span className="size-6 shrink-0 rounded-control bg-surface-2" />}
            trailing={<span className="block h-5 w-14 rounded-control bg-surface-2" />}
          >
            {/* The margins are what make a ghost 55px, which is what a finished trak's
                row measures: a title line box of 24 and a status line box of 11, inside
                `Row`'s own `py-2.5`. Get them wrong and the block is the right shape at
                the wrong height. */}
            <span
              className={`my-[7px] block h-2.5 rounded-control bg-surface-2 ${WIDTHS[i % WIDTHS.length] ?? ""}`}
            />
            <span className="my-[1.5px] block h-2 w-24 rounded-control bg-surface-2" />
          </Row>
        ))}
      </ul>
    </section>
  )
}

export default ForgeHold
