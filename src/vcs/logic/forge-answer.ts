// logic: the forge's own answer, read into ours.
//
// Pure, and that is the point — every judgement worth arguing about lives here
// rather than in the adapter, so the mergeability table, the thread-to-review
// join, a rollup that is absent rather than empty and a connection that was cut
// short are all testable against a captured payload with nothing spawned.
//
// **Absence is read once, at the Schema.** A forge answers `null` where this
// codebase means *absent*, so every nullable field is declared
// `optionalWith(…, { nullable: true })` and arrives as `undefined` — which is why
// nothing below this file's Schemas mentions the other spelling.
//
// **Nothing here fails.** An answer that will not parse, will not decode, or
// names no repository is `Unavailable`: we could not read what the forge said,
// which is the same fact for a caller as not having reached it.

import { Either, Schema } from "effect"
import {
  ForgeAnswer,
  ForgeListing,
  type MergeHold,
  type MergeMethod,
  MergeVerdict,
  type PullRequest,
  type PullRequestCheck,
  type PullRequestComment,
  type PullRequestSummary,
  type Review,
  type ReviewThread,
  type Truncated,
} from "../types/pull-request.js"

// ============================================================================
// The answer's shape
// ============================================================================

/**
 * Everything optional that could conceivably be, and every unknown key ignored.
 *
 * A forge adds fields, deprecates them and nulls them out under partial errors,
 * and a Schema that insisted would turn every one of those into a pane that says
 * nothing at all. What is required below is what the answer is *about* — a pull
 * request with no number is not a pull request.
 */
const nullableString = Schema.optionalWith(Schema.String, { nullable: true })

const PageInfo = Schema.Struct({ hasNextPage: Schema.Boolean })

/** `nodes` and `pageInfo` both absent is an empty, complete connection. */
const connection = <A, I, R>(node: Schema.Schema<A, I, R>) =>
  Schema.Struct({
    nodes: Schema.optionalWith(Schema.Array(node), {
      nullable: true,
      default: (): readonly A[] => [],
    }),
    pageInfo: Schema.optionalWith(PageInfo, {
      nullable: true,
      default: () => ({ hasNextPage: false }),
    }),
  })

const Actor = Schema.Struct({ login: Schema.String })

const CommentNode = Schema.Struct({
  author: Schema.optionalWith(Actor, { nullable: true }),
  body: Schema.String,
  url: Schema.String,
  createdAt: Schema.String,
  diffHunk: nullableString,
  /** The review this comment was written inside — the only link back to one. */
  pullRequestReview: Schema.optionalWith(Schema.Struct({ id: Schema.String }), { nullable: true }),
})

const ReviewNode = Schema.Struct({
  id: Schema.String,
  author: Schema.optionalWith(Actor, { nullable: true }),
  state: Schema.String,
  /** Absent on a review its author has started and not submitted. */
  submittedAt: nullableString,
  url: Schema.String,
  body: nullableString,
})

const ThreadNode = Schema.Struct({
  isResolved: Schema.Boolean,
  isOutdated: Schema.Boolean,
  path: nullableString,
  line: Schema.optionalWith(Schema.Number, { nullable: true }),
  comments: connection(CommentNode),
})

/**
 * One row of the check rollup. `name`, `completedAt` and `url` are aliased in the
 * query so a check run and a commit status arrive under the same keys; `status`
 * and `conclusion` belong to the first and `state` to the second, which is what
 * tells them apart here without reading a type name.
 *
 * `id` is asked of a check run alone, so its absence is the second way of telling
 * the two apart — and the one `toCheck` uses, because a status's identity has to
 * be composed rather than read.
 */
const CheckNode = Schema.Struct({
  id: nullableString,
  /** Increases with every run created, so the larger of two is the later. */
  databaseId: Schema.optionalWith(Schema.Number, { nullable: true }),
  /** Absent on a run no workflow made — a third-party app's. */
  checkSuite: Schema.optionalWith(
    Schema.Struct({
      workflowRun: Schema.optionalWith(
        Schema.Struct({
          event: nullableString,
          workflow: Schema.optionalWith(Schema.Struct({ name: nullableString }), {
            nullable: true,
          }),
        }),
        { nullable: true },
      ),
    }),
    { nullable: true },
  ),
  name: nullableString,
  status: nullableString,
  conclusion: nullableString,
  state: nullableString,
  completedAt: nullableString,
  url: nullableString,
})

/**
 * Absent for a commit nothing ran against — which is most of them, early on.
 *
 * `state` is the rollup's own one-word verdict, asked beside the page of contexts
 * so the whole answer carries the same word the listing's summary does.
 */
const Rollup = Schema.optionalWith(
  Schema.Struct({ state: nullableString, contexts: connection(CheckNode) }),
  { nullable: true },
)

const nullable = <A, I, R>(schema: Schema.Schema<A, I, R>) =>
  Schema.optionalWith(schema, { nullable: true })

