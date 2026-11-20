/**
 * What the list is: twelve sections in a fixed order, each holding the groups a state in
 * it names, newest human touch first — and below them the section's idle groups, newest
 * activity first.
 *
 * **Sections are computed here rather than sent.** Every other reading of a state in
 * this client is an exhaustive switch of its own — `trakLabel`, `rowAction`,
 * `stateIcon` — and a section key on the wire would be a second vocabulary only this
 * list speaks. `sectionOf` is exhaustive for the same reason they are: a state the
 * engine grows is a compile error here rather than a trak that falls out of the list.
 *
 * **A group is placed, never split.** `asTree` runs over the whole list first, so what
 * a section holds is groups: a parent and the pieces it has out, filed together in the
 * furthest-up section any of them is in. One piece at a gate therefore puts the whole
 * group under *Needs you*, and the top section's promise survives it — *everything here
 * needs you* stays literally true, said now of a unit rather than a row. It is the
 * reverse of what this file used to do, which filtered to a section and grouped inside
 * it, and so tore a gated piece out as a row of its own naming the parent it came from.
 *
 * **An empty section is not returned at all**, so nothing downstream draws a header,
 * a rule or the air above one, and the page re-flows as work moves between sections.
 *
 * **Two things override the state, and `waitingRow` says which of them leads.** A finished
 * trak whose pull request the forge has answered for is filed by that answer rather than
 * by `Finished` — `pullRung` decides it, and the switch below stays exhaustive over the
 * wire's states for every trak that has no rung, which is almost all of them. A finished
 * trak resting on an unmet condition is filed under WAITING before either is read
 * (`fileOf`): its plan has a step still to run, so it is not done however its pull request
 * stands, and a row under *Merged* would say the opposite. The forge's answer survives as
 * an aside on the row rather than as the pile. A wait on the deploy files under DEPLOYING
 * instead — a pile of its own above WAITING, because what its rows say is the deploy's
 * answer rather than *held*. The one wait that does not lead is one on the branch going in
 * while the forge says it is out: `merged` and `deployed` cannot pass until the pull
 * request does, so such a row files by the pull request — *Has issues* for its conflicts,
 * *Ready to merge* for the press it is waiting on — and returns to its wait's pile once the
 * forge says merged. `waitFirst` is that rule, and the words and the mark read it too.
 *
 * **Custody is read before either.** A state with a command in flight and nothing carrying
 * it files under *Errors* rather than by its state — `fileOf` says why.
 *
 * **`branchMoved` is not an override and is not a second one.** It splits one state's arm
 * in two rather than replacing the answer: a finished trak that kept nothing on its branch
 * has no merge to be ready for, so it is a different pile with a different question. The
 * forge is never asked about such a branch (`rungsOf`), so the two facts cannot both be in
 * hand for one row.
 */

import type { TrakStateDto, TrakSummaryDto } from "../../api/types"
import { runInterrupted } from "../../format/interrupted"
import type { Tone } from "../../format/tone"
import type { Rung, Rungs } from "./pullRung"
import type { IconName } from "./stateIcon"
import { activeOf, idleOf, newestOf } from "./idle"
import { asTree, type TrakRow } from "./tree"
import { onDeploy, waitFirst } from "./waitingRow"

export type SectionKey =
  | "attention"
  | "progress"
  | "deploying"
  | "waiting"
  | "ready"
  | "review"
  | "issues"
  | "finished"
  | "resolved"
  | "errors"
  | "merged"
  | "archived"

