/**
 * A table an agent marked: a role per column, an icon per row, an arrow on a cell, rows in
 * sections, and a detail drawn as a column of its own. One component for every table fence —
 * `decision`, `scope`, `criteria`, `files`, `runs` and the free `table` — configured by
 * `format/markedTable`, and drawn in the shared `Figure` frame.
 *
 * - **Nothing opens or collapses.** Every cell wraps to its full height, and a row's detail
 *   — a decision's why — is one more column at the right, headed by its label.
 * - **The column heads are the figure's header**: no band above them, 9px caps on `surface`.
 * - **A good column is washed green and a bad one red**, its head in the same tone, with a
 *   quiet glyph leading each cell. Never a pill: a mark is a glyph.
 * - **A cell may carry its own verdict** — `met:` on a criterion, a run's result — which
 *   washes that cell alone, green, red or amber, and leads it with a tick, a cross or a
 *   dashed ring.
 * - **Rules between rows and between columns are the translucent guide**, which stays
 *   visible across a wash in both schemes.
 * - **Icons are filled in light mode and outlined in dark**, except a stroke that never
 *   closes — a tick, a cross, an arrow — which filling would draw as a shape it does not have.
 * - **The key and the notes — a run's cost, what waits on a restart — are the footer.**
 *
 * **The layout keys on the table's own width, not the viewport's.** The figure is a
 * container, and `@xl:` (576px) is where the columns stand side by side; under it each row
 * is a card — its lead cell over one labelled line per other column, then its detail. A
 * table sits in a drawer as narrow as 570px on a desk and in a message bubble narrower than
 * that, so the 640px viewport seam would lay four columns into a box that cannot hold them.
 * The two layouts are one tree, so a tier-2 query finds a column's head twice: once in the
 * head row and once as each cell's narrow label. The column template is an inline style,
 * which only the wide layout's `grid` reads: the narrow one is a flex column.
 *
 * **A column is as wide as its content asks, not an equal share.** Every column is an `auto`
 * track, so the free width is dealt out equally and a column stops taking it once its
 * longest cell fits on one line: a column of numbers stays a number wide, and the prose
 * columns share what is left and wrap. That needs every row on the same tracks, so the wide
 * layout is one grid and each row and the head row a `subgrid` of it — a grid per row would
 * size its columns from that row alone, and no two rows would line up.
 *
 * **No z-index anywhere**, and nothing is positioned: the washes are a cell's own ground.
 */

import type { LucideIcon } from "lucide-react"
import type { CSSProperties, ReactNode } from "react"
import { Fragment } from "react"
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleDashed,
  Equal,
  Flag,
  FlaskConical,
  Pencil,
  Play,
  Plus,
  TriangleAlert,
  User,
  X,
} from "lucide-react"
import type {
  Cell,
  Column,
  Mark,
  MarkedTableConfig,
  Role,
  Row,
  Verdict,
} from "../format/markedTable"
import Figure, { CAPS } from "./Figure"

/* ------------------------------------------------------------------ marks */

const ICON: Record<Mark, LucideIcon> = {
  flag: Flag,
  check: Check,
  warn: TriangleAlert,
  new: Plus,
  changed: Pencil,
  test: FlaskConical,
  person: User,
  script: Play,
  better: ArrowUp,
  worse: ArrowDown,
  same: Equal,
}
/** What a mark says to a screen reader, which cannot see its shape. */
const WORD: Record<Mark, string> = {
  flag: "Flagged",
  check: "Yes",
  warn: "Careful",
  new: "New",
  changed: "Changed",
  test: "A test",
  person: "A person",
  script: "A script",
  better: "Better",
  worse: "Worse",
  same: "Same",
}
/** A row icon's tone, which the key repeats. */
const ICON_TONE: Record<Mark, string> = {
  flag: "text-tone-waiting",
  check: "text-tone-good",
  warn: "text-tone-waiting",
  new: "text-tone-good",
  changed: "text-tone-waiting",
  test: "text-tone-working",
  person: "text-tone-waiting",
  script: "text-tone-working",
  better: "text-tone-good",
  worse: "text-tone-bad",
  same: "text-tone-neutral",
}
/** The same tones, quieter, for a mark leading a cell's text. */
const MARK_TONE: Record<Mark, string> = {
  flag: "text-tone-waiting/70",
  check: "text-tone-good/60",
  warn: "text-tone-waiting/70",
  new: "text-tone-good/60",
  changed: "text-tone-waiting/70",
  test: "text-tone-working/60",
  person: "text-tone-waiting/70",
  script: "text-tone-working/60",
  better: "text-tone-good/60",
  worse: "text-tone-bad/60",
  same: "text-fg-subtle/70",
}