/**
 * One ruleset rule on the base branch. `parameters` is a union on the forge's side, and
 * the three fields read here belong to two of its members, so each is optional.
 */
const RuleNode = Schema.Struct({
  type: Schema.String,
  parameters: nullable(
    Schema.Struct({
      allowedMergeMethods: nullable(Schema.Array(Schema.String)),
      requiredApprovingReviewCount: nullable(Schema.Number),
      requiredStatusChecks: nullable(Schema.Array(Schema.Struct({ context: Schema.String }))),
    }),
  ),
})

/**
 * The base branch's protection, read two ways because the forge keeps two: the classic
 * branch protection rule and the rulesets. Absent where the base branch is gone, and the
 * protection rule absent where the account may not read it.
 */
const BaseRef = nullable(
  Schema.Struct({
    branchProtectionRule: nullable(
      Schema.Struct({
        requiresLinearHistory: nullable(Schema.Boolean),
        requiredApprovingReviewCount: nullable(Schema.Number),
        requiredStatusCheckContexts: nullable(Schema.Array(Schema.NullOr(Schema.String))),
      }),
    ),
    rules: nullable(connection(RuleNode)),
  }),
)

const PullRequestNode = Schema.Struct({
  number: Schema.Number,
  url: Schema.String,
  title: Schema.String,
  state: Schema.String,
  isDraft: Schema.Boolean,
  mergeable: nullableString,
  mergeStateStatus: nullableString,
  reviewDecision: nullableString,
  baseRefName: nullableString,
  baseRef: BaseRef,
  // Null on anything not merged, and on a merge commit the forge has garbage-collected.
  mergeCommit: Schema.optionalWith(Schema.Struct({ oid: Schema.String }), { nullable: true }),
  comments: connection(CommentNode),
  reviews: connection(ReviewNode),
  reviewThreads: connection(ThreadNode),
  commits: connection(Schema.Struct({ commit: Schema.Struct({ statusCheckRollup: Rollup }) })),
})

/**
 * The repository's merge settings: its default method for this account, and which of the
 * three it allows at all. Scalars on the repository, so they ride both queries free.
 */
const RepositoryMethods = Schema.Struct({
  viewerDefaultMergeMethod: nullableString,
  mergeCommitAllowed: nullable(Schema.Boolean),
  squashMergeAllowed: nullable(Schema.Boolean),
  rebaseMergeAllowed: nullable(Schema.Boolean),
})

const Answer = Schema.Struct({
  data: Schema.optionalWith(
    Schema.Struct({
      repository: Schema.optionalWith(
        Schema.Struct({ pullRequests: connection(PullRequestNode), ...RepositoryMethods.fields }),
        { nullable: true },
      ),
    }),
    { nullable: true },
  ),
})

type PullRequestNode = Schema.Schema.Type<typeof PullRequestNode>
type CommentNode = Schema.Schema.Type<typeof CommentNode>
type ReviewNode = Schema.Schema.Type<typeof ReviewNode>
type ThreadNode = Schema.Schema.Type<typeof ThreadNode>
type CheckNode = Schema.Schema.Type<typeof CheckNode>

// ============================================================================
// Their words, and ours
// ============================================================================

/**
 * A check run that has not reached `COMPLETED` is running whatever its
 * conclusion currently says, so the status is read before the conclusion.
 *
 * Anything unrecognised is `unknown` rather than absent: a forge that ships a
 * sixth conclusion should draw a row saying so, not silently shorten the list.
 */
const CONCLUSIONS: Record<string, PullRequestCheck["verdict"]> = {
  SUCCESS: "passed",
  FAILURE: "failed",
  TIMED_OUT: "failed",
  CANCELLED: "failed",
  STARTUP_FAILURE: "failed",
  ACTION_REQUIRED: "failed",
  NEUTRAL: "skipped",
  SKIPPED: "skipped",
}

/** A commit status has no lifecycle of its own — its state is the whole of it. */
const STATUSES: Record<string, PullRequestCheck["verdict"]> = {
  SUCCESS: "passed",
  FAILURE: "failed",
  ERROR: "failed",
  PENDING: "running",
  EXPECTED: "running",
}

/**
 * The rollup's own verdict over the head commit, which is one field where the
 * checks are a whole connection of them.
 *
 * The five are every member of the forge's rollup enum. Anything else is `unknown`
 * rather than a pass or a failure — a forge that ships a sixth should make a caller
 * say it does not know, not quietly file it under either.
 */
const ROLLUPS: Record<string, PullRequest["rollup"]> = {
  SUCCESS: "passed",
  FAILURE: "failed",
  ERROR: "failed",
  PENDING: "running",
  EXPECTED: "running",
}

/**
 * `DIRTY` and `BEHIND` are the two ways a forge refuses. Everything else it
 * would let through is `clean` — including `BLOCKED` and `UNSTABLE`, which are
 * rollups of the review and the checks and are said better by those two than by
 * a merge verdict standing in for them.
 */
