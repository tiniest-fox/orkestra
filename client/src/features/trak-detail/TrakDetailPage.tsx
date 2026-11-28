/**
 * One trak and every piece it has out, as a drawer over the list.
 *
 * **A spawn's children are navigated from here and acted on here, and there is nowhere
 * else.** The map draws each piece's own plan as a column at the spawn's position and the
 * arrows walk into them, so any step of any piece is a position this pane can show — and
 * **the drawer acts for whichever trak owns that position**, not for the trak the page is
 * of. So the acting hooks below are keyed to `spot.trak.id` and `spot.trak`'s custody, and a
 * piece is approved, answered, talked to and merged without leaving its parent. A subtrak's
 * own drawer survives for one case and `useParent` carries it: a child whose parent cannot
 * be loaded, which is the same child `tree.ts` stands as a root row.
 *
 * **The band at the top is the exception, and it is deliberate.** The header speaks for the
 * trak the page is of at every position, so its ending menu, its picker and its openers are
 * keyed to `id` and to that trak's custody. Standing on a piece, `PieceBand` carries the
 * same controls one row down for the piece — two rows reading as two traks with parallel
 * presses, so the row a press sits in says which trak it takes. Where one trak's ending is
 * on two surfaces at once, the two take one hook rather than two pending states for one
 * press. `useSpot` carries why the position is in the URL.
 *
 * **Two altitudes, one surface at a time.** The position you are at is where you live;
 * the trak — its map and its details — is one move away, and the bar is the whole
 * navigator. Replacing rather than adjoining is what lets the agent's turns have the
 * full width at every size, and it is also why nothing here carries a *you are here*
 * mark: when you are looking at the map you are on the map, not on a step.
 *

 * **A press goes on the card; typing goes in the footer.** Approving is a press in the
 * header of the card holding what is being approved — the proposal at the plan gate, the
 * filed document at a step's — which is `CardShell`'s `actions` slot. It stays there because a
 * footer of presses would be the drawer answering for whatever the pane happens to be
 * showing. `ChatBar` is the one thing that is right in a footer anyway, and it carries
 * why. Recomposing is welded to Approve on a document card **while that document is the
 * newest thing there**; once a prose reply takes the newest slot the pair moves beside the
 * bar, and skipping is still `pnpm ork`.
 *
 * **The one press inside the footer's box is the stop, and it is there because it is the
 * send.** While a turn is running there is nothing to send — the bar is shut, saying so —
 * and what a person wants from that box is to interrupt what is in front of them and then
 * type. So it takes the send's place rather than sitting beside it: one control, whose
 * meaning is whichever of the two the trak can take. **The break-out presses sit outside
 * the box, beside it** — File it and Recompose wherever nothing is filed or a turn runs,
 * and Approve and Recompose where a document gate's prose reply has taken them off their
 * card. `TrakChatBar` draws the band, `BreakOut` the cluster, and `footerFor` decides what
 * is in it.
 *
 * **Answering is on the card too, and is the one thing that is neither a press nor
 * typing.** It goes in the *body* of the questions card rather than its header, because
 * what it commits is a field per question below it — `AnswerForm` carries that argument.
 * Both gates that take it draw it there, and the chat bar is shut at one of them: the
 * composer's question gate accepts `AnswerQuestions` and nothing else, so a `Chat` there
 * would end the trak, and `chatClosed` says so in the field rather than leaving the bar
 * claiming nothing is being asked.
 *
 * **The endings are the third place, and they are a position rather than a card.** Once
 * the plan has run out the picker gains a final row with no plan entry behind it, and its
 * pane is what carries Merge, More work on it, Ask about it and Close — `FinishedView`, built here
 * because it is a hook deep and placed by `DrawerPane` at the one row whose `kind` is
 * `end`. On a trak whose branch has a pull request it also carries what the forge says
 * about it, and no Merge at all.
 *
 * **A trak that stopped is the fourth, and it is a notice rather than a press.** Whether
 * the engine wrote the ending or the process carrying a command went away, what is on
 * screen says what happened and carries the way out beside it — at the position that trak
 * stopped on, which is what lets a piece of a spawn be picked back up without leaving its
 * parent. Usually that is a row of its own chronology; where the command in flight *was*
 * the ending it is the ending's own position, which has none. The header's ending stays a
 * trak-wide press up there because it is the parent's own however deep a reader has
 * stepped; the piece band's is the piece's, and reaches only as far as its row says.
 *
 * **A position the engine rather than an agent is working at is the fifth**, and it is the
 * one that takes the pane whole. `engineWork` names the eight states and `engineAt` builds
 * it; where such a trak has also stopped, the notice above is *not* built as well — the
 * block wears an error face and carries the same press, because two plates saying *this is
 * happening* and *this stopped* at one position within 200px contradict each other.
 *
 * **The `_tag` questions it asks, it delegates.** `planAwaitsApproval`,
 * `workAwaitsApproval`, `chatClosed`, `runInterrupted`, `stopOffered` and the finished
 * position's three all live in `controls.ts`,
 * which carries why nothing else may decide whether a control exists — and why `custody`
 * is asked beside the switch rather than inside it, by the acting hook for a press and as
 * an argument for the two questions that are genuinely about the pair. Otherwise the page
 * computes nothing. `familyBands` turns the trak and its pieces into the bands every
 * surface below draws — so the page picks one position and passes it on.
 *
 * Every hook is called before the first early return, because the view states are
 * branches in the render and the rules of hooks are not.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import { Navigate, getRouteApi } from "@tanstack/react-router"
import { Unplug } from "lucide-react"
import { trakImageUrl } from "../../api/trak"
import type {
  AgentDto,
  ModelsDto,
  OpenerKindDto,
  TrakDetailDto,
  TrakStateDto,
} from "../../api/types"
import Drawer from "../../components/Drawer"
import { MarkdownLinks } from "../../components/Markdown"
import Rail, { SLIDE } from "../../components/Rail"
import EmptyState from "../../components/EmptyState"
import { failureWords, type NoticeWords, stoppedWords } from "../../format/failure"
import { runInterrupted } from "../../format/interrupted"
import {
  archiveOffered,
  archiveUnfinishedOffered,
  cancelChecksOffered,
  chatClosed,
  sendBlocked,
  composerAwaitsAnswers,
  fileOffered,
  autoMergeSettable,
  holdOffered,
  modeSettable,
  planAwaitsApproval,
  recomposeOffered,
  restartOffered,
  skipChecksOffered,
  stopOffered,
  stopTaken,
  openersOffered,
  workAwaitsAnswers,
  workAwaitsApproval,
  workAwaitsPermission,
} from "./controls"
import { lastFiledAt } from "./filed"
import { engineWork } from "./engineWork"
import { type Band, familyBands, restingFor, type Spot } from "./family/family"
import { type OutstandingJob, outstandingNow } from "./turns/jobs/outstanding"
import { type StoppingJob, useStopJob } from "./useStopJob"
import OfTrak from "./turns/OfTrak"
import { useViews } from "./turns/views/useViews"
import { branchMoved } from "./finished/finished"
import type { UnfinishedArchive } from "./useArchiveUnfinished"
import { type BandEndings, useBandEndings } from "./useBandEndings"
import { useChangeSurfaces } from "./changes/useChangeSurfaces"
import type { StepSlice } from "./changes/useStepDiff"
import ChangeExcerpt from "./changes/ChangeExcerpt"
import type { StepDiff } from "../../components/ChangeMap"
import { type Answering, useAnswer } from "./useAnswer"
import { type Permitting, usePermit } from "./usePermit"
import { type Approval, useApprove } from "./useApprove"
import type { PlanGate } from "./cards/plan/ProposalCard"
import { proposalAtGate } from "./cards/plan/planEdits"
import { type Archiving, useArchive } from "./useArchive"
import { useFamily } from "./family/useFamily"
import { useAgents } from "../../hooks/useAgents"
import { useClearNotifications } from "../../hooks/useClearNotifications"
import { useModels } from "../../hooks/useModels"
import { type Finishing, useFinishing } from "./finished/useFinishing"
import { useParent } from "./family/useParent"
import type { Recomposing } from "./chat-bar/useRecompose"
import { type BreakOutPresses, useBreakOut } from "./chat-bar/useBreakOut"
import { type Resumption, useResume } from "./failure/useResume"
import { type EffectSkipping, useSkipEffects } from "./failure/useSkipEffects"
import { useSendChat } from "./chat-bar/useSendChat"
import { type PickerSettings, usePickerSettings } from "./run-mode/usePickerSettings"
import { type OpenerBand, type OpenerHandles, useOpeners } from "./openers/useOpeners"
import { type Stopping, stopPressTaken } from "./useStop"
import { useSpot } from "./family/useSpot"
import { useTrakDetail } from "./useTrakDetail"
import { type StepUsage, stepUsage, type TrakUsage, trakUsage } from "./tokens/usage"
import ChangesView from "./changes/ChangesView"
import OpenerControl from "../../components/OpenerControl"
import HandoffCommands from "./openers/HandoffCommands"
import { NO_LOCAL_PATH } from "./openers/handoff"
import DrawerPane from "./DrawerPane"
import FinishedView from "./finished/FinishedView"
import GatePresses from "./cards/gate/GatePresses"
import PermitPresses from "./cards/gate/PermitPresses"
import LoadingDrawer from "./LoadingDrawer"
import PieceBand from "./PieceBand"
import DirectiveBlock from "./family/map/DirectiveBlock"
import PositionStrip from "./family/map/PositionStrip"
import RecomposeSheet from "./chat-bar/RecomposeSheet"
import RunModePicker from "./run-mode/RunModePicker"
import GoalLink from "./GoalLink"
import { type GoalLinkTo, useGoalLink } from "./useGoalLink"
import StepBar, { type Level } from "../../components/StepBar"
import StepMark from "./family/map/StepMark"
import PlacePill from "../../components/PlacePill"
import { placeOfTurn } from "./turns/turns"
import SurfaceBar from "./SurfaceBar"
import TrakRail from "./family/map/TrakRail"
import { usePhone } from "../../hooks/usePhone"
import { useTyping } from "./useTyping"
import TrakChatBar from "./chat-bar/TrakChatBar"
import TrakControls from "./TrakControls"
import ReportPane from "./report/ReportPane"
import { type ReportPaneState, useReportPane } from "./report/useReport"
import BandQuestion, { type BandOffer, type RebuildOffer } from "./BandQuestion"
import type { Rebuilding } from "./useRebuildSandbox"
import TrakFailure from "./failure/TrakFailure"
import TrakHeader from "./TrakHeader"
import TrakResume from "./failure/TrakResume"
import { openerState } from "../../format/hosted"
import PanelOpener from "./processes/PanelOpener"
import ProcessPanel from "./processes/ProcessPanel"
import SideBySide from "./processes/SideBySide"
import { useHoldWideDrawer } from "../../hooks/useWideDrawer"
import { type SidePanel, useSidePanel } from "./processes/useSidePanel"
import { TrakBand } from "../../slots"

/**
 * The param, without importing `routes.ts` — which imports this file. `getRouteApi`
 * exists for exactly that cycle.
 *
 * **The id carries the layout route's own id, where the path does not.** The trak route
 * sits under a pathless `shell` route so the list can render behind the drawer, and a
 * pathless parent contributes to its children's *ids* while contributing nothing to
 * their *paths*. So links stay `to="/traks/$id"` and this reads `/shell/traks/$id`. The
 * string is still checked against the registered tree, so getting it wrong is a type
 * error rather than a blank drawer.
 */
