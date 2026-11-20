// What the forge says about a trak's branch: pull requests, reviews and merge verdicts. Part of the wire contract;
// `common.ts` says how the slices fit together.

import { Schema } from "effect"

// ============================================================================
// The forge — what it currently says about this trak's branch
// ============================================================================

/**
 * One comment, on a review thread or on the pull request itself.
 *
 * `body` is the text whole and verbatim. A picked comment is quoted into the re-entry
 * that sends the trak back to work, and paraphrasing a reviewer is the thing that path
 * exists to avoid — so nothing here truncates and nothing summarises.
 */
export const PullRequestCommentDto = Schema.Struct({
  who: Schema.String,
  body: Schema.String,
  /**
   * **The forge's own permalink to this one comment, and so an identity** — a surface
   * keys a tick on it. Unlike a check's `url` it is not supplied by anybody: the forge
   * mints it from the comment's own id, so two comments never share one.
   */
  url: Schema.String,
  at: Schema.Number,
})
export type PullRequestCommentDto = Schema.Schema.Type<typeof PullRequestCommentDto>

/**
 * A review conversation about one place in the diff.
 *
 * **A level of its own between a review and its comments**, because resolution belongs
 * to the thread rather than to any one comment — hiding some replies of a settled
 * conversation and not the rest is incoherent. It is also the unit that is picked: you
 * answer a conversation, not one reply in it.
 *
 * `path`, `line` and `diffHunk` are absent where the forge reports no position, which
 * is what a thread whose lines have since moved comes back as. `outdated` is that fact
 * said directly, and it is a different one from `resolved`: nobody has answered an
 * outdated thread, the diff simply moved out from under it.
 */
export const ReviewThreadDto = Schema.Struct({
  path: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Number),
  diffHunk: Schema.optional(Schema.String),
  resolved: Schema.Boolean,
  outdated: Schema.Boolean,
  comments: Schema.Array(PullRequestCommentDto),
})
export type ReviewThreadDto = Schema.Schema.Type<typeof ReviewThreadDto>

/**
 * One review, carrying the threads it opened.
 *
 * **The nesting is the adapter's work and never a surface's.** The forge answers with
 * threads in a flat list beside the reviews, and flat they read as one person asking for
 * everything — whose review a comment belongs to is what gives it its weight. So what
 * crosses is already joined, and a thread whose review cannot be identified is not
 * dropped: its comments go into `conversation` below.
 *
 * `body` is the reviewer's own summary, absent where they left none — a verdict with no
 * words is ordinary.
 */
export const ReviewDto = Schema.Struct({
  /**
   * **What tells two reviews apart, and the only field that may.** One person reviewing
   * twice is ordinary, so neither `who` nor `at` names one — and `url` is a link out
   * rather than a promise: it happens to carry the review's own id today, which is
   * exactly the unwritten assumption a check's `url` was keying on when it broke.
   *
   * Unique among the reviews of one answer. The adapter owes that; a surface may rely
   * on it.
   */
  id: Schema.String,
  who: Schema.String,
  verdict: Schema.Literal("approved", "changesRequested", "commented"),
  at: Schema.Number,
  /** Where to read it on the forge. Never an identity — see `id`. */
  url: Schema.String,
  body: Schema.optional(Schema.String),
  threads: Schema.Array(ReviewThreadDto),
})
export type ReviewDto = Schema.Schema.Type<typeof ReviewDto>

/**
 * One check the forge ran. Named apart from `CheckRunDto` because they are different
 * runs of different things: that one is a script this engine spawned in the checkout,
 * this one is CI's, and only the first has output anything here can read.
 *
 * **It carries no output, and that is a constraint rather than a gap.** A surface shows
 * the name, when it ended and a link to the run; fetching a failing check's log would
 * cost a second call to the forge per failing check, where the whole read is one call.
 *
 * All five verdicts are first-class, `unknown` included — it is the answer for a node
 * the forge reports that nothing here classifies, and those arrive mixed in with the
 * green ones. A surface folding a remainder therefore counts by verdict; *all passing*
 * would be asserting something the wire never said.
 *
 * `at` is absent while a check has not finished, and `url` where the forge gives no link.
 */
