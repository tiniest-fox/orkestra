/**
 * The finished position's pane: where the trak is in a sentence, where its work would go,
 * what the forge says about its pull request, and the presses that end it.
 *
 * **The ending is a decision, so the pane draws the thing being decided** — the branch, the
 * destination, the size of the move — and leaves *how the work got made* on the map, one
 * press away, rather than a closing document or one more gate.
 *
 * **One card holds the whole ending, and containment is what integrates the two halves.**
 * The forge under a hairline below the move card would read as *and now, separately,
 * GitHub* — a footnote to a local merge that a trak with a pull request is never offered.
 * So where there is one it is the card's head, its three sections are the
 * rows of the card's table, and the move is the footer inside it; where there is none the
 * card is the move, and `PullRequestPane` returning nothing is the whole of the branch.
 *
 * **Nothing here reads a `_tag` to decide what is on offer.** The three presses come in as
 * booleans from `controls.ts`, which is `client-style`'s checklist item 5 and the reason
 * for it: a control drawn one state too wide is not refused, it settles as
 * `Failed{engine}`. What this file does switch on is *wording*, which is `finished.ts`.
 *
 * **The one thing composed here is the ending cell, and it is composed rather than
 * widened.** `endingCell` takes the state's two offers and adds the forge, the log and the
 * wait: a trak whose branch has a pull request never offers a local merge, because work
 * that went in over there is never merged from here, and nor does a trak that kept nothing
 * on its branch. None of those facts is about `TrakStateDto`, so none is given to
 * `mergeOffered` as an argument; that function's docstring records what a control drawn
 * from anything but the state costs.
 *
 * **`branchMoved` is read here once and reaches four things**: the words, the card's
 * right-hand side, the ending cell, and the standing — which is what
 * carries it on to the card's head and the move's footer. Asked once for `changesOffered`'s
 * reason — two readings of one log is two answers that can differ, on a pane whose halves
 * are inches apart.
 *
 * **A merged pull request now reaches the record.** The engine asks GitHub once at the
 * archive press, so such a trak ends `Merged` and `records.ts` files it like any other —
 * which is also what makes Archive the loud press here, off the same `standingOf` answer
 * the card is drawn from.
 *
 * **The ticks live here because two halves share them**: the pull-request pane draws them
 * and the box at the foot lists them, and one list is what stops a removed line and a
 * still-ticked row disagreeing about what would be sent.
 *
 * **The presses are the pane's last child, in a band that sticks to its bottom edge.**
 * `FinishedActs` draws the band and the request box inside it; `FinishedFoot` carries why.
 * What they need from here is to be last, which is why the hand-up and the
 * overridden-checks notice sit above them rather than under the row.
 *
 * **And one predicate decides whether either is drawn at all.** `changesOffered` is asked
 * once, for the ticks on the pane and for the box they land in — two answers is a state
 * that shows a checkbox with nothing to send it to, which is what `Merged` drew for as long
 * as the pane read its ticks off `finishedPosition` and the box off the offers.
 *
 * **A merge that did not go in draws the same pane with one plate under the sentence.**
 * `finishedPosition` keeps a trak at `Failed{merge}` here — the plan did run out and the
 * work is on its branch — and `MergeRefused` is what it adds: git's own refusal, or the
 * files a child's Merge press was refused over before git was asked, and the press that
 * commits the parent's checkout and merges. The sentence, the card and the presses are
 * what they are at `Finished`; the Merge press is the way to run the merge again.
 *
 * **An archive that did not finish draws the pane with no presses.** `Failed{archive}` is
 * here because the person ended the trak from this row; the notice above the pane says
 * what failed and carries Restart, which is the only way on. The sentence says how the trak
 * was ended, and the forge is not asked.
 *
 * **A trak resting on an unmet wait draws the same pane with one block under the
 * card.** `waiting` is on the wire at exactly that rest, and `HeldCard` is what it adds:
 * the condition or the clock, its state and when it is next asked or starts, under an
 * ending that is otherwise untouched — same sentence, same card, same doors. What it
 * changes about the presses is that Archive goes into the `⋯` and its panel says the held
 * step is dropped, which `endingCell` and `FinishedActs` read off the same fact — and that the block
 * carries one press of its own, the skip that starts the held step with its wait unmet.
 *
 * **A step held on `deployed` is the one wait that draws no held card.** The deploy is the
 * thing being waited for, so `DeployBlock` carries the countdown, the skip press and the
 * held steps itself, above the ending card — one block, not two. The same block stands on
 * any trak with a merge commit to ask about (`landed`, or the `Merged` state), holding
 * steps or not, and it is the deploy alone there. Landing also counts as merged for the
 * ending: the branch is in, whatever the forge has been asked, so Archive is the press.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import type { Dispatch, SetStateAction } from "react"
import { TriangleAlert } from "lucide-react"
import type { AgentDto, TrakDetailDto, WaitingDto } from "../../../api/types"
import { agentGlyph } from "../../../format/glyph"
import {
  archiveFailed,
  archiveOffered,
  autoMergeSettable,
  changesOffered,
  finishedPosition,
  mergeOffered,
} from "../controls"
import { GENERIC_AGENT } from "../../../format/engineAgent"
import { deployRan, heldOnDeploy } from "../deploy/deploy"
import DeployBlock from "../deploy/DeployBlock"
import { branchMoved, destination, ending, endingCell, endingWords, handedUp } from "./finished"
import type { EndingCell } from "./finished"
import FinishedActs, { type AutoMergeOffer } from "./acts/FinishedActs"
import FinishedMove from "./acts/FinishedMove"
import HandedUp from "./acts/HandedUp"
import HandOffs from "../cards/plan/HandOffs"
import ProposedGoal from "../cards/plan/ProposedGoal"
import { handedOffTraks, openedGoals } from "../cards/plan/handOff"
import HeldCard from "../waits/HeldCard"
import MergeRefused from "./merge/MergeRefused"
import { mergeRefusal } from "./merge/mergeRefusal"
import { standingOf } from "../pull-request/pullRequest"
import type { PullMerge, Standing } from "../pull-request/pullRequest"
import PullRequestPane from "../pull-request/PullRequestPane"
import { pickAll, removePick, togglePick } from "../pull-request/picks/reentryBody"
import type { Picked } from "../pull-request/picks/reentryBody"
import type { Finishing } from "./useFinishing"

/**
 * A check that failed and was taken anyway. **The ending is the last place that can say
 * it** — the `checks` gate is gone the moment somebody approves, so a trak arrives here
 * with nothing on screen recording that it happened.
 *
 * In `waiting` rather than as an error: nothing went wrong, a person decided.
 */
