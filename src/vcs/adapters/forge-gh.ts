// The only Layer here: GitHub, through `gh`, over the Process port.
//
// **One process per request, and one query inside it.** Everything the pane draws
// — the pull request, its checks, its reviews, the threads under them and their
// resolution — comes back from a single `gh api graphql`. That is not thrift for
// its own sake: thread resolution is not reachable through `gh pr list --json` in
// any form, so the shape that hides settled conversations behind a counted
// disclosure needs GraphQL anyway, and having gone there a second call would be
// paying twice for what one answer already holds.
//
// **Two queries, and the second exists because the first does not scale by
// caller.** `pullRequest` answers about one branch and costs a process; a surface
// with twenty branches to draw paid twenty of them per poll, over a set that only
// grows. `listing` asks about all of them in one document — one aliased connection
// per branch — and carries a fraction of the payload: no comments, no reviews, no
// threads, and the checks as the rollup's own one-word verdict rather than a page of
// them. Both run through the same call, so there is one place that knows how `gh` is
// spawned and how it fails.
//
// **The listing's document is built per poll, where the other is a constant.** That
// is the price of asking about branches rather than about the repository, and it is
// what buys the property the caller needs: an alias that came back empty is *this
// branch has no pull request*, a fact, where a branch missing from a page of the
// repository's pull requests could equally have been past the bound. It costs one
// GraphQL point per hundred branches against a five-thousand-an-hour budget, so what
// bounds it is the argv rather than the quota.
//
// **`{owner}` and `{repo}` are substituted by `gh` from the working directory**,
// so nothing here reads a remote, parses a URL, or carries a repository name it
// would then have to keep true.
//
// Nothing shells out and nothing reaches the error channel. Every way this can
// go wrong — no `gh`, an expired login, a repository on no forge at all, a
// network that is down, a call that never comes back — is the one answer a caller
// can act on, which is *I could not ask*. See the port.

import { Duration, Effect, Either, Layer, Stream } from "effect"
import { PULL_REQUEST_BRANCH_LIMIT } from "@orkestra/shared/dto/forge"
import { Process, type ProcessShape } from "../../agent/ports/process.js"
import {
  answeredInPart,
  mergeMethodFor,
  readForgeAnswer,
  readForgeListing,
  readMergeOffer,
} from "../logic/forge-answer.js"
import { Forge, type ForgeShape } from "../ports/forge.js"
import {
  ForgeAnswer,
  ForgeListing,
  ForgeMerge,
  ForgeOpen,
  type MergeMethod,
} from "../types/pull-request.js"
import type { BranchName } from "../types/worktree.js"

/**
 * How long a poll may take before it is *no answer*.
 *
 * A pane refetches this, so the cost of waiting longer is a request piling up
 * behind the last one; the cost of waiting less is a slow network reading as a
 * forge that is not there. Ten seconds is well past a healthy call and well
 * short of a person deciding the screen is broken.
 */
const TIMEOUT = Duration.seconds(10)

/**
 * Every connection is bounded, and each bound is a promise that the answer says
 * so when it bites — see `truncated` in `logic/forge-answer.ts`. Fetching
 * everything is the wrong fix: a pull request with three hundred comments is not
 * what this is for.
 */
const PAGE = { comments: 50, reviews: 20, threads: 50, replies: 20, checks: 50, rules: 50 }

/** The repository's default method for this account, and which of the three it allows. */
const REPOSITORY_METHODS =
  "viewerDefaultMergeMethod mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed"

/**
 * What the base branch's protection asks of a merge, from both places the forge keeps it:
 * the classic protection rule and the rulesets. The methods a ruleset allows and linear
 * history narrow the menu; the required checks and approvals explain a `BLOCKED`.
 */
const BASE_RULES = `baseRef {
  branchProtectionRule { requiresLinearHistory requiredApprovingReviewCount requiredStatusCheckContexts }
  rules(first: ${PAGE.rules}) {
    nodes {
      type
      parameters {
        ... on PullRequestParameters { allowedMergeMethods requiredApprovingReviewCount }
        ... on RequiredStatusChecksParameters { requiredStatusChecks { context } }
      }
    }
  }
}`

