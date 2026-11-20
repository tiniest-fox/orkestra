/**
 * The band at the foot of the phone's list: a pill holding the two doors, New Chat and New
 * Trak, under the thumb, with the project checkout's four tabs either side of it.
 *
 * On a phone the list's chrome moves to the foot — the top bar keeps the mark and the
 * word, and the action lives where a thumb already is. The shape is a 56px
 * band, and one pill 102×56, centred and raised 16px above it, in a 110px slot. Each half
 * of the band takes what is left; `TraksListPage` renders this only below the breakpoint
 * and owes the scroller the band and the overhang back, or the last row sits under them.
 *
 * **Split down the middle, and the seam is on the centre line.** `phone-new-chat/v1`
 * chose the pill over a second raised button, a chooser, a chat field in the band and a
 * glyph in the top bar: both doors are one object, so the accent stays single. Each door
 * is about 50×56, clear of the 44px floor on both axes; the seam is decoration and takes no
 * target. The pill was 145px until the band had to hold four tabs, and narrowing it was
 * chosen over folding the two doors into one.
 *
 * **The pill is the accent's one appearance on the list.** A row's right-hand side is
 * a chevron, never a button, precisely so that this stays the only filled thing on
 * screen — put an accent fill back on a row and the dock stops reading as *the* action.
 *
 * **The band either side of the pill is the project checkout's**, which the caller hands
 * in as `left` and `right`, two tabs each: processes and Files, then every CLI's plan usage
 * and the git action. `above` is a row over the band, for a problem that rises by itself; it
 * pays the pill's overhang back in padding, or the pill would cover its last line.
 *
 * A raised pill is a shape `Button` does not draw, and it is drawn here rather than
 * widened into the system because the phone rounds chose it for this one place; a
 * second caller is what would move it to `components/`.
 */

import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { MessageSquare, Plus } from "lucide-react"

const HALF =
  "inline-flex flex-1 items-center justify-center bg-accent text-accent-ink transition-colors hover:bg-accent-hover"

/** A slot the caller filled — `false` is what a guarded expression leaves in one. */
const present = (slot: ReactNode): boolean => slot !== undefined && slot !== false

const Dock = ({
  left,
  right,
  above,
}: {
  readonly left?: ReactNode
  readonly right?: ReactNode
  readonly above?: ReactNode
}): ReactNode => (
  <nav
    aria-label="Start a trak"
    className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-safe-b"
  >
    {present(above) && <div className="border-b border-border px-4 pt-3 pb-7">{above}</div>}
    <div className="relative flex h-14 items-stretch">
      <span className="flex min-w-0 flex-1">{left}</span>
      <span aria-hidden className="w-27.5 shrink-0" />
      <span className="flex min-w-0 flex-1">{right}</span>
      <span className="absolute -top-4 left-1/2 inline-flex h-14 w-25.5 -translate-x-1/2 overflow-hidden rounded-pill shadow-menu">
        <Link to="/traks/chat" aria-label="New Chat" className={HALF}>
          <MessageSquare size={20} aria-hidden />
        </Link>
        {/* Inset top and bottom rather than full height, so it reads as a seam in one
            object and not as the edge between two. */}
        <span aria-hidden className="my-3 w-px shrink-0 bg-accent-ink/45" />
        <Link to="/traks/new" aria-label="New Trak" className={HALF}>
          <Plus size={20} aria-hidden />
        </Link>
      </span>
    </div>
  </nav>
)

export default Dock
