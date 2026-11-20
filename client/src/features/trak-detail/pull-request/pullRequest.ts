/**
 * What the finished pane says about the forge's answer, and what a ticked thing becomes.
 *
 * **Three sections, three states, and nothing that adds them up.** Checks, Review and Merging
 * each own their own words, and there is deliberately no headline, sentence or verdict over the
 * three. It is the rule every function here is written under. Which is also why `mergingWords`
 * is careful: *clean* absorbs the forge's `BLOCKED` and `UNSTABLE`, which are the other two
 * sections' business, so the words for it say what that section knows — no conflicts, not
 * behind — and never that the merge is unblocked.
 *
 * **Mergeability is drawn only while the pull request is open.** The forge keeps answering
 * clean after a merge, so `stateWords` is what a closed or merged one gets instead: drawing
 * mergeability there says *ready to merge* about work already in.
 *
 * **A pick is built here and drawn and sent from one value.** `Picked` carries the line in
 * the box at the foot and the block that reaches the composer, so what a reader removed and
 * what stops being sent cannot come apart — `reentryBody` carries the rest of that argument.
 */

import type { LucideIcon } from "lucide-react"
import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from "lucide-react"
import type {
  PullRequestCheckDto,
  PullRequestCommentDto,
  PullRequestDto,
  PullRequestFoundDto,
  PullRequestSummaryDto,
  ReviewDto,
  ReviewThreadDto,
} from "../../../api/types"
import type { Remembered } from "../../../forgeMemory"
import { elapsedText } from "../../../format/activity"
import type { Tone } from "../../../format/tone"
import type { Picked } from "./picks/reentryBody"

/** A section's own state: the words it says about itself, and how it is going. */
export interface Verdict {
  readonly text: string
  readonly tone: Tone
}

/**
 * The one member anything draws, or `undefined` at the three that draw nothing.
 *
 * **It does not decide the local Merge press, and its three absences are not one case to
 * the things that read it.** `cardOf` tells them apart — *there is none* and *we could not
 * ask* go on offering the press, nothing-in-hand withholds it — and `standingOf` reads the
 * words above the card off that same branch. This is one of the two reads those two are
 * built out of, so a third reader of it beside them is the drift they exist to prevent:
 * `PullRequestPane` is the one, and its reason is the rows, which only the whole answer
 * carries.
 */
export const pullRequestFound = (
  pull: PullRequestDto | undefined,
): PullRequestFoundDto | undefined => (pull?._tag === "PullRequest" ? pull : undefined)

// ============================================================================
// What is in hand, and what the card is drawn from
// ============================================================================

/**
 * Everything the pane knows about the forge at this moment — `usePullRequest` composes it,
 * and nothing below reaches for a second opinion.
 *
 * **Two answers, and the coarse one is only ever a floor.** `pull` is this pane's own read
 * about this branch, whole. `row` is the freshest coarse answer the browser holds for the
 * same branch — the traks list's, a remembered one, or a projection of this pane's own
 * earlier read, whichever is newest — and it exists so the card's head can be drawn on the
 * frame the page paints rather than a `gh` call later.
 */
export interface Forge {
  /** The forge's whole answer, or `undefined` while none is in hand. */
  readonly pull: PullRequestDto | undefined
  /** What the list's answer says about this branch — the head and three verdicts, no rows. */
  readonly row: Remembered | undefined
  /** When whatever is in hand was got. Absent while nothing is. */
  readonly at: number | undefined
  /** Whether a fresh answer has arrived since this page was opened. */
  readonly confirmed: boolean
  /** Whether a fetch is out right now, confirmed or not. */
  readonly fetching: boolean
}

