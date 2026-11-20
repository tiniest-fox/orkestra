// types: what a forge currently says about a branch, in our vocabulary.
//
// Every literal here is ours rather than a provider's, which is what makes a
// second forge a new adapter and nothing else: nothing above this file has to
// learn that GitHub spells a refused merge `DIRTY` or an unsubmitted review
// `PENDING`. The wire Schemas in `shared/` carry the same words, so the boundary
// mapper stays a rename rather than a translation.
//
// Keyed on a branch name and nothing else — no trak, no id — for the reason the
// rest of `vcs/` is.

import { Data, Schema } from "effect"

/** One comment, on a review thread or on the pull request itself. */
export interface PullRequestComment {
  /** The forge's own name for a deleted account is what a person sees over there too. */
  readonly who: string
  /** Whole and verbatim: a picked comment is quoted into the work that answers it. */
  readonly body: string
  readonly url: string
  readonly at: number
}

/**
 * A review conversation about one place in the diff.
 *
 * A level of its own because resolution belongs to the thread rather than to any
 * one comment, and because a thread is the unit somebody answers.
 *
 * `path`, `line` and `diffHunk` are absent where the forge reports no position,
 * which is what a thread whose lines have moved comes back as. `outdated` says
 * that directly and is a different fact from `resolved`.
 */
export interface ReviewThread {
  readonly path?: string
  readonly line?: number
  readonly diffHunk?: string
  readonly resolved: boolean
  readonly outdated: boolean
  readonly comments: readonly PullRequestComment[]
}

/**
 * One submitted review, carrying the threads it opened.
 *
 * **The nesting is the adapter's work.** A forge answers with threads in a flat
 * list beside the reviews, and flat they read as one person asking for
 * everything. A thread whose review cannot be identified is not dropped — its
 * comments go into `PullRequest.conversation`.
 */
export interface Review {
  /**
   * **What tells two reviews apart, and the only field that may.** One person reviewing
   * twice is ordinary, so neither `who` nor `at` names one, and `url` is a link out
   * rather than a promise. Unique among the reviews of one answer — the adapter owes
   * that, and the wire says so where a surface can read it.
   */
  readonly id: string
  readonly who: string
  readonly verdict: "approved" | "changesRequested" | "commented"
  readonly at: number
  readonly url: string
  /** The reviewer's own summary. A verdict with no words is ordinary. */
  readonly body?: string
  readonly threads: readonly ReviewThread[]
}

/**
 * One check the forge ran — CI's, not a script this engine spawned in the
 * checkout, which is why it is not a `CheckOutcome`.
 *
 * **It carries no output, and that is a constraint rather than a gap.** Reading a
 * failing check's log costs a second call to the forge per failing check, where
 * the whole read is one call. The name, when it ended and a link are what a
 * person needs to go and look.
 *
 * `unknown` is the verdict for a node the forge reports that nothing here
 * classifies, and those arrive mixed in with the green ones — so a surface
 * folding a remainder counts by verdict rather than calling it all passing.
 */
export interface PullRequestCheck {
  /**
   * **What tells two checks apart, and the only field that may.** Two workflows each
   * carrying a job called `test` is ordinary, and `url` looks unique without being it —
   * whoever created the run supplies it, so several checks from one CI system routinely
   * share one. Unique among the checks of one answer; the adapter owes that, and the
   * wire says so where a surface can read it. Opaque, and not a link.
   */
  readonly id: string
  readonly name: string
  readonly verdict: "passed" | "failed" | "running" | "skipped" | "unknown"
  /** Absent while the check has not finished. */
  readonly at?: number
  /** Where to read the run. **Never an identity** — see `id`. */
  readonly url?: string
}

/** Which bounded connection was read only the first page of. */
export type Truncated = "checks" | "reviews" | "threads" | "conversation"

/**
 * The branch has a pull request, and this is what the forge says about it now.
 *
 * `merging` is what the forge would do with it as it stands. `conflicting` and
 * `behind` are its two ways of refusing — *behind* only ever comes back where it
 * is actually refusing for that reason, which makes it a refusal like a conflict
 * rather than a separate concern. `clean` absorbs every value that is the checks'
 * or the reviews' business, because those two say it better than a merge verdict
 * standing in for them.
 *
 * **`unknown` is a value, never a failure.** A forge computes mergeability lazily
 * and answers this for a while after every push, so anything reading it as broken
 * fires constantly.
 *
 * `decision` is absent where nobody has reviewed: that is *no decision* rather
 * than a verdict of none.
 *
 * `truncated` names the connections read only the first page of. Every one is
 * bounded, and a short list that reads as a complete one is the failure bounding
 * introduces — so which were cut travels with the answer. `threads` covers the
 * threads under every review at once, and the comments inside them; there is no
 * per-review flag.
 *
 * **`rollup` is the forge's own one-word verdict over the head commit, beside the
 * page of checks — never a fold of it.** Skipped and unrecognised runs sit inside
 * `checks`, so a fold would be a second version of a judgement free to disagree
 * with the summary a list row draws from the same commit. It is here so the whole
 * answer carries everything the coarse one does, and a caller can project one
 * onto the other.
 */
