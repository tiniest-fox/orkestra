/**
 * What happened, as rows.
 *
 * **A row is a trak row, small** — the same anatomy the list already uses: a tone-marked
 * square, a couple of lines, something on the right. So the map needs no vocabulary of its
 * own, and a reader who has learned the index page has already learned this.
 *
 * **The composer is a row wherever it ran**, not only at the top. It runs again every time
 * it is asked for a different rest of the plan, and each of those runs sits after the entry
 * it followed — so the sequence reads as the chronology of the trak, and a plan that was
 * re-cut says so on the map instead of only in the log. The first compose is still first,
 * because nothing precedes it, which is what lets the map do without an empty state.
 * `rows.ts` decides all of that; this only draws it.
 *
 * A hairline guide runs plate centre to plate centre, **drawn behind the plates** so it
 * shows only in the gaps between them. Nothing is measured against a row's height and
 * it cannot drift when the density changes — both of its ends are set from the *top* of
 * their row, because a caption is as tall as it needs to be and the plate is not.
 *
 * **The caption wraps, to five lines.** The row is the one place on the trak that says
 * what a position was told to do, and one truncated line would say only where it began.
 * Five is a cap rather than a promise: about 470 characters on a full-width row, which
 * holds a typical plan step, and about forty words in a fifth-width piece column, where a
 * full-paragraph piece instruction is still cut. The proposal card at the composer's row
 * holds the whole of it.
 *
 * **A spawn has no row of its own — its pieces take the band.** Each column is one piece's
 * plan, stacked, and the layout is what says they ran at once; `family.ts` builds them.
 * The same guide leaves the plan above the columns and gathers back into the next entry
 * below them, which is the one fact adjacency cannot convey: the work rejoins at one
 * position. **A guide runs down each column too**, fan to fan behind its plates — invisible
 * at one line a row, and most of a band's left edge once captions wrap and four columns
 * finish early. **Nothing names a piece** — no column head, no label — because the
 * instructions are what tell them apart.
 *
 * **The ending is a row with a dashed rule above it**, and that rule is the one line the
 * map does not draw anywhere else. It says *the plan stops here*, which is true and is also
 * the only thing separating that row from an entry that happens to be last. The guide stops
 * at it for the same reason: the hairline runs plate to plate between things the plan
 * connects, and nothing composed this one.
 *
 * **Except where a wait has moved it.** A trak parked at a wait has its ending stood before
 * the entry the wait holds (`rows.ts` says why), and there the rule is not drawn and the
 * guide runs through: the entries under it are still the plan, and a line meaning *the
 * plan stops here* drawn over two more entries contradicts itself. Nothing about the row
 * moves it — `MapRow.waiting` is the fact, and `foot` below is the whole of the reading.
 */

import type { CSSProperties, ReactNode } from "react"
import { ArrowUpFromDot, CircleDashed, GitCommitHorizontal, Zap } from "lucide-react"
import { toneInk } from "../../../../format/tone"
import ContinuesMark from "./ContinuesMark"
import { type Corner, cornerClass, type CornerKind, corners } from "./corners"
import type { Band, Column, Spot } from "../family"
import { stillRunningText } from "../../turns/jobs/outstanding"
import { statusText } from "../planView"
import type { Badge as BadgeFact, MapRow } from "../rows"
import StepMark from "./StepMark"

/** `px-2` plus half a 24px plate, less half a hairline. */
const CX = 19.5
/**
 * The route is drawn with `--color-guide`, not `--color-border`.
 *
 * It was a literal here until the rail wanted the same line and two copies of one value
 * became a drift waiting to happen. The token carries the reason it is not `border`; what
 * stays here is that this is an inline `background` rather than a class, because the fan's
 * stubs are positioned spans whose colour is geometry set alongside their offsets.
 */
const GUIDE = "var(--color-guide)"

/** The grid's own gap, in pixels, which the fan has to measure a column's centre through. */
const GAP = 4

/**
 * Between rows, in pixels — the plan's and a column's alike. A wrapped caption runs to the
 * row's edge, and two of them touching read as one paragraph. The guide bridges it.
 */
const ROW_GAP = 2

/** Where the plate's centre is, measured down from the row's top: `py-1.5` plus 12. */
const PLATE = 18

/**
 * Five pieces before the band wraps, each wrapped row bracketed on its own.
 *
 * A spawn is however wide the composer wanted it, and nine columns in a drawer is about
 * 60px each — a mark and a truncated word. Wrapping costs the fan reading twice; not
 * wrapping costs the row being unreadable, which is worse.
 */