const MERGE_STATES: Record<string, PullRequest["merging"]> = {
  DIRTY: "conflicting",
  BEHIND: "behind",
  CLEAN: "clean",
  HAS_HOOKS: "clean",
  BLOCKED: "blocked",
  UNSTABLE: "clean",
  DRAFT: "clean",
}

/** The coarser fact, read only where the finer one has not been worked out. */
const MERGEABLE: Record<string, PullRequest["merging"]> = {
  CONFLICTING: "conflicting",
  MERGEABLE: "clean",
}

const STATES: Record<string, PullRequest["state"]> = {
  OPEN: "open",
  CLOSED: "closed",
  MERGED: "merged",
}

const DECISIONS: Record<string, NonNullable<PullRequest["decision"]>> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changesRequested",
  REVIEW_REQUIRED: "reviewRequired",
}

/**
 * `DISMISSED` is a verdict that was withdrawn, so its words are all that is left
 * of it — `commented` is what that is. `PENDING` is a review nobody has
 * submitted; it has no `submittedAt` and is dropped by `at` being absent.
 */
const VERDICTS: Record<string, Review["verdict"]> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changesRequested",
  COMMENTED: "commented",
  DISMISSED: "commented",
}

const named = <A>(table: Record<string, A>, key: string | undefined): A | undefined =>
  key === undefined ? undefined : table[key]

/**
 * Milliseconds, or absent where the forge gave nothing readable.
 *
 * Parsing a timestamp somebody else stamped is not reading a clock — nothing here
 * asks what time it is now, which is what would make this a mapper that publishes
 * the moment it ran under a name claiming otherwise.
 */
const epoch = (iso: string | undefined): number | undefined => {
  if (iso === undefined) return undefined
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? undefined : ms
}

/** What a forge shows for an account that has since gone. */
const GONE = "ghost"

const verdictOf = (node: CheckNode): PullRequestCheck["verdict"] => {
  if (node.status !== undefined) {
    if (node.status !== "COMPLETED") return "running"
    return named(CONCLUSIONS, node.conclusion) ?? "unknown"
  }
  return named(STATUSES, node.state) ?? "unknown"
}

/**
 * A commit's rollup, and the two absences under it.
 *
 * A commit nothing ran against has no rollup at all, and a pull request whose head
 * commit the answer did not carry has no commit — both are `none`, which is *nothing
 * ran* rather than *nothing passed*. **One reader for both queries**: the detailed
 * answer's rollup and the listing's `checks` are the same field off the same node,
 * and a second copy of the `undefined` handling would be free to answer `unknown`
 * where this answers `none` — putting a row in a different pile from the card
 * beside it.
 */
const checksOf = (
  rollup: { readonly state?: string | undefined } | undefined,
): PullRequest["rollup"] => {
  if (rollup === undefined) return "none"
  return named(ROLLUPS, rollup.state) ?? "unknown"
}

/**
 * What tells this check apart from every other in the same answer.
 *
 * **A check run has one and a commit status does not, so a status's is composed
 * from its context** — which is unique because the rollup answers with the latest
 * status per context and so never returns one twice. The two are prefixed rather
 * than mixed, so a forge whose ids happened to look like a context name could not
 * collide with one.
 *
 * **Not the url, and that is the whole point of this function.** `detailsUrl` is
 * set by whichever app created the run and `targetUrl` by whoever posted the
 * status, so several checks pointing at one build page is ordinary — a surface
 * keying on it drew two rows ticked and sent one of them.
 */
const identify = (node: CheckNode, name: string): string =>
  node.id === undefined ? `status:${name}` : `run:${node.id}`

/** Which job a check run is a run of, or absent for a commit status. */
const jobOf = (node: CheckNode): string | undefined => {
  if (node.id === undefined) return undefined
  const run = node.checkSuite?.workflowRun
  return JSON.stringify([node.name, run?.workflow?.name, run?.event])
}

/**
 * The check runs a forge still counts, without the ones a later run replaced.
 *
 * **The rollup answers every run against the commit, superseded or not.** A push
 * that cancels the workflow run before it leaves both runs' jobs on the head commit,
 * so three jobs read as six — three cancelled, three running — where the forge's own
 * page draws three. The forge's rule is the one kept here: one run per job name,
 * workflow and triggering event, the latest created. Keyed on the workflow too
 * because two workflows each with a job called `test` are two checks, not a re-run.
 *
 * A commit status is never collapsed: the rollup already answers one per context.
 */
const latestRuns = (nodes: readonly CheckNode[]): readonly CheckNode[] => {
  const latest = new Map<string, CheckNode>()
  for (const node of nodes) {
    const key = jobOf(node)
    if (key === undefined) continue
    const held = latest.get(key)
    if (held === undefined || (node.databaseId ?? 0) > (held.databaseId ?? 0)) {
      latest.set(key, node)
    }
  }
  return nodes.filter((node) => {
    const key = jobOf(node)
    return key === undefined || latest.get(key) === node
  })
}