export const PullRequestCheckDto = Schema.Struct({
  /**
   * **What tells two checks apart, and the only field that may.** Two workflows each
   * carrying a job called `test` is ordinary, so `name` names two runs alike — and
   * `url` is worse, because it looks unique and is not: whoever created the run
   * supplies it, and one CI system posting several checks that all link to one build
   * page is the ordinary case rather than the exotic one. A surface keying a tick on it
   * drew both rows ticked and sent one.
   *
   * Unique among the checks of one answer. The adapter owes that; a surface may rely on
   * it. Opaque, and not a link — nothing may parse it or put it in an `href`.
   */
  id: Schema.String,
  name: Schema.String,
  verdict: Schema.Literal("passed", "failed", "running", "skipped", "unknown"),
  at: Schema.optional(Schema.Number),
  /** Where to read the run on the forge. **Never an identity** — see `id`. */
  url: Schema.optional(Schema.String),
})
export type PullRequestCheckDto = Schema.Schema.Type<typeof PullRequestCheckDto>

/**
 * The forge's own rollup over a head commit, in one word. `none` is a commit nothing ran
 * against and `unknown` a rollup state this build does not recognise — **neither is a
 * failure and neither is a pass**, and a surface reading either as one would be turning a
 * thing it cannot tell into a verdict.
 *
 * One Schema for the summary's `checks` and the whole answer's `rollup`, so the two
 * cannot drift: a browser files the whole answer into the same store the summaries live
 * in, and the word has to mean the same thing whichever answer it rode in on.
 */
const CheckRollupDto = Schema.Literal("passed", "failed", "running", "unknown", "none")

/**
 * Nothing on the forge has this branch as its source.
 *
 * **`branch` names the branch that was asked about**, so a browser can file the answer by
 * branch beside the listing's entries — the store both surfaces read is keyed on nothing
 * else. Absent only where there was no branch to ask: a trak that never got a checkout is
 * answered without the forge being consulted, and an entry that names no branch is filed
 * nowhere.
 */
export const NoPullRequestDto = Schema.TaggedStruct("NoPullRequest", {
  branch: Schema.optional(Schema.String),
})
export type NoPullRequestDto = Schema.Schema.Type<typeof NoPullRequestDto>

/**
 * The forge could not be asked: no `gh`, not authenticated, no remote, a remote that is
 * not a forge we speak to, a network failure, a timeout. Shared by both forge answers —
 * about one branch on `PullRequestDto`, and about every branch at once on
 * `ForgeListingDto`, where one call means one failure.
 *
 * **Not an error, and not the same fact as `NoPullRequest`** — and the difference is
 * what a surface owes rather than what it draws. *There is none* licenses saying the
 * work has nothing in its way; *we could not ask* licenses nothing at all. A surface that
 * would otherwise have made a claim has to say it could not look instead, which is what
 * the traks list does; one that draws no claim either way — the finished pane — draws
 * nothing here as it draws nothing for `NoPullRequest`, and the local Merge press behaves
 * exactly as it does on a trak that never had a pull request, because withholding it
 * whenever `gh` is missing would take local merging away from everyone who does not use a
 * forge at all.
 *
 * `why` is for a person who goes looking, never for a banner.
 */
export const ForgeUnavailableDto = Schema.TaggedStruct("ForgeUnavailable", {
  why: Schema.String,
})
export type ForgeUnavailableDto = Schema.Schema.Type<typeof ForgeUnavailableDto>

/**
 * The project has no remote named `origin`, so the engine asked no forge. Shared by both
 * forge answers, as `ForgeUnavailableDto` is.
 *
 * **A fact, unlike `ForgeUnavailable`**: no branch here can have a pull request, so a
 * finished branch is merged locally or not at all. A surface draws it as it draws
 * `NoPullRequest` — the traks list files a moved branch under *Ready to merge*, and the
 * local Merge press is offered.
 */
