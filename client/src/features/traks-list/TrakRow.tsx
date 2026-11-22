/**
 * One trak, as three lines: the body of work, what it is doing now, and how that is
 * going — in the order a reader asks them.
 *
 *     ┌────┐  Move the commit to the end of a step
 *     │ ◉  │  Move the commit to the end of the step, after checks pass
 *     └────┘  Working…                  ⟋ Read, searched, and edited
 *
 * The top line is the plan's title, and the request only until there is one — a title
 * is a name and a request is a paragraph, and a list of paragraphs is unreadable. It is
 * rewritten by every composer turn, so a trak that gets re-cut is renamed here.
 *
 * The middle line is the composer's own instruction for the step that is running, and
 * it is a better answer to *what is happening* than a state word can be — "Working…"
 * is true of half a list at once. Ten of the twenty-one states carry no step and so no
 * instruction: everything before a plan exists, everything coming to rest and
 * everything at rest. **Those rows are two lines, and the list is deliberately not
 * padded back to a uniform height** — the short rows are the ones with less to say.
 *
 * **A trak with pieces still out is one line, and the pieces are the band beneath it**
 * (`TrakBand`). The line is the title alone: the instruction is the parent's, which the
 * pieces each restate in their own words, and nothing on the row counts them. **The band
 * is what decides it, not the state** — a parent that failed or came back to work over
 * pieces still out collapses too, and a parent whose pieces have all landed is an
 * ordinary three-line row with nothing beneath it and nothing marking it as having been
 * a spawn.
 *
 * **The square says who, but only while somebody is working.** A row mid-turn wears its
 * agent's own mark with the segment travelling the plate's edge; every other row wears the
 * state glyph it always has. `TrakMark` decides it and carries the argument.
 *
 * **The head borrows nothing from its band.** A group sits in the furthest-up section any
 * member is in (`sections.ts`), so this row can stand under *Needs you* while its own
 * state is `AwaitingChildren` — and it still draws its own label, its own action and its
 * own activity, because a state is said once, by the plate on the trak it belongs to.
 * Nothing here names the piece that pulled the group up and nothing here counts the
 * pieces: what needs you is the column wearing the amber plate, one press away through
 * its own link. The cost is a group in *Needs you* with no action beside it, which was
 * weighed against a head that spoke for its pieces and taken knowingly.
 *
 * **The trailing slot is `RowTrailing`'s**: the press or the activity line, the ring on the
 * rows spending the most, and the way in. It is its own file because a row over the
 * hundred-line limit is the rule saying the slot had become a component.
 *
 * **No custody mark**, and the cost is worth naming rather than discovering: a trak that
 * says it is working with nothing holding it — a run that died mid-turn — now draws exactly
 * like a healthy one, because the activity line it would otherwise be missing is also
 * absent on a trak whose agent has simply not written anything yet.
 *
 * **The shape of the row is `Row`'s; what fills it is this file's.** Padding, the hover
 * tint and the four slots live there — the tone chip, the three lines, the action and
 * the band are the parts that know what a trak is.
 *
 * The leading square is `components/Plate` — the same box the map's `StepMark` wears, at
 * these measurements: 24px box, 14px glyph, 4px radius.
 * `ModeBadge` sits on its corner with the run mode's mark — on this row and not on a band's
 * pieces.
 *
 * **The whole row is the click target, through one link.** The title's `::after`
 * covers the row, so hovering anywhere is hovering the link and the tint is telling
 * the truth — a row that lit up and did nothing when clicked would be worse than no
 * hover at all. One `<a>` in the markup rather than a wrapper, because the press
 * on the right has to stay clickable and an `<a>` inside an `<a>` is not markup;
 * it sits above the overlay on `z-10` instead, which `Row` gives its trailing slot.
 * The cost is that the row's text cannot be selected with a drag — the overlay takes
 * the gesture.
 */

import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { Target } from "lucide-react"
import Row from "../../components/Row"
import type { AgentDto, TrakSummaryDto } from "../../api/types"
import { withoutWorktree } from "../../format/paths"
import { latestActivity } from "../../format/transcriptRows"
import { rungMerged, type Rungs } from "./pullRung"
import ModeBadge from "./ModeBadge"
import { rowAction } from "./rowAction"
import RowTrailing from "./RowTrailing"
import StatusLine from "./StatusLine"
import TrakBand from "./TrakBand"
import TrakMark from "./TrakMark"
import CloudDisc from "../../components/CloudDisc"
import TrakStrip from "./TrakStrip"
import { rowWords } from "./waitingRow"