const toCheck = (node: CheckNode): PullRequestCheck | undefined => {
  const name = node.name
  if (name === undefined) return undefined
  const at = epoch(node.completedAt)
  return {
    id: identify(node, name),
    name,
    verdict: verdictOf(node),
    ...(at === undefined ? {} : { at }),
    ...(node.url === undefined ? {} : { url: node.url }),
  }
}

/**
 * A comment with no readable timestamp is dropped rather than stamped with a
 * fabricated one: the field is non-null in every forge schema we read, so this is
 * unreachable in practice and a wrong date on a review comment is worse than a
 * comment that is not there.
 */
const toComment = (node: CommentNode): PullRequestComment | undefined => {
  const at = epoch(node.createdAt)
  if (at === undefined) return undefined
  return { who: node.author?.login ?? GONE, body: node.body, url: node.url, at }
}

const present = <A>(items: readonly (A | undefined)[]): readonly A[] =>
  items.filter((item): item is A => item !== undefined)

const toThread = (node: ThreadNode): ReviewThread => {
  const diffHunk = node.comments.nodes[0]?.diffHunk
  return {
    ...(node.path === undefined ? {} : { path: node.path }),
    ...(node.line === undefined ? {} : { line: node.line }),
    ...(diffHunk === undefined ? {} : { diffHunk }),
    resolved: node.isResolved,
    outdated: node.isOutdated,
    comments: present(node.comments.nodes.map(toComment)),
  }
}

// ============================================================================
// The join
// ============================================================================

/**
 * Which review a thread belongs to, taken off the comment that opened it.
 *
 * A forge returns threads in a flat list beside the reviews and offers no link
 * the other way, so this is the only join available — and it is what keeps three
 * people asking for three things from reading as one person asking for three.
 */
const reviewOf = (thread: ThreadNode): string | undefined =>
  thread.comments.nodes[0]?.pullRequestReview?.id

const threadsByReview = (threads: readonly ThreadNode[]): ReadonlyMap<string, ReviewThread[]> => {
  const held = new Map<string, ReviewThread[]>()
  for (const thread of threads) {
    const id = reviewOf(thread)
    if (id === undefined) continue
    const already = held.get(id)
    if (already === undefined) held.set(id, [toThread(thread)])
    else already.push(toThread(thread))
  }
  return held
}

/**
 * One review, or nothing where it is not one yet.
 *
 * A review with no `submittedAt` has not been submitted — it is its author's
 * draft and nobody else can see it — so it is not a review, and neither are the
 * threads under it, which fall through to the conversation below.
 */
const toReview = (
  node: ReviewNode,
  threads: ReadonlyMap<string, ReviewThread[]>,
): Review | undefined => {
  const at = epoch(node.submittedAt)
  const verdict = named(VERDICTS, node.state)
  if (at === undefined || verdict === undefined) return undefined
  return {
    // The forge's own id for the review, which is already what the thread join
    // is keyed on above — so a surface telling two of one person's reviews apart
    // and this file telling their threads apart are the same string.
    id: node.id,
    who: node.author?.login ?? GONE,
    verdict,
    at,
    url: node.url,
    ...(node.body === undefined || node.body === "" ? {} : { body: node.body }),
    threads: threads.get(node.id) ?? [],
  }
}

/**
 * The submitted reviews, and the ids of the ones that survived.
 *
 * Both together rather than the reviews alone, because the conversation is
 * defined against them: a thread whose review was dropped here has to land
 * somewhere, and asking a second time with a second copy of the predicate is how
 * the two answers start disagreeing.
 */
const toReviews = (
  nodes: readonly ReviewNode[],
  threads: ReadonlyMap<string, ReviewThread[]>,
): { readonly reviews: readonly Review[]; readonly kept: ReadonlySet<string> } => {
  const reviews: Review[] = []
  const kept = new Set<string>()
  for (const node of nodes) {
    const review = toReview(node, threads)
    if (review === undefined) continue
    reviews.push(review)
    kept.add(node.id)
  }
  return { reviews, kept }
}

/**
 * Comments on the pull request itself, plus every comment of a thread that
 * belongs to no review we kept — a thread opened by a review beyond the page we
 * read, or by one still in draft.
 *
 * Losing those outright is the alternative, and a reviewer's words going missing
 * because of where they happened to sit is worse than showing them unattributed.
 * Sorted by when they were written, because two sources interleaved in arrival
 * order read as neither.
 */
const toConversation = (
  comments: readonly CommentNode[],
  threads: readonly ThreadNode[],
  kept: ReadonlySet<string>,
): readonly PullRequestComment[] => {
  const orphaned = threads.filter((thread) => {
    const id = reviewOf(thread)
    return id === undefined || !kept.has(id)
  })
  const all = [...comments, ...orphaned.flatMap((thread) => thread.comments.nodes)]
  return present(all.map(toComment)).toSorted((a, b) => a.at - b.at)
}

// ============================================================================
// What a merge pressed now would come to
// ============================================================================

