import type { ReactNode } from "react"
import { ChevronDown } from "lucide-react"

/**
 * The one header a phone draws over the traks list: what is open on the left, under a
 * small ORKESTRA line, and search at the right — one header, rather than the host page's
 * project strip stacked over the app bar.
 *
 * - **48px**, plus the notch's inset, which it pays since nothing is above it.
 * - **The left side is a 28px picture beside two lines**: the eyebrow — the word only,
 *   `text-2xs`, tracked capitals, `fg-subtle` rather than accent — over the name. Where
 *   there is something to switch to, the whole left side is the press and a chevron
 *   follows the name; on an engine reached with no host there is not, and it is neither.
 * - **The name truncates**, and only the name: `waiting` and `end` keep their width.
 *
 * Two callers draw it: the app bar on an engine reached with no host, and a host's page
 * over a project's frame, where the picker and the other projects are. That second one is
 * why this is a primitive rather than the bar's own markup.
 */
const PhoneHeader = ({
  label,
  subject,
  name,
  pick,
  waiting,
  end,
}: {
  /** What a screen reader calls the header; the page's own landmark where absent. */
  readonly label?: string
  /** What stands for what is open, drawn in a 28px box: a picture, a gear or the mark. */
  readonly subject: ReactNode
  /** Nothing while it is not known, which keeps the line's height. */
  readonly name: string | undefined
  /** The press that opens the picker; absent where there is nothing to switch to. */
  readonly pick?: { readonly label: string; readonly onPick: () => void }
  /** The pictures of other projects waiting on the person, between the name and `end`. */
  readonly waiting?: ReactNode
  readonly end: ReactNode
}): ReactNode => {
  const left = (
    <>
      <span className="relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-control">
        {subject}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-2xs leading-none font-semibold tracking-wider text-fg-subtle uppercase">
          Orkestra
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1">
          <span className="min-h-[1lh] min-w-0 truncate text-base leading-tight font-semibold text-fg">
            {name}
          </span>
          {pick !== undefined && (
            <ChevronDown size={16} aria-hidden className="shrink-0 text-fg-subtle" />
          )}
        </span>
      </span>
    </>
  )
  const box = "flex min-h-11 min-w-0 flex-1 items-center gap-2.5"
  return (
    // The row inside the inset, so the notch grows the box rather than squeezing the row.
    <header
      aria-label={label}
      className="shrink-0 border-b border-border bg-surface px-gutter pt-safe-t select-none"
    >
      <div className="flex min-h-12 items-center gap-1">
        {pick === undefined ? (
          <span className={box}>{left}</span>
        ) : (
          <button
            type="button"
            aria-haspopup="dialog"
            aria-label={pick.label}
            onClick={pick.onPick}
            className={`${box} text-left focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent`}
          >
            {left}
          </button>
        )}
        {waiting}
        {end}
      </div>
    </header>
  )
}

export default PhoneHeader