const TONE: Record<Verdict, string> = {
  good: "text-tone-good",
  bad: "text-tone-bad",
  partly: "text-tone-waiting",
}
/** A wash on both layouts, and one on the wide layout only, for the lead cell. */
const WASH: Record<Verdict, string> = {
  good: "bg-tone-good-track",
  bad: "bg-tone-bad-track",
  partly: "bg-tone-waiting-track",
}
const WIDE_WASH: Record<Verdict, string> = {
  good: "@xl:bg-tone-good-track",
  bad: "@xl:bg-tone-bad-track",
  partly: "@xl:bg-tone-waiting-track",
}
const SIDE_GLYPH: Record<Verdict, { readonly icon: LucideIcon; readonly ink: string }> = {
  good: { icon: Check, ink: "text-tone-good/60" },
  bad: { icon: X, ink: "text-tone-bad/60" },
  partly: { icon: CircleDashed, ink: "text-tone-waiting/70" },
}

/** A cell's own verdict, said aloud: a column's wash is said by its head, a cell's by nothing else. */
const VERDICT_WORD: Record<Verdict, string> = { good: "Yes", bad: "No", partly: "Partly" }

/** Strokes that never close: filling them paints a shape the icon does not have. */
const OPEN = new Set<LucideIcon>([Check, X, Plus, ArrowUp, ArrowDown, Equal, CircleDashed])

/** Filled in light mode, outlined in dark; a CSS `fill` overrides lucide's `fill="none"`. */
const FILLED = "fill-current/90 dark:fill-none"

const sideOf = (role: Role): Verdict | undefined => (role === "plain" ? undefined : role)

/** One table icon at its size and tone, filled or outlined as the scheme asks. */
const Glyph = ({
  icon: Icon,
  size,
  tone,
  label,
}: {
  readonly icon: LucideIcon
  readonly size: number
  readonly tone: string
  readonly label: string | undefined
}): ReactNode => (
  <Icon
    aria-label={label}
    aria-hidden={label === undefined ? true : undefined}
    size={size}
    className={`shrink-0 ${tone} ${OPEN.has(Icon) ? "" : FILLED}`}
  />
)

const RowIcon = ({ mark, size }: { readonly mark: Mark; readonly size: number }): ReactNode => (
  <Glyph icon={ICON[mark]} size={size} tone={ICON_TONE[mark]} label={WORD[mark]} />
)

/** The glyph that leads a cell: its own arrow, its verdict, or its column's check or cross. */
const Lead = ({ cell, column }: { readonly cell: Cell; readonly column: Column }): ReactNode => {
  const side = cell.verdict ?? sideOf(column.role)
  if (cell.mark === undefined && side === undefined) return undefined
  const glyph =
    cell.mark === undefined
      ? {
          ...SIDE_GLYPH[side ?? "good"],
          label: cell.verdict === undefined ? undefined : VERDICT_WORD[cell.verdict],
        }
      : { icon: ICON[cell.mark], ink: MARK_TONE[cell.mark], label: WORD[cell.mark] }
  return (
    <span className="mt-1 flex shrink-0">
      <Glyph icon={glyph.icon} size={12} tone={glyph.ink} label={glyph.label} />
    </span>
  )
}

/* ------------------------------------------------------------------ text */

/**
 * A cell's text with the two inline marks an agent uses drawn: a code span and a bold run.
 * Each part is keyed by where it starts in the string, which is fixed for a given string.
 */
const T = ({ children }: { readonly children: string }): ReactNode => {
  let at = 0
  return children.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part) => {
    const key = at
    at += part.length
    if (part.startsWith("`"))
      return (
        <code
          key={key}
          className="rounded-control bg-surface-2 px-1 font-mono text-sm [overflow-wrap:anywhere]"
        >
          {part.slice(1, -1)}
        </code>
      )
    if (part.startsWith("**"))
      return (
        <strong key={key} className="font-semibold text-fg">
          {part.slice(2, -2)}
        </strong>
      )
    return part
  })
}