/** What a screen that never asks the forge looks its rows up in: no rung for any of them. */
const UNASKED_RUNGS: Rungs = new Map()

const TrakRow = ({
  trak,
  band,
  rungs,
  agents,
  phone,
  stacked,
}: {
  readonly trak: TrakSummaryDto
  readonly band: readonly TrakSummaryDto[]
  /** What the forge says about the finished branches on this page, by trak id — this
   *  row's, and its band's. `undefined` where the screen never asks the forge (the goal
   *  screen, the palette): Archive's line is neutral there, as on a rung that has not
   *  heard back (`rungMerged`), and unlike a missing rung, which is an answer. */
  readonly rungs: Rungs | undefined
  /** The library, for the mark a row mid-turn wears — `TrakMark`. */
  readonly agents: readonly AgentDto[]
  /** Below the breakpoint the trailing slot is a chevron, never a button, and the band
   *  is `TrakStrip`. A prop rather than the hook, so the row stays a view. */
  readonly phone: boolean
  /** A drawer is open over the list, so the band draws one piece per row — `TrakBand`. */
  readonly stacked: boolean
}): ReactNode => {
  const asked = rungs ?? UNASKED_RUNGS
  const rung = asked.get(trak.id)
  // The rung is the whole answer where there is one — the same value the pile and the
  // glyph are read off, so the three cannot say different things about one row — and a
  // wait beats it unless the wait is on this very pull request going in. Whichever leads,
  // the other is the aside. `waitingRow` carries why.
  const { label, tone, aside } = rowWords(trak, rung)
  // Composed above the switch rather than inside it, as custody is: `rowAction` is a
  // fact about the state, and a held trak's *Archive* is the one press this list must
  // not raise — it would drop the step the row says is waiting.
  const action = trak.waiting === undefined ? rowAction(trak.state) : undefined
  const name = trak.title ?? trak.description
  const collapsed = band.length > 0
  // What the live log would draw last, in the log's own words — `latestActivity`. The
  // checkout comes off each path first, so a background job's command reads from its verb
  // rather than from ninety characters of worktree prefix.
  const activity =
    trak.activity === undefined
      ? undefined
      : latestActivity(
          trak.activity.map((entry) => withoutWorktree(entry, trak.worktreePath)),
          trak.envelope,
        )

  return (
    <Row
      leading={
        <span className="relative shrink-0">
          <ModeBadge mode={trak.mode}>
            <TrakMark trak={trak} tone={tone} rung={rung} agents={agents} />
          </ModeBadge>
          {/* The mode's twin, on the corner opposite it: a sandboxed trak's checkout is not
              on this machine. A local trak's square has nothing here. */}
          {trak.sandboxed === true && (
            <span className="absolute -top-1.5 -right-1.5">
              <CloudDisc label="Runs in a sandbox" />
            </span>
          )}
        </span>
      }
      trailing={
        <RowTrailing
          trak={trak}
          name={name}
          phone={phone}
          action={action}
          activity={activity}
          merged={rungs === undefined ? undefined : rungMerged(rung)}
        />
      }
      below={
        collapsed &&
        (phone ? (
          <TrakStrip pieces={band} of={name} parent={trak.id} rungs={asked} agents={agents} />
        ) : (
          <TrakBand
            pieces={band}
            of={name}
            parent={trak.id}
            rungs={asked}
            agents={agents}
            stacked={stacked}
          />
        ))
      }
    >
      {/* A trak a goal opened wears the goal's target before its title, in the accent,
          wherever it is filed — the same glyph the goal's banner wears. */}
      <span className="flex min-w-0 items-center gap-1.5">
        {trak.goal !== undefined && (
          <Target
            size={12}
            role="img"
            aria-label="Opened by a goal"
            className="shrink-0 text-accent"
          />
        )}
        <Link
          to="/traks/$id"
          params={{ id: trak.id }}
          className="min-w-0 truncate text-base font-medium text-fg after:absolute after:inset-0"
        >
          {name}
        </Link>
      </span>

      {!collapsed && trak.instruction !== undefined && (
        <span className="truncate text-sm text-fg-muted">{trak.instruction}</span>
      )}

      {!collapsed && label !== undefined && <StatusLine label={label} tone={tone} aside={aside} />}
    </Row>
  )
}

export default TrakRow