const route = getRouteApi("/shell/traks/$id")

/** Stable, so the loading frame does not hand `useSpot` a new array on every render. */
const NO_BANDS: readonly Band[] = []
/** A stable empty list, so a trak with nothing handed back is not a new array per render. */
const NONE: readonly string[] = []

/**
 * The page's trak's own spend by position, and its pieces' beside it — off the rows the
 * map draws and the per-child fetches the bands are built from, so the trak view cannot
 * count a position the map does not have.
 */
const usageOf = (
  data: TrakDetailDto,
  bands: readonly Band[],
  children: ReadonlyMap<string, TrakDetailDto>,
): TrakUsage =>
  trakUsage(
    data.log,
    bands.map((band) => band.spot.row),
    children,
  )

/**
 * The family map, or the stable empty one before the detail has answered. `Date.now()`
 * at render, as the held card reads it: a parked ending's clock is worded relative to
 * today, and the poll redraws it.
 */
const bandsOf = (
  data: TrakDetailDto | undefined,
  children: ReadonlyMap<string, TrakDetailDto>,
  agents: readonly AgentDto[] | undefined,
): readonly Band[] =>
  data === undefined ? NO_BANDS : familyBands(data, children, agents ?? [], Date.now())

/**
 * What a stopped trak's notice says, or `undefined` for one that has not stopped.
 *
 * **Two conditions, two predicates, and they are never both true.** A `Failed` trak is an
 * ending the engine wrote; an interrupted one is a command in flight with nobody carrying
 * it. `controls.ts` carries why that is two switches rather than one widened, and both are
 * asked of the same custody so neither is offered while something is already driving.
 *
 * Here rather than in `controls.ts` because it ends in words: that file answers `boolean`
 * about `TrakStateDto` and nothing else, which is what keeps its switches a fact about the
 * wire.
 */
const stoppage = (state: TrakStateDto, running: boolean): NoticeWords | undefined => {
  if (state._tag === "Failed")
    return restartOffered(state, running) ? failureWords(state) : undefined
  return runInterrupted(state, running) ? stoppedWords : undefined
}

/**
 * The notice this trak would draw here, or `undefined` — which is every position but one,
 * and every trak that is still going.
 *
 * **At one position, and it is the one that trak stopped at.** `resting` is where its own
 * walk opens with nothing picked, which `opensAt` puts on the row that failed, on the step
 * the vanished command was running, or on the ending row when that command *was* the ending
 * — so a reader who has stepped somewhere else is not shown an explanation against another
 * position's turns. The cost is that the way out goes with it, which is still better than
 * pinning it to the header band or to the chat bar's place.
 *
 * **Asked twice, of two traks, which is what gives a piece its press back.** Once of the
 * trak that owns the position — a piece of a spawn is picked back up from the row it
 * stopped on, in its own chronology, and its `resumption` posts to its own id. And once of
 * the trak the page is *of*, whose resting position is not always a row of its own: a
 * spawn's pieces take the band, so a parent that stopped there is standing on a piece's
 * key. Requiring a row of its own dropped both the sentence and the press for the shape a
 * `MergeFailed` at merge time lands in. Both can be on screen at once, and which end of
 * the pane says which is speaking is `DrawerPane`'s.
 *
 * It builds the notice rather than returning the words, so the page holds one name for it
 * instead of two — `TrakFailure` needs nothing the question above does not already have.
 * None for a viewer who is not the owner: its press is a resume — see `footerBand`. The skip
 * rides along only where a failed effect is what stopped it — `effecting` on the state.
 */
const failureAt = (
  trak: TrakDetailDto,
  spot: Spot | undefined,
  resting: string | undefined,
  running: boolean,
  resumption: Resumption,
  skipping: EffectSkipping,
): ReactNode => {
  const words = trak.ownership === undefined ? stoppage(trak.state, running) : undefined
  const skip = trak.state._tag === "Failed" && trak.state.effecting === true ? skipping : undefined
  return words !== undefined && spot !== undefined && spot.key === resting ? (
    <TrakFailure words={words} resumption={resumption} skipping={skip} />
  ) : undefined
}

/**
 * The block a position gets while the *engine* rather than an agent is working there — or
 * `undefined`, which is every state an agent, a person or nothing at all is standing at.
 *
 * **Two faces of one act, and custody is the whole of the difference.** Something is
 * carrying the trak, so the block says what is being done; or nothing is, and it says the
 * same act stopped and carries the way out. `runInterrupted` is the question the stopped
 * notice already asks, so the two cannot disagree about whether a trak is going anywhere.
 *
 * **At the one position that trak is standing at**, `failureAt`'s narrowing and for its
 * reason: a reader who has stepped elsewhere keeps that position's turns rather than having
 * them covered by something happening somewhere else.
 *
 * `EmptyState` with the props it already has; `tone="working"` is what makes it move. Its
 * skeleton ghosts read as *the turns that are not here yet* once the region is genuinely
 * empty, which is what taking the whole pane makes true, so they need no suppressing.
 */