type BaseRefNode = NonNullable<PullRequestNode["baseRef"]>
type RepositoryMethodsNode = Schema.Schema.Type<typeof RepositoryMethods>

/** What the base branch's protection asks of a merge, from both places the forge keeps it. */
interface BaseRules {
  /** The methods every ruleset allows, or absent where no ruleset narrows them. */
  readonly methods?: readonly MergeMethod[]
  /** Linear history is required, which rules out a merge commit. */
  readonly linear: boolean
  /** The checks that must pass, by the name the forge reports them under. */
  readonly required: ReadonlySet<string>
  /** The most approvals any rule asks for, or absent where none names a count. */
  readonly approvals?: number
}

const rulesOf = (base: BaseRefNode | undefined): BaseRules => {
  const classic = base?.branchProtectionRule
  const rules = base?.rules?.nodes ?? []
  let methods: readonly MergeMethod[] | undefined
  const required = new Set(
    (classic?.requiredStatusCheckContexts ?? []).filter((c) => typeof c === "string"),
  )
  const counts = [classic?.requiredApprovingReviewCount ?? 0]
  for (const rule of rules) {
    const allowed = rule.parameters?.allowedMergeMethods
    if (rule.type === "PULL_REQUEST" && allowed !== undefined) {
      const these = present(allowed.map((m) => METHODS[m]))
      methods = methods === undefined ? these : methods.filter((m) => these.includes(m))
    }
    for (const check of rule.parameters?.requiredStatusChecks ?? []) required.add(check.context)
    counts.push(rule.parameters?.requiredApprovingReviewCount ?? 0)
  }
  const approvals = Math.max(...counts)
  return {
    ...(methods === undefined ? {} : { methods }),
    linear:
      classic?.requiresLinearHistory === true ||
      rules.some((rule) => rule.type === "REQUIRED_LINEAR_HISTORY"),
    required,
    ...(approvals > 0 ? { approvals } : {}),
  }
}

const ALLOWED: Record<
  MergeMethod,
  "mergeCommitAllowed" | "squashMergeAllowed" | "rebaseMergeAllowed"
> = {
  merge: "mergeCommitAllowed",
  squash: "squashMergeAllowed",
  rebase: "rebaseMergeAllowed",
}

/**
 * The methods the forge's own menu would offer: the repository's settings, narrowed by
 * every ruleset that names methods, and without a merge commit where linear history is
 * required. A setting the forge did not answer is a method this side cannot vouch for.
 */
const methodsOf = (repository: RepositoryMethodsNode, rules: BaseRules): readonly MergeMethod[] =>
  MERGE_METHODS.filter(
    (method) =>
      repository[ALLOWED[method]] === true &&
      (rules.methods === undefined || rules.methods.includes(method)) &&
      !(method === "merge" && rules.linear),
  )

/**
 * The required checks in one state, by name, once each. `waiting` counts a required check
 * that has not reported at all — but only where the page of checks was whole, since one
 * past the page has reported something this answer cannot see.
 */
const requiredIn = (
  rules: BaseRules,
  checks: readonly PullRequestCheck[],
  cut: boolean,
): { readonly failing: readonly string[]; readonly waiting: readonly string[] } => {
  const failing: string[] = []
  const waiting: string[] = []
  for (const name of rules.required) {
    const runs = checks.filter((check) => check.name === name)
    if (runs.some((run) => run.verdict === "failed")) failing.push(name)
    else if (runs.some((run) => run.verdict === "running") || (runs.length === 0 && !cut)) {
      waiting.push(name)
    }
  }
  return { failing, waiting }
}

/**
 * Why the forge reports `BLOCKED`, from the facts it returns beside the word: the review
 * decision and the required checks. **It returns no sentence of its own**, so a block none
 * of those explains — signed commits, resolved conversations, a deployment — is `rule`.
 */
const blockedBy = (
  node: PullRequestNode,
  rules: BaseRules,
  checks: readonly PullRequestCheck[],
  cut: boolean,
): readonly [MergeHold, ...MergeHold[]] => {
  const holds: MergeHold[] = []
  if (node.reviewDecision === "CHANGES_REQUESTED") holds.push({ cause: "changesRequested" })
  if (node.reviewDecision === "REVIEW_REQUIRED") {
    holds.push({
      cause: "reviewRequired",
      ...(rules.approvals === undefined ? {} : { approvals: rules.approvals }),
    })
  }
  const { failing, waiting } = requiredIn(rules, checks, cut)
  if (failing.length > 0) holds.push({ cause: "checks", names: failing })
  if (waiting.length > 0) holds.push({ cause: "waiting", names: waiting })
  const [first, ...rest] = holds
  return first === undefined ? [{ cause: "rule" }] : [first, ...rest]
}

/**
 * The forge's verdict on a merge pressed now, off `mergeStateStatus`. `CLEAN`, `UNSTABLE` —
 * a check failing that nothing requires — and `HAS_HOOKS` merge. **`UNKNOWN` and anything
 * unrecognised are `Checking`**, the forge still working it out, unless the coarser
 * `mergeable` already says it conflicts.
 */