const Overridden = ({ names }: { readonly names: readonly string[] }): ReactNode =>
  names.length === 0 ? null : (
    <div className="flex items-start gap-2 text-sm text-tone-waiting">
      <TriangleAlert size={12} aria-hidden className="mt-0.5 shrink-0" />
      <span className="min-w-0">You took this work with {names.join(", ")} still failing.</span>
    </div>
  )

/**
 * Below the card rather than above or inside it: a region beside the ending, in the
 * ending's idiom, and the lead sentence stays the first thing read. Nothing for a wait on
 * the deploy, which the block above the card already carries — `onDeploy` is handed in
 * rather than read again, so the two halves cannot answer that differently.
 */
const Held = ({
  trak,
  onDeploy,
  skipping,
}: {
  readonly trak: TrakDetailDto
  readonly onDeploy: WaitingDto | undefined
  readonly skipping: Finishing["skipping"]
}): ReactNode =>
  trak.waiting === undefined || onDeploy !== undefined ? null : (
    <HeldCard waiting={trak.waiting} nextAsk={trak.nextAsk} plan={trak.plan} skipping={skipping} />
  )

/**
 * The two ticks the pane takes, as a pair or as neither: one over a row, one over every
 * pick under a reviewer's head. `changesOffered` is asked once for both, so a pane cannot
 * draw a head tick over rows that have none.
 */
const ticks = (
  picking: boolean,
  setPicked: Dispatch<SetStateAction<readonly Picked[]>>,
): Pick<Parameters<typeof PullRequestPane>[0], "onToggle" | "onToggleAll"> =>
  picking
    ? {
        onToggle: (item) => {
          setPicked((held) => togglePick(held, item))
        },
        onToggleAll: (items) => {
          setPicked((held) => pickAll(held, items))
        },
      }
    : { onToggle: undefined, onToggleAll: undefined }

/**
 * The band's ending cell: the state's two offers, and the three facts about the branch
 * that `endingCell` adds. A landed branch is in, whatever the forge has been asked — the
 * wait that found it merged is the one fact here the forge's answer does not carry.
 */
const cellFor = (
  trak: TrakDetailDto,
  standing: Standing,
  moved: boolean,
  pull: PullMerge | undefined,
): EndingCell =>
  endingCell({
    merge: mergeOffered(trak.state),
    archive: archiveOffered(trak.state),
    standing,
    moved,
    landed: trak.landed !== undefined,
    waiting: trak.waiting !== undefined,
    pull: pull !== undefined,
  })