const engineAt = (
  trak: TrakDetailDto,
  spot: Spot | undefined,
  resting: string | undefined,
  running: boolean,
  resumption: Resumption,
): ReactNode => {
  const work = engineWork(trak.state, trak.worktree?.branch, trak.plan, trak.preparing)
  if (work === undefined || spot === undefined || spot.key !== resting) return undefined
  return runInterrupted(trak.state, running) ? (
    <EmptyState
      shape="blocks"
      tone="bad"
      icon={work.icon}
      title={work.stopped}
      command={work.command}
      action={<TrakResume words={stoppedWords} resumption={resumption} />}
    >
      {stoppedWords.line}
    </EmptyState>
  ) : (
    <EmptyState
      shape="blocks"
      tone="working"
      icon={work.icon}
      title={work.doing}
      command={work.command}
    >
      {work.sentence}
    </EmptyState>
  )
}

/**
 * What one band's ending menu acts on, decided here and drawn by `TrakControls`.
 *
 * **It is given the trak the band speaks for** — the page's own for the header, the
 * focused piece for `PieceBand` — and every offer is read off that trak's state and log,
 * so the menu a reader opens ends the trak whose name is on its row. The ending is
 * offered at every state that has one, which is all of them but the four at rest and the
 * three that are an ending already running — a piece of a spawn included, which the
 * abandon route lands on its parent as a drop.
 *
 * **The Archive the caller hands in is the pane's wherever the two act on the same trak**:
 * the page's own ending row for the header, and every finished piece for the band —
 * `finishing.archiving` is already keyed to the position's owner. The server cannot tell
 * a deliberate second press from a double one, so one trak's ending is one pending state
 * and one refusal, whichever surface it was pressed from. The header diverges only where
 * the position belongs to a piece, which is the case it must not put away.
 *
 * Out here rather than in the render for the reason `DrawerPane` is its own file: the page
 * was over the hundred-line limit, and a slot built from three facts is not a composition.
 */
const offerFor = (
  trak: TrakDetailDto,
  unfinished: UnfinishedArchive,
  archiving: Archiving,
  rebuilding: Rebuilding,
  onReport: (id: string) => void,
): BandOffer => ({
  offers: {
    abandon: archiveUnfinishedOffered(trak.state),
    close: archiveOffered(trak.state),
  },
  unfinished,
  archiving,
  rebuild: rebuildFor(trak, rebuilding),
  // At every state, wherever the host has somewhere to send it.
  report:
    trak.report === undefined
      ? undefined
      : () => {
          onReport(trak.id)
        },
})

/**
 * The band's Rebuild, for a trak whose checkout is in a sandbox — `handoff` on the wire —
 * at the states that still have one, which are the openers'. Unlike them it is offered on a
 * phone: the press acts on the engine's sandbox, not on a window of the viewer's.
 */
const rebuildFor = (trak: TrakDetailDto, press: Rebuilding): RebuildOffer | undefined =>
  trak.handoff === undefined || trak.worktree === undefined || !openersOffered(trak.state)
    ? undefined
    : { owed: trak.rebuild, press }

/**
 * Both bands' ending menus at once — `offerFor` twice, with the hooks routed as its header
 * says: the piece's close is the pane's own `finishing.archiving`, and away from a piece
 * there is no second menu at all. And the sheet a phone's menu asked for, which the page
 * draws after the pane — `useBandEndings` says why there. Out here for `offerFor`'s reason.
 */
const endingsFor = (
  trak: TrakDetailDto,
  /** The trak that owns the position — `trak` itself, or a piece of it. */
  here: TrakDetailDto,
  ends: BandEndings,
  archiving: Archiving,
  finishing: Finishing,
  onReport: (id: string) => void,
): { readonly page: ReactNode; readonly piece: ReactNode; readonly sheet: ReactNode } => {
  const onPiece = here.id !== trak.id
  const offers = {
    page: offerFor(
      trak,
      ends.unfinished.page,
      onPiece ? archiving : finishing.archiving,
      ends.rebuilds.page,
      onReport,
    ),
    piece: onPiece
      ? offerFor(here, ends.unfinished.piece, finishing.archiving, ends.rebuilds.piece, onReport)
      : undefined,
  }
  const menu = (band: "page" | "piece", offer: BandOffer | undefined): ReactNode =>
    offer === undefined ? undefined : (
      <TrakControls
        offer={offer}
        onAsk={ends.ask === undefined ? undefined : (ask) => ends.ask?.({ band, ask })}
      />
    )
  const asked = ends.asked === undefined ? undefined : offers[ends.asked.band]
  return {
    page: menu("page", offers.page),
    piece: menu("piece", offers.piece),
    sheet:
      ends.asked === undefined || asked === undefined ? undefined : (
        <BandQuestion ask={ends.asked.ask} offer={asked} sheet onCancel={ends.cancel} />
      ),
  }
}

/**
 * One band's opener control of one kind, or nothing — which is a phone, a platform with
 * no scan, an engine that could not answer, a machine with nothing of that kind, a trak
 * with no checkout yet, and the states whose checkout an archive takes.
 *
 * **`worktree` alone cannot decide the last one**: the wire keeps naming a checkout
 * the archive deleted, so `openersOffered` reads the state beside it. The phone is
 * first because it is the one case decided about the *viewer* — the press opens a
 * window on the engine's machine, which is the one place a phone is known not to be.
 *
 * **A sandboxed trak — `handoff` on the wire — has no local path**: its editor is drawn
 * disabled saying so, its terminal opens a shell in the sandbox, and under a host, where
 * that terminal would open on a machine nobody is looking at, there is no terminal press
 * and `handoffFor` draws the command instead.
 *
 * Given the trak the band speaks for, `bandEnding`'s rule: the header's presses open
 * the page's trak's checkout, and the piece band's open the focused piece's.
 */
const openerFor = (
  phone: boolean,
  trak: TrakDetailDto,
  kind: OpenerKindDto,
  handles: OpenerHandles,
): ReactNode =>
  phone ||
  handles.listing === undefined ||
  handles.listing === "unsupported" ||
  trak.worktree === undefined ||
  !openersOffered(trak.state) ||
  (kind === "terminal" && trak.handoff?.host !== undefined) ? undefined : (
    <OpenerControl
      kind={kind}
      apps={handles.listing.apps}
      chosen={handles.listing.chosen}
      choosing={handles.choosing}
      opening={handles.opening}
      at={trak.handoff === undefined ? "this trak's checkout" : "this trak's sandbox"}
      {...(kind === "editor" && trak.handoff !== undefined ? { withheld: NO_LOCAL_PATH } : {})}
    />
  )

/**
 * The commands that pick a sandboxed trak's session up, beside its openers — or nothing
 * where `openerFor` would draw nothing for the trak itself, or its checkout is on this
 * machine. Not gated on the listing: under a host there is no terminal to list, and the
 * commands are the whole handoff.
 */
const handoffFor = (phone: boolean, trak: TrakDetailDto): ReactNode =>
  phone ||
  trak.handoff === undefined ||
  trak.worktree === undefined ||
  !openersOffered(trak.state) ? undefined : (
    <HandoffCommands handoff={trak.handoff} />
  )

/**
 * One trak's run-mode picker — or nothing, once that trak is over.
 *
 * **Built for each band's own trak.** The header's is the page's trak's at every position,
 * and standing on a spawn's piece `PieceBand` carries a second one for the piece, so two
 * are on screen and each sits in the row that names its trak. `modeSettable` is the state's
 * answer to whether there is a next gate for it to decide; custody is not asked, because
 * these presses are the ones meant to land while a turn runs. Auto-merge widens it to
 * `Finished` on the page's own trak — a piece has no pull request of its own, so its picker
 * never carries it — where the picker holds that one switch.
 */
