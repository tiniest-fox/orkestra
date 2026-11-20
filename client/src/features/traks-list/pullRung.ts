/**
 * What the forge says about a finished trak's branch, as the one thing the row is drawn
 * from: the pile it sits in, the glyph it wears, the words beside it, and whether the
 * plate's edge moves.
 *
 * **Every rung names what is stopping the merge, or says nothing is.** That is the whole
 * shape of the ladder and the reason three earlier rungs are gone: *Approved*, *Checks
 * passed* and *Open pull request* each reported a sub-fact and left the reader to work out
 * whether the thing could land. A row answers *what is in the way*, and the bottom rung
 * answers it with *nothing*.
 *
 * **One ordered ladder, first match wins, and one return value.** The pile, the mark, the
 * phrase and the motion come out together because a row filed under *Merged* wearing a
 * hollow open circle is what four separate switches over one answer produce the first time
 * one of them grows a case the others do not. `sectionOf` and `stateIcon` take a `Rung` and
 * read a field off it; neither asks the forge's answer anything of its own.
 *
 * **A draft sits above every other rung**, because every lower one is moot until it is
 * marked ready: a draft is precisely a pull request that cannot be merged, whatever its
 * checks say.
 *
 * **Every wire union the ladder reads is matched exhaustively, and the fall-throughs are
 * written down.** A positive test on a literal — `merging === "conflicting"` — makes the
 * bottom rung the destination of *everything nobody enumerated*, so a value meaning
 * *nothing is known* arrives at the pile whose header counts what a person can land, and a
 * literal either union grows arrives there too with nothing failing. That is how
 * `merging: "unknown"` came to read *Ready to merge*. So each reader below is a `switch`
 * with a case for every member, and `noImplicitReturns` is what makes a missing one a
 * compile error.
 *
 * **A field the ladder reads at two heights gets two exhaustive switches**, which is the
 * point rather than a duplication: `merging` is read as a refusal near the top and as an
 * absence at the foot, `decision` as an objection and as a wait. A fifth literal is then a
 * compile error at *both* altitudes, so placing it is a decision at each rather than a
 * silent fall to the bottom from the one nobody edited.
 *
 * **`bad` is a rule rather than three separate picks: it is exactly the rungs that mean
 * *this is not going in as it stands*** — a conflict, a reviewer's no, a failing check.
 * Everything else still open is `waiting` or `neutral`, and `good` is the merged rung's
 * alone: the work is in and nothing is owed but the press. The app's other `good` is a
 * finished trak with nothing to merge, which never reaches this ladder because its branch
 * is never asked about.
 *
 * **These words are a row's, and the pane's sentences are the pane's — but they say the
 * same thing about the same field.** A row's phrase is three or four words in `text-2xs`
 * beside a truncating title — *Conflicts*, where `trak-detail/pull-request/pullRequest.ts` says *GitHub
 * sees conflicts to resolve* under a heading that has room for it, and *Not worked out
 * yet* where it says *GitHub has not worked it out yet*. Each reader below names the pane's
 * sentence for the field it reads, because the two surfaces are one click apart and the
 * words are the only part of them that is not read off one table.
 *
 * **A branch the forge said nothing about is three different facts, and this file's job is
 * that no two of them draw the same row.**
 *
 *   - *There is no pull request* — the forge was asked about this branch by name and
 *     answered that it has none, which arrives as an entry with nothing in it. **No
 *     rung**: the row is filed by `Finished` alone, which for a branch that was asked
 *     about — so one something was committed to — is *Ready to merge* under the flag, and
 *     that is the true answer. Nothing is stopping it, exactly as the bottom
 *     rung says of an open one with nothing wrong, and the two sitting together
 *     indistinguishable is right rather than a collision.
 *   - *We could not ask* — the forge was unreachable, or this branch was never in the
 *     question and so has no entry at all. `UNASKED`, which says so in its own words under
 *     its own mark, in a pile of its own. It is **not** the bottom rung, and that is the
 *     whole point: a `gh` that is not installed used to file every finished trak under
 *     *Ready to merge*, which is a verdict about somebody's work arrived at from an
 *     inability to look at it.
 *   - *Nothing has come back yet* — `ASKING`, and see it for why it is no longer the
 *     second of these.
 *
 * **A project with no `origin` is none of the three.** The engine answers the listing
 * `NoOrigin` without asking any forge, and every finished branch gets no rung, as one with
 * no pull request does: it is merged here or not at all.
 *
 * **Every answer is read through one store, at exactly the two places above that say *the
 * forge answered*.** `forgeMemory` holds the freshest thing known about each branch — the
 * list's live answer, a carried one, an open trak page's own read, and whatever survived a
 * reload, newest winning per branch. So a reloaded page draws the verdicts it was drawing
 * a moment ago rather than four rows of *we could not ask*, and a card somebody just
 * looked at is what its row says. Nothing about the row says which answer it came from: a
 * verdict a minute old and one from before the reload are the same claim, and the hour
 * bounding the store is what makes that true rather than a hope.
 */

