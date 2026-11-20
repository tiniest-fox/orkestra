/**
 * What the drawer is showing at whichever altitude it is at.
 *
 * Four surfaces and nothing else: the agent's turns at this position, the map of the
 * plan, the trak, and what the work did to the files. Split out of `TrakDetailPage`
 * because the page was over the hundred-line limit, which is the rule doing its job — a
 * page composes, and a switch over what fills a pane is a view.
 *
 * **The first of those three is four things**, and which one is `StepPane`'s — the same
 * split again, one altitude down: this file is the box and the scrolling, that one is what
 * goes in it.
 *
 * On `canvas` rather than a shade of its own. The pane is inside and subordinate to the
 * drawer that frames it, and it ends up on the same ground as the list behind — which
 * says they are the same kind of surface rather than two that happen to be nearly the
 * same colour.
 *
 * **It is the scroll container, so following the bottom is its job and nobody else's.**
 * It had no scroll behaviour at all for one commit, and against a real trak that is the
 * whole surface failing: a position with forty rows opens at the top, a message sent from
 * the bar below lands off-screen, and every line the agent writes after it lands
 * off-screen too — so a working stream and a growing transcript read as *nothing
 * happened*. That was reported as two bugs and was one.
 *
 * A `useLayoutEffect` in a `presentational` file, which `client-style`'s table otherwise
 * reads as banned. The same exception `components/Field` takes and for the same reason:
 * measuring and setting a box is not a side effect on anything outside this component,
 * and there is nowhere else it can be done — a hook cannot reach the node and the page
 * does not own it.
 */

import type { ReactNode, UIEvent } from "react"
import { useLayoutEffect, useRef } from "react"
import type { AgentDto, TrakDetailDto } from "../../api/types"
import { type Band, type Spot, walk } from "./family/family"
import type { Answering } from "./useAnswer"
import type { PlanGate } from "./cards/plan/ProposalCard"
import type { Stopping } from "./useStop"
import type { StoppingJob } from "./useStopJob"
import type { Level } from "../../components/StepBar"
import { atBottom } from "../../format/scroll"
import StepPane from "./StepPane"
import TrakDetailsView from "./TrakDetailsView"
import TrakMap from "./family/map/TrakMap"
import type { TrakUsage } from "./tokens/usage"

/** A stable empty list, for every row that draws no waiting message. */
const NONE_WAITING: TrakDetailDto["messages"] = []

/** Whether the trak is at this row — running here, parked here, or stopped here. */
const standsAt = (spot: Spot): boolean =>
  spot.row.status === "running" || spot.row.status === "gate" || spot.row.status === "failed"

/**
 * The waiting messages the row on screen draws: its trak's, where that trak stands at
 * this row — and where it stands at none of its rows, at whichever one is on screen.
 *
 * A waiting message is about the turn to come, so a position the trak has left or has
 * not reached draws none. **But a trak is not always at a row**: one still preparing has
 * no plan to stand in, and one between its last step and its ending is on bookkeeping no
 * row is marked for. The field is open through all of that, and a message sent there
 * has to be on screen somewhere — so with no standing row, the row being read has it.
 */
const waitingAt = (
  here: TrakDetailDto,
  spot: Spot | undefined,
  bands: readonly Band[],
): TrakDetailDto["messages"] => {
  if (spot === undefined || standsAt(spot)) return here.messages
  const own = walk(bands).filter((s) => s.trak.id === here.id)
  return own.some(standsAt) ? NONE_WAITING : here.messages
}

