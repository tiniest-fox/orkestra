/**
 * The strip down the left of the drawer's pane: a fixed width, an edge, and whatever the
 * caller draws in it.
 *
 * **Here rather than in `trak-detail/` because three drawers have to agree about it**, and
 * only one of them knows what a trak is. `TrakDetailPage` fills it; `LoadingDrawer` and
 * `NewTrakPage` draw it empty, for exactly the reason they already draw `StepBar`
 * `disabled` — so nothing moves between the frame before a trak exists and the frame
 * after. A second copy of this width would be a second answer about where the pane starts,
 * and the jump would appear at the one moment a person is watching.
 *
 * What goes in it is the caller's: `TrakRail` reads a `Band[]`, a type this cannot see from
 * here. Same split as `Plate` and `StepMark` — the box and the edge are the system's, the
 * marks are the feature's.
 *
 * **It is its own scroll container, and it fades at the foot.** A plan long enough to
 * overflow is ordinary — a re-composed plan easily outgrows the drawer — and the mark that
 * falls off the bottom is the *ending*, the one a reader most wants. The fade is a
 * `mask-image` on the container rather than a gradient inside it, because a gradient that
 * is a child of a scroll box scrolls away with the content, which is the one thing a scroll
 * cue must not do.
 *
 * **It declares no `overscroll-behavior`, and do not add one back.** It carried
 * `overscroll-contain`, explained as what stopped a gesture running off the end of this
 * strip from reaching the list behind the drawer — which `components/Drawer` does, from
 * every position inside it, so the class was by then restating an ancestor — it was the
 * only thing refusing the chain from here until the drawer's column took the boundary, and
 * nothing since. Measured at this strip's end with 600 more wheeled in: the page holds at 0
 * either way. A second copy of a boundary can disagree with the first, and this one already
 * had, in that comment.
 *
 * `w-12` is 48px by measurement rather than taste: a 24px plate, a 3px position marker and
 * a gutter stop fitting together below about 40, and the spawn cell measures 36 wide.
 *
 * **Handed `open`, it is out of flow and slides.** The detail page withholds it on the map,
 * where every position is already drawn at full size, and a person watching the surface
 * change asked for it to leave rather than vanish. So the strip is `absolute` and moves
 * `-48px` off the left edge over `SLIDE`, and the pane beside it travels with it — the
 * map's pane at the drawer's full width, every other surface's at the width beside this
 * strip, and neither changing width while it moves, which is `TrakDetailPage`'s half. Two
 * costs, both deliberate: a slid-out strip is still in the tree,
 * so `aria-hidden` and `inert` take it out of the accessibility tree and the focus order by
 * hand and have to be kept on; and happy-dom loads no stylesheet, so a render test that asks
 * whether the rail is there is answered *yes* on every surface — it has to ask whether the
 * rail is collapsed. Without `open` it is the strip in flow the cold-open and New Trak
 * frames draw empty, which is the same 48px in the same place.
 */

import type { ReactNode } from "react"

/**
 * How fast the strip and the pane move, shared so the two cannot travel at different
 * speeds. The *property* each transitions is its own: this strip moves by `transform`, and
 * the pane beside it by `margin-left` — never `transform`, because the pane is an ancestor
 * of `Lightbox` and `ChangeSheet`, which are `fixed` and must resolve against the viewport
 * (`Lightbox.tsx` has the rule). A sibling's transform contains nothing of theirs, which is
 * why this one may. `motion-reduce` snaps both: the choice was between a slide and a cut,
 * never a fade.
 */
export const SLIDE = "duration-[220ms] ease-out motion-reduce:transition-none"

const Rail = ({
  open,
  children,
}: {
  readonly open?: boolean
  readonly children?: ReactNode
}): ReactNode => (
  <div
    aria-hidden={open === false ? true : undefined}
    // `inert` rather than a `tabIndex` sweep: one attribute takes the whole subtree out
    // of focus, out of the accessibility tree and out of hit-testing.
    inert={open === false}
    className={`flex w-12 shrink-0 flex-col items-center overflow-y-auto border-r border-border bg-surface py-2 ${
      open === undefined ? "" : `absolute inset-y-0 left-0 z-10 transition-transform ${SLIDE}`
    }`}
    style={{
      maskImage: "linear-gradient(to bottom, #000 calc(100% - 28px), transparent)",
      transform: open === false ? "translateX(-48px)" : undefined,
    }}
  >
    {children}
  </div>
)

export default Rail