/**
 * Top to bottom: what needs you, what is running, what is held, what broke, then work
 * that has run its plan out in the order it is asked about — what you can land, what is
 * still out, what is stuck, and what nobody could ask about — then the two piles waiting
 * on the one press, and the archive.
 *
 * **`waiting` sits with the piles about now, under `progress`.** A trak held behind a
 * condition owes nobody anything and is about to do something on its own, which is what
 * *In progress* says of its rows too — the difference is only that nothing is running this
 * second. It sits above `errors` because it needs no press, where every failed row does.
 *
 * **`deploying` sits above it, and it is the same kind of pile with a better answer.** A
 * trak waiting on its deploy is held like any other, and the row can say what the deploy
 * said — which the person chose to read as a section of its own rather than a mark on a
 * row under *Waiting*, from the moment the wait starts. A deploy that failed
 * stays here in red rather than moving to *Has issues*: it is still the deploy wait it was,
 * and nothing about the branch is wrong.
 *
 * **`errors` sits above the four piles the forge decides.** Every failed row offers
 * `Retry`, which is a person's to press — the same kind of owed as a gate, and not the
 * kind any pile below it holds. It also keeps a failure out from under the hold: while
 * GitHub is being asked, `ForgeHold`'s block stands where the four piles will be, and an
 * `errors` below them would put the one section carrying something broken beneath a band
 * of grey on every first load.
 *
 * **Three piles rather than one, and rather than two.** Sweeping *Checks running* and
 * *Waiting on review* in with the landable work was tried and is dishonest: the header
 * counts six things as ready when four are. `review` is what makes `ready`'s count true.
 *
 * **`finished` is the fourth of them and it is the pre-forge world**, which is why it
 * carries the plain word: it holds the finished traks the forge could not be asked about
 * and the ones nothing has come back for yet, so what is known of them is exactly what was
 * known before this list could ask anything.
 * It sits *after* the three the forge classified, because it is the pile that says less
 * rather than a stage before them — and on a machine with no `gh` it is the only one of
 * the four that ever draws, which puts the finished work back where it used to be.
 *
 * **`resolved` is the fifth of them and it is outside the ladder entirely**: the forge is
 * never asked about a branch nothing was committed to, because a branch nobody pushed to
 * cannot have a pull request. So it sits below all four rather than among them — the four
 * above are degrees of *what is stopping the merge*, and this one has no merge to stop.
 * Its header names what is true of the work rather than the press, because the press —
 * Archive — is the same one every finished pile offers.
 *
 * **`merged` is the sixth, and it is a chore pile rather than an ending**: `Finished`,
 * branch moved, and the forge says the pull request merged. The work is in; the checkout
 * is still here, waiting for the one press. It sits under `resolved` and above the tail.
 *
 * **`archived` is the tail** — the `Merged`, `Closed` and `Abandoned` states in one pile,
 * and the two states on the way to them. Three endings, one pile: the log keeps them apart
 * because the corpus is worth less without the distinction, and the list draws them
 * together because every one of them is put away and the answer to *who is this waiting
 * on* is nobody. `Closing` and `Abandoning` file here too, because the press has been
 * made: the trak is being put away, nobody is owed anything by it, and a row that went
 * *up* the page under *In progress* for the seconds an archive takes read as work
 * starting. A failed archive is `Failed` like any other failure and files under `errors`.
 *
 * **No row ever reaches this pile.** The engine holds the same five states as its
 * archived set (`archived` in `workflow/domain/trak.ts`) and sends a count in place of
 * their rows, so the section here is never filed and the tail is drawn from that count
 * alone — `ArchivedHeader`, with nothing under it. The key stays so the switch over the
 * states is total.
 */
export const SECTION_ORDER: readonly SectionKey[] = [
  "attention",
  "progress",
  "deploying",
  "waiting",
  "errors",
  "ready",
  "review",
  "issues",
  "finished",
  "resolved",
  "merged",
  "archived",
]

export const SECTION_TITLE: Record<SectionKey, string> = {
  attention: "Needs you",
  progress: "In progress",
  deploying: "Waiting on deploy",
  waiting: "Waiting",
  ready: "Ready to merge",
  review: "In review",
  issues: "Has issues",
  finished: "Finished",
  resolved: "Resolved",
  errors: "Errors",
  merged: "Merged",
  archived: "Archived",
}