/**
 * `name`, `completedAt` and `url` are aliased across the two members of the check
 * rollup so a check run and a commit status arrive under the same keys; what
 * tells them apart downstream is that only the first has a `status`.
 *
 * **`id` is asked of a check run and not of a commit status**, which is what
 * gives `toCheck` the two identities it composes: a run has one of its own, and a
 * status's identity is its `context`, because the rollup answers with the latest
 * status *per context* and so never returns one twice. Neither `detailsUrl` nor
 * `targetUrl` can do this job — both are supplied by whoever posted the check.
 *
 * **`databaseId` and the workflow are asked so a superseded run can be dropped** —
 * see `latestRuns` in `logic/forge-answer.ts`. **`workflowRun` needs `actions: read`**,
 * which the host's App token does not carry and an installation may not grant, so the
 * forge refuses it there and answers the rest — `call` keeps that answer, and no other
 * partial one. The cost is the dropping: without the workflow, runs are told apart by job
 * name alone.
 *
 * The newest pull request when a branch has had several — a branch reopened after
 * a close is the ordinary way that happens, and the one somebody is looking at is
 * the one they just made.
 *
 * **The merge settings are the repository's, not the pull request's**, and `baseRef` is
 * the base branch's protection — asked here because the press that merges names its
 * method and offers the others, and this is the answer the pane holds.
 */
const QUERY = `query($owner: String!, $name: String!, $branch: String!) {
  repository(owner: $owner, name: $name) {
    ${REPOSITORY_METHODS}
    pullRequests(headRefName: $branch, first: 1, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes {
        number url title state isDraft mergeable mergeStateStatus reviewDecision baseRefName
        ${BASE_RULES}
        mergeCommit { oid }
        comments(first: ${PAGE.comments}) {
          nodes { author { login } body url createdAt }
          pageInfo { hasNextPage }
        }
        reviews(first: ${PAGE.reviews}) {
          nodes { id author { login } state submittedAt url body }
          pageInfo { hasNextPage }
        }
        reviewThreads(first: ${PAGE.threads}) {
          nodes {
            isResolved isOutdated path line
            comments(first: ${PAGE.replies}) {
              nodes { author { login } body url createdAt diffHunk pullRequestReview { id } }
              pageInfo { hasNextPage }
            }
          }
          pageInfo { hasNextPage }
        }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
                contexts(first: ${PAGE.checks}) {
                  nodes {
                    ... on CheckRun {
                      id databaseId name status conclusion completedAt url: detailsUrl
                      checkSuite { workflowRun { event workflow { name } } }
                    }
                    ... on StatusContext { name: context state completedAt: createdAt url: targetUrl }
                  }
                  pageInfo { hasNextPage }
                }
              }
            }
          }
        }
      }
    }
  }
}`

/**
 * The alias a branch is asked under. Index rather than name, because a GraphQL alias must
 * match `[_A-Za-z][_0-9A-Za-z]*` and `trak/61f8baa7-…` is not one.
 *
 * **Nothing reads it back.** The node carries `headRefName`, so the answer says which
 * branch it is about without a table mapping aliases to names — see the reader.
 */
const alias = (index: number): string => `b${String(index)}`

/**
 * The listing's rows. `headRefName` is what a caller matches on, and everything else
 * is what the ladder on a row reads — the state, the two mergeability fields, the
 * review decision and the rollup's own verdict.
 *
 * **`statusCheckRollup { state }` and not its `contexts`**, which is the whole of why
 * this call is cheap where the one above is not: the rollup answers in one field what
 * a bounded connection of fifty check runs answers in a page.
 *
 * **`number`, `url` and `title` are scalars on a node already being fetched**, so they
 * cost nothing here — GraphQL prices the connections, and this fragment asks for one.
 * They are what lets a surface draw the head of the card from a row's answer.
 * `mergeCommit` is one more such scalar, and the one the engine reads: it is what a
 * trak waiting on `merged` is handed as the commit that landed.
 */
const ROW = `fragment row on PullRequest {
  headRefName headRefOid baseRefName number url title state isDraft mergeable mergeStateStatus reviewDecision
  mergeCommit { oid }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`

/**
 * One document, one connection per branch.
 *
 * **The branch is a variable and never interpolated into the query**, so a ref named
 * with a quote or a brace cannot reshape the document. `gh -f` sends a string field
 * verbatim, where `-F` would read a leading `@` as a filename — which is why `argsFor`
 * above, which still sends its one branch as `-F`, would answer about the wrong thing for
 * a ref named `@work`. Nothing produces one today: every branch either side of this file
 * is `trak/<id>`, and a trak id is a UUID or three lowercase words.
 *
 * `first: 1` newest-first is verbatim the rule the per-branch query above uses, and that
 * is deliberate: a branch that has had several pull requests — reopened after a close is
 * the ordinary way — now resolves to the same one on a row as in the pane a click behind
 * it. The listing used to prefer an open pull request over an ended one, which was a
 * second rule for the same question.
 */
const listingQuery = (branches: readonly BranchName[]): string => {
  const variables = branches.map((_, i) => `$${alias(i)}: String!`).join(", ")
  const connections = branches
    .map(
      (_, i) =>
        `    ${alias(i)}: pullRequests(headRefName: $${alias(i)}, first: 1, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { ...row } }`,
    )
    .join("\n")
  return `query($owner: String!, $name: String!, ${variables}) {
  repository(owner: $owner, name: $name) {
${connections}
  }
}
${ROW}`
}