import type { ForgeListingDto, PullRequestSummaryDto, TrakSummaryDto } from "../../api/types"
import type { ForgeMemory } from "../../forgeMemory"
import type { Tone } from "../../format/tone"
import type { SectionKey } from "./sections"
import type { IconName } from "./stateIcon"

/** One rung of the ladder: everything a row says about its pull request, decided once. */
export interface Rung {
  readonly section: SectionKey
  readonly icon: IconName
  readonly label: string
  readonly tone: Tone
  /**
   * Whether the segment travels the plate's edge. It is the rung's rather than the
   * state's, because a `Finished` trak is never mid-turn and the forge's checks are the
   * only thing that can be in flight on one — *something is happening* said the same way
   * whether the checks are Orkestra's or GitHub's.
   */
  readonly running: boolean
  /**
   * The forge has said the branch is not in. True of every rung read off a pull request
   * that has not merged — *Ready to merge* included, because a branch with nothing in its
   * way is still out — and false of the merged rung. **False too of `UNASKED` and
   * `ASKING`**, which say nothing about the branch: the one reader of this field is a wait
   * on the branch going in (`waitingRow`), which yields the row to the pull request only
   * on a forge that has spoken, so a forge nobody could reach leaves the row where it was.
   */
  readonly unmerged: boolean
}

/** The answers a list has in hand, by trak id. Absent means no rung — see the header. */
export type Rungs = ReadonlyMap<string, Rung>

const rung = (
  section: SectionKey,
  icon: IconName,
  label: string,
  tone: Tone,
  running = false,
): Rung => ({ section, icon, label, tone, running, unmerged: true })

/** The same rung, for the three answers that do not say the branch is out — `Rung.unmerged`. */
const notOut = (r: Rung): Rung => ({ ...r, unmerged: false })

/**
 * The forge could not be asked about this branch — **a rung, and deliberately not the
 * bottom one.**
 *
 * `unplug` is the same mark the page wears when the engine itself cannot be reached, and
 * that is the reuse rather than a collision: it means *not connected to the thing that
 * would know*, at both scales. It sits outside the three families for `flag`'s reason —
 * it is not a fact about the branch at all.
 *
 * `neutral`, because nothing has gone wrong with the work. The pile is what keeps
 * *Ready to merge*'s count honest: a row nobody could vouch for is not one you can land.
 */
export const UNASKED: Rung = notOut(rung("finished", "unplug", "Could not ask GitHub", "neutral"))