const pickerFor = (trak: TrakDetailDto, settings: PickerSettings, piece: boolean): ReactNode => {
  const merges = !piece && autoMergeSettable(trak.state)
  const modes = modeSettable(trak.state)
  return modes || merges ? (
    <RunModePicker
      mode={trak.mode}
      modes={modes}
      holding={trak.holding}
      holdable={holdOffered(trak.state)}
      skipping={trak.skippingChecks}
      skippable={skipChecksOffered(trak.state)}
      nextChecks={trak.nextChecks}
      autoMerge={merges ? trak.autoMerge : false}
      settings={settings}
    />
  ) : undefined
}

/**
 * The two bands at the top: the header, and under it the piece's band where the position
 * belongs to a piece.
 *
 * **Neither band says where its trak stands.** The header names the page's trak and the
 * band names the piece; what either is doing is the pane's to say, in more detail than a
 * phrase — the ending row's caption, the engine-work block, the gate cards, the notice —
 * and a chip over that pane was the same words twice within 200px.
 *
 * **Each band carries its own trak's picker, openers and ending.** The header's actions
 * row is the page's trak's — its picker, its openers and the side panel's opener, hung from
 * the right edge — and its ending is the title row's `⋯`. On a piece the band carries the
 * piece's picker and openers right after the piece's name and its ending at the far right,
 * so the two rows never line up as one toolbar that slipped. Out here for `bandEnding`'s
 * reason: the page is at the hundred-line limit, and two bands built from facts it already
 * holds are not a decision.
 */
const topBands = (args: {
  readonly trak: TrakDetailDto
  /** The trak that owns the position — `trak` itself, or a piece of it. */
  readonly here: TrakDetailDto
  /** Each band's picker settings, keyed to its own trak. */
  readonly settings: { readonly page: PickerSettings; readonly piece: PickerSettings }
  /** Each band's ending menu — `endingsFor`'s pair; `piece` is `undefined` away from one. */
  readonly endings: { readonly page: ReactNode; readonly piece: ReactNode }
  /** Both bands' opener handles — `openerFor` composes each control here. */
  readonly openers: { readonly header: OpenerBand; readonly piece: OpenerBand }
  /** `true` below the breakpoint, where the way out is Back and no opener is drawn. */
  readonly back: boolean
  /** The trak's side panel, whose opener is last in the actions row — `panelOpenerFor`. */
  readonly side: SidePanel
  /** The goal that opened the page's trak, linked on the metadata row; `undefined` for none. */
  readonly goal: GoalLinkTo | undefined
}): ReactNode => {
  const onPiece = args.here.id !== args.trak.id
  // The page's trak, not `here`: the header's presses act on the trak it names.
  const picker = pickerFor(args.trak, args.settings.page, false)
  const editor = openerFor(args.back, args.trak, "editor", args.openers.header.editor)
  const terminal = openerFor(args.back, args.trak, "terminal", args.openers.header.terminal)
  const handoff = handoffFor(args.back, args.trak)
  const panel = panelOpenerFor(args.side)
  return (
    <>
      <TrakHeader
        name={args.trak.plan?.title ?? args.trak.description}
        id={args.trak.id}
        goal={args.goal === undefined ? undefined : <GoalLink goal={args.goal} />}
        menu={args.endings.page}
        actions={
          picker === undefined &&
          editor === undefined &&
          terminal === undefined &&
          handoff === undefined &&
          panel === undefined ? undefined : (
            <>
              {picker}
              {editor}
              {terminal}
              {handoff}
              {panel}
            </>
          )
        }
        back={args.back}
      />
      <PieceBand
        piece={
          onPiece
            ? {
                name: args.here.plan?.title ?? args.here.description,
                actions: (
                  <>
                    {pickerFor(args.here, args.settings.piece, true)}
                    {openerFor(args.back, args.here, "editor", args.openers.piece.editor)}
                    {openerFor(args.back, args.here, "terminal", args.openers.piece.terminal)}
                    {handoffFor(args.back, args.here)}
                  </>
                ),
                menu: args.endings.piece,
              }
            : undefined
        }
      />
    </>
  )
}

/**
 * How the footer band is drawn: why the bar is shut, the stop where there is a turn to
 * interrupt, and the two presses that leave the step where the state offers them there.
 *
 * **One function for all of it, because they are one decision read several ways.** Every
 * state that offers a stop is a state `chatClosed` leaves open for a message the agent
 * will read, and the bar draws the stop until the field holds one — so the two must not
 * be able to come apart. The break-out
 * cluster beside the box carries File it and Recompose where nothing is filed, and Approve
 * and Recompose where a document gate's prose reply has taken its presses off their card —
 * `artifactShown` is what says the card still holds them.
 *
 * **Asked of the trak that owns the position**, on every count, for the reason the
 * gate's press is: what is on screen and what a press reaches have to be the same trak,
 * and at a spawn's piece that is the piece. `running` is the same custody every press
 * here takes, and the stop is the one control that wants it `true`.
 *
 * Here rather than in `controls.ts` because it ends in hooks and a sentence rather than
 * a boolean: that file answers about `TrakStateDto` and nothing else, which is what keeps
 * its switches a fact about the wire.
 *
 * The strip's list and its per-job press ride the same bundle: they are the footer's
 * other two faces, gated on the same custody every press here reads.
 */
const footerFor = (
  trak: TrakDetailDto,
  atGate: boolean,
  running: boolean,
  /** Whether an approvable artifact is the newest thing at this position — see the page. */
  artifactShown: boolean,
  presses: BreakOutPresses,
  approval: Approval,
  stoppingJob: StoppingJob,
): {
  readonly closed: string | undefined
  readonly stopping: Stopping | undefined
  /** The same press as `stopping`, offered at the one script state with a gate to land at. */
  readonly cancelling: Stopping | undefined
  readonly approving: Approval | undefined
  readonly filing: BreakOutPresses["filing"] | undefined
  readonly recomposing: Recomposing | undefined
  readonly outstanding: readonly OutstandingJob[]
  readonly stoppingJob: StoppingJob | undefined
} => {
  // A document gate keeps its presses welded into its own card while that document is the
  // newest thing at the position; a prose reply below it makes the reply newest and takes
  // them here. So `docOnCard` is the one case the bar draws neither Approve nor Recompose.
  const docOnCard = workAwaitsApproval(trak.state) && artifactShown
  return {
    closed: chatClosed(trak.state, atGate, running),
    // Offered while a turn runs, and drawn taken once pressed until the trak parks.
    stopping: stopOffered(trak.state, running, trak.plan !== undefined)
      ? presses.stopping
      : stopTaken(trak.state, running)
        ? stopPressTaken
        : undefined,
    // The same hook and the same route: the engine's stop ends a check at `CheckRunning`
    // as it ends a turn at `AgentWorking`, and the band draws this one where the bar draws
    // that. `useStop` takes no `running` and this reads custody for it, as `stopping` does.
    cancelling: cancelChecksOffered(trak.state, running) ? presses.stopping : undefined,
    // The strip's list and its per-job press: the turn in flight's jobs, and nothing off
    // any earlier turn — `outstandingNow` carries why a dead turn's level must not draw.
    outstanding: outstandingNow(trak.transcript, trak.log, running),
    stoppingJob: running ? stoppingJob : undefined,
    // **A press whose subject is a gate is drawn at the live row only.** Approve beside the
    // bar is exactly that: a document gate whose card no longer carries it, at the row the
    // trak is being asked about. A reader on an earlier run of a re-composed trak is not
    // there, and the bar beside them has just said so.
    approving: workAwaitsApproval(trak.state) && !artifactShown && atGate ? approval : undefined,
    // File it beside the stop while a turn runs, and beside the bar at a gate with nothing
    // filed. `running || atGate` is the gate-subject guard `stopOffered` shares: mid-turn
    // the subject is the running turn, and no row is a gate at `AgentWorking`.
    filing: fileOffered(trak.state, running) && (running || atGate) ? presses.filing : undefined,
    // Recompose beside the bar wherever it is offered and not welded into a card — every
    // gate with nothing filed, a document gate after a prose reply, and mid-turn. The same
    // gate-subject guard, so a reader on an earlier run does not get it.
    recomposing:
      recomposeOffered(trak.state, running) && !docOnCard && (running || atGate)
        ? presses.recomposing
        : undefined,
  }
}