/**
 * Which of the four cards this is — **asked once, because two readers act on it and they
 * must not disagree.** The pane draws from it and `FinishedView` withholds the local Merge
 * press on it, and a version of that question answered twice is a card with a merge button
 * under it.
 *
 * | | |
 * |---|---|
 * | `whole` | the answer is in hand, every row of it. It may still be one nobody has confirmed this session |
 * | `row` | the list's coarse answer says there is a pull request; the detail is on its way, or could not be asked |
 * | `none` | an answer says there is no pull request or no `origin`, or that we could not ask and no row says there is one. Nothing is drawn and the local Merge press is offered |
 * | `checking` | nothing is in hand. A strip stands where the head will be, and Merge is withheld |
 *
 * **`checking` withholds Merge and `none` offers it, and the difference is the point.**
 * Offering a merge and taking it away a second later is worse than not offering it for a
 * second; but *we could not ask* must go on offering it, or a machine with no `gh` loses
 * local merging altogether — `ForgeUnavailableDto` carries that argument.
 */
export type Card = "whole" | "row" | "none" | "checking"

export const cardOf = (forge: Forge): Card => {
  if (pullRequestFound(forge.pull) !== undefined) return "whole"
  // The forge said there is none, or there is no `origin` to hold one, and nothing older
  // outranks that.
  if (forge.pull?._tag === "NoPullRequest" || forge.pull?._tag === "NoOrigin") return "none"
  // Nothing in hand, or the detailed query could not ask. **The row still speaks where the
  // detail could not**: the two are separate calls, and a detail refused one field while
  // the list showed the pull request read as *none* and offered the local Merge press.
  if (forge.row === undefined) return forge.pull === undefined ? "checking" : "none"
  return forge.row.pull === undefined ? "none" : "row"
}

/**
 * Where the branch's pull request stands, as the words above the card read it — **the same
 * question `cardOf` answers, said in the vocabulary the sentences need.**
 *
 * It exists because the sentence and the press must never be read off two answers. They
 * were: the press moved onto `cardOf` and the words stayed on the whole answer alone, so a
 * card drawn from a remembered or coarse answer printed *the checkout is held until you
 * merge it* with no Merge press beneath it, and a remembered `merged` printed *the work is
 * on its branch* under a head saying **Merged**. Both cards are the ordinary reload rather
 * than an edge.
 *
 * **Derived through `cardOf` rather than beside it**, so there is one branch and not two
 * that could drift apart. The state is the same `Schema.Literal("open", "closed", "merged")`
 * on either answer, which is what makes the coarse card able to supply it at all.
 *
 * | | | |---|---| | a state | the forge named a pull request and said what state it is in —
 * whole or coarse | | `none` | there is no pull request, or we could not ask. The words a trak
 * has always had, and the local Merge press is offered | | `unknown` | nothing has come back.
 * **No claim at all** — see `endingWords`, which says nothing about the checkout rather than
 * naming a press it cannot promise |
 */
export type Standing = PullRequestFoundDto["state"] | "none" | "unknown"

export const standingOf = (forge: Forge): Standing => {
  switch (cardOf(forge)) {
    // The fallbacks are unreachable — `cardOf` answered `whole` and `row` off exactly these
    // two reads — and they are here because narrowing a value twice is what the compiler
    // asks for, not because either absence means anything.
    case "whole":
      return pullRequestFound(forge.pull)?.state ?? "none"
    case "row":
      return forge.row?.pull?.state ?? "none"
    case "none":
      return "none"
    case "checking":
      return "unknown"
  }
}

/** How the forge merges a pull request on this repository — the wire's three words. */
export type MergeMethod = NonNullable<PullRequestFoundDto["mergeMethod"]>

/** What the finished band's merge press is drawn from. */
export interface PullMerge {
  readonly number: number
  /** The method the press merges by — `methodFor`. */
  readonly method: MergeMethod
  /** What the menu offers, in GitHub's order. One or none draws the plain press. */
  readonly methods: readonly MergeMethod[]
  /**
   * GitHub's verdict on a merge pressed now — the only thing the press is live on. Absent
   * reads as GitHub not having said, which draws as checking.
   */
  readonly verdict: PullRequestFoundDto["mergeVerdict"]
}

/**
 * The method the press merges by: the trak's pick where GitHub still offers it, then the
 * repository's default, then the first GitHub offers — the engine's `mergeMethodFor`, so
 * the press names what the route will merge by. **A default the forge did not name reads as
 * `merge`**, GitHub's own first button.
 */
