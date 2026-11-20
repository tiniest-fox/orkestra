/**
 * The list, grouped: a header and a `<ul>` per section that has anything in it.
 *
 * One `<ul>` per section rather than one for the page, because a section's rows are a
 * list and the run of them is not — and it is what keeps the dividers from running
 * across a boundary the rule above it already drew. Each carries the section's title
 * as its accessible name, which is the only thing saying *which* list a row is in to a
 * reader who cannot see the label.
 *
 * **An idle group is one line at its section's foot** (`IdleRow`), under a hairline that
 * closes the live rows, with no line between two idle ones; past a few, the rest fold into
 * a `+N more` line (`IdleRows`). The count takes idle groups in like any other. **The
 * header after such a section draws no rule** — the hairline above the idle rows already
 * closed it, and two rules a few rows apart read as a box. **A section whose groups are
 * all idle is not drawn in its place**: it is one line on the idle shelf (`IdleShelf`),
 * directly above the archive.
 *
 * **The count counts groups, not traks** — `Needs you 4` over a page holding eleven live
 * pieces, because a row is a group and the count is of what is under the header. A
 * number that disagreed with the rows beneath it would be the worse of the two.
 *
 * The lid is local state and deliberately forgotten on reload: `SECTION_SHUT` is the
 * shape the page should open in, and remembering a fold would be a stored preference
 * for something a person redoes in one click.
 *
 * **The archive is a header and a number, after every section, and it does not open.**
 * No archived trak is on the list at all — the engine sends a count in their place and
 * never a row — so there is nothing under the header to fold, and `ArchivedHeader` has
 * no caret. It is drawn only when the count is not zero, on the rule an empty section
 * is not drawn.
 *
 * **A page with nothing live on it gets a notice in place of the rows** (`NothingOpen`),
 * so a list holding only the archive does not open as a header over nothing. The
 * trigger is that no section is filed, never a lid's state: a person who shut every
 * section themselves is not looking at a blank page.
 *
 * **A section shut while empty stays shut when work arrives in it.** The header keeps
 * its title, its tone and its number, so `Needs you 3` under a closed caret is the whole
 * of the notice; a lid that reopened itself is one you could not leave down.
 *
 * **The finished work is held by the group, while GitHub is being asked.** While every
 * group whose pile the forge decides is still in the question (`withHold`), those
 * groups are not drawn: `ForgeHold` stands where *Ready to merge*'s rule will land, and
 * the rows appear once, already classified, when the answer does — instead of piling up
 * under *Finished* and scattering a `gh` call later. Groups that need a person, are
 * running, or failed draw as normal the whole time — a finished piece on a running
 * parent's band included, which stays a column on that band saying its own *Asking
 * GitHub…* words, because a band column has no pile for the forge to decide.
 */

import { useState, type ReactNode } from "react"
import type { AgentDto, TrakSummaryDto } from "../../api/types"
import ArchivedHeader from "./ArchivedHeader"
import ForgeHold from "./ForgeHold"
import { withHold } from "./hold"
import { idleOf } from "./idle"
import IdleRows from "./IdleRows"
import IdleShelf from "./IdleShelf"
import NothingOpen from "./NothingOpen"
import type { Rungs } from "./pullRung"
import SectionHeader from "./SectionHeader"
import TrakRow from "./TrakRow"
import { SECTION_GLYPH, SECTION_ORDER, SECTION_SHUT, SECTION_TITLE, SECTION_TONE } from "./sections"