/**
 * Whether an approvable artifact is the newest thing at the position on screen.
 *
 * The one fact that decides whether a document gate's Approve and Recompose sit welded on
 * their card or beside the bar: a prose reply makes the reply newest, and the presses move.
 * Read off the owner trak's log at this position — `undefined` where nothing was filed (a
 * running turn, a conversation), which reads as `false`, so the presses are beside the bar
 * there as they should be. Only ever consulted alongside `workAwaitsApproval`, which is why
 * a compose row's `at` reading a step's output cannot mislead it.
 */
const newestIsArtifact = (trak: TrakDetailDto, spot: Spot | undefined): boolean =>
  spot !== undefined && lastFiledAt(trak.log, spot.row.at)?.type === "artifact"

/** The plan gate as the slots decide it; the page adds the model list, which it fetches. */
type GateOfPlan = Omit<PlanGate, "models">

/**
 * The plan gate with the models a proposed step may be swapped onto. None while the list
 * has not answered, and the swap then draws no model menu.
 */
const withModels = (
  gate: GateOfPlan | undefined,
  models: ModelsDto | undefined,
): PlanGate | undefined =>
  gate === undefined ? undefined : { ...gate, models: models?.allowed ?? [] }

/**
 * The gate's presses and the gate's form, decided here and placed by the pane.
 *
 * **Two gates, one approval, and two predicates per slot.** The composer's plan and a
 * step's filed work are both taken with `Approve` on the same route, and they are two
 * states carrying two step indices — so which is on offer is asked twice, exhaustively,
 * and never widened into one switch over both; `controls.ts` carries why a control drawn
 * one state too wide ends the trak instead of being refused. The form takes the same
 * split, and is handed down as the hook rather than a built node because only the card
 * that draws the questions has them.
 *
 * **A card carries the gate's presses only while its document is the newest thing at the
 * position.** The plan gate's proposal always is, so Approve is on it; a step's document
 * gate keeps Approve and Recompose welded on its artifact card until a prose reply takes
 * the newest slot, and then they move beside the bar — `footerFor`. `artifactShown` is that
 * fact. Every other step gate has no document card at all, so its presses are always beside
 * the bar; the form, at a question gate, still draws in the card `answering` reaches or, once
 * a reply is newest, in a fresh card at the foot — `TurnsView`.
 */
const gatesFor = (
  trak: TrakDetailDto,
  /** Whether an approvable artifact is the newest thing at this position. */
  artifactShown: boolean,
  approval: Approval,
  answer: Answering,
  recomposing: Recomposing,
  permitting: Permitting,
): {
  readonly actions: ReactNode
  readonly answering: Answering | undefined
  readonly planning: GateOfPlan | undefined
} => {
  const { state } = trak
  const approveOnCard = planAwaitsApproval(state) || (workAwaitsApproval(state) && artifactShown)
  const recomposeOnCard = workAwaitsApproval(state) && artifactShown
  // The plan gate's proposal takes the approval whole rather than as a built press: its
  // Approve sends the edits the card holds. `actions` still reaches a finish handing work
  // off, the other thing the plan gate can hold.
  const atGate = planAwaitsApproval(state) ? proposalAtGate(trak) : undefined
  return {
    planning: atGate === undefined ? undefined : { approval, ...atGate },
    // A permission gate's Allow and Refuse sit on the card naming the command, the one
    // card at a gate with nothing filed that carries presses: they answer what it shows.
    actions: workAwaitsPermission(state) ? (
      <PermitPresses permitting={permitting} />
    ) : approveOnCard || recomposeOnCard ? (
      <GatePresses
        approval={approveOnCard ? approval : undefined}
        recomposing={recomposeOnCard ? recomposing : undefined}
      />
    ) : undefined,
    answering: composerAwaitsAnswers(state) || workAwaitsAnswers(state) ? answer : undefined,
  }
}

/**
 * The three chat-band slots decided together: the gate's presses, the gate's form, and the
 * footer band. Bundled so the page reads the newest thing at the position once and hands the
 * same `artifactShown` to both the card and the bar — which is what keeps a document gate's
 * presses from being drawn in two places at a prose reply.
 *
 * **The row's status is the whole of *is this position being asked about* now**: `chat` and
 * every press here are keyed to `here`, so what is typed reaches whoever asked, and a reader
 * on an earlier run of a re-composed trak gets no press.
 */
const chatSlots = (
  here: TrakDetailDto,
  spot: Spot | undefined,
  driving: boolean,
  /** The three presses that answer a gate: approving, answering and permitting. */
  gate: {
    readonly approval: Approval
    readonly answer: Answering
    readonly permitting: Permitting
  },
  presses: BreakOutPresses,
  stoppingJob: StoppingJob,
): {
  readonly actions: ReactNode
  readonly answering: Answering | undefined
  readonly planning: GateOfPlan | undefined
  readonly footer: ReturnType<typeof footerFor> & {
    readonly usage: StepUsage | undefined
    readonly model: string | undefined
    readonly effort: string | undefined
  }
} => {
  const shown = newestIsArtifact(here, spot)
  const { actions, answering, planning } = gatesFor(
    here,
    shown,
    gate.approval,
    gate.answer,
    presses.recomposing,
    gate.permitting,
  )
  const atGate = spot?.row.status === "gate"
  const footer = footerFor(here, atGate, driving, shown, presses, gate.approval, stoppingJob)
  // The usage is the owning trak's at the position on screen — a piece's own log and turn
  // in flight at a piece's step, for the reason its turns are the piece's.
  const usage =
    spot === undefined ? undefined : stepUsage(spot.row, spot.trak.log, spot.trak.inFlight)
  // And the model and effort the position's step runs on, for the token that leads the
  // spend row — a piece's own step's at a piece, since the row is the piece's.
  const [model, effort] = [spot?.row.model, spot?.row.effort]
  return { actions, answering, planning, footer: { ...footer, usage, model, effort } }
}

/**
 * The sheet the recompose press opens, over everything, from either press — or nothing
 * while it is shut.
 *
 * `filed` is the gate's own fact — a document on the table means the work is committed
 * first — read off the same state the press was offered from. It is `fixed`, so it lives
 * in the pane's column for `Lightbox`'s reason and under its rule.
 */
const sheetFor = (trak: TrakDetailDto, recomposing: Recomposing): ReactNode =>
  recomposing.asking ? (
    <RecomposeSheet filed={workAwaitsApproval(trak.state)} recomposing={recomposing} />
  ) : undefined

/**
 * The finished pane for the trak that owns the position on screen. Out here for
 * `sheetFor`'s reason: it is four facts the page already holds, and the page is at the
 * hundred-line limit. `phone` rides along because the pane's Review row starts folded there.
 *
 * `onOpenPull` is the card's link into the side panel — `useSidePanel` says where it is.
 */
/** The wait's skip, shut: it starts the held step, which only the owner may. */
const withoutSkip = (finishing: Finishing): Finishing => ({
  ...finishing,
  skipping: { ...finishing.skipping, disabled: true },
})

/**
 * The Changes surface, told whether the ownership band is drawn below it — the band then
 * pays the home indicator's inset, and the stack drops its share (`DrawerPane` names every
 * payer).
 */
const changesView = (
  changes: Pick<ReturnType<typeof useChangeSurfaces>, "tab" | "landing">,
  trak: TrakDetailDto,
): ReactNode => (
  <ChangesView
    changes={changes.tab}
    landing={changes.landing}
    bandBelow={trak.ownership !== undefined}
  />
)

/** The gate's three slots as `chatSlots` decided them, with the models the plan's swap offers. */
const gateOf = (
  slots: Pick<ReturnType<typeof chatSlots>, "actions" | "answering" | "planning">,
  models: ModelsDto | undefined,
) => ({
  actions: slots.actions,
  answering: slots.answering,
  planning: withModels(slots.planning, models),
})