const PER_ROW = 5

/** Where one row of the band splits into columns, and where it gathers back. */
const inRowsOfFive = (columns: readonly Column[]): readonly (readonly Column[])[] =>
  Array.from({ length: Math.ceil(columns.length / PER_ROW) }, (_, i) =>
    columns.slice(i * PER_ROW, (i + 1) * PER_ROW),
  )

/**
 * The centre of column `i`'s plate, as a length the fan's stubs can be placed at.
 *
 * Measured to the plate rather than to the middle of the cell: `repeat(n, 1fr)` with a gap
 * puts cell `i` at `i·(width + gap)/n`, and the plate sits `CX` into it — so a stub at the
 * cell's own centre would point at a column's caption instead of at its mark.
 */
const centre = (i: number, n: number): string =>
  `calc(${String((i / n) * 100)}% + ${String((i / n) * GAP + CX)}px)`

/**
 * The split, or the rejoin: the guide leaves the plan once and spreads to the pieces.
 *
 * Drawn in the guide's own colour and from its own `CX`, so what leaves the plan is
 * visibly the same line that runs down it.
 */
const Fan = ({
  columns,
  edge,
}: {
  readonly columns: readonly Column[]
  readonly edge: "top" | "bottom"
}): ReactNode => {
  const n = columns.length
  const from = (px: number): CSSProperties => (edge === "top" ? { top: px } : { bottom: px })
  return (
    <span aria-hidden className="relative block h-3">
      <span
        className="absolute w-px"
        style={{ ...from(0), left: CX, height: 6, background: GUIDE }}
      />
      <span
        className="absolute h-px"
        style={{
          ...from(6),
          left: CX,
          right: `calc(100% - ${centre(n - 1, n)})`,
          background: GUIDE,
        }}
      />
      {columns.map((column, i) => (
        <span
          key={column.id}
          className="absolute w-px"
          style={{ ...from(6), left: centre(i, n), height: 6, background: GUIDE }}
        />
      ))}
    </span>
  )
}

/**
 * The four corner marks this surface draws, in the shape `corners` places them: a mark
 * is drawn where the placement names its corner, and not at all where it does not. The
 * ordering and the two-corner cap are `corners.ts`'s and nothing here re-decides them.
 */
const DRAWN: readonly CornerKind[] = ["gate", "handUp", "badge", "continues"]

/**
 * The mark on a row nobody was asked about: a filled bolt at the plate's corner, half
 * outside it, on a disc of the row's own ground.
 *
 * **Beside the plate and never inside it.** The plate's colour and glyph are already
 * spoken for — they say how the step *went* — so a source colour has to live on
 * something that is not the plate, which is why this is a badge rather than a treatment.
 * The disc is what keeps a 10px glyph legible over the guide running behind it.
 *
 * **The map only makes it findable.** Why the gate went past is a band inside the
 * document the row filed, and this carries none of it: a reason repeated on every marked
 * row is a reason nobody reads. `UnattendedBand` draws the answer.
 */
const Unread = ({ corner }: { readonly corner: Corner }): ReactNode => (
  <span
    className={`absolute -top-1 flex size-3.5 items-center justify-center rounded-pill bg-canvas text-source-machine ${cornerClass[corner]}`}
  >
    <Zap size={10} fill="currentColor" strokeWidth={2.25} aria-hidden />
    {/* Nothing in the row's caption says it, so the mark is the only thing on this
        surface that does — a reader who cannot see it needs the words. */}
    <span className="sr-only">automatically approved</span>
  </span>
)

/**
 * The mark on the ending row of a piece whose composer handed work up to its parent — the
 * same device as `Unread`, at the plate's other fact.
 *
 * In `tone-waiting` rather than a source colour, because it is a different fact from
 * `Unread`'s: not *who took this gate* but *this piece asked for work*. The plate under it
 * stays the ending's own tone, so a merged piece that asked carries two colours, and that
 * is deliberate — the badge does not move what green means anywhere else.
 *
 * **The map only makes it findable.** What was asked for is printed whole on the piece's
 * own finished pane, one press away — `FinishedView`.
 */
