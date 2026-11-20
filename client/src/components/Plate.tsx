/**
 * A glyph on a tone-tinted square — the leading mark a list row, a plan entry, the
 * navigator's position and a spawn's 14px tile all wear.
 *
 * The three drew it by hand and identically: `size-6`, `rounded-control`, the ink and the
 * fill off the same two lookups. A copied pair of lookups is how two of them come to
 * disagree about what `waiting` looks like, which is the drift `format/tone` exists to
 * stop one level down.
 *
 * **A slot rather than an `icon` prop.** Its callers hand it three different things — a
 * `lucide` component, `TrakIcon`'s name-mapped one, an agent's own mark — and a prop that
 * took all three would be a second icon registry. The plate owns the box and the colour;
 * what goes in it is the caller's, and inherits the ink through `currentColor`.
 *
 * **Two sizes, because a spawn's column in the rail is 14px and draws the same thing.**
 * `tile` is that one: 14px to the plate's 24 and half the radius, which is what
 * `--radius-tile` exists for. Nothing else varies — a second appearance would be a second component.
 */

import type { ReactNode } from "react"
import type { Tone } from "../format/tone"
import { toneFill, toneInk, toneTrack } from "../format/tone"

/**
 * A segment travelling the plate's own edge — what says a position is running, at both
 * sizes, and the only motion left on these surfaces.
 *
 * **It is a conic gradient painted behind the plate, not a border on it.** A border can
 * be solid or dashed and nothing else; a segment travelling the perimeter of a rounded
 * rectangle has no CSS property at all. So the gradient fills the box, the plate sits on
 * top inset by the segment's width, and what shows through around the edge is the
 * segment.
 *
 * **It works only because `--color-tone-*-bg` are opaque.** They are `color-mix(…,
 * var(--color-surface))` rather than an alpha; making them translucent would let the
 * gradient through and the plate would become a spinning disc.
 *
 * **The segment runs on a track, and the track is why this layer has a fill of its own.**
 * The gradient is transparent for three quarters of its turn, so without one the ring
 * showed whatever the plate was sitting on: invisible in light, and in dark a moat of
 * near-black cut around a plate that had visibly shrunk. `toneTrack` is a step between
 * the plate's fill and the page, so the ring reads as part of the plate at rest and the
 * segment reads as travelling along it. Settled by looking, in dark.
 *
 * The square is 210% of the box and centred, so the gradient's own centre is the plate's
 * centre and its corners still cover the box as it turns. `tail` is the taper: a conic
 * gradient's angle increases clockwise and so does `animate-spin`, so the opaque stop
 * belongs at the *high* angle — that is the leading end, and a comet fades out behind its
 * head. With the stops the other way round the fade runs ahead of the travel and the eye
 * reads the segment as moving backwards.
 *
 * Exported for the one other thing that runs it: a project's tile on the desktop rail,
 * whose box is a picture rather than a tinted plate. The caller owns a `relative` box
 * with `text-tone-*` on it, and insets what it draws over this by the segment's width.
 * The tile runs it with no track: its ring sits in a gap kept round the picture at rest
 * too, so there is no plate edge for a track to be part of.
 */
const ARC = 90
const SWEEP = `conic-gradient(from 0deg, transparent 0deg, currentColor ${String(ARC)}deg, transparent ${String(ARC)}deg 360deg)`

export const Chase = ({
  radius,
  tone,
  track = true,
}: {
  readonly radius: string
  readonly tone: Tone
  /** Whether the segment runs on `toneTrack`, or on whatever is behind the box. */
  readonly track?: boolean
}): ReactNode => (
  // `overflow-hidden` is the whole mechanism: the gradient is twice the box, and what is
  // left after the plate is laid over it is the 1.5px ring around the edge.
  <span
    aria-hidden
    className={`absolute inset-0 overflow-hidden ${radius} ${track ? toneTrack[tone] : ""}`}
  >
    <span
      className="absolute left-1/2 top-1/2 animate-spin"
      style={{
        width: "210%",
        height: "210%",
        marginLeft: "-105%",
        marginTop: "-105%",
        // 2s rather than the spinner's default, which came out of four running rows in
        // one list: four segments at 1.4s read as a screen that is vibrating.
        animationDuration: "2s",
        background: SWEEP,
      }}
    />
  </span>
)

const Plate = ({
  tone,
  size = "full",
  running = false,
  children,
}: {
  readonly tone: Tone
  /** `tile` is the 14px one a spawn's column draws in the rail. */
  readonly size?: "full" | "tile"
  /** Whether the segment travels the edge. */
  readonly running?: boolean
  readonly children: ReactNode
}): ReactNode => {
  const tile = size === "tile"
  const radius = tile ? "rounded-tile" : "rounded-control"
  return (
    // `inline-flex`, not bare `relative`: the box is a `<span>` and several callers put it
    // inside another one, where `display: inline` makes `size-6` do nothing at all and the
    // plate collapses to whatever the glyph inside it happens to be.
    <span
      className={`relative inline-flex ${tile ? "size-3.5" : "size-6"} shrink-0 ${toneInk[tone]}`}
    >
      {running && <Chase radius={radius} tone={tone} />}
      {/* Inset by the segment's width only while it is running, so a plate at rest is
          the box it always was and nothing moves when a turn starts or ends. */}
      <span
        className={`absolute flex items-center justify-center ${radius} ${toneFill[tone]}`}
        style={{ inset: running ? 1.5 : 0 }}
      >
        {children}
      </span>
    </span>
  )
}

export default Plate
