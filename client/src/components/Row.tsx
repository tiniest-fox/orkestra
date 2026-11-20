import type { ReactNode } from "react"

/**
 * The shell of a list row: a leading mark, a stack of lines, a trailing slot — and, for
 * a row that has something running underneath it, a full-width slot beneath.
 *
 * It owns the row's *shape and state* — padding, rhythm, and the hover tint — and
 * nothing about what is in it. What goes in the four slots is the feature's business; a
 * row that knew what a trak was could not be used by a second list.
 *
 * **Hover is `hover-row`, not `surface-2`.** They look similar and mean opposite things:
 * `surface-2` is the *recessed* mechanism, and a row under the cursor has not changed
 * level — it is the same surface, momentarily marked. `hover-row` is an alpha, so it
 * composites over whatever the row is sitting on rather than replacing it.
 *
 * Renders an `<li>`, so it belongs inside a `<ul>`/`<ol>`. That is the markup a list
 * wants, and the tests assert on roles rather than on classes.
 *
 * **`group` is part of the contract.** A trailing affordance that appears on hover uses
 * `group-hover:` against the row, which is why the class is here and not optional.
 *
 * **`relative` and `group` are on the row, never on the `<li>`.** A caller's full-row
 * click overlay is an `::after` at `inset-0`, which resolves against the nearest
 * positioned ancestor — so on the `<li>` it would spread over `below` as well and eat
 * every click in it, and the hover tint would light the row up whenever the cursor was
 * anywhere beneath it.
 */
export default function Row({
  leading,
  trailing,
  below,
  children,
}: {
  /** A status mark, an icon, a dot. Kept out of the text stack so the lines align. */
  leading?: ReactNode
  /** Actions, or whatever the row says about itself on the right. Sits above any
   *  full-row click overlay on `z-10`, so it takes its own clicks. */
  trailing?: ReactNode
  /** Full width, under the row and inside the same `<li>` — a band of work the row is
   *  waiting on. Outside the row's own hover and click target. */
  below?: ReactNode
  children: ReactNode
}) {
  return (
    <li>
      <div className="group relative flex items-start gap-4 px-gutter py-2.5 transition-colors hover:bg-hover-row">
        {leading}
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        {trailing === undefined ? null : (
          <div className="relative z-10 flex min-h-6 shrink-0 items-center gap-2 pl-3">
            {trailing}
          </div>
        )}
      </div>
      {below}
    </li>
  )
}