const mergeVerdictOf = (
  node: PullRequestNode,
  rules: BaseRules,
  checks: readonly PullRequestCheck[],
  cut: boolean,
): MergeVerdict => {
  if (node.isDraft || node.mergeStateStatus === "DRAFT") {
    return MergeVerdict.Blocked({ holds: [{ cause: "draft" }] })
  }
  const status = node.mergeStateStatus
  if (status === "CLEAN" || status === "UNSTABLE" || status === "HAS_HOOKS") {
    return MergeVerdict.Mergeable()
  }
  if (status === "BLOCKED") {
    return MergeVerdict.Blocked({ holds: blockedBy(node, rules, checks, cut) })
  }
  if (status === "BEHIND") return MergeVerdict.Blocked({ holds: [{ cause: "behind" }] })
  return status === "DIRTY" || node.mergeable === "CONFLICTING"
    ? MergeVerdict.Blocked({ holds: [{ cause: "conflicting" }] })
    : MergeVerdict.Checking()
}

// ============================================================================
// The whole answer
// ============================================================================

const truncated = (
  node: PullRequestNode,
  checks: { hasNextPage: boolean },
): readonly Truncated[] => {
  const cut: Truncated[] = []
  if (checks.hasNextPage) cut.push("checks")
  if (node.reviews.pageInfo.hasNextPage) cut.push("reviews")
  // One flag for the threads and for the comments inside them alike: a surface
  // says *there is more of this conversation than you can see*, and which of the
  // two bounds was the one that bit is not a distinction anybody acts on.
  if (
    node.reviewThreads.pageInfo.hasNextPage ||
    node.reviewThreads.nodes.some((thread) => thread.comments.pageInfo.hasNextPage)
  ) {
    cut.push("threads")
  }
  if (node.comments.pageInfo.hasNextPage) cut.push("conversation")
  return cut
}

const toPullRequest = (node: PullRequestNode, repository: RepositoryMethodsNode): PullRequest => {
  // Absent rather than empty is what a commit nothing ran against comes back as,
  // and a walk into it is what throws on every pull request with no CI.
  const rollup = node.commits.nodes[0]?.commit.statusCheckRollup
  const contexts = rollup?.contexts
  const threads = threadsByReview(node.reviewThreads.nodes)
  const { reviews, kept } = toReviews(node.reviews.nodes, threads)
  const decision = named(DECISIONS, node.reviewDecision)
  const mergeCommit = node.mergeCommit?.oid
  const mergeMethod = named(METHODS, repository.viewerDefaultMergeMethod)
  const checks = present(latestRuns(contexts?.nodes ?? []).map(toCheck))
  const cut = contexts?.pageInfo.hasNextPage ?? false
  const rules = rulesOf(node.baseRef)
  const state = named(STATES, node.state) ?? "closed"
  return {
    number: node.number,
    url: node.url,
    title: node.title,
    // `closed` for a state nothing here recognises, and the direction is the whole
    // of the choice: the wire has three states and no fourth for *I could not
    // tell*, and a surface stops drawing `merging` once the state is not `open`.
    // Guessing open would draw *ready to merge* over work that may already be in;
    // guessing closed only understates a pull request that is still going.
    state,
    ...(mergeCommit === undefined ? {} : { mergeCommit }),
    isDraft: node.isDraft,
    merging:
      named(MERGE_STATES, node.mergeStateStatus) ?? named(MERGEABLE, node.mergeable) ?? "unknown",
    ...(decision === undefined ? {} : { decision }),
    ...(node.baseRefName === undefined ? {} : { base: node.baseRefName }),
    rollup: checksOf(rollup),
    checks,
    reviews,
    conversation: toConversation(node.comments.nodes, node.reviewThreads.nodes, kept),
    truncated: truncated(node, contexts?.pageInfo ?? { hasNextPage: false }),
    ...(mergeMethod === undefined ? {} : { mergeMethod }),
    mergeMethods: methodsOf(repository, rules),
    ...(state === "open" ? { mergeVerdict: mergeVerdictOf(node, rules, checks, cut) } : {}),
  }
}

const decode = Schema.decodeUnknownEither(Answer)

/**
 * The forge's reply, as one of the three answers.
 *
 * `Unavailable` covers everything that is not a readable answer — not JSON, not
 * this shape, or a repository the forge says nothing about. The caller has
 * already turned a missing CLI, a refused login and a call that never returned
 * into the same answer, so a reader never has to tell those apart from this.
 */
export const readForgeAnswer = (stdout: string): ForgeAnswer => {
  const parsed = Either.try((): unknown => JSON.parse(stdout))
  if (Either.isLeft(parsed)) {
    return ForgeAnswer.Unavailable({ why: "the forge's answer was not JSON" })
  }
  const answer = decode(parsed.right)
  if (Either.isLeft(answer)) {
    return ForgeAnswer.Unavailable({ why: "the forge answered a shape this build cannot read" })
  }
  const repository = answer.right.data?.repository
  if (repository === undefined) {
    return ForgeAnswer.Unavailable({ why: "the forge knows no such repository" })
  }
  const node = repository.pullRequests.nodes[0]
  if (node === undefined) return ForgeAnswer.None()
  return ForgeAnswer.Found({
    pullRequest: toPullRequest(node, repository),
  })
}

