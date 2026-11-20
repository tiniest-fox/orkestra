/**
 * One thing, shown whole over the window on the wash.
 *
 * **The first surface in this client that covers the screen**, which is why it spends
 * `--color-scrim` — authored with the rest of the elevation tokens and until now unused.
 * `components/README` states the rule it is the other half of: a menu is nearer than a
 * modal, and a modal sits behind a wash. The `Drawer` refuses one on purpose, because the
 * list beside it stays workable; this one takes it, because a picture opened over
 * everything *is* saying finish with this first.
 *
 * **A slot, not an image viewer.** It holds a picture and a rendered diagram from the
 * first commit, and knows what neither is — a `src` prop would have been rewritten the
 * moment the second shape arrived. What it owns is the wash, the centring and the ways
 * out.
 *
 * **Whole and still.** No zoom, no pan and nothing to scroll: the caller sizes its own
 * child against the box, and a picture is capped at its own pixels. A view that could be
 * moved around needs a gesture vocabulary, a reset and a way to say where you are.
 *
 * **`fixed inset-0` at `z-40`, in the tree of whatever opened it — no portal.** Over the
 * `Drawer`'s `z-30`, the bar's `z-20` and a row's `z-10`. `createPortal` would reach into
 * another component's DOM and leave the presentational kind; the price of not using it is
 * that `fixed` must resolve against the viewport, so **nothing in the chain above a caller
 * may carry `transform`, `filter`, `backdrop-filter`, `will-change` or `contain`** — any
 * one of those makes that ancestor the containing block and this draws inside the drawer
 * instead of over the window.
 *
 * **It takes focus onto its own close control as it opens** — a ref and a
 * `useLayoutEffect`, `Confirmation`'s exception and for the same reason. Escape is a plain
 * handler on this component's own node rather than a listener on the document, so it only
 * reaches here while focus is inside; before paint, because a frame with focus still on the
 * press behind the wash is a frame where Escape goes to the page.
 *
 * **`tabIndex={-1}` on that node is what keeps focus inside when a person presses the
 * picture.** Chromium sends a pointer press to the nearest focusable ancestor of what was
 * pressed, and with nothing focusable above the picture that is `<body>` — so Escape was
 * dispatched outside this subtree and the view stayed open, after the most ordinary gesture
 * there is on something you just opened to look at. `-1` keeps it out of the tab order, so
 * it is the landing place and never a stop.
 *
 * **The price, stated rather than hidden: there is no focus trap.** The close control is
 * the only thing in here Tab reaches, so Tab leaves for the page behind and takes Escape
 * with it. Holding focus in would mean a document listener, which is a hook's business —
 * and the way out is still on screen and still a press.
 *
 * **Focus going back to whatever opened it is the caller's**, in its own `onClose`: the
 * node that was pressed belongs to the caller, and an effect in here that reached for it
 * would be touching another component's DOM.
 */

import type { KeyboardEvent, MouseEvent, ReactNode } from "react"
import { useLayoutEffect, useRef } from "react"
import { X } from "lucide-react"
import Button from "./Button"

const Lightbox = ({
  label,
  onClose,
  children,
}: {
  /** What is open, for anything that reads the dialog rather than looking at it. */
  readonly label: string
  /** Escape, a press on the wash, or the close control. */
  readonly onClose: () => void
  /** The one thing being shown. It sizes itself against the box, and is phrasing content. */
  readonly children: ReactNode
}): ReactNode => {
  const closePress = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    closePress.current?.focus()
  }, [])

  return (
    // A `span`, and both of these are, for the reason `OverflowMenu`'s panel is one: the
    // picture that opens this is an image on its own line, which react-markdown puts inside
    // a `<p>` — and a `div` in a `p` is markup no parser accepts and React reports as an
    // error. The layout comes from the classes either way. A caller's child must be phrasing
    // content too.
    <span
      role="dialog"
      aria-label={label}
      // Where a pointer press inside the view lands, so the handler below stays under
      // focus — the paragraph above says why, and why `-1` rather than `0`.
      tabIndex={-1}
      // No `min-w-0` on the child, which a flex container usually needs: a flex item's
      // automatic minimum size is its content's, but for a replaced element that floor is
      // clamped by `max-width` — so a 1600px shot in a 1280px window fits on `max-w-full`
      // alone. Measured with a wide picture and a 1942px diagram, both whole.
      className="fixed inset-0 z-40 flex items-center justify-center bg-scrim p-8"
      onKeyDown={(event: KeyboardEvent<HTMLSpanElement>) => {
        if (event.key === "Escape") onClose()
      }}
      onClick={(event: MouseEvent<HTMLSpanElement>) => {
        // The wash itself, not something standing on it: a press on the picture must not
        // shut the view it opened. A caller whose child should also be pressable-to-close
        // makes that child `pointer-events-none`, which is how a diagram does it.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <span className="absolute right-2 top-2">
        <Button
          ref={closePress}
          variant="quiet"
          size="md"
          icon={X}
          aria-label="Close"
          onClick={onClose}
        />
      </span>
      {children}
    </span>
  )
}

export default Lightbox