const methodFor = (
  pick: MergeMethod | undefined,
  fallback: MergeMethod | undefined,
  methods: readonly MergeMethod[],
): MergeMethod => {
  const offered = (m: MergeMethod | undefined): m is MergeMethod =>
    m !== undefined && (methods.length === 0 || methods.includes(m))
  if (offered(pick)) return pick
  if (offered(fallback)) return fallback
  return methods[0] ?? "merge"
}

/**
 * The press's facts, from the pane's whole answer about an open pull request — or
 * `undefined` where there is none in hand, which is also what a coarse card is: the row
 * carries no method and no verdict.
 *
 * Derived through `cardOf`, as `headingOf` is, so the press cannot name a pull request
 * the card does not. `pick` is the method recorded on the trak, or the one being recorded.
 */
export const pullMergeOf = (forge: Forge, pick: MergeMethod | undefined): PullMerge | undefined => {
  const pull = cardOf(forge) === "whole" ? pullRequestFound(forge.pull) : undefined
  if (pull?.state !== "open") return undefined
  return {
    number: pull.number,
    method: methodFor(pick, pull.mergeMethod, pull.mergeMethods),
    methods: pull.mergeMethods,
    verdict: pull.mergeVerdict,
  }
}

/**
 * What the card's head is drawn from — the five fields both answers carry, so the header is
 * one component rather than two that could come to disagree about a draft.
 */
export type Heading = Pick<PullRequestSummaryDto, "number" | "title" | "url" | "state" | "isDraft">

/**
 * The head a card would be drawn from, or `undefined` where `cardOf` draws none — derived
 * through it, as `standingOf` is, so the side panel's tab cannot name a pull request the
 * card does not.
 */
export const headingOf = (forge: Forge): Heading | undefined => {
  switch (cardOf(forge)) {
    case "whole":
      return pullRequestFound(forge.pull)
    case "row":
      return forge.row?.pull
    case "none":
    case "checking":
      return undefined
  }
}

/** The pull request's state as an icon — the card's plate, the panel's tab and its opener. */
export const headingIcon = (pull: Heading): LucideIcon => {
  switch (pull.state) {
    case "merged":
      return GitMerge
    case "closed":
      return GitPullRequestClosed
    case "open":
      return pull.isDraft ? GitPullRequestDraft : GitPullRequest
  }
}

/**
 * `waiting` for an open pull request rather than `working`: `tone.ts` defines `working` as
 * something in flight right now and `waiting` as a human owing an action, and a trak whose
 * plan has run out with a pull request open is the second.
 */
export const headingTone = (pull: Heading): Tone => {
  switch (pull.state) {
    case "merged":
      return "good"
    case "closed":
      return "neutral"
    case "open":
      return pull.isDraft ? "neutral" : "waiting"
  }
}

/** What the Merging section reads, which the coarse answer carries in full — see
 *  `PullRequestMerging` for why that section is finished the moment the card appears. */
export type Merging = Pick<PullRequestSummaryDto, "number" | "state" | "merging" | "base">

// ============================================================================
// When we last heard
// ============================================================================

/** How long ago, at the coarseness a card is read at: minutes, and *just now* under one.
 *  Exported for the deploy block's *Last asked* row, so the two cards on one pane cannot
 *  say a minute differently. */
export const agoWords = (at: number, now: number): string => {
  const minutes = Math.floor((now - at) / 60_000)
  // Also the answer for a stamp in the future, which is the two clocks disagreeing rather
  // than something that has not happened yet.
  if (minutes < 1) return "just now"
  if (minutes === 1) return "1 minute ago"
  if (minutes < 60) return `${String(minutes)} minutes ago`
  const hours = Math.floor(minutes / 60)
  return hours === 1 ? "1 hour ago" : `${String(hours)} hours ago`
}

/** The line under the title, and whether its glyph turns. */
export interface Synced {
  readonly text: string
  readonly turning: boolean
}