/** The one field a refusal of is tolerated — see `answeredInPart`. */
const TOLERATED = "workflowRun"

const PartialAnswer = Schema.Struct({
  data: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  errors: Schema.NonEmptyArray(
    Schema.Struct({ path: Schema.NonEmptyArray(Schema.Union(Schema.String, Schema.Number)) }),
  ),
})

const decodePartial = Schema.decodeUnknownEither(PartialAnswer)

/**
 * Whether `gh`'s stdout is a GraphQL answer the forge gave in part, and refused only a check
 * suite's `workflowRun`.
 *
 * **`gh api graphql` exits non-zero on any error in the answer, data or none**, and an App
 * token without `actions: read` is refused `workflowRun` on every check run while every
 * other field comes back. Its absence costs `latestRuns` the workflow and event it tells
 * re-runs apart by, and nothing else.
 *
 * **Every error has to name that field, and any other refusal stays a refusal.** The readers
 * here read a null as absent — a refused `nodes` decodes as an empty connection, which is
 * *no pull request*, a verdict a caller acts on by offering the local merge. An error with
 * no `path`, or any path ending elsewhere, leaves the call unavailable with `gh`'s words.
 */
export const answeredInPart = (stdout: string): boolean => {
  const parsed = Either.try((): unknown => JSON.parse(stdout))
  if (Either.isLeft(parsed)) return false
  const answer = decodePartial(parsed.right)
  return (
    Either.isRight(answer) && answer.right.errors.every((error) => error.path.at(-1) === TOLERATED)
  )
}

// ============================================================================
// The listing — every pull request, coarsely, in one answer
// ============================================================================

/**
 * The rollup as the listing asks for it — the word alone, no page of contexts. What
 * it means is `checksOf`'s, shared with the detailed answer's rollup so the two
 * cannot disagree about one commit.
 */
const RollupState = Schema.optionalWith(Schema.Struct({ state: nullableString }), {
  nullable: true,
})

/**
 * The fields the ladder on a list row reads, plus the three a card's head needs.
 *
 * `number`, `url` and `title` are scalars on a node this already decodes, so they are
 * free where every other field the detailed answer carries is a connection.
 */
const SummaryNode = Schema.Struct({
  headRefName: Schema.String,
  headRefOid: nullableString,
  number: Schema.Number,
  url: Schema.String,
  title: Schema.String,
  state: Schema.String,
  mergeCommit: Schema.optionalWith(Schema.Struct({ oid: Schema.String }), { nullable: true }),
  isDraft: Schema.Boolean,
  mergeable: nullableString,
  mergeStateStatus: nullableString,
  reviewDecision: nullableString,
  baseRefName: nullableString,
  commits: connection(Schema.Struct({ commit: Schema.Struct({ statusCheckRollup: RollupState }) })),
})

/**
 * One connection per branch asked about, under an alias the adapter numbered.
 *
 * **A record rather than named fields, and the aliases are never read.** They exist
 * because a branch name is not a legal GraphQL alias; what ties a node back to a branch is
 * the `headRefName` the node itself carries, so this decodes the shape and `byBranch`
 * below does the matching.
 */
const ListingAnswer = Schema.Struct({
  data: Schema.optionalWith(
    Schema.Struct({
      repository: Schema.optionalWith(
        Schema.Record({ key: Schema.String, value: connection(SummaryNode) }),
        { nullable: true },
      ),
    }),
    { nullable: true },
  ),
})

type SummaryNode = Schema.Schema.Type<typeof SummaryNode>

/**
 * The same three readings the detailed answer makes — the state, the merge verdict and
 * the review decision — off the same tables, which is what stops a row and the pane
 * behind it disagreeing about one pull request.
 */
const toSummary = (node: SummaryNode): PullRequestSummary => {
  const decision = named(DECISIONS, node.reviewDecision)
  const mergeCommit = node.mergeCommit?.oid
  return {
    number: node.number,
    url: node.url,
    title: node.title,
    // `closed` for a state nothing here recognises, for `toPullRequest`'s reason.
    state: named(STATES, node.state) ?? "closed",
    ...(mergeCommit === undefined ? {} : { mergeCommit }),
    isDraft: node.isDraft,
    merging:
      named(MERGE_STATES, node.mergeStateStatus) ?? named(MERGEABLE, node.mergeable) ?? "unknown",
    ...(decision === undefined ? {} : { decision }),
    ...(node.baseRefName === undefined ? {} : { base: node.baseRefName }),
    checks: checksOf(node.commits.nodes[0]?.commit.statusCheckRollup),
    ...(node.headRefOid === undefined ? {} : { head: node.headRefOid }),
  }
}