export interface PullRequest {
  readonly number: number
  readonly url: string
  readonly title: string
  readonly state: "open" | "closed" | "merged"
  /**
   * The commit the merge made on the base branch, present only where `state` is
   * `merged` and the forge still knows it. It is what the engine records as where
   * the work went when a merged trak is archived — the one field here read by
   * anything other than a surface.
   */
  readonly mergeCommit?: string
  readonly isDraft: boolean
  /**
   * `blocked` is `clean` but for the forge's own protection — a required review, signed
   * commits, resolved conversations: a merge the checks alone will not release. Kept apart
   * because the engine merges on `clean` and must not on this; a surface draws it as
   * `clean`, which is what the wire carries.
   */
  readonly merging: "conflicting" | "behind" | "blocked" | "clean" | "unknown"
  readonly decision?: "approved" | "changesRequested" | "reviewRequired" | "commented"
  /**
   * The branch the forge merges into and judges `merging` against — its name on the
   * remote, which can differ from the base a trak recorded. Absent where the forge named
   * none.
   */
  readonly base?: string
  readonly rollup: "passed" | "failed" | "running" | "unknown" | "none"
  readonly checks: readonly PullRequestCheck[]
  readonly reviews: readonly Review[]
  /**
   * Comments on the pull request itself, plus the comments of any thread whose
   * review could not be identified — the alternative to losing a reviewer's words.
   */
  readonly conversation: readonly PullRequestComment[]
  readonly truncated: readonly Truncated[]
  /**
   * The method the forge's merge button offers this account first on the repository —
   * the one `ForgeShape.merge` falls back to. **A fact about the repository rather than
   * this pull request**, carried here because it costs the same query one scalar and a
   * surface naming the method on its press has nothing else to read it from. Absent where
   * the forge named none this build can read.
   */
  readonly mergeMethod?: MergeMethod
  /**
   * The methods the forge would merge this pull request by, in the forge's own order: the
   * repository's settings narrowed by the base branch's rules. Empty where the forge named
   * none, which a caller reads as not knowing rather than as no method.
   */
  readonly mergeMethods: readonly MergeMethod[]
  /**
   * What the forge would say to a merge pressed now — its own verdict under the
   * repository's rules and protection, not one this side keeps. Absent where the pull
   * request is not open.
   */
  readonly mergeVerdict?: MergeVerdict
}

/** How a merge on the forge is made, spelled as `gh pr merge`'s flags spell it. */
export type MergeMethod = "merge" | "squash" | "rebase"

/** `MergeMethod` as a Schema, for a log that records one. */
export const MERGE_METHOD = Schema.Literal("merge", "squash", "rebase")

/**
 * One reason the forge refuses a merge, in our words — a surface words each one.
 *
 * `checks` names the required checks that failed, and `waiting` the required checks that
 * have not finished. `reviewRequired` carries the approvals the base's rules ask for, where
 * they name a count. `rule` is a refusal nothing the forge returns explains.
 */
export type MergeHold =
  | { readonly cause: "draft" | "conflicting" | "behind" | "changesRequested" | "rule" }
  | { readonly cause: "reviewRequired"; readonly approvals?: number }
  | { readonly cause: "checks" | "waiting"; readonly names: readonly string[] }

/**
 * The forge's verdict on a merge made now. `Checking` is the forge not having worked it
 * out yet, which it does for a while after every push — never a refusal.
 */
export type MergeVerdict = Data.TaggedEnum<{
  Mergeable: object
  Checking: object
  Blocked: { readonly holds: readonly [MergeHold, ...MergeHold[]] }
}>
export const MergeVerdict = Data.taggedEnum<MergeVerdict>()

/**
 * What the forge had to say — **four answers, and only one of them is a pull
 * request.**
 *
 * `Unavailable` is not an error and not the same fact as `None`: the forge could
 * not be asked at all — no CLI, not authenticated, no remote, a remote that is
 * not a forge we speak to, a network failure, a timeout. A caller says nothing
 * rather than drawing a failure, so `why` is for a person who goes looking.
 *
 * `NoOrigin` is the repository having no remote named `origin`, so there is no forge
 * to ask and no pull request can exist. Unlike `Unavailable` it is a fact, and a
 * surface may draw it: the branch is merged here or not at all.
 *
 * Tagged rather than an optional `PullRequest` for that reason exactly: an
 * absent value would collapse *there is none* into *I could not tell*, and the
 * two license opposite behaviour at every surface that reads this.
 */
export type ForgeAnswer = Data.TaggedEnum<{
  None: object
  Unavailable: { readonly why: string }
  NoOrigin: object
  Found: { readonly pullRequest: PullRequest }
}>
export const ForgeAnswer = Data.taggedEnum<ForgeAnswer>()