const TrakSections = ({
  traks,
  archived,
  rungs,
  agents,
  phone,
  stacked,
  rail,
}: {
  /** The live traks — every row the page has. */
  readonly traks: readonly TrakSummaryDto[]
  /** How many traks are put away, none of which is in `traks`. */
  readonly archived: number
  /** What the forge says about the finished branches on this page, by trak id. It files
   *  a row as well as drawing it, which is why `asSections` takes it too — the pile and
   *  the glyph come off the one answer. */
  readonly rungs: Rungs
  /** The library, for the mark a row mid-turn wears — `TrakMark`. */
  readonly agents: readonly AgentDto[]
  /** Passed through to every row — `TrakRow` says what changes below the breakpoint. */
  readonly phone: boolean
  /** Passed through to every row — a drawer is open, so a band stacks. */
  readonly stacked: boolean
  /** A wide drawer leaves the list its first 48px, so every header draws as a count. */
  readonly rail: boolean
}): ReactNode => {
  // Keyed by section rather than by position, so the lid follows its section as an empty
  // one is dropped and the list re-flows under it.
  const [shut, setShut] = useState(SECTION_SHUT)

  // The whole list goes in — grouping must see every trak, or a band column is dropped
  // and a child is promoted to a row — and what comes back is already minus the groups
  // the hold stands in for.
  const drawn = withHold(traks, rungs)
  const { held } = drawn
  const sections = drawn.sections.filter((section) => !section.rows.every(idleOf))
  const shelf = drawn.sections.filter((section) => section.rows.every(idleOf))
  // The block's top edge is exactly where *Ready to merge*'s rule will land. Held, the
  // four piles the forge decides are all vacant, so every position they will occupy
  // resolves to this one gap — what can still be drawn below it is the piles a state
  // put there: RESOLVED, and the archive.
  const at = sections.findIndex(
    (section) => SECTION_ORDER.indexOf(section.key) >= SECTION_ORDER.indexOf("ready"),
  )
  const cut = held === 0 || at === -1 ? sections.length : at

  const draw = (from: number, to: number): ReactNode =>
    sections.slice(from, to).map(({ key, rows }) => {
      const open = !shut[key]
      // Live rows come first and idle ones at the foot — `asSections` sorts them so.
      const live = rows.filter((row) => !idleOf(row))
      const idle = rows.filter(idleOf)
      return (
        <section key={key} data-split={open && idle.length > 0 ? "" : undefined}>
          <SectionHeader
            title={SECTION_TITLE[key]}
            tone={SECTION_TONE[key]}
            glyph={SECTION_GLYPH[key]}
            count={rows.length}
            open={open}
            rail={rail}
            onToggle={() => setShut((prev) => ({ ...prev, [key]: !prev[key] }))}
          />
          {open && (
            // A rule above every row but an idle one under another idle one: the live rows
            // keep their dividers and the hairline under the last of them, and the idle
            // rows run together.
            <ul
              aria-label={SECTION_TITLE[key]}
              className="flex flex-col [&>*+*]:border-t [&>*+*]:border-border [&>[data-idle]+[data-idle]]:border-t-0"
            >
              {live.map((row) => (
                <TrakRow
                  key={row.trak.id}
                  trak={row.trak}
                  band={row.band}
                  rungs={rungs}
                  agents={agents}
                  phone={phone}
                  stacked={stacked}
                />
              ))}
              <IdleRows rows={idle} rungs={rungs} phone={phone} />
            </ul>
          )}
        </section>
      )
    })

  return (
    // The list's own foot. A section header carries `pt-10` above its rule and 6px below
    // its label, which is right between two sections and leaves the last one sitting on
    // the bottom edge of the window when it is shut — a heading with nothing under it,
    // which reads as the page having been cut off rather than having ended. Matching the
    // header's own `pt-10` gives the list the same air at both ends. On the list rather
    // than on the page, because the page's other three states are `EmptyState`, which is
    // a centred block carrying its own gutter and would only be pushed off centre.
    //
    // **The first header draws no rule.** The goal banner, or the door in its place, sits
    // right above it, and a hairline under the card read as a stray line — so 32px of air
    // is the boundary there instead. Any header can be first: a section's, the hold's.
    //
    // **Nor does the header after a section ending in idle rows** (`data-split`): the
    // hairline over those rows closed the section already.
    <div className="pb-10 [&>section:first-child>:first-child]:border-t-0 [&>section:first-child>:first-child]:pt-8 [&>[data-split]+section>:first-child]:border-t-0">
      {/* Nothing is filed, so without this the page opens as the archived header over
          nothing. Not while the hold stands: the held groups are live work the forge has
          yet to file, and the block below already says so. */}
      {held === 0 && drawn.sections.length === 0 ? <NothingOpen /> : null}
      {draw(0, cut)}
      {held > 0 ? <ForgeHold count={held} rail={rail} /> : null}
      {draw(cut, sections.length)}
      {shelf.length > 0 ? (
        <IdleShelf sections={shelf} rungs={rungs} phone={phone} rail={rail} />
      ) : null}
      {archived > 0 ? <ArchivedHeader count={archived} rail={rail} /> : null}
    </div>
  )
}

export default TrakSections