/**
 * When the forge last answered, in words — **drawn on every card, including one that is
 * completely up to date.**
 *
 * Showing it only where something is off was built, put on a knob and rejected: a stamp
 * that appears only when there is a problem is a warning rather than a fact, and it leaves
 * a reader no way to tell a card that has stopped syncing from one that just did.
 *
 * **The words claim less where the card is not this pane's own fresh read.** A card built
 * from a coarse answer is a head and three verdicts with the rows still coming, so
 * *Synced* would be claiming the whole of it. It does not name a source, because the
 * coarse answer is the freshest thing the browser holds for this branch — the traks
 * list's read or a projection of this pane's own earlier one — and the line cannot know
 * which without the store carrying provenance nothing else wants.
 *
 * `rechecking` is only ever true on a card nobody has confirmed this session. A background
 * poll behind a card that is already right is not worth a word or a moving glyph.
 */
export const syncedLine = (
  at: number,
  /** Whether what is drawn is a coarse answer rather than this pane's own whole one. */
  fromRow: boolean,
  rechecking: boolean,
  now: number,
): Synced => {
  const lead = `${fromRow ? "From an earlier answer," : "Synced"} ${agoWords(at, now)}`
  return { text: rechecking ? `${lead} · rechecking` : lead, turning: rechecking }
}

// ============================================================================
// Checks
// ============================================================================

type CheckVerdict = PullRequestCheckDto["verdict"]

/**
 * The five verdicts in words, all first-class.
 *
 * `unknown` is *not known* rather than a failure or a pass: it is what the forge reports
 * for a node nothing here classifies, and those arrive mixed in with the green ones.
 */
export const verdictWord = (verdict: CheckVerdict): string => {
  switch (verdict) {
    case "passed":
      return "passed"
    case "failed":
      return "failed"
    case "running":
      return "running"
    case "skipped":
      return "skipped"
    case "unknown":
      return "not known"
  }
}

export const verdictTone = (verdict: CheckVerdict): Tone => {
  switch (verdict) {
    case "passed":
      return "good"
    case "failed":
      return "bad"
    case "running":
      return "working"
    case "skipped":
    case "unknown":
      return "neutral"
  }
}

/** The order a reader meets them, which is also the order a summary lists them in. */
const VERDICTS: readonly CheckVerdict[] = ["failed", "running", "passed", "skipped", "unknown"]

/**
 * How many of each verdict, as words: `12 passed · 2 skipped · 1 not known`.
 *
 * **Never *all passing*, and that is the whole reason this exists.** The forge's rollup
 * mixes skipped, queued and unrecognised nodes in with the green ones, so a summary that
 * called them passes would quietly undo the `unknown` verdict one fold further out.
 * A verdict nothing has is left out rather than reported as zero.
 */
export const countedVerdicts = (checks: readonly PullRequestCheckDto[]): string =>
  VERDICTS.flatMap((verdict) => {
    const n = checks.filter((check) => check.verdict === verdict).length
    return n === 0 ? [] : [`${String(n)} ${verdictWord(verdict)}`]
  }).join(" · ")

/** The failing ones, which are the rows the section always shows and the only pickable ones. */
export const failingChecks = (
  checks: readonly PullRequestCheckDto[],
): readonly PullRequestCheckDto[] => checks.filter((check) => check.verdict === "failed")

/** Everything else, which is what the grid under the verdict holds. */
export const otherChecks = (
  checks: readonly PullRequestCheckDto[],
): readonly PullRequestCheckDto[] => checks.filter((check) => check.verdict !== "failed")

/**
 * What the Checks section says about itself with only the list's answer in hand — the
 * forge's rollup over the head commit, in one word.
 *
 * **New copy rather than `checksHeadline` with an empty list**, which would say *No checks
 * have run* about a branch whose checks are failing. The row knows a word where the card
 * knows a count, and the section rewriting itself from *Some checks are failing* to *2
 * failing of 5* when the detail lands is accepted: splitting every headline so the coarse
 * word stays put was offered and declined as too large a change to all three sections.
 *
 * `none` and `unknown` are neither a pass nor a failure, which is the rule the per-check
 * `unknown` is already written under — see `verdictWord`.
 */