/**
 * Every node the answer carried, keyed by the branch it names.
 *
 * **Read off `headRefName` rather than off the alias it arrived under**, because the alias
 * is an index and the node already says which branch it is. First wins, though a second
 * takes a forge answering one `headRefName` filter with a pull request on another branch.
 *
 * The rule for which pull request a branch with several resolves to has moved into the
 * query — newest first, one node per branch — and it is now the same rule the per-branch
 * answer uses. It used to be here and it used to differ: an open pull request was
 * preferred over an ended one, so a branch reopened and re-closed could read one way on a
 * row and another in the pane a click behind it.
 */
const byBranch = (
  aliased: Record<string, { readonly nodes: readonly SummaryNode[] }>,
): ReadonlyMap<string, SummaryNode> => {
  const found = new Map<string, SummaryNode>()
  for (const answer of Object.values(aliased)) {
    for (const node of answer.nodes) {
      if (!found.has(node.headRefName)) found.set(node.headRefName, node)
    }
  }
  return found
}

const decodeListing = Schema.decodeUnknownEither(ListingAnswer)

/**
 * The forge's reply to the listing query, as one of the two answers.
 *
 * **One entry per branch asked about, whether or not one came back.** That is the whole
 * shape of the thing: the question named the branches, so an empty connection is *this
 * branch has no pull request* rather than *not read this far*, and a caller may act on it.
 *
 * Everything unreadable is `Unavailable`, exactly as it is for one branch — and here that
 * matters more, because a caller reads an entry with no pull request as a fact about
 * somebody's work. Nothing below invents an entry out of a payload it could not parse, and
 * nothing writes one for a branch that was not in `branches`.
 */
export const readForgeListing = (stdout: string, branches: readonly string[]): ForgeListing => {
  const parsed = Either.try((): unknown => JSON.parse(stdout))
  if (Either.isLeft(parsed)) {
    return ForgeListing.Unavailable({ why: "the forge's answer was not JSON" })
  }
  const answer = decodeListing(parsed.right)
  if (Either.isLeft(answer)) {
    return ForgeListing.Unavailable({ why: "the forge answered a shape this build cannot read" })
  }
  const repository = answer.right.data?.repository
  if (repository === undefined) {
    return ForgeListing.Unavailable({ why: "the forge knows no such repository" })
  }
  const found = byBranch(repository)
  return ForgeListing.Listed({
    entries: branches.map((branch) => {
      const node = found.get(branch)
      return node === undefined ? { branch } : { branch, pull: toSummary(node) }
    }),
  })
}

// ============================================================================
// The merge method
// ============================================================================

/** GitHub's words for the three methods, and ours. */
const METHODS: Record<string, MergeMethod> = { MERGE: "merge", SQUASH: "squash", REBASE: "rebase" }

/** Every method, in the order the forge's own menu lists them. */
const MERGE_METHODS: readonly MergeMethod[] = ["merge", "squash", "rebase"]

const MethodAnswer = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.Struct({
      ...RepositoryMethods.fields,
      pullRequests: connection(Schema.Struct({ baseRef: BaseRef })),
    }),
  }),
})

const decodeMethod = Schema.decodeUnknownEither(MethodAnswer)

/** The methods a merge of one pull request may use, and the one the forge offers first. */
export interface MergeOffer {
  readonly fallback?: MergeMethod
  readonly allowed: readonly MergeMethod[]
}

/**
 * The forge's answer to the merge query — the repository's settings and the base branch's
 * rules, read as `methodsOf` reads them for the pane — or `undefined` where it cannot be
 * read.
 */
export const readMergeOffer = (stdout: string): MergeOffer | undefined => {
  const parsed = Either.try((): unknown => JSON.parse(stdout))
  if (Either.isLeft(parsed)) return undefined
  const answer = decodeMethod(parsed.right)
  if (Either.isLeft(answer)) return undefined
  const repository = answer.right.data.repository
  const fallback = named(METHODS, repository.viewerDefaultMergeMethod)
  const rules = rulesOf(repository.pullRequests.nodes[0]?.baseRef)
  return {
    ...(fallback === undefined ? {} : { fallback }),
    allowed: methodsOf(repository, rules),
  }
}

/**
 * The method a merge uses: the person's pick where the forge still allows it, then the
 * forge's own first offer, then the first method it allows. **Allowed-or-not is only read
 * where the forge named some** — an empty list is not knowing, and the pick goes through
 * for the forge to refuse with its own words.
 */
export const mergeMethodFor = (
  pick: MergeMethod | undefined,
  offer: MergeOffer,
): MergeMethod | undefined => {
  const allows = (m: MergeMethod | undefined): m is MergeMethod =>
    m !== undefined && (offer.allowed.length === 0 || offer.allowed.includes(m))
  if (allows(pick)) return pick
  if (allows(offer.fallback)) return offer.fallback
  return offer.allowed[0]
}