/** The gate's three slots, empty: what a viewer who is not the owner is handed. */
const NO_GATE = { actions: undefined, answering: undefined, planning: undefined } as const

/**
 * The footer for a viewer who is not the owner, on a host with more than one user: the
 * `TrakBand` slot, which a host may fill with whose it is, at every altitude, in the chat bar's
 * place. Everything else that would start a turn gives way with it — the gate's presses,
 * the stopped notice's resume, the finished pane's doors and the wait's skip — because the
 * engine refuses each to anyone but the owner. `undefined` for the owner at the step altitude, where the chat bar is drawn,
 * and `false` at the others, where nothing is.
 */
const footerBand = (trak: TrakDetailDto, atStep: boolean): ReactNode | undefined => {
  if (trak.ownership !== undefined) return <TrakBand trak={trak} />
  return atStep ? undefined : false
}

const finishFor = (
  trak: TrakDetailDto,
  finishing: Finishing,
  agents: readonly AgentDto[],
  phone: boolean,
  onOpenPull: (() => void) | undefined,
): ReactNode => (
  <FinishedView
    trak={trak}
    finishing={trak.ownership === undefined ? finishing : withoutSkip(finishing)}
    agents={agents}
    phone={phone}
    onOpenPull={onOpenPull}
  />
)

/**
 * The navigator band, decided here and drawn under the header — two shapes for one job.
 *
 * Below the breakpoint the surface bar replaces the step bar, and the step level becomes
 * the Agent tab. **On that tab alone** the strip of marks and the directive block sit under
 * it — the strip does the desk rail's job and the block the wide segment's, arrows
 * included. Map, Trak and Changes draw neither: the map already shows every position, and
 * the person chose to keep the other two clear. One layout in the tree at a time, which is
 * `usePhone`'s contract. Out here for `bandEnding`'s reason: the page was over the
 * hundred-line limit, and a band built from facts it already holds is not a decision.
 */
const navigatorFor = (args: {
  readonly phone: boolean
  readonly bands: readonly Band[]
  readonly parent: string
  readonly spot: Spot | undefined
  readonly level: Level
  readonly prev: string | undefined
  readonly next: string | undefined
  readonly onLevel: (to: Level) => void
  readonly onStep: (to: string) => void
}): ReactNode =>
  args.phone ? (
    <>
      <SurfaceBar level={args.level} onLevel={args.onLevel} />
      {args.level === "step" && (
        <>
          <PositionStrip bands={args.bands} at={args.spot?.key} onPick={args.onStep} />
          {/* Keyed to the position, so an instruction opened in place closes on a step. */}
          <DirectiveBlock
            key={args.spot?.key}
            bands={args.bands}
            parent={args.parent}
            spot={args.spot}
            prev={args.prev}
            next={args.next}
            onStep={args.onStep}
          />
        </>
      )}
    </>
  ) : (
    <StepBar
      level={args.level}
      mark={<StepMark row={args.spot?.row} />}
      place={<PlacePill place={placeOfTurn(args.spot?.row.turns.at(-1))} />}
      name={args.spot?.row.title}
      caption={args.spot?.row.caption}
      prev={args.prev}
      next={args.next}
      onLevel={args.onLevel}
      onStep={args.onStep}
    />
  )

/**
 * The header and the navigator under it, as one node pinned above the pane at every width
 * and on every surface, so Back, the tabs, the strip and the arrows are always one tap away.
 *
 * **On a phone it hides whole while a field below it has the keyboard** — `useTyping` — and
 * at no other time. It never collapses or scrolls away to make room for what is below it:
 * the finished pane's open box is kept small enough to fit under it instead
 * (`ChangeRequest`, `FinishedActs`).
 */
const chromeFor = (
  top: Parameters<typeof topBands>[0],
  nav: Parameters<typeof navigatorFor>[0],
  hidden: boolean,
): ReactNode => (
  // `contents`, so the bands stay the drawer's own flex rows as they were without a wrapper.
  <div className={hidden ? "hidden" : "contents"}>
    {topBands(top)}
    {navigatorFor(nav)}
  </div>
)

/**
 * The rail beside the pane, and none at all below the breakpoint — there the rail is the
 * strip across the Agent tab, `navigatorFor`'s, and 48px down the edge would be a second
 * copy of it.
 *
 * **Slid out on the map, for the same reason.** The map draws every position at full size,
 * so beside it the strip is the copy. It stays mounted and moves — `Rail` carries what that
 * costs — and the pane's column below travels with it, laid out at the width that surface
 * gets from the frame the move starts, which is `columnFor`'s. The map gains no *you are
 * here* mark in exchange: the bar above it names the position, and that is the standing
 * decision in the header.
 */
const railFor = (
  phone: boolean,
  level: Level,
  bands: readonly Band[],
  at: string | undefined,
  onPick: (to: string) => void,
): ReactNode =>
  phone ? undefined : (
    <Rail open={level !== "map"}>
      <TrakRail bands={bands} at={at} onPick={onPick} />
    </Rail>
  )

/**
 * The step's diff as the change maps on its documents read it, or `undefined` until there
 * is one — which draws them standalone rather than flagging files against nothing.
 *
 * A file's lines are drawn here because they are the Changes feature's, and so is the
 * press that lands the tab on the file: `open` is handed the slice as well, so the tab
 * opens on the diff the map was drawn from rather than whichever row it was last left on.
 */
const diffFor = ({
  slice,
  landing,
}: {
  readonly slice: StepSlice | undefined
  readonly landing: { readonly land: (at: string, path: string) => void }
}): StepDiff | undefined => {
  const open = landing.land
  if (slice === undefined) return undefined
  const { files, omittedFiles } = slice.data
  return {
    name: slice.name,
    join: { files, complete: omittedFiles === undefined || omittedFiles === 0 },
    omitted: omittedFiles === 0 ? undefined : omittedFiles,
    lines: (path, gutter) => {
      const file = files.find((f) => f.path === path)
      return file === undefined ? undefined : (
        <ChangeExcerpt
          file={file}
          gutter={gutter}
          onOpen={() => {
            open(slice.at, path)
          }}
        />
      )
    },
  }
}

/**
 * The pane's column beside the rail: on the desk, two widths, and it travels with the rail.
 *
 * **The map's pane is the drawer's full width; every other surface's is the width beside
 * the rail.** The 48px the rail occupies on Agent, Trak and Changes is the map's to use,
 * which is why it is not padded off or clipped there — and on the other three nothing sits
 * behind the strip, so the chat bar's send, a card's Approve and the pane's own scrollbar
 * all stay at an edge a person can reach. What holds while the rail slides is that *neither
 * pane changes width during the move*: a surface change swaps the pane's content on the
 * same frame the move starts, so the map is laid out at its full width from its first
 * frame and a transcript at its narrower one from its first, and the column then travels
 * 48px with the rail — the `Drawer`'s own `overflow-hidden` clips whichever edge is out.
 * Not one width for both: that would put a press behind the rail.
 *
 * **It travels by `margin-left`, and it must not travel by `transform`.** `Lightbox` and
 * `ChangeSheet` are `fixed inset-0` inside this column with no portal, and any `transform`
 * on an ancestor — `translateX(0px)` included — becomes their containing block: measured,
 * the open picture drew at the pane's 731×620 instead of over the window. `Lightbox.tsx`
 * carries the rule and the browser tier measures the picture's box against the viewport.
 * The rail may transform, because it is this column's sibling.
 * The row carries `bg-canvas` for the move: while the narrower pane slides in, the 48px
 * between its far edge and the drawer's is the row, and on the pane's own ground it reads
 * as the pane rather than as a gap opening at the edge. The phone does none of this — it
 * has no rail.
 */
const columnFor = (phone: boolean, level: Level): string =>
  phone
    ? "flex min-h-0 min-w-0 flex-1 flex-col"
    : `flex min-h-0 min-w-0 flex-none flex-col transition-[margin-left] ${SLIDE} ${
        level === "map" ? "ml-0 w-full" : "ml-12 w-[calc(100%-48px)]"
      }`

/**
 * The header's way into the side panel, or nothing while it would hold nothing: a project
 * that declares no hosted process and has no pull request in the panel — or while the
 * answers are out, so the opener does not draw as empty first.
 */