/**
 * One pull request, as much of it as a caller drawing a row rather than a pane needs.
 *
 * **The literals are `PullRequest`'s own**, read off it rather than written again, so
 * the two shapes cannot come to disagree about what a refused merge is called. What is
 * *missing* is the whole point: no comments, no reviews, no threads, and the checks
 * rolled up to one word instead of a list. Those are what make the detailed answer
 * expensive, and a row draws none of them.
 *
 * `checks` is the same rollup the detailed shape carries as `rollup` — one field,
 * where that shape also reads a bounded connection of them. `none` is a commit
 * nothing ran against, `unknown` a rollup state this build does not recognise;
 * neither is a failure, and a caller must not read either as one.
 *
 * **`number`, `title` and `url` are here despite naming nothing a row draws**, because
 * they are what a *card* built from this answer needs for its head and they are plain
 * scalars on a node the query already asks for — no connection, no page, nothing the
 * forge prices. A surface holding this shape can draw the head of a pull request while
 * the detailed answer is still on its way, which is the only thing that made widening it
 * worth doing.
 *
 * **It names no branch.** The branch is the question rather than part of the answer, so
 * it lives on the entry this sits inside — one place says which branch was asked about,
 * and a pull request is what the forge said back.
 */
export interface PullRequestSummary {
  readonly number: number
  readonly title: string
  readonly url: string
  readonly state: PullRequest["state"]
  /**
   * The merge commit, on `PullRequest.mergeCommit`'s terms — and the one field of this
   * shape read by something other than a surface: a trak waiting on `merged` is handed
   * it as the commit that landed. A scalar on the node, so it costs the query nothing.
   */
  readonly mergeCommit?: string
  readonly isDraft: boolean
  readonly merging: PullRequest["merging"]
  readonly decision?: PullRequest["decision"]
  /** `PullRequest.base`: what a send-back after a refusal names as the branch to merge. */
  readonly base?: string
  readonly checks: PullRequest["rollup"]
  /**
   * The head commit's sha, which `checks` was read against. What tells the forge sweep a
   * `none` that has held on one commit from the `none` a push leaves before its checks are
   * registered. Absent where the forge did not name one.
   */
  readonly head?: string
}

/**
 * One branch that was asked about, and what came back for it.
 *
 * **An absent `pull` is a fact about this branch** — the forge was asked about it by
 * name and answered with no pull request. That is the whole reason the entry exists
 * rather than a caller reading absence from a list: an entry is only ever written for a
 * branch that was named in the question, so *nothing came back about you* and *you were
 * never asked* are different shapes rather than the same silence.
 */
export interface ForgeListingEntry {
  readonly branch: string
  readonly pull?: PullRequestSummary
}

/**
 * What the forge said about the branches it was handed — **three members, and only an
 * entry says *this branch has none*.**
 *
 * `Unavailable` is the same fact it is on `ForgeAnswer`, and it is the whole call's
 * rather than one branch's: one document, so one failure. `NoOrigin` is the same fact
 * it is on `ForgeAnswer`, said of every branch at once.
 *
 * **A branch with no entry was not answered about**, and a caller may not read that as a
 * fact about the branch. It is what a branch past the adapter's bound comes back as, and
 * a caller drawing a verdict there would be rendering the bound as a claim about
 * somebody's work. There is no `complete` flag because there is no page a branch could
 * have fallen off: the question named the branches, so the answer either holds an entry
 * for one or it does not.
 *
 * **One entry per branch asked, and never two.** The adapter owes that, and a caller may
 * index on `branch` without checking.
 */
export type ForgeListing = Data.TaggedEnum<{
  Unavailable: { readonly why: string }
  NoOrigin: object
  Listed: { readonly entries: readonly ForgeListingEntry[] }
}>
export const ForgeListing = Data.taggedEnum<ForgeListing>()

/**
 * What asking the forge to merge a branch's pull request came to. **Two answers, and the
 * second is not a failure**: a forge that refuses — the checks moved, the base moved, a
 * protection rule nobody here can see — and a forge that could not be reached are both a
 * merge that did not happen, and the caller asks again on its next pass either way.
 * `why` is for a person who goes looking.
 */
export type ForgeMerge = Data.TaggedEnum<{
  Merged: object
  Refused: { readonly why: string }
}>
export const ForgeMerge = Data.taggedEnum<ForgeMerge>()

/**
 * What asking the forge to open or update a pull request came to: the one it now holds, or
 * the forge's refusal — which includes a forge that could not be reached. `why` is shown
 * to the person who pressed.
 */
export type ForgeOpen = Data.TaggedEnum<{
  Opened: { readonly url: string }
  Refused: { readonly why: string }
}>
export const ForgeOpen = Data.taggedEnum<ForgeOpen>()