export const coarseChecks = (checks: PullRequestSummaryDto["checks"]): Verdict => {
  switch (checks) {
    case "failed":
      return { text: "Some checks are failing", tone: "bad" }
    case "running":
      return { text: "Checks are running", tone: "working" }
    case "passed":
      return { text: "Checks passed", tone: "good" }
    case "none":
      return { text: "No checks have run", tone: "neutral" }
    case "unknown":
      return { text: "GitHub has not said", tone: "neutral" }
  }
}

/**
 * What the Checks section says about itself.
 *
 * **With nothing failing, the counted verdicts are the whole of it.** The verdict is also
 * the press that opens the grid of every check, so the count is said once on one line
 * rather than as a verdict and a fold summary that print the same string an inch apart.
 * It is `countedVerdicts` rather than a pass count so that a run of skipped and
 * unrecognised nodes cannot read as a clean sweep; the tone is what is still moving.
 */
export const checksHeadline = (checks: readonly PullRequestCheckDto[]): Verdict => {
  if (checks.length === 0) return { text: "No checks have run", tone: "neutral" }
  const failing = failingChecks(checks).length
  if (failing > 0)
    return { text: `${String(failing)} failing of ${String(checks.length)}`, tone: "bad" }
  return {
    text: countedVerdicts(checks),
    tone: checks.some((check) => check.verdict === "running")
      ? "working"
      : checks.every((check) => check.verdict === "passed")
        ? "good"
        : "neutral",
  }
}

// ============================================================================
// Review
// ============================================================================

/**
 * A thread with its place among its review's own threads.
 *
 * The position is carried rather than recovered, because it is what names a thread with no
 * comments at all — the one case `threadKey` has no permalink to key on — and a filtered
 * list has lost it.
 */
export interface ThreadAt {
  readonly thread: ReviewThreadDto
  readonly at: number
}

/** The ones a review shows on arrival, and the ones it shuts behind a counted disclosure. */
export const openThreads = (review: ReviewDto): readonly ThreadAt[] =>
  review.threads.flatMap((thread, at) => (thread.resolved ? [] : [{ thread, at }]))

export const resolvedThreads = (review: ReviewDto): readonly ThreadAt[] =>
  review.threads.flatMap((thread, at) => (thread.resolved ? [{ thread, at }] : []))

/**
 * What the Review section says about itself.
 *
 * `decision` absent is *nobody has reviewed*, which the forge answers as no decision rather
 * than as a verdict of none. The unanswered count rides on the two decisions it means
 * something under, and is left off at zero rather than reported as none outstanding.
 *
 * **`unanswered` is a count handed in rather than one worked out here, because the section
 * prints it twice.** The verdict says it, and below the breakpoint the folded row says it
 * again in words; two derivations of *how much is outstanding* disagree the moment they
 * read different things, which is what counting threads here did while the row counted
 * every tick — comments on the pull request included. The caller counts the ticks under it
 * once and both draw from that. The coarse card passes `0`, which is exactly *no unanswered
 * count*, so this is one function serving both cards rather than a second set of words that
 * could disagree with these about what *Approved* is called.
 */
export const reviewHeadline = (
  decision: PullRequestSummaryDto["decision"],
  /** How many conversations under this section still carry a tick — `picksOf`. */
  unanswered: number,
): Verdict => {
  const trailing = unanswered === 0 ? "" : ` · ${String(unanswered)} unanswered`
  switch (decision) {
    case undefined:
      return { text: "No review yet", tone: "neutral" }
    case "approved":
      return { text: "Approved", tone: "good" }
    case "changesRequested":
      return { text: `Changes requested${trailing}`, tone: "waiting" }
    case "reviewRequired":
      return { text: "Review required", tone: "waiting" }
    case "commented":
      return { text: `Commented${trailing}`, tone: "neutral" }
  }
}

/** What a reviewer decided, in the words the review's own row wears. */
export const reviewVerdict = (review: ReviewDto): Verdict => {
  switch (review.verdict) {
    case "approved":
      return { text: "approved", tone: "good" }
    case "changesRequested":
      return { text: "requested changes", tone: "waiting" }
    case "commented":
      return { text: "commented", tone: "neutral" }
  }
}