/**
 * The tone of the *question a section answers*, not of any row in it — `progress`
 * holds eleven states that are all `working`, but `archived` holds three endings that
 * differ, beside two archives still running, and `attention` holds five gates that do
 * not.
 *
 * `review` is `neutral` rather than `working`: what is in flight there is the forge's,
 * not the engine's, and a `working` header over rows Orkestra is doing nothing about
 * would be the list claiming custody it does not have.
 *
 * `finished` is `waiting` like `ready`, because the question it answers is the same one —
 * a finished trak is holding a checkout and a person owes it something. It is not `bad`:
 * a forge nobody could reach is not a fault in the work under the header.
 *
 * `waiting` the section is `working` the tone, and the two words colliding is the point:
 * the tone named `waiting` means a person owes an action, and nobody owes a held trak
 * anything — the engine will run its step when the condition is met. Amber there would
 * be the list's top promise made of a row nobody has to touch. `deploying` is `working`
 * for the same reason, and its header wears a rocket rather than a tone of its own — a
 * failed deploy under it is red on the row, never on the lid.
 *
 * **`resolved` and `merged` are `good` and they are the page's two greens**, which is the
 * one place this map departs from *who is this waiting on*. The rows under both are still
 * holding checkouts and still owe you a press, so `waiting` is what the rule would say —
 * and it would put amber piles of completed work beside an amber pile of work that has yet
 * to land, with nothing between them but the words. There is no decision left under either
 * header: the work is in, or there was nothing to land, and the one press left is Archive.
 * See `trakLabel`, which tones the resolved rows the same way.
 */
export const SECTION_TONE: Record<SectionKey, Tone> = {
  attention: "waiting",
  progress: "working",
  deploying: "working",
  waiting: "working",
  ready: "waiting",
  review: "neutral",
  issues: "bad",
  finished: "waiting",
  resolved: "good",
  errors: "bad",
  merged: "good",
  archived: "neutral",
}

/**
 * The mark a section's header wears beside its title, where one does. Only the deploy
 * pile has one — the rocket the person chose for it — and a `Record` rather than a set so
 * that a new section has to say it wears none.
 */
export const SECTION_GLYPH: Record<SectionKey, IconName | undefined> = {
  attention: undefined,
  progress: undefined,
  deploying: "rocket",
  waiting: undefined,
  ready: undefined,
  review: undefined,
  issues: undefined,
  finished: undefined,
  resolved: undefined,
  errors: undefined,
  merged: undefined,
  archived: undefined,
}

/**
 * Which sections open shut on first paint. Every section has a lid, and every one
 * starts open.
 *
 * `merged` is open despite holding endings on the forge's side, because its rows still
 * owe a press. The archive is not a lid at all — nothing is under its header to fold,
 * so its entry here is never read. A `Record` rather than a set of the shut ones, so a
 * new section is a compile error here rather than a section nobody decided a default
 * for.
 */
export const SECTION_SHUT: Record<SectionKey, boolean> = {
  attention: false,
  progress: false,
  deploying: false,
  waiting: false,
  ready: false,
  review: false,
  issues: false,
  finished: false,
  resolved: false,
  errors: false,
  merged: false,
  archived: false,
}

/**
 * A finished trak with no rung goes to `ready`, which is the same place the ladder's
 * bottom rung puts an open pull request with nothing stopping it — and it wears the same
 * flag and the same words, from `stateIcon` and `trakLabel`. The piles that replaced
 * *Finished* are a claim about what is in the way, and *nothing* is a true answer for a
 * branch nobody opened a pull request for.
 *
 * **That is why a forge nobody could reach must not arrive here as an absence.** It has a
 * rung of its own — `pullRung`'s `UNASKED` — filed under `finished`, because this line
 * would otherwise turn *we could not look* into *nothing is stopping it*. The switch below
 * never sees the difference; the map it is given is where it is made. `ASKING` is the same
 * argument for a branch nothing has come back for yet, and lands in the same pile.
 *
 * These three sit outside `attention` rather than in it, which is the one place this map
 * is a judgement: a finished trak is `waiting`-toned and offers `Archive`, so it is
 * waiting on a person too — and the top section is therefore not *quite* everything that
 * is.
 *
 * **A branch nothing was committed to goes to `resolved` instead, and it never has a rung
 * to be overridden by** — `rungsOf` does not ask the forge about one, so the early return
 * above cannot fire for it. The two are read in that order anyway rather than the other
 * way round: the rung is the answer of the two that is a *claim*, and if one ever did
 * arrive for such a branch it would mean the skip had failed and the pile should say so.
 */
