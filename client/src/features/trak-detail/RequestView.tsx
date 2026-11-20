/**
 * What you asked for — clamped to three lines, and expandable.
 *
 * A panel at `base`, regular weight, with **no header over it**. It is the first thing
 * on the pane and unmistakably the request, so a label would be the app saying it
 * twice. It is also deliberately not the largest thing here: the request is what
 * everything else amends, but it is the one thing the reader already knows, because
 * they wrote it. A quotable block, not a headline demanding to be re-read.
 *
 * **The toggle is measured, not assumed.** `scrollHeight` against `clientHeight` on the
 * clamped element, re-checked when the description changes — a re-entered trak can
 * arrive with a longer one. A *More* on a description that already fits reads as
 * broken, and at a wide drawer most of them do fit.
 *
 * **It is markdown, drawn as a person's words are** — `Said`'s rendering, where a single
 * newline stays a line break. So the clamp is a height rather than a line count: the
 * content is blocks, and `line-clamp` counts lines only in one run of inline text. Three
 * lines at `Markdown`'s `leading-5` is 60px, `max-h-15`.
 *
 * Local state only, which `client-style` allows a presentational component: a
 * disclosure toggle is where the data is *shown*, not where it comes from.
 */

import type { ReactNode } from "react"
import { useLayoutEffect, useRef, useState } from "react"
import { ChevronRight } from "lucide-react"
import Markdown from "../../components/Markdown"

/**
 * The closed panel's class. A height clamp cuts wherever 60px falls, which can be through
 * the top of a list or a figure, so a request that overflows fades out over its last line
 * rather than ending on a sliver.
 */
const clamp = (clipped: boolean): string =>
  clipped
    ? "max-h-15 overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent)]"
    : "max-h-15 overflow-hidden"

const RequestView = ({ description }: { readonly description: string }): ReactNode => {
  const [open, setOpen] = useState(false)
  const [clipped, setClipped] = useState(false)
  const text = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = text.current
    // The 1px allowance is for sub-pixel line heights, which otherwise report a
    // one-pixel overflow on text that visibly fits.
    if (el !== null) setClipped(el.scrollHeight > el.clientHeight + 1)
  }, [description])

  return (
    <section className="flex flex-col gap-1.5 rounded-surface border border-border bg-surface p-3">
      <div ref={text} className={`min-w-0 text-fg ${open ? "" : clamp(clipped)}`}>
        <Markdown said>{description}</Markdown>
      </div>
      {(clipped || open) && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex w-fit items-center gap-1 font-mono text-2xs text-fg-subtle transition-colors hover:text-fg"
        >
          <ChevronRight size={11} aria-hidden className={open ? "rotate-90" : undefined} />
          {open ? "Less" : "More"}
        </button>
      )}
    </section>
  )
}

export default RequestView