const repositoryArgs: readonly string[] = ["-F", "owner={owner}", "-F", "name={repo}"]

const argsFor = (branch: BranchName): readonly string[] => [
  "api",
  "graphql",
  "-f",
  `query=${QUERY}`,
  ...repositoryArgs,
  "-F",
  `branch=${branch}`,
]

const listingArgs = (branches: readonly BranchName[]): readonly string[] => [
  "api",
  "graphql",
  "-f",
  `query=${listingQuery(branches)}`,
  ...repositoryArgs,
  ...branches.flatMap((branch, i) => ["-f", `${alias(i)}=${branch}`]),
]

/**
 * The one call, and the three ways it ends.
 *
 * `stdin: undefined` is load-bearing: `gh` prompts — for a login, for a
 * repository it cannot infer — and a prompt on a route is a request that never
 * returns. With stdin ignored it refuses instead, which arrives here as a
 * non-zero exit carrying what it would have asked.
 *
 * The scope is inside the timeout, so timing out closes it and the finalizer
 * kills the process group. The other way round leaves `gh` running after nothing
 * is waiting for it.
 *
 * A non-zero exit is read as *unavailable* rather than picked apart, and
 * deliberately: `gh` reports a missing login, a repository on no forge, a query
 * the API rejected and a network that is down all the same way, and a heuristic
 * over its prose would file one of them under a verdict a caller acts on. Its
 * stderr is carried whole for whoever goes looking.
 *
 * **The one exit read past is a GraphQL answer refused only `workflowRun`** — data beside
 * errors that all name that field, which `gh` exits 1 on. A token refused it still has the
 * pull request in hand, and reading the whole as *unavailable* hid it. Any other refused
 * field is still *unavailable*: read as absent, it would be a verdict. `answeredInPart`
 * reads the body, not the prose.
 */
const call = (
  proc: ProcessShape,
  cwd: string,
  args: readonly string[],
): Effect.Effect<Either.Either<string, string>> =>
  Effect.gen(function* () {
    const spawned = yield* proc.spawn({
      command: "gh",
      args,
      cwd,
      // Merged over the parent environment, which is what lets `gh` find the
      // machine's own keyring. **No token is read here and none is passed on** —
      // the credential stays where the person who logged in put it.
      env: {},
      stdin: undefined,
      holdStdin: false,
    })
    // Drained before awaiting exit, or a full pipe would deadlock the child: a
    // pull request with fifty comments is comfortably more than one pipe buffer.
    const out = yield* Stream.runCollect(spawned.lines)
    const exited = yield* spawned.exited
    const stdout = [...out].join("\n")
    if (exited.code !== 0 && !answeredInPart(stdout)) {
      return Either.left(
        `gh exited ${exited.code ?? exited.signal ?? "?"}: ${exited.stderr.trim()}`,
      )
    }
    return Either.right(stdout)
  }).pipe(
    Effect.scoped,
    Effect.timeoutTo({
      duration: TIMEOUT,
      onTimeout: (): Either.Either<string, string> =>
        Either.left(`gh did not answer within ${Duration.toSeconds(TIMEOUT)}s`),
      onSuccess: (out) => out,
    }),
    // A `gh` that cannot be spawned at all is the commonest case of the lot —
    // the tool is not installed — and it is the same answer as every other. The
    // alternative is a 500 on a route a pane polls.
    Effect.catchTag("ProcessFailed", (e) =>
      Effect.succeed(Either.left(`gh could not be run: ${e.reason}`)),
    ),
  )

/** The forge's own words, or the sentence saying why there are none. */
const ask = (proc: ProcessShape, cwd: string, branch: BranchName): Effect.Effect<ForgeAnswer> =>
  call(proc, cwd, argsFor(branch)).pipe(
    Effect.map(
      Either.match({
        onLeft: (why): ForgeAnswer => ForgeAnswer.Unavailable({ why }),
        onRight: readForgeAnswer,
      }),
    ),
  )

/**
 * The branches the forge was handed, minus whatever was past the bound — and nothing is
 * spawned for none of them.
 *
 * **`PULL_REQUEST_BRANCH_LIMIT` rather than a number of this file's own**, and it comes
 * from the wire package because the surface sending the branches has to stop at the same
 * line: one that sent more than this answers about would spend query-string bytes to be
 * told nothing, and enough of them make the request itself too long to be served. The
 * bound is the same fact on both sides of the wire, so it is written once. This end keeps
 * enforcing it regardless — the port promises a bounded answer to *any* caller, not only
 * to the one that reads the same constant.
 *
 * **An empty ask is answered here rather than by `gh`.** A document with no connection in
 * it is not valid GraphQL, and a caller with nothing on screen wanting nothing asked is
 * the ordinary case rather than an error.
 */