/**
 * Nothing has come back about this branch yet — **a rung of its own, and this file's
 * fourth answer.**
 *
 * It used to be `UNASKED`, on the argument that an answer still in flight and a forge that
 * could not be reached license exactly the same nothing. They do, and that turned out not
 * to be the question: one of them lasts the length of a `gh` call and the other is how the
 * row reads for as long as the tab is open, and drawing an unplug mark and the words *Could
 * not ask GitHub* for the first is an assertion about somebody's tooling made while we are
 * still asking. What made that survivable was the gap being rare, and it was not — every
 * reload of the page was one.
 *
 * **It is still not the bottom rung**, which is the part of the old argument that stands: a
 * row nobody has vouched for yet is not one you can land, so it stays out of the count
 * under *Ready to merge*.
 *
 * `circleDashed` is `unsettled`'s mark at the other scale and means the same thing —
 * nothing has settled here yet — and it is `Preparing`'s for the same reason. `neutral`,
 * because nothing has gone wrong. **Not `running`**: the thing in flight is our own fetch,
 * and the travelling edge is reserved for work happening on the branch.
 *
 * Filed under `finished` beside `UNASKED`, because what is known of the trak is exactly
 * what was known before this list could ask anything.
 */
export const ASKING: Rung = notOut(rung("finished", "circleDashed", "Asking GitHub…", "neutral"))

/**
 * Whether the forge says this row's branch went in, for Archive's confirmation:
 * `archiveScope` words a known answer either way and `undefined` neutrally.
 *
 * **No rung is an answer** — the forge has no pull request on the branch, or there is no
 * `origin` — so it is `false`, as is every rung that says the branch is out. `UNASKED` and
 * `ASKING` say nothing about the branch, so they are `undefined`: reading them as `false`
 * told a merged trak its work would go.
 */
export const rungMerged = (said: Rung | undefined): boolean | undefined =>
  said === undefined || said.unmerged ? false : said.section === "merged" ? true : undefined

type State = PullRequestSummaryDto["state"]
type Merging = PullRequestSummaryDto["merging"]
type Decision = PullRequestSummaryDto["decision"]
type Checks = PullRequestSummaryDto["checks"]

/**
 * Where the pull request stands, for the two states that end it.
 *
 * A merged one files into the MERGED chore pile — the work is in, the checkout is
 * still here, and the row's words carry both halves so it cannot be mistaken for
 * the archived `Merged` state's row one pile down.
 *
 * A pull request closed without being merged is filed under *Has issues* rather than in
 * the `archived` pile: that one means the trak was put away and draws no rows, and work
 * whose pull request was rejected is still holding a worktree and still needs a person.
 * Filing it there would lose a held checkout behind a count.
 *
 * **`open` falls through, and it is the ladder's whole remainder** — the pane draws no
 * mergeability at the other two for the same reason (`stateWords`), because the forge
 * keeps answering clean after a merge.
 */
const ending = (state: State): Rung | undefined => {
  switch (state) {
    case "merged":
      return notOut(rung("merged", "gitMerge", "Merged — checkout still here", "good"))
    case "closed":
      return rung("issues", "gitPullRequestClosed", "Closed without merging", "neutral")
    case "open":
      return undefined
  }
}

const DRAFT: Rung = rung("review", "gitPullRequestDraft", "Draft", "neutral")

/** Above every other rung: every lower one is moot until it is marked ready. */
const drafted = (isDraft: boolean): Rung | undefined => (isDraft ? DRAFT : undefined)

/**
 * The forge refusing to merge it as it stands — its two ways of doing so.
 *
 * **The two fall-throughs are deliberate and they are not the same kind of deliberate.**
 * `clean` is an answer: the forge would let this through, so the rungs below get to speak,
 * and the pane words it *No conflicts, and up to date with its base* for the same reason.
 * `unknown` is the *absence* of an answer and is read at the foot of the ladder by
 * `unsettled` — a reviewer's no and a failing check are things we do know, and either is a
 * better answer to *what is in the way* than *nobody has worked it out*.
 */
const refusal = (merging: Merging): Rung | undefined => {
  switch (merging) {
    // The pane: *GitHub sees conflicts to resolve*.
    case "conflicting":
      return rung("issues", "unlink", "Conflicts", "bad")
    // The pane: *The branch is behind its base*. The forge reports this only where it is
    // actually refusing for that reason, which is what makes it a refusal rather than a
    // remark about how old the branch is.
    case "behind":
      return rung("issues", "history", "Behind the base", "waiting")
    case "clean":
    case "unknown":
      return undefined
  }
}