export const ForgeNoOriginDto = Schema.TaggedStruct("NoOrigin", {})
export type ForgeNoOriginDto = Schema.Schema.Type<typeof ForgeNoOriginDto>

/**
 * One reason the forge refuses a merge. `checks` names the required checks that failed and
 * `waiting` those not finished; `reviewRequired` carries the approvals the base's rules ask
 * for, where they name a count; `rule` is a refusal nothing the forge returns explains. A
 * surface words each one.
 */
export const MergeHoldDto = Schema.Union(
  Schema.Struct({
    cause: Schema.Literal("draft", "conflicting", "behind", "changesRequested", "rule"),
  }),
  Schema.Struct({
    cause: Schema.Literal("reviewRequired"),
    approvals: Schema.optional(Schema.Number),
  }),
  Schema.Struct({ cause: Schema.Literal("checks", "waiting"), names: Schema.Array(Schema.String) }),
)
export type MergeHoldDto = Schema.Schema.Type<typeof MergeHoldDto>

/**
 * The forge's verdict on a merge pressed now. `Checking` is the forge still working it out,
 * which it does for a while after every push — never a refusal.
 */
export const MergeableDto = Schema.TaggedStruct("Mergeable", {})
export const MergeCheckingDto = Schema.TaggedStruct("Checking", {})
export const MergeBlockedDto = Schema.TaggedStruct("Blocked", {
  holds: Schema.NonEmptyArray(MergeHoldDto),
})
export const MergeVerdictDto = Schema.Union(MergeableDto, MergeCheckingDto, MergeBlockedDto)
export type MergeVerdictDto = Schema.Schema.Type<typeof MergeVerdictDto>

/**
 * The branch has a pull request, and this is what the forge says about it now.
 *
 * `merging` is what the forge would do with it as it stands, mapped by the adapter and
 * never by a surface. `conflicting` and `behind` are its two ways of refusing —
 * *behind* is reported only where it is actually refusing for that reason, which makes
 * it a refusal like a conflict rather than a separate concern. `clean` is everything it
 * would let through, and it absorbs the values that are the checks' and the reviews'
 * business rather than the merge's, because those two sections say it better.
 *
 * **`unknown` is a value, never a failure.** The forge computes mergeability lazily and
 * answers this for a while after every push, so anything reading it as broken fires
 * constantly.
 *
 * **Nothing renders `merging` once `state` is not `open`.** The forge keeps answering
 * clean after a merge, and drawing that says *ready to merge* about work already in.
 *
 * `decision` is absent where nobody has reviewed — the forge answers null there, which
 * is *no decision* rather than a verdict of none.
 *
 * `truncated` names the connections only the first page of was read. Every one of them
 * is bounded, and a short list that reads as a complete one is the failure that bounding
 * introduces — so which were cut crosses the wire and a surface says so. `threads`
 * covers the threads under every review at once; there is no per-review flag.
 *
 * **`branch` and `rollup` are what make this answer projectable onto a list row.** The
 * summary a row draws is a strict subset of these fields plus the rollup word, so a
 * browser can fold this answer into the same freshest-per-branch store the listing
 * feeds — a trak's own page keeping the row behind it current. `branch` is the question
 * rather than part of what came back, filled from what was asked; `rollup` is GitHub's
 * own one-word verdict over the head commit, **never a fold of `checks`** — skipped and
 * unrecognised runs sit inside that list, and a second version of the judgement would be
 * free to disagree with the row beside it.
 */