export const sectionOf = (
  state: TrakStateDto,
  /** `TrakSummaryDto.branchMoved` — whether anything was kept on this trak's branch. */
  branchMoved: boolean,
  rung?: Rung,
): SectionKey => {
  if (rung !== undefined) return rung.section
  switch (state._tag) {
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "AwaitingHuman":
      return "attention"
    case "Preparing":
    case "Composing":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    // `Merging` stays here rather than going down with `Closing`: a merge is a landing
    // rather than a putting-away, it writes to the host's own branch, and the trak
    // enters `Closing` when it is done — which is when it moves under the archive.
    case "Merging":
      return "progress"
    case "Finished":
      return branchMoved ? "ready" : "resolved"
    // A failed archive lands here with every other failure — `decide` settles a git
    // error in `Closing` or `Abandoning` as `Failed{archive}` — so a trak that moved
    // under the archive the moment the press landed comes back out to `Retry`.
    case "Failed":
      return "errors"
    // The three endings are one pile. The states stay three on the log — the
    // corpus tells them apart, and a parent reads a child's ending as
    // landed-or-dropped — but every one of them is put away, and that is the
    // whole of what the pile says. The MERGED pile is the rung's, not a state's:
    // a `Finished` trak whose pull request the forge says merged is filed there
    // by the override above.
    //
    // The two archives in flight file with the endings they are about to be: a
    // person who pressed Archive is owed nothing more by the row, and *In progress*
    // would move it up the page to say something was starting.
    //
    // These five are the engine's archived set, and it sends no row for any of them.
    // A state added here and not there is a row the engine keeps sending under a
    // header that never draws it.
    case "Abandoning":
    case "Closing":
    case "Merged":
    case "Closed":
    case "Abandoned":
      return "archived"
  }
}

export interface Section {
  readonly key: SectionKey
  /** Never empty: `asSections` drops a section with nothing in it. */
  readonly rows: readonly TrakRow[]
}

/** The one of two sections that is nearer the top of the page. */
const higher = (a: SectionKey, b: SectionKey): SectionKey =>
  SECTION_ORDER.indexOf(a) <= SECTION_ORDER.indexOf(b) ? a : b

/**
 * Where one member goes: the wait where it leads — the deploy's pile where the wait is
 * `deployed`, and WAITING for any other — then the rung, then the state.
 *
 * Read here rather than inside `sectionOf`, so that switch stays a fact about the state and
 * the rung alone: `waiting` is on the wire at `Finished` and nowhere else, and it is the
 * one fact that files a row against what both of the others say. `waitFirst` and
 * `onDeploy` are the same reads the row's words and mark come off, so a row cannot say
 * *Not live yet* under *Waiting*, or wear the dashed ring under *Has issues*.
 *
 * **Nothing here reaches `rungsOf` or `forgeBranches`.** Both read `state._tag` and
 * `branchMoved` alone, so a pile a rung moved a row into can never decide whether that
 * row's branch is asked about — the loop that would otherwise flip a merged row every poll.
 *
 * **An interrupted trak files under *Errors*, ahead of all three.** Its state still names
 * the command that was in flight, so `sectionOf` alone would put it under *In progress* —
 * but nothing is carrying it, and it waits on a person pressing Resume as a failure waits
 * on Restart. `runInterrupted` is the detail page's own reading, so the row's pile and the
 * page's stopped notice cannot disagree.
 */
export const fileOf = (member: TrakSummaryDto, rung: Rung | undefined): SectionKey => {
  if (runInterrupted(member.state, member.running)) return "errors"
  if (!waitFirst(member, rung)) return sectionOf(member.state, member.branchMoved, rung)
  return onDeploy(member) ? "deploying" : "waiting"
}

/**
 * The engine's *at rest*: `Finished`, `Closed`, `Merged`, `Abandoned` — genuinely over,
 * as against merely stopped. `Failed` is not one: a failed trak is picked back up.
 *
 * Exhaustive, for `stillOut`'s reason and `sectionOf`'s: a state the engine grows would
 * otherwise default to *not at rest*, and a parent at a fifth ending would go back to
 * being placed by whatever ghost its band holds.
 */
const atRest = (state: TrakStateDto): boolean => {
  switch (state._tag) {
    case "Finished":
    case "Closed":
    case "Merged":
    case "Abandoned":
      return true
    case "Preparing":
    case "Composing":
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "AgentWorking":
    case "Stopping":
    case "CheckRunning":
    case "AwaitingHuman":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
    case "ConditionRunning":
    case "Integrating":
    case "Abandoning":
    case "Merging":
    case "Closing":
    case "Failed":
      return false
  }
}