/**
 * A reviewer's no.
 *
 * Three fall through and none of them is in the way. `approved` is a reviewer's yes, and
 * *Approved* was a rung once and was deleted: it reports a sub-fact rather than a blocker.
 * `commented` is words without a verdict, which the pane also draws `neutral`. Absent is
 * the forge saying nobody has reviewed and nobody has to — *no decision* rather than a
 * verdict of none. `reviewRequired` falls through here and is caught below.
 */
const objection = (decision: Decision): Rung | undefined => {
  switch (decision) {
    // The pane: *Changes requested*, which it tones `waiting` where a row tones it `bad`.
    // The row's is the settled one — `bad` is exactly the rungs that mean this is not
    // going in as it stands, and a reviewer's no is one of the three.
    case "changesRequested":
      return rung("issues", "triangleAlert", "Changes requested", "bad")
    case "approved":
    case "commented":
    case "reviewRequired":
    case undefined:
      return undefined
  }
}

/**
 * The forge's rollup over the head commit, in one word.
 *
 * `passed` falls through because a green run is not in the way. **`none` and `unknown` fall
 * through too, and they are the two worth naming: neither is a pass and neither is a
 * failure.** A commit nothing ran against is `none` — most of them, early on — and a
 * rollup word this build does not recognise is `unknown`. Reading either as a verdict
 * would turn a thing we cannot tell into one we can, which is what `verdictWord` already
 * refuses to do with the pane's per-check `unknown`.
 *
 * **`unknown` reaching the bottom rung is the one fall-through here that is a judgement
 * rather than an obvious call**, and it rests on it being unreachable: every member of the
 * forge's rollup enum is mapped in `vcs/logic/forge-answer.ts`, so producing one takes a
 * forge that has grown a sixth. When that happens it wants a rung beside `unsettled`, and
 * this switch is where the reader will be standing.
 */
const checkRollup = (checks: Checks): Rung | undefined => {
  switch (checks) {
    case "failed":
      return rung("issues", "shieldX", "Checks failing", "bad")
    case "running":
      return rung("review", "shield", "Checks running", "working", true)
    case "passed":
    case "none":
    case "unknown":
      return undefined
  }
}

/**
 * The forge waiting for somebody to look, which is a blocker like any other — it will not
 * merge until a review arrives. The pane: *Review required*.
 *
 * The second exhaustive switch over `decision`, at the height it belongs to. See the
 * header for why both are exhaustive rather than this one testing the literal it wants.
 */
const awaitingReview = (decision: Decision): Rung | undefined => {
  switch (decision) {
    case "reviewRequired":
      return rung("review", "triangle", "Waiting on review", "waiting")
    case "approved":
    case "changesRequested":
    case "commented":
    case undefined:
      return undefined
  }
}

/**
 * **The forge has not worked it out yet** — what GitHub answers for a while after every
 * push, computing mergeability lazily, and so the first thing this list hears about nearly
 * every newly-finished trak.
 *
 * **The pile is the point.** This used to fall the length of the ladder to *Ready to
 * merge*, so the header counting what a person can land counted a branch nobody had
 * reached a verdict on, and fifteen seconds later the row could jump to *Has issues*. It
 * is *In review* instead, beside *Checks running* and *Waiting on review*: something is
 * still being worked out, it is not ours and it is not yours.
 *
 * **At the foot rather than beside the two refusals**, because a reviewer's no and a
 * failing check are things we know, and either is a better answer to *what is in the way*.
 * A freshly pushed branch whose checks are running says *Checks running*, which is the
 * more useful of two true things.
 *
 * The words are the pane's own, shortened to a row: `mergingWords` says *GitHub has not
 * worked it out yet* about this field, `neutral`, one click away.
 *
 * `circleDashed` sits outside the three families with `flag` and `unplug` — a mergeability
 * nobody has computed is not a fact about the branch, the checks or a person. It is
 * `Preparing`'s mark, meaning the same thing at the other scale: nothing has settled here
 * yet.
 */
