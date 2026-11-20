import type { CSSProperties, ReactNode } from "react"

/**
 * The shape of content that is not there — bars in the outline of whatever would fill
 * the region.
 *
 * Five shapes, because the app has five things that can be missing: a list of `rows`, the
 * stacked `blocks` of an agent's turns, the `decisions` on the trak tab, and — inside a
 * finished card whose head is drawn from the traks list's coarse answer — the forge's
 * `checks` and the `threads` under its reviews. A sixth belongs here rather than at a call
 * site, so the drawing stays in one file and a region cannot invent its own.
 *
 * **It draws the region's own proportions, which is the whole point.** A centred card
 * in an empty list throws away the shape the list will have; this keeps it, so the page
 * does not change layout between "asking" and "there is nothing" — the two states a
 * 1.5s poll moves between most often.
 *
 * `aria-hidden`, always: these are the absence of content, and a screen reader that
 * announced four empty rows would be reporting data that does not exist. Whatever
 * renders this owes the reader words — `EmptyState` is what supplies them.
 *
 * **`fade` masks the group toward its bottom edge** so the ghosts dissolve rather than
 * stopping on a line, which is what stops them reading as four real rows that failed
 * to load. Use it on the group that runs off the end of the region, never on one with
 * text over it: a masked group behind a message reads as the shape having *stopped*.
 */

export type Shape = "rows" | "blocks" | "decisions" | "checks" | "threads"

const MASK = "linear-gradient(to bottom, #000 0%, #000 45%, transparent 100%)"
const MASKED: CSSProperties = { maskImage: MASK, WebkitMaskImage: MASK }

/**
 * The gutter each shape sits at — the list's, the drawer pane's narrower one, and none
 * at all for `decisions`, which is drawn *inside* a section that already has padding.
 */
export const shapePad: Record<Shape, string> = {
  rows: "px-gutter",
  blocks: "px-4",
  decisions: "",
  // Both are drawn inside a card section that already has its gutter, as `decisions` is.
  checks: "",
  threads: "",
}

/**
 * The mark a shape's entry leads with, for something drawing one entry *itself* — an
 * `EmptySection`'s sentence standing where the first entry would. Here rather than at
 * the call site for the same reason the drawings are: a shape is one file's business.
 */
export const shapeMark: Record<Shape, string> = {
  rows: "mt-1.5 size-1.5 rounded-pill",
  blocks: "hidden",
  decisions: "mt-0.5 size-4 rounded-control",
  checks: "size-3.5 rounded-control",
  threads: "hidden",
}

/** How the ghosts of one shape stack. The last three are sections, so they take no gutter. */
const GROUP: Record<Shape, string> = {
  rows: "flex flex-col divide-y divide-border",
  blocks: "flex flex-col gap-4 px-4 py-4",
  decisions: "flex flex-col gap-2",
  checks: "flex flex-col gap-1.5",
  threads: "flex flex-col gap-2",
}

/* Whole literal class names: Tailwind finds classes by scanning source text, so a width
 * assembled at runtime emits no CSS and the bar renders full-width. */
const WIDTHS = ["w-[58%]", "w-[42%]", "w-[66%]", "w-[36%]", "w-[52%]", "w-[47%]"]

const Bar = ({ w, h = "h-2.5" }: { readonly w: string; readonly h?: string }): ReactNode => (
  <span className={`block rounded-control bg-surface-2 ${h} ${w}`} />
)

/** A list row: a status mark, a title, a status on the right. */
const RowGhost = ({ w }: { readonly w: string }): ReactNode => (
  <span className="flex items-center gap-3 px-gutter py-3.5">
    <span className="size-1.5 shrink-0 rounded-pill bg-surface-2" />
    <Bar w={w} />
    <span className="ml-auto">
      <Bar w="w-14" h="h-2" />
    </span>
  </span>
)

/** A turn: a session line, and the activity under it. */
const BlockGhost = ({ w }: { readonly w: string }): ReactNode => (
  <span className="flex flex-col gap-2">
    <Bar w={w} />
    <Bar w="w-[80%]" h="h-2" />
    <Bar w="w-[64%]" h="h-2" />
  </span>
)

/**
 * A decision: the provenance plate, and the sentence beside it.
 *
 * The bar is the flex item itself rather than `Bar` inside a wrapper — a percentage
 * width resolves against the *containing block*, so a shrink-to-fit wrapper makes it
 * 58% of nothing and the row renders as a plate with no sentence beside it.
 */
const DecisionGhost = ({ w }: { readonly w: string }): ReactNode => (
  <span className="flex gap-2">
    <span className="mt-0.5 size-4 shrink-0 rounded-control bg-surface-2" />
    <span className={`mt-1.5 block h-2 rounded-control bg-surface-2 ${w}`} />
  </span>
)

/** A check: the box a failing one's tick sits in, and the run's name beside it. */
const CheckGhost = ({ w }: { readonly w: string }): ReactNode => (
  <span className="flex items-center gap-2">
    <span className="size-3.5 shrink-0 rounded-control bg-surface-2" />
    <Bar w={w} h="h-3" />
  </span>
)

/** A review conversation: the block it is drawn in, who opened it, and a line of it. */
const ThreadGhost = ({ w }: { readonly w: string }): ReactNode => (
  <span className="flex flex-col gap-2 rounded-surface border border-border p-2">
    <Bar w="w-40" h="h-3" />
    <Bar w={w} h="h-3" />
  </span>
)

const GHOST: Record<Shape, (props: { readonly w: string }) => ReactNode> = {
  rows: RowGhost,
  blocks: BlockGhost,
  decisions: DecisionGhost,
  checks: CheckGhost,
  threads: ThreadGhost,
}

export default function Skeleton({
  shape,
  count,
  offset = 0,
  fade = false,
  pulse = false,
}: {
  readonly shape: Shape
  readonly count: number
  /** Where in the width cycle to start, so two groups either side of a message differ. */
  readonly offset?: number
  readonly fade?: boolean
  /** The one state a pulse is honest about: something really is on its way. */
  readonly pulse?: boolean
}) {
  const widths = Array.from({ length: count }, (_, i) => WIDTHS[(offset + i) % WIDTHS.length] ?? "")
  const Ghost = GHOST[shape]

  return (
    <div
      aria-hidden
      style={fade ? MASKED : undefined}
      className={`opacity-60 ${pulse ? "animate-pulse" : ""} ${GROUP[shape]}`}
    >
      {widths.map((w, i) => (
        // The ghosts are positional and identical in kind; there is no id to key on and
        // nothing here reorders.
        // oxlint-disable-next-line react/no-array-index-key -- fixed-length placeholder
        <Ghost key={i} w={w} />
      ))}
    </div>
  )
}