/**
 * Where a group goes: the furthest-up section any member is in, the parent counting as a
 * member like any other — while the parent is still going. **A parent at rest files on
 * its own state**, whatever its band holds: a parent reaches the end of its plan only
 * once every piece has landed, so a piece still drawn under one is a child whose log has
 * come to say something else since — an ending that replays as `Failed` under today's
 * engine, say — and it must not drag a finished trak up into *Errors*. The piece stays on
 * the band, where its own menu can archive it.
 *
 * **`SECTION_ORDER` read literally**, which is the one place this rule bites: a parent
 * that `Failed` with one piece at `Finished` files under *Errors*, because `errors` sits
 * above `ready`. Filing it under *Finished* would read as right — the head wears its own
 * red plate and its `Retry` wherever the group is filed — and a second order constant for
 * groups alone would be two orders on one page.
 *
 * Splitting the finished work into three piles extends that rather than changing it: a
 * group holding one landable piece and one conflicting one files under *Ready to merge*,
 * so the count on that header is of groups you could act on rather than of branches with
 * nothing wrong. The piece's own red plate on the band is what says the rest.
 *
 * **The members are the ones on the page**, so a landed piece — off the band and off the
 * list — cannot place anything. Counting one would let a `Closed` parent whose piece
 * merged file under *Merged*, which is a group filed by work that is no longer out.
 *
 * Exported for the hold (`hold.ts`), which reads a group's pile to decide whether the
 * forge is still being waited on — the same placement, so the two cannot disagree about
 * where a group would land.
 */
export const placementOf = (row: TrakRow, rungs: Rungs): SectionKey => {
  const own = fileOf(row.trak, rungs.get(row.trak.id))
  if (atRest(row.trak.state)) return own
  return row.band.reduce<SectionKey>(
    (key, piece) => higher(key, fileOf(piece, rungs.get(piece.id))),
    own,
  )
}

/**
 * Newest first, and a group nobody has measured last.
 *
 * Absent means *we do not know when*, so it sorts to the bottom rather than to either
 * end of time — a log written before events carried `at` would otherwise take the top
 * of `Needs you`, which is the engine asserting something it cannot. Among themselves
 * they keep the order the store handed over, which `Array#sort`'s stability is what
 * buys.
 */
const newestFirst =
  (read: (row: TrakRow) => number | undefined) =>
  (a: TrakRow, b: TrakRow): number => {
    const left = read(a)
    const right = read(b)
    if (left === right) return 0
    if (left === undefined) return 1
    if (right === undefined) return -1
    return right - left
  }

/**
 * Live groups by the newest human touch anywhere in them — the group is the unit, so the
 * touch is too: on the parent's own `touched`, a group pulled into *Needs you* by a piece
 * answered a minute ago would sort by a parent touch hours old.
 */
const byTouch = newestFirst((row) => newestOf(row, (member) => member.touched))

/** Idle groups by when anything last happened to them, which is the age their row shows. */
const byActive = newestFirst(activeOf)

/** `rungs` is required rather than defaulted: an empty map placed every row by its state
 *  alone, which is precisely the behaviour this change exists to replace and precisely
 *  the one a forgotten argument would restore without failing anything. */
export const asSections = (traks: readonly TrakSummaryDto[], rungs: Rungs): readonly Section[] => {
  // Grouped once, over everything, and then placed — not filtered per section and
  // grouped inside each. Two passes that had to agree about a group's members are what
  // let a piece come out as a row of its own.
  const groups = asTree(traks)
  const sections: Section[] = []
  for (const key of SECTION_ORDER) {
    const placed = groups.filter((row) => placementOf(row, rungs) === key)
    if (placed.length === 0) continue
    // Idle groups sink to the foot of the section they file in rather than into one of
    // their own: an idle gate still sits with the gates, so nothing waiting on you leaves
    // *Needs you*.
    const live = placed.filter((row) => !idleOf(row)).sort(byTouch)
    const idle = placed.filter(idleOf).sort(byActive)
    sections.push({ key, rows: [...live, ...idle] })
  }
  return sections
}