export const PullRequestFoundDto = Schema.TaggedStruct("PullRequest", {
  /** The branch that was asked about — see the header. Absent never happens on an answer
   *  the forge gave, and a surface treats it as nothing to file rather than a claim. */
  branch: Schema.optional(Schema.String),
  number: Schema.Number,
  url: Schema.String,
  title: Schema.String,
  state: Schema.Literal("open", "closed", "merged"),
  isDraft: Schema.Boolean,
  merging: Schema.Literal("conflicting", "behind", "clean", "unknown"),
  decision: Schema.optional(
    Schema.Literal("approved", "changesRequested", "reviewRequired", "commented"),
  ),
  /** The branch the forge merges into, as the remote names it. */
  base: Schema.optional(Schema.String),
  rollup: CheckRollupDto,
  checks: Schema.Array(PullRequestCheckDto),
  reviews: Schema.Array(ReviewDto),
  /**
   * Comments on the pull request itself, attached to no line — plus the comments of any
   * thread whose review could not be identified, which is the alternative to losing a
   * reviewer's words entirely.
   */
  conversation: Schema.Array(PullRequestCommentDto),
  truncated: Schema.Array(Schema.Literal("checks", "reviews", "threads", "conversation")),
  /**
   * The method the forge's merge button offers first on the repository — what the
   * finished band's merge press names, and what `POST /merge-pull-request` merges by. A
   * fact about the repository, carried on this answer because the pane already holds it.
   * Absent where the forge named none this build can read.
   */
  mergeMethod: Schema.optional(Schema.Literal("merge", "squash", "rebase")),
  /**
   * The methods the forge would merge this pull request by, in its own menu's order — the
   * repository's settings narrowed by the base branch's rules. Empty where the forge named
   * none, which a surface reads as not knowing.
   */
  mergeMethods: Schema.Array(Schema.Literal("merge", "squash", "rebase")),
  /**
   * What the forge would say to a merge pressed now, under the repository's own rules — the
   * one thing the finished band's press is live on. Absent where the pull request is not
   * open.
   */
  mergeVerdict: Schema.optional(MergeVerdictDto),
})
export type PullRequestFoundDto = Schema.Schema.Type<typeof PullRequestFoundDto>

/**
 * What the forge says about this trak's branch — the body of
 * `GET /api/traks/:id/pull-request`.
 *
 * **Our shape, not the forge's.** A second forge is a new adapter behind the `Forge`
 * port and no client file changes; passing a provider's own response through would put
 * its vocabulary on every surface that draws it, and take it out again on the day there
 * are two.
 *
 * **A `PullRequest` of any state is what hides the local Merge press** — not its being
 * open. Work that went in through a pull request is never merged from here, so open,
 * closed and merged-on-the-forge all hide it alike, and the other three members leave the
 * press exactly as it behaves on any other trak.
 *
 * No credential crosses this seam and there is no route that serves one: the engine runs
 * the forge's CLI, which uses the machine's own keyring.
 */
export const PullRequestDto = Schema.Union(
  NoPullRequestDto,
  ForgeUnavailableDto,
  ForgeNoOriginDto,
  PullRequestFoundDto,
)
export type PullRequestDto = Schema.Schema.Type<typeof PullRequestDto>

/**
 * One pull request, as much of it as a row on a list needs.
 *
 * **The same words as `PullRequestFoundDto` and a fraction of the fields.** `state`,
 * `isDraft`, `merging` and `decision` are that shape's own literals, mapped by the same
 * tables in the same place — so a row and the pane one click behind it cannot come to
 * disagree about one pull request. What is missing is what makes the other one
 * expensive: no comments, no reviews, no threads, and no page of checks.
 *
 * `checks` is the forge's own rollup over the head commit, in one word. `none` is a
 * commit nothing ran against and `unknown` a rollup state this build does not
 * recognise — **neither is a failure and neither is a pass**, and a surface reading
 * either as one would be turning a thing it cannot tell into a verdict.
 *
 * **`number`, `title` and `url` are here and no list row draws one.** They are the head
 * of a *card*, carried on the coarse answer so a surface can draw one before the detailed
 * answer arrives — which is the whole of what makes a page that already knows a branch has
 * a pull request able to say so without a flash. They are plain scalars on a node the
 * query fetches anyway, so the forge prices them at nothing; every field this shape leaves
 * out is a connection, and that is still the line.
 *
 * **It names no branch.** The branch is what was asked rather than part of what came
 * back, so it lives on the entry below — and that entry is the only thing tying any of
 * this to a trak, exactly as the `Forge` port names no trak either.
 */
