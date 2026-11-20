/**
 * The one header every drawer screen draws: a title row, and under it an actions row only
 * where the screen has actions — on the trak, goal and Files screens and the three New
 * pages.
 *
 * **The title row is fixed slots.** The way out, the title over one mono metadata row, then
 * at most one `action` and at most one `menu` — the ghost `⋯`. The actions row holds any
 * number, hung from the right edge. **Every action is one 30px bordered press**, `Button`
 * quiet at `md` or a control already that size, and 44px on a phone through the touch
 * floor each one carries; this file places them and sizes none of them.
 *
 * **On a wide header the actions row folds up into the title row**, between the title and
 * the `action`, `⋯` and way out, in the same order — a drawer on a wide screen has the room,
 * and a second row there spends height on nothing. It is a container query on the header's
 * own width, `@6xl`, never the window's: the same trak is the whole drawer or the 440px
 * column beside the side panel, and only the header knows which. An 820px drawer stays two
 * rows. One grid either way, so nothing is drawn twice and focus order is
 * the same at every width: title, actions, then the title row's presses.
 *
 * **Being a container makes the header a containing block**, as layout containment does,
 * so nothing `fixed` may be drawn inside it — it would be placed against the header rather
 * than the window. A sheet a press here opens goes beside the header, not in it.
 *
 * **No status chip, and no state words, anywhere in it.** What a thing is doing is the
 * pane's to say, in more detail than a phrase, and a chip here repeats it a hand's width
 * above. The metadata row names what the thing *is* — an id, the goal it belongs to, the
 * checkout being browsed — and nothing about where it stands.
 *
 * **The way out is Back on the left on a phone and Close on the right at desk.** The phone
 * screen is a pushed full page, so it goes back, where the edge swipe and the OS back already
 * point; the desk drawer sits over the list, so it shuts. A `Link` to `/` by default, so it
 * keeps the back stack and middle-click a route change is owed; `onClose` is for a drawer
 * that closes by state rather than by route — Files.
 *
 * **The title is the only elastic thing in the row, and the control group does not shrink**:
 * `flex-1` on the title and `shrink-0` on the group, so a long title truncates rather than
 * dragging the presses past the group's edge.
 *
 * **`z-20`, because the panels in it hang below its edge** — the run-mode picker's and the
 * ending's reach down over a card's pinned `z-10` header. The rank goes on the band and
 * never on a panel: `README.md`'s layering ladder carries the rule.
 */

import type { ReactNode } from "react"
import { Children, Fragment, isValidElement } from "react"
import { ChevronLeft, X } from "lucide-react"
import Button from "./Button"

/**
 * A part's key: `Children.toArray` has already keyed every element by its place, and a
 * string is its own — two parts of one row never say the same words.
 */
const keyOf = (part: ReturnType<typeof Children.toArray>[number]): string =>
  isValidElement(part) ? String(part.key) : typeof part === "string" ? part : ""

const ScreenHeader = ({
  title,
  meta,
  phone,
  onClose,
  closeLabel = "Close",
  action,
  menu,
  actions,
}: {
  /** The heading's content — a string, or a skeleton while it loads. */
  readonly title: ReactNode
  /**
   * The metadata row's parts, drawn in mono with a middot between each. A string keeps its
   * width; a part that should give way first — a branch, a goal's title — brings its own
   * truncation.
   */
  readonly meta: readonly ReactNode[]
  /** Below the breakpoint, where the way out is Back on the left. */
  readonly phone: boolean
  /** Close by state rather than by a route to `/`. Desk only: a phone always goes back. */
  readonly onClose?: () => void
  readonly closeLabel?: string
  /** The title row's one action, left of its menu. */
  readonly action?: ReactNode
  /** The title row's one ghost `⋯`. */
  readonly menu?: ReactNode
  /** The actions row, right-aligned; `undefined` draws no row at all. */
  readonly actions?: ReactNode
}): ReactNode => {
  const close = phone ? undefined : onClose === undefined ? (
    <Button to="/" aria-label={closeLabel} variant="ghost" size="md" icon={X} />
  ) : (
    <Button aria-label={closeLabel} variant="ghost" size="md" icon={X} onClick={onClose} />
  )
  return (
    <header className="@container relative z-20 shrink-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 px-4 pt-3 @6xl:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div className="col-start-1 row-start-1 flex min-w-0 items-start gap-2 pb-2">
          {phone && (
            <Button to="/" aria-label="Back" variant="ghost" size="md" icon={ChevronLeft} />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
            <h1 className="truncate text-base font-medium text-fg">{title}</h1>
            <p className="flex min-w-0 items-center gap-x-1.5 font-mono text-2xs text-fg-subtle">
              {Children.toArray(meta).map((part, i) => (
                <Fragment key={keyOf(part)}>
                  {i > 0 && (
                    <span aria-hidden className="shrink-0">
                      ·
                    </span>
                  )}
                  {typeof part === "string" ? <span className="shrink-0">{part}</span> : part}
                </Fragment>
              ))}
            </p>
          </div>
        </div>
        {actions !== undefined && (
          <div className="col-span-full row-start-2 flex min-w-0 items-center justify-end gap-2 pb-1.5 @6xl:col-span-1 @6xl:col-start-2 @6xl:row-start-1 @6xl:pb-2">
            {actions}
          </div>
        )}
        <div className="col-start-2 row-start-1 flex shrink-0 items-center gap-1.5 pb-2 @6xl:col-start-3">
          {action}
          {menu}
          {close}
        </div>
      </div>
    </header>
  )
}

export default ScreenHeader