const HandedUp = ({ corner }: { readonly corner: Corner }): ReactNode => (
  <span
    className={`absolute -top-1 flex size-3.5 items-center justify-center rounded-pill bg-canvas text-tone-waiting ${cornerClass[corner]}`}
  >
    <ArrowUpFromDot size={10} strokeWidth={2.75} aria-hidden />
    {/* The caption says it in words too, but a reader who cannot see the mark should
        hear it at the plate rather than three lines later. */}
    <span className="sr-only">handed work up to the parent</span>
  </span>
)

/**
 * The third and fourth of the family `Unread` and `HandedUp` are the first two of: a fact
 * that is neither *who ran this* nor *how it went*, at the plate's corner on a disc of the
 * row's own ground. Which rows carry one and what it says is `rows.ts`'s — the entry a wait
 * holds, and a compose something asked for — so this only draws it: the same 14px disc,
 * the same 10px glyph, and a tone rather than a fixed colour, because a wait has one of its
 * own and an ask borrows the hand-up's.
 *
 * **The map only makes it findable.** What the wait is and when it is next asked is the
 * held card, one press away on the ending row above; why the compose was asked is the row's
 * own caption.
 */
const Badge = ({
  glyph: Glyph,
  tone,
  says,
  corner,
}: BadgeFact & { readonly corner: Corner }): ReactNode => (
  <span
    className={`absolute -top-1 flex size-3.5 items-center justify-center rounded-pill bg-canvas ${toneInk[tone]} ${cornerClass[corner]}`}
  >
    <Glyph size={10} strokeWidth={2.5} aria-hidden />
    {/* Nothing in the row's title or caption says it, so the mark carries its own words
        for a reader who cannot see it. */}
    <span className="sr-only">{says}</span>
  </span>
)

/**
 * Whether a row is the ending at the foot of its plan — the one the rule is drawn over and
 * the guide stops short of. An ending a wait has moved mid-plan is neither.
 */
const foot = (row: MapRow | undefined): boolean => row?.kind === "end" && row.waiting === undefined

