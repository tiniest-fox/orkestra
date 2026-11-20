/**
 * What fills the pane at the step altitude, which is four things and not one.
 *
 * **In the order they are tried, because each is a case the next one would get wrong:**
 *
 * 1. **The engine's own work**, at the eight states `engineWork` names. It is not a
 *    transcript and not an ending, and it takes the pane whole — which is the region being
 *    genuinely empty rather than a notice filed under a stale document. At `Preparing` and
 *    `Spawning` the pane used to say *Nothing has run here yet* about a position no agent
 *    will ever run at; at the three commits and the two endings it left the previous step's
 *    work on screen with nothing saying a `git` was in flight.
 * 2. **The trak's ending**, the one row with no plan entry behind it — taken before the
 *    turns branch rather than falling through to *Nothing has run here yet*, which would be
 *    true and useless.
 * 3. **The empty shell**, for a position nothing has run at. It is here rather than in
 *    `TurnsView` because it draws the shape of the turns that are missing and runs
 *    full-bleed, so it cannot sit inside the padding the turns themselves take.
 * 4. **The turns.**
 *
 * Its own file for the reason `DrawerPane` is: that component was over the hundred-line
 * limit, and a four-way switch over what fills a pane is a view rather than a container.
 * `DrawerPane` keeps the scroll box and the two other altitudes, which is what it is for.
 *
 * **Every slot arrives built.** Whether each exists is the page's answer — see
 * `DrawerPane`'s props, which carry that argument in full — and this file decides only
 * where it goes.
 */

import type { ReactNode } from "react"
import { Terminal } from "lucide-react"
import EmptyState from "../../components/EmptyState"
import type { WaitingMessageDto, AgentDto } from "../../api/types"
import ContinuesNotice from "./family/map/ContinuesNotice"
import type { Spot } from "./family/family"
import type { HandOffBase } from "./cards/plan/handOff"
import { carriedIn, inFlightAt, total } from "./tokens/usage"
import type { Answering } from "./useAnswer"
import type { PlanGate } from "./cards/plan/ProposalCard"
import type { Stopping } from "./useStop"
import type { StoppingJob } from "./useStopJob"
import TurnsView from "./turns/TurnsView"
import WaitingMessages from "./turns/output/WaitingMessages"
import Reattaching from "./turns/output/Reattaching"
import PreparingLine from "./turns/output/PreparingLine"
import SeamLine from "./turns/output/SeamLine"

/**
 * Both notices as one block, above a pane that is not a transcript — the ending's, and the
 * empty one. The page's own goes first for the reason it heads a pane with turns in it: it
 * is speaking over a position it does not own.
 */
const Notices = ({
  page,
  own,
}: {
  readonly page?: ReactNode
  readonly own?: ReactNode
}): ReactNode =>
  page === undefined && own === undefined ? undefined : (
    <div className="flex min-w-0 flex-col gap-2 px-4 pt-4">
      {page}
      {own}
    </div>
  )

/** What the conversation this position joined had spent before it, as one figure. */
const carried = (spot: Spot): number | undefined => {
  const before = carriedIn(spot.trak.log, spot.row)
  return before === undefined ? undefined : total(before)
}

/**
 * The waiting messages under a pane that is not a transcript — the engine's block, the
 * ending and the empty shell. On the column's own measure, so a message sent before a
 * position has written a line sits where it will sit once the first one arrives.
 */
/** Why this row's running turn is quiet, where the engine is reaching for its sandbox again. */
const reattachingAt = (spot: Spot) => {
  const turn = spot.trak.inFlight
  return turn === undefined || !inFlightAt(turn, spot.row) ? undefined : turn.reattaching
}

/**
 * What the engine is preparing beside this row, where it is the live one — the block takes
 * the pane at `Preparing`, so this is every other state's.
 */
const preparingAt = (spot: Spot) =>
  spot.row.status === "running" && spot.trak.state._tag !== "Preparing"
    ? spot.trak.preparing
    : undefined

/**
 * The engine's action at the seam beside this row, where it is the live one — and whether
 * the trak is stopping, which the line says before any status has arrived.
 */