const panelOpenerFor = (side: SidePanel): ReactNode =>
  side.processes.length === 0 && side.pull === undefined ? undefined : (
    <PanelOpener
      worst={openerState(side.processes)}
      pull={side.pull}
      count={side.processes.length}
      open={side.open}
      onToggle={side.toggle}
    />
  )

/**
 * The report pane, for whichever of `traks` it is open for — the page's own or the piece a
 * band spoke for — and only while the host still offers a destination for that trak.
 */
const reportPaneFor = (
  traks: readonly TrakDetailDto[],
  pane: ReportPaneState,
  phone: boolean,
): ReactNode => {
  const reported = traks.find((t) => t.id === pane.trak && t.report !== undefined)
  return reported?.report === undefined ? undefined : (
    <ReportPane
      reporting={pane.reporting}
      destination={reported.report.destination}
      phone={phone}
      onBack={pane.close}
    />
  )
}

/**
 * The drawer, with the side panel in it where the panel is open.
 *
 * **On the desk the drawer widens and splits**: the trak keeps a column of its own and the
 * panel takes the rest, or the whole drawer in full view — `SideBySide`. **On a phone the
 * panel is pushed over the trak**, a screen of its own with a way back, because there is no
 * width to split. A process runs in the checkout of the trak that owns the position — `here`,
 * which at a spawn's piece is the piece — so Start waits on that trak having one: none yet,
 * or the archive has taken it, which leaves `worktree` naming it — the openers' question,
 * asked the same way.
 */
const SideDrawer = ({
  side,
  trak,
  here,
  phone,
  chrome,
  report: opened,
  children,
}: {
  readonly side: SidePanel
  /** The trak the page is of; `here` is the one owning the position, which may be a piece. */
  readonly trak: TrakDetailDto
  readonly here: TrakDetailDto
  readonly phone: boolean
  /** The header and the navigator — `chromeFor`. */
  readonly chrome: ReactNode
  /** The report pane's state: where one is open it is the whole screen on a phone, the row on a desk. */
  readonly report: ReportPaneState
  /** The rail and the pane's column, as one row. */
  readonly children: ReactNode
}): ReactNode => {
  useHoldWideDrawer(side.open && !phone)
  const report = reportPaneFor([trak, here], opened, phone)
  const body =
    phone && report !== undefined ? (
      report
    ) : (
      <>
        {chrome}
        {report ?? children}
      </>
    )
  // A link an agent wrote to one of this trak's processes, or to its pull request, opens the
  // panel there — every markdown on the screen, so it is provided around all of it. Not on a
  // phone, where the panel is a screen of its own and links stay as they were.
  const linked = <MarkdownLinks follow={phone ? undefined : side.follow}>{body}</MarkdownLinks>
  if (!side.open) return <Drawer label="Trak">{linked}</Drawer>
  const panel = (
    <ProcessPanel
      trak={here.id}
      processes={side.processes}
      pull={side.pull}
      active={side.active}
      onActive={side.setActive}
      held={side.held}
      origins={side.origins}
      view={side.view}
      onView={side.setView}
      presses={side.presses}
      startable={here.worktree !== undefined && openersOffered(here.state)}
      phone={phone}
      full={side.full}
      onFull={phone ? undefined : () => side.setFull(!side.full)}
      onClose={phone ? undefined : side.toggle}
      back={
        phone ? { title: here.plan?.title ?? here.description, onBack: side.toggle } : undefined
      }
    />
  )
  return phone ? (
    <Drawer label="Trak">{panel}</Drawer>
  ) : (
    <Drawer label="Trak" wide>
      <SideBySide trak={linked} panel={panel} full={side.full} />
    </Drawer>
  )
}

/** The drawer with no trak in it, because the detail could not be read at all. */
const Unreadable = ({ said }: { readonly said: string }): ReactNode => (
  <Drawer label="Trak">
    <EmptyState shape="blocks" tone="bad" icon={Unplug} title="Could not load this trak">
      {said}
    </EmptyState>
  </Drawer>
)

