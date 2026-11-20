/**
 * Every section whose groups are all idle, gathered in one block directly above the
 * archive: an `Idle` word with no count and no caret, then one `ShelfLine` per section, in
 * the sections' own order.
 *
 * Three idle sections cost one
 * header and three lines here, where in their places they cost three headers with 40px of
 * air each. **The cost is position**: a section leaves its place the moment its last live
 * group goes idle, and comes back when one wakes.
 *
 * The header is drawn at `SHELL`'s measurements, the caret's slot held empty, for the
 * reason `ArchivedHeader` gives: every label stays on one vertical line.
 */

import type { ReactNode } from "react"
import type { Rungs } from "./pullRung"
import RailCount from "./RailCount"
import { SHELL } from "./SectionHeader"
import { SECTION_TITLE, type Section } from "./sections"
import ShelfLine from "./ShelfLine"

const IdleShelf = ({
  sections,
  rungs,
  phone,
  rail,
}: {
  readonly sections: readonly Section[]
  readonly rungs: Rungs
  readonly phone: boolean
  /** Beside a wide drawer — `SectionHeader`'s rail form. */
  readonly rail: boolean
}): ReactNode => (
  <section>
    <div className={SHELL} title={rail ? "Idle" : undefined}>
      {rail ? (
        <RailCount title="Idle" tone="neutral" count={undefined} />
      ) : (
        <>
          <span aria-hidden className="w-[11px] self-center" />
          <span className="font-mono text-2xs uppercase tracking-wider text-fg-subtle">Idle</span>
        </>
      )}
    </div>
    <ul aria-label="Idle" className="flex flex-col">
      {sections.map(({ key, rows }) => (
        <ShelfLine
          key={key}
          title={SECTION_TITLE[key]}
          rows={rows}
          rungs={rungs}
          phone={phone}
          rail={rail}
        />
      ))}
    </ul>
  </section>
)

export default IdleShelf