const seamAt = (spot: Spot) =>
  spot.row.status === "running"
    ? { seam: spot.trak.seam, stopping: spot.trak.state._tag === "Stopping" }
    : { seam: undefined, stopping: false }

/** The live lines under the empty shell, padded only where one of them draws. */
const ShellLines = ({ spot }: { readonly spot: Spot }): ReactNode => {
  const at = seamAt(spot)
  return at.seam === undefined && !at.stopping && preparingAt(spot) === undefined ? undefined : (
    <div className="flex min-w-0 flex-col gap-2 px-4 pb-4">
      <SeamLine {...at} />
      <PreparingLine preparing={preparingAt(spot)} />
    </div>
  )
}

const Waiting = ({ messages }: { readonly messages: readonly WaitingMessageDto[] }): ReactNode =>
  messages.length === 0 ? undefined : (
    <div className="flex min-w-0 flex-col px-4 pb-4">
      <WaitingMessages messages={messages} />
    </div>
  )

const StepPane = ({
  spot,
  actions,
  answering,
  planning,
  failure,
  pageFailure,
  finish,
  engine,
  agents,
  handOffBase,
  cancelling,
  stopJob,
  waiting,
  onPick,
}: {
  /** The selected position. Its turns can be empty — see `DrawerPane`. */
  readonly spot: Spot | undefined
  readonly actions?: ReactNode
  readonly answering?: Answering
  /** The plan gate's approval and what it edits, under the same row guard as `actions`. */
  readonly planning: PlanGate | undefined
  readonly failure?: ReactNode
  readonly pageFailure?: ReactNode
  readonly finish?: ReactNode
  readonly engine?: ReactNode
  /** The library, for each step's mark on a proposal this position returned. */
  readonly agents: readonly AgentDto[]
  /** The branch a hand-off at the gate would be cut from, or its goal, threaded as `agents` is. */
  readonly handOffBase: HandOffBase
  /**
   * The press that ends a check in flight, threaded as `actions` is. No row guard, unlike
   * the two slots above: its subject is the running check, and no row is a gate while a
   * check runs — `client-style`'s rule for a press whose subject is the running turn.
   */
  readonly cancelling: Stopping | undefined
  /** The per-job stop, threaded as `actions` is — `DrawerPane` carries the argument. */
  readonly stopJob?: StoppingJob
  /**
   * What a person has said that no agent has read, where this pane is the one to draw
   * it — empty everywhere else. **Drawn last in every branch below**, not only under a
   * transcript: the field is open before a position has a turn, and a message sent then
   * is otherwise on no surface until the first line arrives. `DrawerPane` decides which
   * row it belongs to.
   */
  readonly waiting: readonly WaitingMessageDto[]
  /** Where the continues notice sends a reader — the drawer's own pick, passed down. */
  readonly onPick: (key: string) => void
}): ReactNode => {
  // **The page's notice comes with the block and nothing else does.** That one belongs to
  // the parent speaking over a piece's position, so it is outside this position's account —
  // and dropping it would take the only way back a parent stopped at a spawn has. The
  // position's own stopped notice is not drawn here at all, because the page has folded it
  // into the block rather than leaving two plates saying *this is happening* and *this
  // stopped* within 200px.
  if (engine !== undefined)
    return (
      <>
        <Notices page={pageFailure} />
        {engine}
        <Waiting messages={waiting} />
      </>
    )

  // **The notices come with the ending**, above rather than below: a trak stopped at a
  // position with no chronology to end rests here, and under the pane the sentence would be
  // a correction filed beneath the ending card rather than the first thing a reader meets.
  // `Merging` and `Closing` no longer reach it — the block above is where a trak that died
  // mid-ending stands now — but a parent's own notice still does.
  if (spot?.row.kind === "end")
    return (
      <>
        <Notices page={pageFailure} own={failure} />
        {finish}
        <Waiting messages={waiting} />
      </>
    )

  if (spot === undefined || spot.row.turns.length === 0)
    return (
      <>
        {/* Above the shell, not below it: where a stopped trak still reaches this branch,
            the notice is the only thing in the pane and *Nothing has run here yet* is the
            caption under it rather than the headline over it. A trak killed during
            `Preparing` used to be that case and is the block above now. */}
        <Notices page={pageFailure} own={failure} />
        <EmptyState shape="blocks" icon={Terminal} title="Nothing has run here yet">
          The agent has not run at this position.
        </EmptyState>
        {spot !== undefined && <ShellLines spot={spot} />}
        <Waiting messages={waiting} />
      </>
    )

  return (
    <>
      <div className="flex min-w-0 flex-col gap-2 px-4 py-4">
        {/* The page's own, over a log that is not its own: the tail of that log is where a
          reader would take it for the piece's ending, and the press on it is not the
          piece's. The position's own notice goes to `TurnsView`'s tail slot instead, which
          is where the trak it is about ends. */}
        {pageFailure}
        {/* At the head of the turns, because it is about all of them: this position's
          conversation began somewhere else. Not drawn over the empty shell — with no
          turn there is no session to compare, so the notice has nothing it may claim. */}
        {spot.row.continues !== undefined && (
          <ContinuesNotice continues={spot.row.continues} carried={carried(spot)} onGo={onPick} />
        )}
        <TurnsView
          // **A position's pane is that position's, down to what is typed into it.** React
          // keeps a component's state at the same place in the tree, so without this the
          // answer form below is one instance shared by every position the drawer steps
          // through — and at a spawn, the next position is another trak's gate, with fields
          // already holding the answers meant for this one. Keyed to the position rather than
          // to the trak because the two rows either side of a move are two asks whichever
          // traks they belong to.
          key={spot.key}
          failure={failure}
          agents={agents}
          handOffBase={handOffBase}
          row={spot.row}
          log={spot.trak.log}
          // The piece's own checkout at a piece's step, for the reason `log` is the piece's: a
          // path in its transcript is under the directory *it* ran in, and the parent's root
          // would take nothing off.
          worktree={spot.trak.worktree?.path}
          // **Two facts, and a duration needs both.** Custody says something is driving this
          // trak at all — the piece's own, not the parent's, since a child's step runs under
          // the child's drive — and it is what keeps a crashed `AgentWorking` from ticking
          // forever. The row's status says this is the position that drive is standing at, and
          // it is what keeps a position a reader scrolled back to from ticking: every other
          // row has ended, whatever its last line looks like. Either one alone counts up
          // somewhere it should not.
          running={spot.trak.custody.holder !== undefined && spot.row.status === "running"}
          // **The piece's own, for the reason `log` is.** A child's step runs its own checks
          // under its own drive, and the parent's memory holds a run at a position only it
          // numbers. Whether this one is *this* position's is `TurnsView`'s to ask.
          check={spot.trak.check}
          // **The row's status, and nothing about whose trak it is.** Both slots were
          // additionally narrowed to `spot.trak.id === trak.id`, because they were built from
          // the page's own state and would have pressed at the parent's position from a
          // piece's card. The page builds them from `spot.trak` now, so the second question is
          // answered before it gets here — and this one is still needed: `state` says a trak
          // is at a gate and only the *live* row is it, which is what keeps a press off an
          // earlier run of a re-composed trak.
          // **The row's gate mark takes no such guard, and that is the difference between
          // the two.** The slots are a press on offer now, which belongs to the live row
          // alone; `row.atGate` is why the row is already behind, so it belongs to the row
          // wherever the reader is standing. `rows.ts` has settled it.
          actions={spot.row.status === "gate" ? actions : undefined}
          answering={spot.row.status === "gate" ? answering : undefined}
          planning={spot.row.status === "gate" ? planning : undefined}
          cancelling={cancelling}
          stopJob={stopJob}
        />
        {/* After everything the position has drawn, in the column's own gap. */}
        <SeamLine {...seamAt(spot)} />
        <Reattaching reattaching={reattachingAt(spot)} />
        <PreparingLine preparing={preparingAt(spot)} />
        <WaitingMessages messages={waiting} />
      </div>
    </>
  )
}

export default StepPane