const TrakDetailPage = (): ReactNode => {
  const { id } = route.useParams()
  const { data, isError, error } = useTrakDetail(id)
  // The breakpoint, read here and passed down: below it the drawer is the whole screen,
  // the surface bar replaces the step bar, and the strip across the Agent tab the rail. Beside it, the
  // device's notifications about this trak closed as it opens.
  const [phone] = [usePhone(), useClearNotifications(`trak:${id}`)]
  // Whether a field below the chrome has the keyboard up, which is when a phone hides it.
  const typing = useTyping(phone)

  // One detail covers the parent and every piece of every spawn it has out. The ids are in
  // the trak's own log, and each piece is read through the same route and cache key.
  const children = useFamily(data?.log)
  // And the other direction: the trak this one is a piece of, where it is one. A subtrak is
  // viewed inside its parent, so this drawer redirects into it below rather than drawing.
  const parent = useParent(data?.log)

  const [level, setLevel] = useState<Level>("step")
  // The library, for the mark each position's agent wears and the models the plan gate's
  // swap offers. Unconditional and cheap, and a position whose mark cannot be resolved draws
  // the fallback rather than nothing.
  const [agents, models] = [useAgents(), useModels()]
  const bands = bandsOf(data, children, agents.data)
  const { spot, prev, next, resting, pick } = useSpot(bands, data?.state)

  /**
   * The trak the presses on screen act for: whichever owns the position, which at a spawn's
   * piece is the piece rather than the parent.
   *
   * **One rule, replacing *the page's trak only*.** A piece's gate was built from the
   * piece's state and carries the piece's step index, so acting for the page's trak from a
   * piece's card would press somewhere nobody was looking — which is why the presses used
   * to be withheld here entirely. Keying them to this instead is what gives them back.
   */
  const owner = spot?.trak ?? data
  const at = owner?.id ?? id
  // Custody, not state, and read off the trak being acted on: `driving` is whether
  // *anything* holds it — this tab, a second one, or a `pnpm ork` in a terminal — and it is
  // the only thing that stops a press racing a drive already under way. A crashed run stays
  // `AgentWorking` with nobody holding it, which is why the state cannot answer this.
  const driving = owner?.custody.holder !== undefined
  // The band at the top acts for the trak the page is of, so it asks the same question of
  // that trak instead. The two are the same at every position but a piece's.
  const running = data?.custody.holder !== undefined

  const [approval, answer, permitting] = [
    useApprove(at, driving),
    useAnswer(at, driving),
    usePermit(at, driving),
  ]
  // Custody shuts the send only where the engine would refuse it; a turn or a check
  // running keeps what is said. The hand-back is the owner's, like the draft.
  const chat = useSendChat(at, sendBlocked(owner?.state, driving), owner?.returned ?? NONE)
  // The press that shares the chat bar's place and the two beside it — `footerFor` above.
  // None of the three takes custody; `controls.ts` decides which exist from it instead.
  const presses = useBreakOut(at)
  // The per-job stop, keyed like every press; it takes no `running` — `useStopJob` says why.
  // Beside it, every view on the transcript of the trak that owns the position and the
  // press a view sends — keyed to `at` for the reason every press is. `driving` is not a
  // guard there: it only says whether a press needs a CLI started first.
  const [stoppingJob, views] = [useStopJob(at), useViews(at, owner?.transcript, driving, phone)]
  // The four settings each picker presses: the header's keyed to the page's trak, and the
  // piece band's to the trak that owns the position — `pickerFor` above.
  const settings = { page: usePickerSettings(id), piece: usePickerSettings(at) }
  // The endings and the preview that labels one of them. Still four mutations with four
  // refusals — `useFinishing` is an aggregator, not a hook with a discriminator.
  // Keyed to the trak that owns the position, so `branchMoved` is asked of that trak's log
  // and not the page's: at a spawn's piece the pane, its presses, its preview, its forge
  // and its deploy are all the piece's.
  const finishing = useFinishing(at, driving, owner, branchMoved(owner?.log ?? []))
  // The presses on the notice — resume, and the skip a failed effect adds — for the trak
  // owning the position on screen, which is how a stopped piece of a spawn is picked back up.
  const [resumption, skip] = [useResume(at, driving), useSkipEffects(at, driving)]
  // And the page's own trak's, for the notice heading the pane where the position it rests on
  // belongs to a piece. Two of each acting hook, for the second `useArchive`'s reason — never
  // about the same trak, since the page's notice is built only off a position not its own.
  const pageWays = [useResume(id, running), useSkipEffects(id, running)] as const
  // The header's own Archive, for the position where `finishing.archiving` is ending a
  // *piece*: the menu speaks for the trak the page is of at every position, so one shared
  // hook would put *Archive this trak* in a header naming the parent and archive a child
  // with it. Where the two act on the same trak the pane's is used instead — `controls`
  // below.
  const archiving = useArchive(id, running)
  /**
   * What the work did to the files, and which slice of it is showing.
   *
   * **Keyed to `at` like every press on this screen**, which at a spawn's piece is the
   * piece: a piece's work is in a checkout the parent has never seen, and its step indices
   * are its own. It is handed the position for the same reason the arrows read one — the
   * third row of the picker is that step's commit, so moving position moves what there is
   * to look at.
   *
   * **The altitude decides when git is asked.** On Changes for the tab, and on the step
   * only while that position filed a change map — which reads the step's slice under the
   * tab's key, and whose Open in Changes lands this tab on a file. Never on the map, which
   * is what keeps a drawer left open on Map from running `git diff` every fifteen seconds.
   */
  const changes = useChangeSurfaces(at, spot?.row, owner?.log, level, setLevel)
  // The editor and the terminal at each band's checkout: the listing (asked at desk width
  // only — the query is gated on the breakpoint), one pick per kind shared by both bands,
  // and an open press per band. `useOpeners` carries why only the open press is keyed per
  // trak.
  // And the goal that opened the page's trak, which the header links back to.
  const [openers, goal] = [useOpeners(id, at, phone), useGoalLink(data?.goal)]
  // The side panel — `SideDrawer` — whose processes are the position's trak's.
  // And the report pane, open for the page's trak or a piece, shut by a step to another page.
  const [side, report] = [useSidePanel(id, data, at), useReportPane(id)]
  // Both bands' endings, each keyed to its own trak, and a phone's open question.
  const ends = useBandEndings({ id, owed: data?.rebuild }, { id: at, owed: owner?.rebuild }, phone)

  /** Picking a row is picking it *to read*, whichever surface you picked it from. */
  const go = (to: string): void => {
    pick(to)
    setLevel("step")
  }

  if (data === undefined)
    return isError ? (
      <Unreadable said={error.message} />
    ) : (
      <LoadingDrawer chat={chat} phone={phone} />
    )

  // A piece is read inside its parent and nowhere else, so an old link to one lands on the
  // parent standing at it. After the hooks and after the load, because it needs the log —
  // and only once the parent has answered, so a child whose parent is gone keeps its drawer.
  if (parent !== undefined)
    return <Navigate to="/traks/$id" params={{ id: parent.id }} search={{ spot: id }} replace />

  /** `owner` past the load guard. It is `data` or a piece of it and neither can be missing
   *  here, which the compiler cannot see through the `??` above the hooks. */
  const here = owner ?? data
  // Each band's ending menu, with the pane's Archive shared wherever two surfaces act on
  // one trak — `endingsFor` carries the routing.
  const endings = endingsFor(data, here, ends, archiving, finishing, report.open)

  // The gate's presses, the gate's form, and the footer band — `chatSlots` places them.
  const gate = { approval, answer, permitting }
  const slots = chatSlots(here, spot, driving, gate, presses, stoppingJob)

  /** Where the trak that owns the position on screen is standing. Asked once, because both
   *  things drawn at that row and nowhere else — the stopped notice and the engine's own
   *  block — have to agree about which row it is. */
  const restsAt = restingFor(bands, spot, resting)
  // Where an image an agent wrote is fetched from — the `OfTrak` below says why.
  const images = (path: string): string => trakImageUrl(at, path, here.log.length)

  /**
   * The engine's block and the stopped notice for the trak that owns this position —
   * `engineAt` and `failureAt`, and never both: the block replaces the notice because it
   * is the same trak at the same position with the same press inside it. Where either
   * goes, and what it displaces, is `DrawerPane`'s.
   */
  const engine = engineAt(here, spot, restsAt, driving, resumption)
  const failure =
    engine === undefined ? failureAt(here, spot, restsAt, driving, resumption, skip) : undefined

  const chrome = chromeFor(
    { trak: data, here, settings, endings, openers, back: phone, side, goal },
    { phone, bands, parent: data.id, spot, level, prev, next, onLevel: setLevel, onStep: go },
    typing.typing,
  )

  return (
    <SideDrawer side={side} trak={data} here={here} phone={phone} chrome={chrome} report={report}>
      {/* The rail and the pane are one row that runs to the foot of the drawer. It sits
          beside the pane rather than beside the whole drawer, so the header and the step
          bar still run the full width — the rail is about a position within the work and
          those two are about the trak. **The chat bar is in the pane's column, not below
          the row**, because it is the bottom of the conversation the pane is showing: it
          shares the pane's ground, and the rail's edge reaches the bottom rather than
          stopping short of it. **There is no rail down the edge on a phone** — the strip
          under the surface tabs is its rail. **On the desk the rail is out of flow and slides**, and the
          column beside it is `columnFor`'s. **Every field the chrome hides for is in here**,
          the chat bar's included, so `useTyping` listens on this row and a field in the
          chrome never hides the band it is in. */}
      <div ref={typing.root} className={`flex min-h-0 flex-1${phone ? "" : " relative bg-canvas"}`}>
        {railFor(phone, level, bands, spot?.key, go)}

        <div className={columnFor(phone, level)}>
          {/* An image an agent wrote is drawn out of the checkout belonging to whichever
              trak owns the position, which at a spawn's piece is the piece — the same
              `at` every press is keyed to, and for the same reason: a piece's shot is in
              a worktree the parent has never seen. Here rather than deeper because
              nothing between this and the markdown knows which trak it is drawing.
              Versioned by that trak's log length because a shot is re-taken under the
              name it was first taken under, and the trak logging something is the only
              signal this surface has that a file in its checkout may have changed. */}
          <OfTrak images={images} views={views} trak={here} diff={diffFor(changes)}>
            <DrawerPane
              level={level}
              trak={data}
              bands={bands}
              spot={spot}
              {...(data.ownership === undefined ? gateOf(slots, models.data) : NO_GATE)}
              failure={failure}
              // And the page's trak's, where it is resting on a position it does not own.
              // Withheld where it does: `here` is `data` there, so the two questions have the
              // same answer and drawing both would be one notice twice. Where it goes once it
              // exists is `DrawerPane`'s.
              pageFailure={
                at === id ? undefined : failureAt(data, spot, resting, running, ...pageWays)
              }
              // Handed over unconditionally: `DrawerPane` draws it at the one row whose
              // `kind` is `end`, and that row exists at exactly the states `FinishedView`
              // draws anything at. One question, asked in one place — and `here` is what
              // makes it the right one on a piece's own ending row, which its column carries
              // again now that the pane's ending is not always the page's.
              finish={finishFor(here, finishing, agents.data ?? [], phone, side.openPull)}
              engine={engine}
              changes={changesView(changes, data)}
              usage={usageOf(data, bands, children)}
              agents={agents.data ?? []}
              onPick={go}
              cancelling={slots.footer.cancelling}
              stopJob={slots.footer.stoppingJob}
            />
          </OfTrak>

          {/* At the step altitude only: the
              conversation is what you are typing into, and the map and the details are two
              moves away from it rather than two things to talk to. It closes rather than
              disappearing whenever it is *here* and there is nothing to say — a shut bar
              with the reason in it, which is not the same as no bar. */}
          {footerBand(data, level === "step") ?? (
            <TrakChatBar chat={chat} phone={phone} {...slots.footer} />
          )}
          {sheetFor(here, presses.recomposing)}
          {endings.sheet}
        </div>
      </div>
    </SideDrawer>
  )
}

export default TrakDetailPage
