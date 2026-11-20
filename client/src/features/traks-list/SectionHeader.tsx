/**
 * A section boundary: a hairline rule, a mono word in the page gutter, and a count.
 *
 * **Punctuation, not a container** — no pinned header, tinted ground or card: six of those
 * on one page is six more surfaces on a screen that already has rows to read. What is left
 * is the rule and the word, at `px-gutter` so the label's left edge lines up with the row
 * chip below it rather than the title.
 *
 * The lid is the one thing that is a container, and **every section has one** — so the
 * header is always a button and the caret is always drawn, six of them on one vertical
 * line. Which sections start shut is `SECTION_SHUT`'s to say, not this component's.
 * Shut, a header still shows its title and its count, so a lid is never a lie about an
 * empty box.
 *
 * **Beside a wide drawer the header is a count and nothing else** — the drawer leaves the
 * list its first 48px, where the title would be cut to a caret and half a glyph. The count
 * takes the tone and sits over the marks' column so each section's number heads the marks
 * under it. Only the contents change, never `SHELL`: the header keeps its height, so no
 * mark below it moves when the drawer opens or shuts. The title stays as the button's name
 * and its hover text.
 */

import type { ReactNode } from "react"
import { toneInk, type Tone } from "../../format/tone"
import type { IconName } from "./stateIcon"
import RailCount from "./RailCount"
import TrakIcon from "./TrakIcon"

/** Exported for `ForgeHold`, whose header is drawn at this shell's own measurements —
 *  the one header on the page that is not a lid. */
export const SHELL =
  "flex w-full items-baseline gap-2 border-t border-border px-gutter pt-10 pb-1.5 text-left"

const SectionHeader = ({
  title,
  tone,
  glyph,
  count,
  open,
  onToggle,
  rail,
}: {
  readonly title: string
  readonly tone: Tone
  /** A mark between the caret and the title, in the header's tone — `SECTION_GLYPH`. */
  readonly glyph: IconName | undefined
  readonly count: number
  readonly open: boolean
  readonly onToggle: () => void
  /** A wide drawer leaves the list its first 48px — the index rail's form. */
  readonly rail: boolean
}): ReactNode => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={open}
    title={rail ? title : undefined}
    className={`${SHELL} transition-colors hover:bg-hover-row`}
  >
    {rail ? (
      <RailCount title={title} tone={tone} count={count} />
    ) : (
      <>
        <span
          aria-hidden
          className={`self-center text-fg-subtle transition-transform ${open ? "rotate-90" : ""}`}
        >
          <TrakIcon name="chevronRight" size={11} />
        </span>
        {glyph !== undefined && (
          <span className={`self-center ${toneInk[tone]}`}>
            <TrakIcon name={glyph} size={11} />
          </span>
        )}
        <span className={`font-mono text-2xs uppercase tracking-wider ${toneInk[tone]}`}>
          {title}
        </span>
        <span className="font-mono text-2xs tabular-nums text-fg-subtle">{count}</span>
      </>
    )}
  </button>
)

export default SectionHeader
