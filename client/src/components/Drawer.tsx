import type { KeyboardEvent, ReactNode } from "react"

/**
 * A region over the list, with an edge and a shadow.
 *
 * **No scrim, and that is the decision.** The list stays visible and clickable beside
 * it, so triaging one trak against the next never costs a close. A drawer that dimmed
 * what it covered would be saying *finish with this first*, which is the opposite of
 * what the screen is for.
 *
 * **It covers the app bar.** It began below it, because the bar is what tells you which
 * app you are in — and what is inside is a transcript, where the bar's 44px is two more
 * lines of a running turn. Identity stays on screen beside the drawer at every width it
 * does not fill, and the way out is the drawer's own Close, as reliable as anything on
 * the bar behind it.
 *
 * `z-30` is what puts it there: the bar is `z-20`, over the `z-10` a list row's own
 * action sits on.
 *
 * **Below the phone breakpoint it fills the width, so neither half of that paragraph
 * holds.** There is no bar beside it and no identity left on screen, and the way out is
 * not a Close: `trak-detail/TrakHeader` and `new-trak/NewTrakPage` draw a back control at
 * the left edge instead, because a region covering the whole screen reads as a page. Same
 * `z-30`, same close — what changes is only which control makes it, and that is the
 * page's choice rather than this file's. `pt-safe-t` below is the other consequence: at
 * that width this region owns the status-bar band as well.
 *
 * **The gesture stops at this edge, and that is this file's rule rather than any
 * control's.** No scrim is what makes it one: the list is fully visible behind, so a wheel
 * that escaped the drawer moves something the reader can watch move while the thing under
 * their cursor stands still. `overscroll-contain` is what refuses the chain and
 * `overflow-hidden` is what makes there be something to refuse it — the property only
 * applies to a scroll container, and this column had no `overflow` at all.
 *
 * **It belongs here because the alternative was asking every control where it sits.** The
 * pane inside is a scroll container of its own and catches everything drawn in it, so it
 * looks as though a field could simply hand the wheel upward — but the two chat bars are
 * the pane's *siblings*, and so is the padding around them, so a chain starting there ran
 * past the drawer to the page. A control cannot tell the two positions apart, and a prop
 * saying which one it is in would be this decision copied to every call site. Drawn as a
 * boundary instead, it also covers whatever is added to a drawer next.
 *
 * `overflow-hidden` clips rather than scrolls, and that is the intent: nothing in here
 * overflows this column — the pane is `min-h-0 flex-1` and takes the slack — so a drawer
 * that had something to scroll at this level would be a layout bug, and scrolling it
 * would hide the bug rather than show it.
 *
 * **Two features open one: a trak from the right, and the Files drawer from the left**,
 * beside the strip's Files cell. Only one is ever open — the traks list closes Files when
 * a route opens, and leaves the route when Files opens — so the two never meet. A trak is
 * a route and closes by a route change. Files is local state, so it passes `dismiss` and
 * is a `dialog` that Escape shuts — the role the desktop shell reads to hide a native page.
 * The phone never draws Files here; it has its own sheet.
 *
 * Here rather than in a feature because both of those open one. It is vocabulary —
 * `components/README`'s test is *is this in the system*, not *how many callers are
 * there* — and a second copy would be a second width, a second edge and a second answer
 * about the scrim.
 */
const Drawer = ({
  label,
  side = "right",
  dismiss,
  wide = false,
  children,
}: {
  /** What the region is called, for anything that navigates by landmark. */
  readonly label: string
  /** The edge it opens from. The border goes on the edge facing the list. */
  readonly side?: "left" | "right"
  /**
   * How a drawer that is not a route closes. Given, the region is a `dialog` and Escape
   * calls it; absent, it is an `aside` landmark and closing is the route's business.
   */
  readonly dismiss?: () => void
  /**
   * Whether it takes the window but the list's first 48px — a trak with its side panel
   * open, which needs the room for a second column. The list's marks stay visible where
   * their rows are, so the way to another trak is still one press.
   */
  readonly wide?: boolean
  readonly children: ReactNode
}): ReactNode => (
  <aside
    aria-label={label}
    role={dismiss === undefined ? undefined : "dialog"}
    onKeyDown={
      dismiss === undefined
        ? undefined
        : (event: KeyboardEvent<HTMLElement>) => {
            if (event.key === "Escape") dismiss()
          }
    }
    /* The width is `--spacing-drawer` in `styles.css` — 80% of the window, with a 780px
       floor of its own and 320px left to the list beside it. `max-w-full` is what stops
       the floor overhanging a window narrower than it.

       `sm:bottom-8` leaves the git strip the foot of the window above the phone
       breakpoint — `traks-list/git/GitStrip`, which every desktop screen draws. Below it
       this region is the whole screen and the phone has no strip.

       `pt-safe-t` because below 780px this region is the whole screen, status bar
       included: the inset keeps the header's row out from under the notch, and it is
       0 everywhere else. */
    className={`fixed top-0 bottom-0 z-30 flex sm:bottom-8 ${side === "left" ? "left-0 border-r" : "right-0 border-l"} ${wide ? "w-drawer-wide" : "w-drawer"} max-w-full flex-col overflow-hidden overscroll-contain border-border bg-surface pt-safe-t shadow-modal`}
  >
    {children}
  </aside>
)

export default Drawer