const list = (
  proc: ProcessShape,
  cwd: string,
  branches: readonly BranchName[],
): Effect.Effect<ForgeListing> => {
  // Deduplicated before the bound rather than after, so a caller that named a branch twice
  // spends one alias on it and gets the one entry the port promises.
  const asked = [...new Set(branches)].slice(0, PULL_REQUEST_BRANCH_LIMIT)
  if (asked.length === 0) return Effect.succeed(ForgeListing.Listed({ entries: [] }))
  return call(proc, cwd, listingArgs(asked)).pipe(
    Effect.map(
      Either.match({
        onLeft: (why): ForgeListing => ForgeListing.Unavailable({ why }),
        // The branches actually asked about, never the whole list: a branch past the
        // bound must reach the caller as one nothing was said about.
        onRight: (out) => readForgeListing(out, asked),
      }),
    ),
  )
}

/**
 * The methods this branch's pull request may merge by, and the one this account's merge
 * button offers first. `gh pr merge` refuses to pick one without a terminal, so a merge
 * always names its method — and asks first, because a pick the repository or the base's
 * rules no longer allow is a merge the forge refuses.
 */
const METHOD_QUERY = `query($owner: String!, $name: String!, $branch: String!) {
  repository(owner: $owner, name: $name) {
    ${REPOSITORY_METHODS}
    pullRequests(headRefName: $branch, first: 1, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes { ${BASE_RULES} }
    }
  }
}`

/**
 * Two calls: the methods, then the merge. **The branch stays**, with no `--delete-branch`:
 * the archive removes it with the checkout, and a branch the forge deleted under a
 * checkout still standing is a trak whose `Finished` names something that is gone.
 */
const mergeBranch = (
  proc: ProcessShape,
  cwd: string,
  branch: BranchName,
  pick: MergeMethod | undefined,
): Effect.Effect<ForgeMerge> =>
  Effect.gen(function* () {
    const asked = yield* call(proc, cwd, [
      "api",
      "graphql",
      "-f",
      `query=${METHOD_QUERY}`,
      ...repositoryArgs,
      "-F",
      `branch=${branch}`,
    ])
    if (Either.isLeft(asked)) return ForgeMerge.Refused({ why: asked.left })
    const offer = readMergeOffer(asked.right)
    const method = offer === undefined ? undefined : mergeMethodFor(pick, offer)
    if (method === undefined) {
      return ForgeMerge.Refused({ why: "the forge named no merge method this build can read" })
    }
    const merged = yield* call(proc, cwd, ["pr", "merge", branch, `--${method}`])
    return Either.isLeft(merged) ? ForgeMerge.Refused({ why: merged.left }) : ForgeMerge.Merged()
  })

/**
 * Found by asking for the open one from `head` into `base`, the question `open-pr.sh`
 * asks, and edited in place where there is one. `gh` prints the URL it created as its
 * last line.
 */
const openPull = (
  proc: ProcessShape,
  cwd: string,
  head: BranchName,
  base: BranchName,
  title: string,
  body: string,
): Effect.Effect<ForgeOpen> =>
  Effect.gen(function* () {
    const found = yield* call(proc, cwd, [
      "pr",
      "list",
      "--head",
      head,
      "--base",
      base,
      "--state",
      "open",
      "--limit",
      "1",
      "--json",
      "url",
      "--jq",
      ".[].url",
    ])
    if (Either.isLeft(found)) return ForgeOpen.Refused({ why: found.left })
    const url = found.right.trim()
    const sent = yield* call(
      proc,
      cwd,
      url === ""
        ? ["pr", "create", "--head", head, "--base", base, "--title", title, "--body", body]
        : ["pr", "edit", url, "--title", title, "--body", body],
    )
    if (Either.isLeft(sent)) return ForgeOpen.Refused({ why: sent.left })
    return ForgeOpen.Opened({
      url: url === "" ? (sent.right.trim().split("\n").at(-1) ?? "") : url,
    })
  })

/**
 * `startDir` rather than a repository root, and unlike `GitCliLayer` this
 * resolves nothing at construction: `gh` walks up for the repository itself, and
 * a layer that failed to build because this machine has no forge would take the
 * daemon down over a question it is allowed not to be able to answer.
 */
export const GhForgeLayer = (startDir: string): Layer.Layer<Forge, never, Process> =>
  Layer.effect(
    Forge,
    Effect.gen(function* () {
      const proc = yield* Process
      return {
        pullRequest: (branch) => ask(proc, startDir, branch),
        listing: (branches) => list(proc, startDir, branches),
        merge: (branch, pick) => mergeBranch(proc, startDir, branch, pick),
        openPullRequest: (head, base, title, body) =>
          openPull(proc, startDir, head, base, title, body),
      } satisfies ForgeShape
    }),
  )