// ============================================================================
// Merging
// ============================================================================

/**
 * Whether the forge would merge this as it stands, and why not.
 *
 * **Two ways of refusing, and *behind* is one of them.** The forge reports a branch behind
 * its base only where it is actually refusing for that reason — a repository that permits
 * merging an out-of-date branch answers clean instead — so it is a refusal like a conflict
 * rather than a separate concern.
 *
 * **`clean` says what this section knows and not a word more.** It absorbs the forge's
 * blocked and unstable, which are the Checks and Review sections' business, so wording it
 * as *ready to merge* would be this section answering for those two.
 *
 * `reason` is the line under the state, and it is also what a ticked merging fact quotes.
 * It is absent at the two states there is nothing to send back about.
 */
export const mergingWords = (
  merging: PullRequestFoundDto["merging"],
): Verdict & { readonly reason: string | undefined } => {
  switch (merging) {
    case "conflicting":
      return {
        text: "GitHub sees conflicts to resolve",
        tone: "bad",
        reason: "The pull request conflicts with its base branch.",
      }
    case "behind":
      return {
        text: "The branch is behind its base",
        tone: "bad",
        reason: "The branch is behind its base branch, and GitHub will not merge it as it stands.",
      }
    case "clean":
      return {
        text: "No conflicts, and up to date with its base",
        tone: "good",
        reason: undefined,
      }
    case "unknown":
      return { text: "GitHub has not worked it out yet", tone: "neutral", reason: undefined }
  }
}

/**
 * Where the pull request stands, for the two states that draw no mergeability at all.
 *
 * `open` is `undefined` because an open pull request's answer is `mergingWords` — asking
 * this there would be the section saying two things at once.
 */
export const stateWords = (pull: Pick<Merging, "state">): Verdict | undefined => {
  switch (pull.state) {
    case "open":
      return undefined
    case "merged":
      return { text: "Merged on GitHub — the work is in over there", tone: "good" }
    case "closed":
      return {
        text: "Closed on GitHub — nothing was merged, and the branch is still here",
        tone: "neutral",
      }
  }
}

// ============================================================================
// Truncation
// ============================================================================

/**
 * That a list is short because it was cut, said in the section it was cut from.
 *
 * Every connection the engine reads is bounded, and a silently short list of comments or
 * checks reads as a complete one — which is the failure bounding introduces. Fetching
 * everything is not the answer; saying so is.
 */
export const wasTruncated = (
  truncated: PullRequestFoundDto["truncated"],
  ...kinds: readonly PullRequestFoundDto["truncated"][number][]
): boolean => kinds.some((kind) => truncated.includes(kind))

export const TRUNCATED_NOTE = "Only the first page was read — there are more on GitHub."

// ============================================================================
// What a tick becomes
// ============================================================================

/** How long ago something happened, or `undefined` where the forge stamped nothing. */
const ago = (at: number | undefined, now: number): string | undefined => {
  const elapsed = elapsedText(at, now)
  return elapsed === undefined ? undefined : `Failed ${elapsed} ago`
}

/**
 * What names one check, for the tick and for the list it is drawn in.
 *
 * **`id` and nothing else, because it is the only field the wire promises is unique.**
 * Neither of the two that look like they would do is: two workflows may each carry a job
 * called `test`, and a check's link is supplied by whoever created the run — one CI system
 * posting several checks that all point at one build page is ordinary. Either one keys two
 * different runs alike, which draws both rows ticked, sends one of them, and hands React
 * two children under one key. `PullRequestCheckDto.id` is where that promise is written
 * down and `vcs/logic/forge-answer.ts` is where it is kept.
 */
export const checkKey = (check: PullRequestCheckDto): string => `check:${check.id}`

/**
 * A failing check, as a pick.
 *
 * **Its name, when it failed and its link — and no output.** A check's log is never
 * fetched, so there is nothing to quote and nothing may be invented in its place; quoting
 * a transcript here would cost the second forge call the whole read is built to avoid.
 */