/**
 * The deploy: the wait where it is the deploy's, and the answer where the script ran.
 * The block draws for either — a step held on `deployed` before the branch has merged
 * has no answer yet and still needs its steps and its countdown somewhere — and for the
 * moment before the first answer, so the head's space is held rather than appearing.
 */
const deployOf = (trak: TrakDetailDto, finishing: Finishing) => {
  const onDeploy = heldOnDeploy(trak.waiting)
  const deployed = deployRan(finishing.deploy.answer)
  const deploy = onDeploy !== undefined || deployed !== undefined || finishing.deploy.checking
  return { onDeploy, deployed, deploy }
}

/**
 * The traks this trak's composer handed off and the goals it proposed, drawn as links where
 * the hand-up is drawn: the other blocks on this pane addressed to somebody other than the
 * reader.
 */
const OpenedElsewhere = ({ log }: { readonly log: TrakDetailDto["log"] }): ReactNode => (
  <>
    {handedOffTraks(log).map((o) => (
      <HandOffs key={o.step} texts={o.ids} base={o.base} opened={o.ids} />
    ))}
    {openedGoals(log).map((o) => (
      <ProposedGoal key={o.goal} opened={o.goal} />
    ))}
  </>
)

/**
 * The switch the header's picker also offers, where the route would take it. A child never
 * reaches the cell it is drawn in — it has no pull request — so nothing here asks which it is.
 */
const autoMergeOf = (trak: TrakDetailDto, finishing: Finishing): AutoMergeOffer | undefined =>
  autoMergeSettable(trak.state)
    ? { value: trak.autoMerge, setting: finishing.autoMerge }
    : undefined