export const PullRequestSummaryDto = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  state: Schema.Literal("open", "closed", "merged"),
  isDraft: Schema.Boolean,
  merging: Schema.Literal("conflicting", "behind", "clean", "unknown"),
  decision: Schema.optional(
    Schema.Literal("approved", "changesRequested", "reviewRequired", "commented"),
  ),
  /** `PullRequestFoundDto.base`, so a row's refusal can be sent back naming it. */
  base: Schema.optional(Schema.String),
  checks: CheckRollupDto,
})
export type PullRequestSummaryDto = Schema.Schema.Type<typeof PullRequestSummaryDto>

/**
 * One branch that was asked about, and what came back for it.
 *
 * **An absent `pull` is an answer, not a gap.** The forge was asked about this branch by
 * name and said there is no pull request on it — which a surface may draw as a fact,
 * because nothing about it depends on a page having been read to the end.
 */
export const PullRequestEntryDto = Schema.Struct({
  branch: Schema.String,
  pull: Schema.optional(PullRequestSummaryDto),
})
export type PullRequestEntryDto = Schema.Schema.Type<typeof PullRequestEntryDto>

/**
 * What the forge said about the branches it was handed.
 *
 * **A branch with no entry was not answered about, and a surface may say nothing about
 * it.** That is what a branch past the engine's per-call bound comes back as, and drawing
 * a verdict there would be rendering the bound as a claim about somebody's work. There is
 * no flag saying whether the answer is whole, because there is no page a branch could have
 * fallen off: the request named the branches, so either an entry came back for one or it
 * did not.
 *
 * **One entry per branch, and never two.** The engine settles it, so a surface may index
 * on `branch` without checking.
 */
export const PullRequestsDto = Schema.TaggedStruct("PullRequests", {
  entries: Schema.Array(PullRequestEntryDto),
})
export type PullRequestsDto = Schema.Schema.Type<typeof PullRequestsDto>

/**
 * How many branches one `GET /api/pull-requests` may carry — **the other half of the
 * sentence above.** That one says a branch with no entry was not answered about; this says
 * where the engine stops answering, so a surface can put the same rows past the same line
 * rather than discovering it from a body that named fewer branches than it asked about.
 *
 * **Both sides read this number and neither may hold its own.** A surface that sent more
 * than the engine answers about spends bytes to be told nothing — and past roughly three
 * hundred repeated `branch=` parameters the request line crosses Node's default 16 KB
 * header budget and the server refuses the whole read with a 431, which lands on the page
 * as *no answer at all* rather than as a bounded one. A ceiling that inverts into a
 * refusal three hundred rows past where it was announced is worse than no ceiling.
 *
 * A hundred is where one GraphQL document measured at a single point of quota and a few
 * kilobytes of query string, comfortably inside every budget on either side of the wire.
 *
 * **What crossing it looks like is the point**: the branches past it are simply not asked
 * about, so they come back with no entry and a surface draws them as *we could not ask* —
 * the same reading as a forge that is not there, on the rows it bites and nowhere else.
 */
export const PULL_REQUEST_BRANCH_LIMIT = 100

/**
 * What the forge says about every branch at once — the body of `GET /api/pull-requests`.
 *
 * **`ForgeUnavailable` and `PullRequests` are the two a surface must never collapse.** *We
 * could not ask* is not *there is nothing to say*: the first licenses saying nothing about
 * any branch, the second is a fact about all of them. `NoOrigin` is a fact about all of
 * them too: no branch has a pull request, because there is no remote to hold one. Collapsing them is how an unreachable
 * forge comes to render as a verdict about work it never saw — which is exactly what a
 * per-branch fan-out did here, where the same absence stood for both.
 *
 * It is not under `/api/traks` because it is not about a trak: the route replays no log
 * and reads no store, and it is the caller that names the branches — on the query string,
 * repeated — and matches the entries back to its rows.
 */
export const ForgeListingDto = Schema.Union(ForgeUnavailableDto, ForgeNoOriginDto, PullRequestsDto)
export type ForgeListingDto = Schema.Schema.Type<typeof ForgeListingDto>