const unsettled = (merging: Merging): Rung | undefined => {
  switch (merging) {
    case "unknown":
      return rung("review", "circleDashed", "Not worked out yet", "neutral")
    case "conflicting":
    case "behind":
    case "clean":
      return undefined
  }
}

/**
 * Nothing is in the way.
 *
 * It has to be the row a finished trak with no pull request at all draws, which
 * `sectionOf`, `stateIcon` and `trakLabel` each produce without consulting this — the two
 * sitting together indistinguishable is the answer being right rather than a collision.
 */
const READY: Rung = rung("ready", "flag", "Ready to merge", "waiting")

/**
 * Which rung — total, because it is only ever handed a pull request the forge named.
 *
 * **The chain is the ladder, read top to bottom.** First reader that answers wins, and
 * `READY` is what is left when none of them does.
 */
export const pullRung = (pull: PullRequestSummaryDto): Rung =>
  ending(pull.state) ??
  drafted(pull.isDraft) ??
  refusal(pull.merging) ??
  objection(pull.decision) ??
  checkRollup(pull.checks) ??
  awaitingReview(pull.decision) ??
  unsettled(pull.merging) ??
  READY

/**
 * Which branches the forge is asked about — **the question itself, and the gate.**
 *
 * The engine asks about branches by name rather than about the repository, so this is
 * what goes on the wire and what keys the answer. Empty is the gate: one call is cheap
 * where N were not, but it is not free — a `gh` process every fifteen seconds for as long
 * as the tab is open — and a list of work still in flight has nothing a pull request could
 * be drawn on.
 *
 * **`state._tag` and `branchMoved`, and nothing derived from either**, for `rungsOf`'s
 * reason: ask about where rows were filed and the answer that moved them is the answer
 * that stops it being asked. Both are fields the wire carries about the trak itself, so
 * neither can be moved by anything this file returns — which a section key or a rung
 * could, and which is what makes them the only two admissible here.
 *
 * **A branch nothing was committed to is not asked about**, because a branch nobody
 * pushed to cannot have a pull request: the question has one possible answer, it costs a
 * per-call bound slot, and letting the empty answer fall through would make the pile such
 * a trak sits in depend on whether `gh` replied.
 *
 * **Sorted and deduplicated, because it is a cache key.** Two renders that produce the
 * same set in a different order would otherwise be two questions, refetching on a render
 * and making the poll interval mean nothing.
 *
 * **It is every finished branch, and `useForgeListing` is what cuts it at the wire's
 * bound.** The cut lives there because the number is the wire package's and a pure module
 * may not hold a wire value — and the sort lives here because it decides *which* branches
 * fall past that cut, which has to be the same set between renders rather than a function
 * of the order the list happened to arrive in. A branch cut off is one the engine never
 * hears about, so it reaches `rungsOf` with no entry and reads *Could not ask GitHub* —
 * the same row a branch past the engine's own bound already draws.
 */
export const forgeBranches = (traks: readonly TrakSummaryDto[]): readonly string[] => {
  const branches = new Set<string>()
  for (const trak of traks) {
    if (trak.state._tag === "Finished" && trak.branchMoved && trak.branch !== undefined)
      branches.add(trak.branch)
  }
  return [...branches].sort()
}