export const checkPick = (check: PullRequestCheckDto, number: number, now: number): Picked => {
  const when = ago(check.at, now)
  return {
    key: checkKey(check),
    label: `${check.name} — failing`,
    said: `The ${check.name} check is failing on pull request #${String(number)}.`,
    where: [...(when === undefined ? [] : [when]), ...(check.url === undefined ? [] : [check.url])],
    quote: undefined,
  }
}

/** Where a thread is, as the code reference its row wears and its block carries. */
export const threadWhere = (thread: ReviewThreadDto): string | undefined =>
  thread.path === undefined
    ? undefined
    : thread.line === undefined
      ? thread.path
      : `${thread.path}:${String(thread.line)}`

/**
 * What names one conversation, for the tick and for the list it is drawn in.
 *
 * **Never the reviewer and the line.** One person can review twice and comment on the same
 * line in both, which is two conversations answering to one string — so ticking either
 * ticks both and only one is ever sent. The first comment's permalink is what the forge
 * mints per conversation, and the wire says so; where a thread has no comments at all, the
 * review's `id` plus the thread's position in **that** review is unique, because the id is.
 *
 * A review's `url` is deliberately not what the fallback is built on. It carries the
 * review's own id today and would work, which is exactly what was said of a check's link
 * before two of them turned out to share one.
 */
export const threadKey = (review: ReviewDto, thread: ReviewThreadDto, at: number): string => {
  const [first] = thread.comments
  return `thread:${first?.url ?? `${review.id}#${String(at)}`}`
}

/**
 * What one conversation is called, for the tick that sends it and for the link that opens
 * it on the forge.
 *
 * **Named for whoever opened it rather than for the review it hangs under**: a reply from
 * somebody else is still that person's words, and the opener is who a reader is looking
 * for. Shared with the resolved fold, which carries no tick and still needs the link it
 * draws to be told apart from the one on the row below it.
 */
export const threadLabel = (review: ReviewDto, thread: ReviewThreadDto): string => {
  const where = threadWhere(thread)
  const who = thread.comments[0]?.who ?? review.who
  return where === undefined ? `${who}'s comment` : `${who} on ${where}`
}

/**
 * A review conversation, as a pick.
 *
 * **The thread is the unit, not one reply in it** — resolution belongs to the thread in the
 * forge's model, and answering half a settled conversation is incoherent. So every comment
 * in it is quoted, in order.
 */
export const threadPick = (
  review: ReviewDto,
  thread: ReviewThreadDto,
  /** Its position among that review's own threads — `ThreadAt.at`. */
  at: number,
  number: number,
): Picked => {
  const where = threadWhere(thread)
  const who = thread.comments[0]?.who ?? review.who
  return {
    key: threadKey(review, thread, at),
    label: threadLabel(review, thread),
    said: `${who} left a comment on pull request #${String(number)}.`,
    where: where === undefined ? [] : [where],
    quote: thread.comments.map((comment) => comment.body).join("\n\n"),
  }
}

/** A comment on the pull request itself, attached to no line. Keyed by its permalink, which
 *  the wire promises is the forge's own and so unique — and which is stable where a position
 *  in the list is not, because the list re-orders under a poll. */
export const commentPick = (comment: PullRequestCommentDto, number: number): Picked => ({
  key: `comment:${comment.url}`,
  label: `${comment.who} on the pull request`,
  said: `${comment.who} commented on pull request #${String(number)}.`,
  where: [],
  quote: comment.body,
})

/**
 * The forge refusing the merge, as a pick — or `undefined` where it is not refusing.
 *
 * Nothing here updates the branch. A conflict or a branch behind its base is reported and
 * sent back into the trak as work, and a plan step does the rebase or the resolution.
 */
export const mergingPick = (pull: Merging): Picked | undefined => {
  const { reason } = mergingWords(pull.merging)
  if (pull.state !== "open" || reason === undefined) return undefined
  return {
    key: "merging",
    label: "GitHub will not merge it as it stands",
    said: `Pull request #${String(pull.number)} cannot merge as it stands.`,
    where: [],
    quote: reason,
    base: pull.base,
  }
}