const FinishedView = ({
  trak,
  finishing,
  agents,
  phone,
  onOpenPull,
}: {
  readonly trak: TrakDetailDto
  readonly finishing: Finishing
  /** The library, for the ask door's mark. Empty while the query is out — `agentGlyph`
   *  says what that draws and why it is the same as three other absences. */
  readonly agents: readonly AgentDto[]
  /** The page reads the seam once and hands it down: the Review row starts folded there. */
  readonly phone: boolean
  /** The card's link into the side panel's Pull request tab — `PullRequestHeader`. */
  readonly onOpenPull: (() => void) | undefined
}): ReactNode => {
  // Before the guard below, because the rules of hooks are not a branch in the render.
  const [picked, setPicked] = useState<readonly Picked[]>([])

  // Nothing draws this pane at a trak whose plan has not run out — the row it belongs to
  // does not exist there either — but the page hands it over unconditionally, so this is
  // the one place that has to say so.
  const ended = finishedPosition(trak.state)
  if (ended === undefined) return null

  const summary = ending(trak.log, trak.plan, trak.worktree?.branch)
  // Whether anything was kept on the branch, asked once — see the header.
  const moved = branchMoved(trak.log)
  const into = destination(finishing.preview)
  // **The sentence above the card and the press below it come off one answer.** They were
  // read off two — the press off whether a card is drawn, the words off the whole answer
  // alone — and the two disagree on exactly the cards a remembered answer introduces: a
  // coarse card printed *until you merge it* with no Merge press, and a remembered `merged`
  // printed *the work is on its branch* under a head saying Merged. `standingOf` is that one
  // answer, derived through `cardOf` so a third reader cannot drift from either.
  //
  // A remembered answer therefore gates the press exactly as a fresh one does, and so does
  // the moment before the first: offering a local merge and taking it away a second later is
  // worse than a ghost in its place for a second, and `endingWords` says nothing about the
  // checkout there rather than naming a press that is not drawn.
  //
  // **A branch nothing was committed to is the one standing nobody asked for.**
  // `finishingLive` withholds the query there, so `finishing.forge` stays empty for as long
  // as the drawer is open and `cardOf` reads that emptiness as *still checking* — a strip
  // where the head will be, forever, on a pane that is not waiting for anything. There is no
  // pull request to wait for: a branch nobody pushed to cannot have one, so the standing is
  // `none` without a `gh` process being spent to say so, and the card is not drawn.
  //
  // **Nor is an archive that did not finish** — `finishingLive` withholds the query there
  // too, for the same reason and to the same effect.
  const standing = moved && !archiveFailed(trak.state) ? standingOf(finishing.forge) : "none"
  // Which is also what says whether the card has a head at all. `none` is the one standing
  // `PullRequestPane` draws nothing for, so asking it here rather than letting the pane
  // return null of its own accord keeps *is there a card above the move* and *is the move a
  // footer* one answer — `FinishedMove`'s `foot` is the other reader of this.
  const forge = standing !== "none"
  const { lead, under, instead } = endingWords(ended, standing, moved)
  // **One predicate for the ticks and for the box they land in.** Asked once here rather
  // than twice below, because the two answering differently is a checkbox that can be
  // pressed and does nothing — which is what `Merged` drew when it offered nothing and the
  // pane above it still had ticks on it. It offers both doors now, so the same one answer
  // turns the ticks on there as well: a merged trak with a pull request can have a failing
  // check ticked and sent back, which `controls.ts` records as taken knowingly.
  // Withheld from a viewer who is not the owner: both doors start a turn.
  const picking = changesOffered(trak.state) && trak.ownership === undefined
  // A child's message to its parent, drawn only where there is one: a child that ended
  // with nothing to say upward gets the pane every other trak has.
  const handUp = handedUp(trak.log)
  // A merge that did not go in — git's refusal on the state, or the files the Merge press
  // was refused over — and the parent it names, which is the preview's `parentId`: the
  // id is the name, and nothing else on the wire carries it. `mergeRefusal` says which of
  // the two is drawn and why a refusal with no parent is not.
  const refusal = mergeRefusal(trak.state, finishing.merge.files, finishing.preview?.parentId)
  const { onDeploy, deployed, deploy } = deployOf(trak, finishing)

  return (
    // `pt-4` and not `py-4`: the band at the foot pays the bottom. `min-h-full` is what
    // lets the band's `mt-auto` put it on the scroller's bottom edge under a short card.
    <div className="flex min-h-full flex-col gap-4 px-4 pt-4">
      <div className="flex flex-col gap-1.5">
        <p className="text-lg leading-6 text-fg">{lead}</p>
        {under !== undefined && <p className="text-base text-fg-muted">{under}</p>}
      </div>
      {/* Under the sentence and over the card: the ending is still read first, and the
          refusal is the newest thing that happened to it. */}
      {refusal !== undefined && (
        <MergeRefused refusal={refusal} commit={finishing.commitAndMerge} />
      )}

      {deploy && (
        <DeployBlock
          answer={deployed}
          checking={finishing.deploy.checking}
          fetching={finishing.deploy.fetching}
          held={onDeploy}
          nextAsk={trak.nextAsk}
          plan={trak.plan}
          agents={agents}
          skipping={finishing.skipping}
        />
      )}

      {/* `overflow-hidden` because the footer's own fill has to stop at the card's corner
          rather than square it off — and it is what clips the rechecking hairline to the
          same corner. `relative` is that hairline's containing block: it is drawn on the
          card's top edge and out of the flow, so nothing below it moves every poll. */}
      <div className="relative flex min-w-0 flex-col overflow-hidden rounded-surface border border-border bg-surface">
        {forge && (
          <PullRequestPane
            forge={finishing.forge}
            picked={picked}
            {...ticks(picking, setPicked)}
            phone={phone}
            onOpen={onOpenPull}
          />
        )}
        <FinishedMove state={ended} ending={summary} into={into} foot={forge} moved={moved} />
      </div>
      <Held trak={trak} onDeploy={onDeploy} skipping={finishing.skipping} />
      <Overridden names={summary.overrode} />
      {handUp !== undefined && <HandedUp text={handUp} />}
      <OpenedElsewhere log={trak.log} />
      <FinishedActs
        cell={cellFor(trak, standing, moved, finishing.pull)}
        doors={picking}
        merged={standing === "merged" || trak.landed !== undefined}
        moved={moved}
        waiting={trak.waiting !== undefined}
        instead={instead}
        destination={into?.name}
        // Withheld while a pull request exists: this is the local `git merge-tree` answer
        // about the daemon's own checkout, it labels a press that is no longer drawn, and
        // it is a different comparison from the forge's — which is the one that is true of
        // the pull request.
        conflicts={forge ? undefined : finishing.preview?.conflicts}
        // Resolved from the wire rather than named here: `format/glyph.ts` carries what a
        // surface holding its own agent-name-to-mark map cost the last time one did.
        askGlyph={agentGlyph(agents, GENERIC_AGENT)}
        merge={finishing.merge}
        pull={finishing.pull}
        pullMerging={finishing.pullMerging}
        methodPick={finishing.methodPick}
        autoMerge={autoMergeOf(trak, finishing)}
        // The plate above holds the press's own refusal where it holds the files, so the
        // band does not say it twice. A failure on the plate leaves the band its own.
        refusedAbove={refusal !== undefined && refusal.said === undefined}
        archiving={finishing.archiving}
        changes={finishing.changes}
        picked={picked}
        onRemove={(key) => {
          setPicked((held) => removePick(held, key))
        }}
        onClear={() => {
          setPicked([])
        }}
        phone={phone}
      />
    </div>
  )
}

export default FinishedView