/**
 * Every row's rung, from the one answer the page holds.
 *
 * **`state._tag` and `branchMoved` decide which rows are looked up, and nothing derived
 * does.** File the rows in a pile and then ask about *the rows in that pile* and a trak
 * whose pull request merged leaves it, stops being asked, has its answer collected, falls
 * back and is asked again — a fifteen-second loop that reads as a rendering bug. Nothing
 * this returns may feed back into which traks it reads. That was a hazard of the fan-out
 * and it is a hazard of a lookup for the same reason. Both facts above are the wire's
 * about the trak, so neither can move under an answer this produced.
 *
 * `Finished` alone, because a rung overrides the pile: a trak mid-plan whose branch
 * already has a pull request — a plan can open one before its last step — would otherwise
 * be filed under *In review* while an agent is working in it.
 *
 * **A branch nothing was committed to gets no rung of any kind, `UNASKED` included.** It
 * was not asked about and there is nothing to say: `sectionOf` files it under RESOLVED
 * off its own state, and a rung would override that with a pile about a pull
 * request that cannot exist. This is the one absence below that is neither a claim nor a
 * failure to look.
 *
 * **No rung is a claim, so it is made only where the forge made one.** A trak reaches the
 * `Finished` fallback — the flag, and *Ready to merge* — only where an answer holds an
 * entry for its branch saying there is no pull request. There is no silence available here:
 * a finished trak this returns nothing for is filed `ready` by `sections.ts`, so *saying
 * nothing* and *saying nothing is in the way* are the same row.
 *
 * **The store is the one source of answers, and the live listing is in it like any other
 * query.** `useForgeMemory` folds every forge answer the cache holds — the live listing, a
 * carried one under an older key, an open trak's own read — newest winning per branch, so
 * there is no listing-first branch here to disagree with it. What the listing still
 * supplies separately is its *tag*: `ForgeUnavailable` settles every branch it was asked
 * about at once, and that fact names no branch for the store to file.
 *
 * Every remaining absence is one of the two nothings:
 *
 *   - `UNASKED` — the forge was unavailable; or this branch was not in the question, which
 *     is what a branch past the engine's per-call bound is; or the trak has no branch to
 *     match on. `branch` rides on the worktree and replay never clears one, so nothing
 *     produces a finished trak without it today; the case is here because an absent field
 *     must never be read as an absent pull request.
 *   - `ASKING` — the branch is in the question and no answer naming it has come back.
 *
 * `asked` is what separates those two, and it is the branches this page actually sent
 * rather than every branch on it: cut differently and a row past the bound would say we are
 * still asking about it forever.
 */
export const rungsOf = (
  traks: readonly TrakSummaryDto[],
  /** The list's own answer, read for its tag alone — its entries reach here through the
   *  store, which folds it in beside every other answer the cache holds. */
  listing: ForgeListingDto | undefined,
  /** The branches the page's question names, cut — `askedBranches`. */
  asked: readonly string[],
  /** The freshest answer per branch, from every query in the cache — `useForgeMemory`. */
  memory: ForgeMemory,
): Rungs => {
  const rungs = new Map<string, Rung>()
  // The forge answering *unavailable* is an answer about the whole call, so it settles
  // every branch it was asked about at once — nobody is still asking on its behalf. It is
  // read off the listing rather than the store because it names no branch to file there.
  const unavailable = listing?._tag === "ForgeUnavailable"
  // No `origin` is the engine saying no branch can have a pull request: every finished
  // trak gets no rung, which files it under *Ready to merge* for the local press. It
  // outranks the store, which may still hold what a since-removed remote said.
  const noOrigin = listing?._tag === "NoOrigin"
  const inQuestion = new Set(asked)
  for (const trak of traks) {
    if (trak.state._tag !== "Finished" || !trak.branchMoved || noOrigin) continue
    const branch = trak.branch
    // An entry that is present and empty is the answer *there is none*; a branch with no
    // entry is a branch nothing was said about. Collapsing the two is the failure this
    // whole shape exists to make impossible, so the store distinguishes them by key.
    const said = branch === undefined ? undefined : memory.get(branch)
    if (said !== undefined) {
      if (said.pull !== undefined) rungs.set(trak.id, pullRung(said.pull))
      continue
    }
    const asking = branch !== undefined && inQuestion.has(branch) && !unavailable
    rungs.set(trak.id, asking ? ASKING : UNASKED)
  }
  return rungs
}