/** A file's path: its folder muted, its name in full, wrapping wherever it must. */
const Path = ({ text }: { readonly text: string }): ReactNode => {
  const at = text.lastIndexOf("/") + 1
  return (
    <span className="min-w-0 font-mono text-sm [overflow-wrap:anywhere]">
      <span className="text-fg-muted">{text.slice(0, at)}</span>
      <span className="font-medium text-fg">{text.slice(at)}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ the grid */

/** A column's place on the wide layout: the rule before it and the room around its text. */
const WIDE = "@xl:border-l @xl:border-guide @xl:px-2.5 @xl:py-1.75 @xl:first:border-l-0"

/** The wide layout's columns: the icons' slot, then a track sized to its content per column. */
const templateOf = (config: MarkedTableConfig): CSSProperties => ({
  gridTemplateColumns: [
    ...(config.rows.some((row) => row.icon !== undefined) ? ["24px"] : []),
    ...config.columns.map(() => "auto"),
    ...(config.rows.some((row) => row.detail !== undefined) ? ["auto"] : []),
  ].join(" "),
})

/** A row of the wide layout: the whole width, on the table's own tracks. */
const ROW = "@xl:col-span-full @xl:grid @xl:grid-cols-subgrid"

/** The label a narrow line carries, which the wide layout's head row says instead. */
const Label = ({ children }: { readonly children: string }): ReactNode => (
  <span className={`min-w-0 pt-0.5 @xl:hidden ${CAPS}`}>{children}</span>
)

/** The lead cell: on a narrow card the line on top, with the row's icon before it. */
const Name = ({ row, column }: { readonly row: Row; readonly column: Column }): ReactNode => {
  const cell = row.cells[0]
  const side = cell?.verdict ?? sideOf(column.role)
  return (
    <span
      className={`flex min-w-0 items-start gap-1.5 text-fg ${WIDE} ${side === undefined ? "" : WIDE_WASH[side]}`}
    >
      {row.icon !== undefined && (
        <span className="mt-0.5 flex shrink-0 @xl:hidden">
          <RowIcon mark={row.icon} size={13} />
        </span>
      )}
      {cell !== undefined && <Lead cell={cell} column={column} />}
      <span className="min-w-0">
        {column.path ? <Path text={cell?.text ?? ""} /> : <T>{cell?.text ?? ""}</T>}
      </span>
    </span>
  )
}

/** Any other cell: a column on the wide layout, a labelled line on a narrow card. */
const Piece = ({ cell, column }: { readonly cell: Cell; readonly column: Column }): ReactNode => {
  const side = cell.verdict ?? sideOf(column.role)
  return (
    <span
      className={`-mx-1 grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 rounded-control px-1 py-0.5 text-fg @xl:mx-0 @xl:block @xl:rounded-none ${WIDE} ${side === undefined ? "" : WASH[side]}`}
    >
      <Label>{column.head}</Label>
      <span className="flex min-w-0 gap-1.5">
        <Lead cell={cell} column={column} />
        <span className="min-w-0">
          {column.path ? <Path text={cell.text} /> : <T>{cell.text}</T>}
        </span>
      </span>
    </span>
  )
}

/** A row's detail: the last column on the wide layout, the last line of a narrow card. */
const Detail = ({ row }: { readonly row: Row }): ReactNode =>
  row.detail === undefined ? (
    // An empty cell still holds the column's rule on the wide layout.
    <span aria-hidden className={`hidden @xl:block ${WIDE}`} />
  ) : (
    <span
      className={`grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 py-0.5 text-fg-muted @xl:block ${WIDE}`}
    >
      <Label>{row.detailLabel}</Label>
      <span className="min-w-0">
        <T>{row.detail}</T>
      </span>
    </span>
  )

/* ------------------------------------------------------------------ a row */

const Entry = ({
  config,
  row,
  ruled,
  details,
}: {
  readonly config: MarkedTableConfig
  readonly row: Row
  readonly ruled: boolean
  readonly details: boolean
}): ReactNode => (
  <div
    className={`flex min-w-0 flex-col gap-1 bg-surface px-2.5 py-1.75 ${ROW} @xl:gap-0 @xl:p-0 ${ruled ? "border-t border-guide" : ""}`}
  >
    {config.rows.some((r) => r.icon !== undefined) && (
      <span className="hidden justify-center pt-2.5 @xl:flex">
        {row.icon !== undefined && <RowIcon mark={row.icon} size={13} />}
      </span>
    )}
    {config.columns.map((column, i) => {
      const cell = row.cells[i] ?? { text: "", mark: undefined, verdict: undefined }
      // By place, not by head: two columns may share a head, and columns never reorder.
      return i === 0 && column.lead ? (
        // oxlint-disable-next-line react/no-array-index-key
        <Name key={i} row={row} column={column} />
      ) : (
        // oxlint-disable-next-line react/no-array-index-key
        <Piece key={i} cell={cell} column={column} />
      )
    })}
    {details && <Detail row={row} />}
  </div>
)

/* ------------------------------------------------------------------ the chrome around the rows */

/** The column heads, on the wide layout only: a narrow card labels each line instead. */
const Head = ({ config }: { readonly config: MarkedTableConfig }): ReactNode => {
  const detail = config.rows.find((row) => row.detail !== undefined)?.detailLabel
  const heads: readonly (readonly [string, Role])[] = [
    ...config.columns.map((column) => [column.head, column.role] as const),
    ...(detail === undefined ? [] : [[detail, "plain"] as const]),
  ]
  const head = `border-l border-guide px-2.5 py-0.75 first:border-l-0 ${CAPS}`
  return (
    <div className={`hidden min-w-0 border-b border-guide bg-surface ${ROW}`}>
      {config.rows.some((row) => row.icon !== undefined) && <span className={head} />}
      {heads.map(([words, role], i) => {
        const side = sideOf(role)
        return (
          // By place: two columns may share a head, and columns never reorder.
          // oxlint-disable-next-line react/no-array-index-key
          <span key={i} className={head}>
            <span className={side === undefined ? "" : TONE[side]}>{words}</span>
          </span>
        )
      })}
    </div>
  )
}

/** A band across the table naming the rows under it, and how many there are. */
const Band = ({
  title,
  count,
  ruled,
}: {
  readonly title: string
  readonly count: number
  readonly ruled: boolean
}): ReactNode => (
  <div
    className={`flex min-w-0 items-baseline gap-2 border-b border-guide bg-surface px-2.5 py-0.75 @xl:col-span-full ${ruled ? "border-t" : ""} ${CAPS}`}
  >
    <span className="min-w-0">{title}</span>
    <span className="tabular-nums">{count}</span>
  </div>
)

/** What each icon means, then the labelled notes: a run's cost and what waits on a restart. */
const Footer = ({ config }: { readonly config: MarkedTableConfig }): ReactNode => (
  <>
    {/* A criteria tally and `how: check` share the tick, so the mark alone is no key. */}
    {config.key.map(([mark, words]) => (
      <span key={`${mark} ${words}`} className="flex min-w-0 items-center gap-1">
        <RowIcon mark={mark} size={11} />
        {words}
      </span>
    ))}
    {config.notes.map(([label, text]) => (
      <span key={label} className="min-w-0">
        <span className="font-bold">{label}</span> <T>{text}</T>
      </span>
    ))}
  </>
)

/* ------------------------------------------------------------------ the table */

const MarkedTable = ({ config }: { readonly config: MarkedTableConfig }): ReactNode => {
  const details = config.rows.some((row) => row.detail !== undefined)
  const footed = config.key.length > 0 || config.notes.length > 0
  return (
    <Figure label={undefined} footer={footed ? <Footer config={config} /> : undefined}>
      <div style={templateOf(config)} className="min-w-0 @xl:grid">
        <Head config={config} />
        {config.rows.map((row, at) => {
          const banded = row.section !== undefined && row.section !== config.rows[at - 1]?.section
          const count = config.rows.slice(at).findIndex((r) => r.section !== row.section)
          return (
            // A table's rows never reorder, so their place is their identity.
            // oxlint-disable-next-line react/no-array-index-key
            <Fragment key={at}>
              {banded && (
                <Band
                  title={row.section}
                  count={count === -1 ? config.rows.length - at : count}
                  ruled={at > 0}
                />
              )}
              <Entry config={config} row={row} ruled={at > 0 && !banded} details={details} />
            </Fragment>
          )
        })}
      </div>
    </Figure>
  )
}

export default MarkedTable