const DrawerPane = ({
  level,
  trak,
  bands,
  spot,
  actions,
  answering,
  planning,
  failure,
  pageFailure,
  finish,
  engine,
  changes,
  usage,
  agents,
  onPick,
  cancelling,
  stopJob,
}: {
  readonly level: Level
  /**
   * The trak this page is *of*, which the Trak surface below is about — the parent, at a
   * position belonging to one of its pieces. **Nothing on the step surface reads it**: the
   * turns, the ending and both gate slots come from `spot.trak`, so this is the details
   * pane's alone.
   */
  readonly trak: TrakDetailDto
  readonly bands: readonly Band[]
  /**
   * The selected position, which may belong to the parent or to one of a spawn's pieces.
   * Its turns can be empty — a step can have run nothing yet.
   *
   * **The turns come from `spot.trak`, never from `trak`.** A piece's step filed its work
   * in its own log and ran in its own transcript, and asking the parent about a position
   * only it numbers would draw somebody else's step.
   */
  readonly spot: Spot | undefined
  /**
   * The gate's presses, if the trak that owns the position is at one. **Whether they exist
   * is the page's answer and whether *this* row is where they go is this file's** — two
   * questions with two inputs, which is why neither is derived from the other. The page
   * reads `state`, the only thing allowed to say what is on offer; a row's `status` is what
   * says which of several runs a person is looking at, and only the live one is `gate`.
   * Stepping back onto an earlier proposal on a re-composed trak is the case that separates
   * them.
   */
  readonly actions?: ReactNode
  /**
   * The gate's form, if the trak that owns the position is at one that asked something —
   * under the same split as `actions` and behind the same guard, which prevents the same
   * mistake: a form on an earlier run of a re-composed trak.
   *
   * **Its absence is a fact about the ask again, and it was not for two commits.** The form
   * used to be withheld on a piece's row as well — a second guard, correct while the press
   * would have landed at the parent's position — and the card read that absence as *nobody
   * owes an answer*, heading a live question `Never answered`. `QuestionsCard` grew a fourth
   * state for it and has lost it again: the guard is gone, so the two facts coincide.
   */
  readonly answering?: Answering
  /**
   * The plan gate's approval and what it edits, where the trak that owns the position is
   * at one with a proposal on it — `actions`' split, and handed down whole for
   * `answering`'s reason: only the card drawing the plan holds what the press sends.
   */
  readonly planning: PlanGate | undefined
  /**
   * Why the trak that owns this position stopped, and the press out of it — built by the
   * page, which holds the state, the custody and the hook that spends.
   *
   * **Whether it exists is the page's answer and where it goes is this file's**, `actions`'
   * split again: the page has already narrowed it to the one position that trak stopped at,
   * and this file places it.
   *
   * **Three placements, because a position is one of three things.** It ends the chronology
   * where there is one, since it is the newest thing that happened to the trak whose log
   * this is; above an empty pane where it is the only thing there is to say; and above the
   * ending, which is the one row with no chronology to end — a trak whose process died
   * during its own `Merging` or `Closing` rests there, and it is the only way back it has.
   */
  readonly failure?: ReactNode
  /**
   * The same notice for the trak the page is *of*, where the position on screen is not one
   * of its rows — which is what a spawn band needs.
   *
   * **It takes the pane's head, and that is the whole of the difference.** A spawn's pieces
   * take the band, so a parent that stopped there is resting at a position belonging to a
   * piece, and the tail of that piece's log is the one place this must not go: a sentence
   * closing somebody else's turns reads as their ending, and the press on it is not theirs.
   * The head is outside that chronology, which is what says it is the page speaking — and
   * it is why both notices can be on screen at once without either being ambiguous.
   */
  readonly pageFailure?: ReactNode
  /**
   * The finished position's pane, built by the page because it is four hooks deep.
   *
   * **Whether it exists is the page's answer and where it goes is this file's**, the same
   * split `actions` takes — and here the row is the whole of the second question: the
   * ending is the one row with no plan entry behind it, so it is also the one row whose
   * pane is not a transcript.
   */
  readonly finish?: ReactNode
  /**
   * What the *engine* is doing at this position, where the thing working here is the engine
   * rather than an agent — a checkout being made, a commit, a spawn, a merge, a close.
   *
   * **Whether it exists is the page's answer and where it goes is this file's**, `actions`'
   * split again — and here the placement is the whole of the second question, because the
   * answer is *everywhere*: it takes the pane whole. The turns, the empty shell and the
   * ending are all withheld while it is on screen, which is what makes the region genuinely
   * empty rather than a notice filed under whatever the last step left behind.
   *
   * **The page's own notice still heads it**, and it is the one thing that may. That notice
   * is the *parent* speaking over a position belonging to a piece, so it is outside this
   * position's account by construction — and dropping it would take the only way back a
   * parent stopped at a spawn has. `pageFailure` carries the argument.
   */
  readonly engine?: ReactNode
  /**
   * What the work did to the files, built by the page because it is a query deep.
   *
   * **A slot rather than a branch that fetches**, the same split `finish` and `engine`
   * take: whether it is worth asking git at all is the page's answer — the query is
   * `enabled` only at this altitude — and where it goes is this file's. It is the one
   * surface that scrolls itself rather than being scrolled by the pane, which is why the
   * follow-the-bottom effect below is written over `step` alone.
   */
  readonly changes: ReactNode
  /**
   * What the page's trak and its pieces spent, folded by the page because the pieces'
   * logs are a hook deep — the details pane's alone, as `trak` is. Required, `undefined`
   * not allowed: a hop that dropped it would draw the section empty and fail no check.
   */
  readonly usage: TrakUsage
  /** The library, for each step's mark on a proposal a position returned. */
  readonly agents: readonly AgentDto[]
  readonly onPick: (key: string) => void
  /**
   * The per-job stop, for a background job's card — built by the page, which holds the
   * hook and the custody it is gated on, threaded exactly as `actions` is.
   */
  /**
   * The press that ends a check in flight, built by the page from the same custody every
   * press reads and placed by `StepPane`. Required, `undefined` spelled out: a hop that
   * dropped it would draw no press and fail no check.
   */
  readonly cancelling: Stopping | undefined
  readonly stopJob?: StoppingJob
}): ReactNode => {
  const box = useRef<HTMLDivElement>(null)
  /**
   * Whether an append should carry the pane with it.
   *
   * **A ref rather than state, deliberately.** Nothing renders differently because of
   * it — it decides what one effect does — and holding it in state would re-render the
   * whole transcript on every scroll event.
   *
   * It starts true so a pane opens at the end, which is where the live turn is.
   */
  const following = useRef(true)
  /** Which surface the last effect ran for, so moving to another one opens it at its end
   *  rather than inheriting wherever the previous reader had scrolled to. */
  const showing = useRef("")

  const at = `${level}:${spot?.key ?? ""}`
  // The trak whose lines are arriving under the reader, which at a piece's step is that
  // piece rather than the parent — the parent's own files stop growing while it waits.
  const here = spot?.trak ?? trak
  useLayoutEffect(() => {
    const node = box.current
    if (node === null) return
    if (showing.current !== at) {
      showing.current = at
      following.current = true
    }
    // Only the transcript grows under a reader. The map and the trak change when the
    // trak does, and yanking either to the bottom would be the poll moving the page.
    if (level === "step" && following.current) node.scrollTop = node.scrollHeight
    // `log` as well as `transcript`: what a turn filed is a card at the end of the pane
    // and arrives on the log alone, so a pane keyed only to the transcript stops one
    // card short of the thing a person is being asked about.
    // And a message a person has just sent, which is drawn at the foot before any line
    // answers it.
  }, [at, level, here.transcript.length, here.log.length, here.messages.length])

  return (
    <div
      ref={box}
      // Scrolling up is how a reader says *stop moving this*, and scrolling back to the
      // end is how they take it back. Nothing else may set it: a button that followed
      // would be a second opinion about where a person is looking.
      onScroll={(event: UIEvent<HTMLDivElement>) => {
        following.current = atBottom(event.currentTarget)
      }}
      // `min-w-0` because the pane sits in a column beside the rail: without it a long
      // unbroken token in a transcript line sets the flex base of that column and pushes
      // the rail off, which is the one way a fixed-width sibling can be made to move.
      //
      // **Every altitude has exactly one payer of the home-indicator inset**, or a phone's
      // last row ends under the indicator — the inset is 0 everywhere else, so nothing
      // here moves on desktop. For a viewer who is not the owner — `trak.ownership`, the
      // page's trak's — the ownership band below the pane pays it at every altitude
      // (`pb-foot`, the `TrakBand` slot), and nothing above it does — `ChangeStack` drops its
      // share too. Otherwise: at `step` the chat bar below the pane pays it (`pb-foot`,
      // `TrakChatBar`); at `changes` the surface's own chrome does (`ChangeStack`'s
      // reservation and `ChangeSheet`), which is why paying here too would push its pill
      // 34px high. At `map` and `trak` nothing is drawn below the pane, so the pane pays
      // (`pb-safe-b`). `ChangeSheet` pays its own under the band too, since it covers the
      // screen. A surface added to this switch has to name its payer.
      //
      // **No `overscroll-behavior`, and do not add one back.** This carried
      // `overscroll-contain`, explained as what kept the list still when a reader ran off
      // the end of a long transcript — which `components/Drawer` does, from every position
      // inside it, and this pane is only ever inside one. Measured at a transcript's end
      // with 600 more wheeled in: the page holds at 0 either way. `Rail` carried the same
      // class on the same mistaken grounds and lost it in the same change.
      className={`min-h-0 min-w-0 flex-1 overflow-y-auto bg-canvas${
        trak.ownership === undefined && (level === "map" || level === "trak") ? " pb-safe-b" : ""
      }`}
    >
      {/* Which of the four things this position gets, and in what order they are tried, is
          `StepPane`'s — everything here is built by the page and placed there. */}
      {level === "step" && (
        <StepPane
          spot={spot}
          actions={actions}
          answering={answering}
          planning={planning}
          failure={failure}
          pageFailure={pageFailure}
          finish={finish}
          engine={engine}
          agents={agents}
          // The page's trak's, not the piece's: a hand-off is refused on a child, so the
          // only card that draws the branch is on the page's own plan. Where a hand-off
          // goes to a goal, the engine names the goal and sends no branch.
          handOffBase={
            trak.handOffGoal === undefined ? trak.handOffBase : { goal: trak.handOffGoal }
          }
          cancelling={cancelling}
          stopJob={stopJob}
          waiting={waitingAt(here, spot, bands)}
          onPick={onPick}
        />
      )}

      {/* No empty state: the composer is a row at every age of a trak, so there is
          always something to draw here. */}
      {level === "map" && (
        <div className="px-2 py-3">
          <TrakMap bands={bands} onPick={onPick} />
        </div>
      )}

      {level === "trak" && <TrakDetailsView trak={trak} plan={trak.plan} usage={usage} />}

      {/* Full height rather than flowing, because it owns two scrollers of its own — the
          index and the diff — and a surface that grew past this pane would put a third
          one around them. */}
      {level === "changes" && <div className="h-full">{changes}</div>}
    </div>
  )
}

export default DrawerPane
