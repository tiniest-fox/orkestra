/**
 * The bar: the mark, the word, and one slot at the right for whatever the app can do
 * from anywhere.
 *
 * **Drawn by the gate, over every route, in two states.** *New Chat* and *New Trak* in
 * the slot once this browser is in; the slot empty while locked and until the gate knows,
 * because what the slot holds is links to routes the guard refuses. The bar is the one
 * thing on screen naming the app at every route, so it is the thing a logged-out screen
 * keeps. It is a primitive
 * rather than the chrome's own markup so that the two states are one bar with a slot and
 * not two bars that drift.
 *
 * **The bar holds identity and little else** — the `Mark` at 20px and the word, `New
 * Chat`, and the slot. A tally, a filter strip, a footer and a `cmd+k` hint are left off
 * on purpose.
 *
 * **On a phone it is `PhoneHeader`**, naming the project under the word. **Inside a host's
 * frame it is nothing, at any width, once the host's page says it draws its own header
 * over the frame** — the page's word rather than this frame's width, which beside the rail
 * is 48px narrower than the page (`api/frame.ts`).
 */

import type { ReactNode } from "react"
import Mark from "./Mark"
import PhoneHeader from "./PhoneHeader"

/**
 * Which bar to draw other than the desk's: none, under a host page's header, or the
 * phone's, with the project's name — nothing while it is not known.
 */
export type BarLayout = "covered" | { readonly name: string | undefined }

const AppBar = ({
  action,
  layout,
}: {
  /** What sits at the right. Nothing, on a screen where nothing can be done yet. */
  readonly action?: ReactNode
  /** Absent for the desk's bar. */
  readonly layout?: BarLayout | undefined
}): ReactNode => {
  if (layout === "covered") return undefined
  if (layout !== undefined)
    return (
      <div className="sticky top-0 z-20">
        <PhoneHeader subject={<Mark size={28} />} name={layout.name} end={action} />
      </div>
    )
  return (
    /* Sticky rather than static: the list polls and grows, and a bar that scrolls
     away takes the only thing on screen naming the app with it.

     `z-20` rather than `z-10`, because a list row's own action already sits on
     `z-10` to clear the full-row click overlay above it — level with the bar, and
     later in the tree, so it won the paint and every row's button slid across the
     bar on the way up. The drawer is `z-30`, over both. */
    /* `min-h-11` with `pt-safe-t` rather than `h-11`: installed on a phone the bar owns
     the status-bar band, and the safe inset has to grow the box rather than squeeze the
     row inside it. On desktop the inset is 0 and the box is the same 44px. */
    <header className="sticky top-0 z-20 flex min-h-11 items-center justify-between border-b border-border bg-surface px-gutter pt-safe-t">
      <span className="flex items-center gap-2 select-none">
        <Mark />
        <span className="text-base font-semibold tracking-wider text-fg uppercase">Orkestra</span>
      </span>
      {action}
    </header>
  )
}

export default AppBar
