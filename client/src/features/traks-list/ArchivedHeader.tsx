import type { ReactNode } from "react"
import { toneInk } from "../../format/tone"
import { SECTION_TITLE, SECTION_TONE } from "./sections"
import RailCount from "./RailCount"
import { SHELL } from "./SectionHeader"

/**
 * The archive's header: the word and the count, at the page's foot, and nothing under
 * it. The traks it counts are not on the list — the engine sends the number in place
 * of their rows and never opens their logs for a list — so there is nothing to fold,
 * and this is not a lid.
 *
 * **The caret's slot is drawn without the caret**, for `ForgeHold`'s reason: that 11px
 * is what puts every section label on one vertical line, and a word hanging left of
 * that rail would be the only one on the page. A `<div>` rather than a button, and no
 * `aria-expanded`, because a control that did nothing on press would be a lie about
 * what is behind it.
 *
 * The count is of groups, as every other header's is: an archived child is counted
 * under nothing, the way a live child is a band column and not a row.
 */
const ArchivedHeader = ({
  count,
  rail,
}: {
  readonly count: number
  /** Beside a wide drawer — `SectionHeader`'s rail form. */
  readonly rail: boolean
}): ReactNode => (
  <section>
    <div className={SHELL} title={rail ? SECTION_TITLE.archived : undefined}>
      {rail ? (
        <RailCount title={SECTION_TITLE.archived} tone={SECTION_TONE.archived} count={count} />
      ) : (
        <>
          <span aria-hidden className="w-[11px] self-center" />
          <span
            className={`font-mono text-2xs uppercase tracking-wider ${toneInk[SECTION_TONE.archived]}`}
          >
            {SECTION_TITLE.archived}
          </span>
          <span className="font-mono text-2xs tabular-nums text-fg-subtle">{count}</span>
        </>
      )}
    </div>
  </section>
)

export default ArchivedHeader