/** One row. The guide is a sibling of the button so the plate paints over it. */
const Row = ({
  spot,
  spine,
  onPick,
}: {
  readonly spot: Spot
  /**
   * Where the plan's guide runs behind this row, and **absent for a row in a column**.
   *
   * One prop for two facts that always coincide: a packed row has no spine to sit on, and
   * no right edge to hang a commit on either — a slot pinned right in a fifth-width column
   * lands in the middle of the strip and reads as another column.
   */
  readonly spine?: { readonly first: boolean; readonly last: boolean }
  readonly onPick: (key: string) => void
}): ReactNode => {
  const at = corners(spot.row, DRAWN)
  return (
    <li
      className={`relative flex ${
        // The one line the map does not draw anywhere else: *the plan stops here*.
        foot(spot.row) ? "mt-1.5 border-t border-dashed border-border pt-1.5" : ""
      }`}
    >
      {spine !== undefined && !foot(spot.row) && (
        <span
          aria-hidden
          className="pointer-events-none absolute w-px"
          style={{
            left: CX,
            top: spine.first ? PLATE : -ROW_GAP,
            // Measured from the top like the start, which is the whole of what keeps the
            // end on the last plate's centre: 18px above the row's *bottom* was the centre
            // only while the row was one line tall. A row that is first and last draws
            // nothing, which is right — there is no second plate to reach.
            bottom: spine.last ? `calc(100% - ${String(PLATE)}px)` : -ROW_GAP,
            background: GUIDE,
          }}
        />
      )}
      <button
        type="button"
        onClick={() => onPick(spot.key)}
        className="flex min-w-0 flex-1 items-start gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-hover-row"
      >
        {/* Positioned, so it paints over the guide — which is what makes the line
          centre-to-centre without anyone measuring a row. */}
        <span className="relative">
          <StepMark row={spot.row} />
          {/* Each mark where `corners` put it — right for the first the row carries, left
            for the second. A settled ask on an unattended trak carries the bolt and the
            hand; a held step told to continue a conversation carries the badge and the
            continues mark. Neither surface decides the side. */}
          {at.get("gate") !== undefined && <Unread corner={at.get("gate") ?? "right"} />}
          {at.get("handUp") !== undefined && <HandedUp corner={at.get("handUp") ?? "right"} />}
          {spot.row.badge !== undefined && at.get("badge") !== undefined && (
            <Badge {...spot.row.badge} corner={at.get("badge") ?? "right"} />
          )}
          {at.get("continues") !== undefined && (
            <ContinuesMark corner={at.get("continues") ?? "right"} />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="min-w-0 truncate text-base font-medium text-fg">{spot.row.title}</span>
          {/* `break-words` is what keeps a path in a fifth-width column inside it — without
            `truncate` there is no `overflow-hidden` left to stop a long token crossing
            into the next piece. `line-clamp-5` is the cap the header argues. */}
          <span className="min-w-0 break-words text-sm text-fg-muted line-clamp-5">
            {spot.row.caption}
          </span>
          {/* The square says how the position is going in colour and in motion alone — its
            glyph belongs to the agent now — so this is the only place those words exist.
            An `sr-only` span rather than an `aria-label`, which would replace the title
            and the caption the row is actually named by. The ending needs none: its
            caption is `trakLabel`'s sentence, which already says where it stands. */}
          {spot.row.status !== undefined && (
            <span className="sr-only">{statusText(spot.row.status)}</span>
          )}
          {/* Which step is holding background work open, in words under its caption — the
            plan surface says more than the rail's numeral. Gated on `running` for
            `MapRow.outstanding`'s reason. */}
          {spot.row.status === "running" && spot.row.outstanding > 0 && (
            <span className="flex min-w-0 items-center gap-1.5 pt-0.5 font-mono text-2xs text-tone-working">
              <CircleDashed size={10} aria-hidden className="shrink-0" />
              {stillRunningText(spot.row.outstanding)}
            </span>
          )}
        </span>
        {spine !== undefined && spot.row.sha !== undefined && (
          <span className="flex shrink-0 items-center gap-1 pt-0.5 font-mono text-2xs text-tone-good">
            <GitCommitHorizontal size={11} aria-hidden />
            {spot.row.sha}
          </span>
        )}
      </button>
    </li>
  )
}

/**
 * A spawn's pieces, abreast.
 *
 * **Ragged, not `items-start`-levelled.** The work rejoins when the slowest piece
 * finishes, so a short column padded to its neighbours' height would say the opposite.
 */
const Spawn = ({
  columns,
  onPick,
}: {
  readonly columns: readonly Column[]
  readonly onPick: (key: string) => void
}): ReactNode => (
  <li className="flex flex-col gap-1">
    {inRowsOfFive(columns).map((across) => (
      // The first piece of a wrapped row names it: the columns of one spawn never reorder
      // within a poll, and the id is the only stable name any of them has.
      <div key={across[0]?.id} className="flex flex-col">
        <Fan columns={across} edge="top" />
        <div
          className="grid"
          style={{
            gap: GAP,
            gridTemplateColumns: `repeat(${String(across.length)}, minmax(0, 1fr))`,
          }}
        >
          {across.map((column) => (
            // The guide is a sibling of the list rather than a child of it: an `<ol>` may
            // hold nothing but `<li>`. First, so the plates paint over it — the plan's own
            // device, and why nothing here measures a row.
            <div key={column.id} className="relative flex min-w-0 flex-col">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 w-px"
                style={{ left: CX, background: GUIDE }}
              />
              <ol className="flex min-w-0 flex-col" style={{ gap: ROW_GAP }}>
                {column.spots.map((spot) => (
                  <Row key={spot.key} spot={spot} onPick={onPick} />
                ))}
              </ol>
            </div>
          ))}
        </div>
        <Fan columns={across} edge="bottom" />
      </div>
    ))}
  </li>
)

const TrakMap = ({
  bands,
  onPick,
}: {
  readonly bands: readonly Band[]
  readonly onPick: (key: string) => void
}): ReactNode => (
  // Named, because `TrakRail` draws the same positions under the same names down the edge
  // of this pane. Two unlabelled lists of identical items is one list met twice.
  <ol aria-label="Plan" className="flex flex-col" style={{ gap: ROW_GAP }}>
    {bands.map((band, i) =>
      // The band's own key, not its index: a re-compose inserts in the middle, so this
      // list genuinely reorders — which is the case an index key gets wrong.
      band.columns.length === 0 ? (
        <Row
          key={band.spot.key}
          spot={band.spot}
          spine={{
            first: i === 0,
            // The guide ends at the last row the *plan* holds. Running it into the ending
            // would draw a line between the plan and the thing that is not part of it,
            // under the very rule that says they are apart. An ending a wait has moved
            // mid-plan is not that: the plan carries on under it.
            last: i === bands.length - 1 || foot(bands[i + 1]?.spot.row),
          }}
          onPick={onPick}
        />
      ) : (
        <Spawn key={band.spot.key} columns={band.columns} onPick={onPick} />
      ),
    )}
  </ol>
)

export default TrakMap
