// The forge's answer, read into ours — every judgement, with nothing spawned.
//
// The fixtures are written as the payload `gh api graphql` prints, nulls
// included, because the nulls are half of what this file is about: a commit with
// no CI answers `statusCheckRollup: null` rather than an empty list, and a pull
// request nobody has reviewed answers `reviewDecision: null` rather than the
// empty string the REST transport would have given.

import { describe, expect, it } from "vitest"
import {
  mergeMethodFor,
  readForgeAnswer,
  readForgeListing,
  readMergeOffer,
} from "./forge-answer.js"
import type { ForgeAnswer, ForgeListing, PullRequest } from "../types/pull-request.js"

/**
 * A forge writes it and reading it is the whole point of half these cases, so it
 * is spelled once here and referred to everywhere else.
 */
// oxlint-disable-next-line unicorn/no-null -- the payload under test contains it
const NOTHING = null

const page = (hasNextPage = false) => ({ pageInfo: { hasNextPage } })

const connection = (nodes: readonly unknown[], hasNextPage = false) => ({
  nodes,
  ...page(hasNextPage),
})

const comment = (over: Record<string, unknown> = {}) => ({
  author: { login: "ali" },
  body: "this reads oddly",
  url: "https://forge/c/1",
  createdAt: "2026-08-19T10:00:00Z",
  ...over,
})

const review = (over: Record<string, unknown> = {}) => ({
  id: "R1",
  author: { login: "ali" },
  state: "CHANGES_REQUESTED",
  submittedAt: "2026-08-19T10:00:00Z",
  url: "https://forge/r/1",
  body: NOTHING,
  ...over,
})

const thread = (over: Record<string, unknown> = {}) => ({
  isResolved: false,
  isOutdated: false,
  path: "src/app/server.ts",
  line: 12,
  comments: connection([comment({ pullRequestReview: { id: "R1" } })]),
  ...over,
})

const rollup = (nodes: readonly unknown[], hasNextPage = false) =>
  connection([{ commit: { statusCheckRollup: { contexts: connection(nodes, hasNextPage) } } }])

/** The workflow and event a check run came from — what tells a re-run from a second check. */
const from = (workflow: string, event = "pull_request") => ({
  checkSuite: { workflowRun: { event, workflow: { name: workflow } } },
})

/** The rollup with its own one-word verdict beside the page of contexts, as the detail
 *  query now asks for it. */
const rolledUp = (state: unknown, nodes: readonly unknown[] = []) =>
  connection([{ commit: { statusCheckRollup: { state, contexts: connection(nodes) } } }])

const node = (over: Record<string, unknown> = {}) => ({
  number: 7,
  url: "https://forge/pr/7",
  title: "Add a --json flag",
  state: "OPEN",
  isDraft: false,
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  reviewDecision: NOTHING,
  comments: connection([]),
  reviews: connection([]),
  reviewThreads: connection([]),
  commits: connection([{ commit: { statusCheckRollup: NOTHING } }]),
  ...over,
})

const read = (over: Record<string, unknown> = {}): ForgeAnswer =>
  readForgeAnswer(
    JSON.stringify({ data: { repository: { pullRequests: connection([node(over)]) } } }),
  )

/** Every case below is about a pull request that is there, so unwrap it once. */
const found = (over: Record<string, unknown> = {}): PullRequest => {
  const answer = read(over)
  expect(answer._tag).toBe("Found")
  if (answer._tag !== "Found") throw new Error("unreachable")
  return answer.pullRequest
}

describe("what came back at all", () => {
  it("reads no pull request as none, which is not the same as not having asked", () => {
    const answer = readForgeAnswer(
      JSON.stringify({ data: { repository: { pullRequests: connection([]) } } }),
    )
    expect(answer).toStrictEqual({ _tag: "None" })
  })

  it("reads an answer that is not JSON as the forge being unreachable", () => {
    expect(readForgeAnswer("gh: command not found")._tag).toBe("Unavailable")
  })

  it("reads a repository the forge says nothing about as unreachable, not as none", () => {
    expect(readForgeAnswer(JSON.stringify({ data: { repository: NOTHING } }))._tag).toBe(
      "Unavailable",
    )
  })

  it("reads a shape it does not recognise as unreachable rather than throwing", () => {
    expect(
      readForgeAnswer(
        JSON.stringify({ data: { repository: { pullRequests: connection([{ number: 7 }]) } } }),
      )._tag,
    ).toBe("Unavailable")
  })

  it("carries the repository's default merge method beside the pull request", () => {
    const answer = readForgeAnswer(
      JSON.stringify({
        data: {
          repository: { viewerDefaultMergeMethod: "SQUASH", pullRequests: connection([node()]) },
        },
      }),
    )
    expect(answer._tag === "Found" && answer.pullRequest.mergeMethod).toBe("squash")
  })

  it("leaves the method out where the forge names none it can read", () => {
    expect(found().mergeMethod).toBeUndefined()
  })

  it("understates a state it does not recognise rather than reading it as open", () => {
    // Open is the one value that makes a surface draw mergeability, so an
    // unrecognised state guessed that way says *ready to merge* about work
    // nothing here can account for.
    expect(found({ state: "A_NEW_ONE" }).state).toBe("closed")
  })

  it("carries the pull request's own facts across", () => {
    expect(found({ state: "MERGED", isDraft: true })).toMatchObject({
      number: 7,
      url: "https://forge/pr/7",
      title: "Add a --json flag",
      state: "merged",
      isDraft: true,
    })
  })

  it("carries the merge commit where the forge reports one, and omits it where it does not", () => {
    // What the engine records as where the work went when a merged trak is archived.
    expect(found({ state: "MERGED", mergeCommit: { oid: "9f31c07aa11" } }).mergeCommit).toBe(
      "9f31c07aa11",
    )
    // Null on anything not merged — absent rather than present-and-undefined.
    expect("mergeCommit" in found({ mergeCommit: NOTHING })).toBe(false)
  })
})

describe("whether the forge would merge it", () => {
  const cases: readonly [string, string, PullRequest["merging"]][] = [
    ["DIRTY", "CONFLICTING", "conflicting"],
    ["BEHIND", "MERGEABLE", "behind"],
    ["CLEAN", "MERGEABLE", "clean"],
    ["HAS_HOOKS", "MERGEABLE", "clean"],
    // The forge's protection holding the merge: kept apart, because the engine must not
    // merge on it. The wire draws it as `clean`.
    ["BLOCKED", "MERGEABLE", "blocked"],
    // Rollups of the checks and the review, which say it better than a merge
    // verdict standing in for them.
    ["UNSTABLE", "MERGEABLE", "clean"],
    ["DRAFT", "MERGEABLE", "clean"],
  ]
  for (const [status, mergeable, merging] of cases) {
    it(`reads ${status} as ${merging}`, () => {
      expect(found({ mergeStateStatus: status, mergeable }).merging).toBe(merging)
    })
  }

  it("falls back to the coarser fact while the finer one is still being worked out", () => {
    expect(found({ mergeStateStatus: "UNKNOWN", mergeable: "CONFLICTING" }).merging).toBe(
      "conflicting",
    )
    expect(found({ mergeStateStatus: "UNKNOWN", mergeable: "MERGEABLE" }).merging).toBe("clean")
  })

  it("says it does not know, rather than clean or broken, when neither has been worked out", () => {
    expect(found({ mergeStateStatus: "UNKNOWN", mergeable: "UNKNOWN" }).merging).toBe("unknown")
    expect(found({ mergeStateStatus: NOTHING, mergeable: NOTHING }).merging).toBe("unknown")
  })
})

describe("the checks", () => {
  it("reads a commit nothing ran against as no checks rather than throwing", () => {
    expect(found().checks).toStrictEqual([])
    expect(found().truncated).toStrictEqual([])
  })

  /**
   * The rollup word beside the page of checks — GitHub's own verdict over the head commit,
   * read through the same table as the listing's `checks` so a card and the row behind it
   * cannot come to disagree about one commit. `none` is a commit nothing ran against and
   * `unknown` a state this build has never seen; neither is a pass or a failure.
   */
  it("carries the rollup's own word, and tells nothing-ran from nothing-known", () => {
    expect(found({ commits: rolledUp("SUCCESS") }).rollup).toBe("passed")
    expect(found({ commits: rolledUp("FAILURE") }).rollup).toBe("failed")
    expect(found({ commits: rolledUp("ERROR") }).rollup).toBe("failed")
    expect(found({ commits: rolledUp("PENDING") }).rollup).toBe("running")
    expect(found({ commits: rolledUp("EXPECTED") }).rollup).toBe("running")
    expect(found({ commits: rolledUp("QUARANTINED") }).rollup).toBe("unknown")
    // A commit nothing ran against has no rollup at all, which is a third thing.
    expect(found().rollup).toBe("none")
    // And a rollup whose word is missing while its contexts are not is *not known* — the
    // word was asked for and did not come back, which is not the same as nothing ran.
    expect(found({ commits: rollup([{ name: "verify", state: "SUCCESS" }]) }).rollup).toBe(
      "unknown",
    )
  })

  it("reads all five verdicts as themselves", () => {
    const checks = found({
      commits: rollup([
        { name: "verify", status: "COMPLETED", conclusion: "SUCCESS" },
        { name: "smoke", status: "COMPLETED", conclusion: "FAILURE" },
        { name: "docs", status: "IN_PROGRESS", conclusion: NOTHING },
        { name: "e2e", status: "COMPLETED", conclusion: "SKIPPED" },
        { name: "audit", status: "COMPLETED", conclusion: "A_NEW_ONE" },
      ]),
    }).checks
    expect(checks.map((c) => c.verdict)).toStrictEqual([
      "passed",
      "failed",
      "running",
      "skipped",
      "unknown",
    ])
  })

  it("reads a commit status, which has a state where a check run has a status", () => {
    expect(
      found({
        commits: rollup([
          { name: "ci/legacy", state: "FAILURE", completedAt: "2026-08-19T10:00:00Z" },
          { name: "ci/waiting", state: "PENDING" },
        ]),
      }).checks,
    ).toStrictEqual([
      {
        id: "status:ci/legacy",
        name: "ci/legacy",
        verdict: "failed",
        at: Date.parse("2026-08-19T10:00:00Z"),
      },
      { id: "status:ci/waiting", name: "ci/waiting", verdict: "running" },
    ])
  })

  it("carries when a check ended and where to read it, and never its output", () => {
    const [check] = found({
      commits: rollup([
        {
          id: "CR_1",
          name: "verify",
          status: "COMPLETED",
          conclusion: "FAILURE",
          completedAt: "2026-08-19T11:30:00Z",
          url: "https://forge/runs/9",
        },
      ]),
    }).checks
    expect(check).toStrictEqual({
      id: "run:CR_1",
      name: "verify",
      verdict: "failed",
      at: Date.parse("2026-08-19T11:30:00Z"),
      url: "https://forge/runs/9",
    })
  })
})

describe("a re-run", () => {
  /** A push that cancels the run before it leaves both runs' jobs on the head commit,
   *  and the forge's own page counts only the later one. */
  it("drops a run a later run of the same job replaced", () => {
    const run = (id: number, name: string, over: Record<string, unknown>) => ({
      id: `CR_${String(id)}`,
      databaseId: id,
      name,
      ...from("ci"),
      ...over,
    })
    const cancelled = { status: "COMPLETED", conclusion: "CANCELLED" }
    const running = { status: "IN_PROGRESS", conclusion: NOTHING }
    expect(
      found({
        commits: rollup([
          run(1, "verify (engine)", cancelled),
          run(4, "verify (engine)", running),
          run(2, "verify (apps)", cancelled),
          // Order is not age: the later run can arrive first.
          run(6, "verify (browser)", { status: "COMPLETED", conclusion: "FAILURE" }),
          run(3, "verify (browser)", cancelled),
          run(5, "verify (apps)", running),
          // The same job triggered by another event is another check.
          run(7, "verify (apps)", { ...cancelled, ...from("ci", "push") }),
        ]),
      }).checks.map((c) => [c.id, c.verdict]),
    ).toStrictEqual([
      ["run:CR_4", "running"],
      ["run:CR_6", "failed"],
      ["run:CR_5", "running"],
      ["run:CR_7", "failed"],
    ])
  })
})

/**
 * **What a surface may key a tick on.** Nothing else on a check or a review is unique:
 * two workflows each with a job called `test` is ordinary, and so is one person reviewing
 * twice — and a url is worse than a name, because it looks unique and is supplied by
 * whoever posted the run.
 */
describe("what tells two of a kind apart", () => {
  it("gives two checks of one name and one link two identities", () => {
    const same = { name: "test", url: "https://forge/build/1" }
    expect(
      found({
        commits: rollup([
          { ...same, id: "CR_1", status: "COMPLETED", conclusion: "FAILURE", ...from("ci") },
          { ...same, id: "CR_2", status: "COMPLETED", conclusion: "FAILURE", ...from("lint") },
          // A commit status, which has no id of its own — so its context is what names it,
          // and the rollup answers the latest status per context, never one twice.
          { ...same, name: "ci/legacy", state: "FAILURE" },
        ]),
      }).checks.map((c) => c.id),
    ).toStrictEqual(["run:CR_1", "run:CR_2", "status:ci/legacy"])
  })

  /** The same string the thread join is keyed on, so a surface telling two of one person's
   *  reviews apart and this file telling their threads apart cannot disagree. */
  it("carries the forge's own id for a review, which two by one person do not share", () => {
    expect(
      found({
        reviews: connection([
          review({ id: "R1", url: "https://forge/r/same" }),
          review({ id: "R2", url: "https://forge/r/same" }),
        ]),
      }).reviews.map((r) => r.id),
    ).toStrictEqual(["R1", "R2"])
  })
})

describe("the reviews and what was said on them", () => {
  it("puts each comment under the review that made it, never in one pile", () => {
    const pr = found({
      reviews: connection([
        review({ id: "R1", author: { login: "ali" }, body: "a few things" }),
        review({ id: "R2", author: { login: "sam" }, state: "APPROVED" }),
      ]),
      reviewThreads: connection([
        thread({ comments: connection([comment({ pullRequestReview: { id: "R2" } })]) }),
        thread(),
      ]),
    })
    expect(pr.reviews.map((r) => [r.who, r.verdict, r.threads.length])).toStrictEqual([
      ["ali", "changesRequested", 1],
      ["sam", "approved", 1],
    ])
    expect(pr.reviews[0]?.body).toBe("a few things")
    expect(pr.conversation).toStrictEqual([])
  })

  it("carries a thread's position, its diff and whether it is settled", () => {
    const [thread0] =
      found({
        reviews: connection([review()]),
        reviewThreads: connection([
          thread({
            isResolved: true,
            isOutdated: true,
            comments: connection([
              comment({ pullRequestReview: { id: "R1" }, diffHunk: "@@ -1 +1 @@" }),
            ]),
          }),
        ]),
      }).reviews[0]?.threads ?? []
    expect(thread0).toMatchObject({
      path: "src/app/server.ts",
      line: 12,
      diffHunk: "@@ -1 +1 @@",
      resolved: true,
      outdated: true,
    })
  })

  it("leaves out a position the forge no longer has rather than inventing one", () => {
    const [thread0] =
      found({
        reviews: connection([review()]),
        reviewThreads: connection([thread({ path: NOTHING, line: NOTHING })]),
      }).reviews[0]?.threads ?? []
    expect(thread0?.path).toBeUndefined()
    expect(thread0?.line).toBeUndefined()
  })

  it("keeps the words of a thread whose review it cannot identify, in the conversation", () => {
    const pr = found({
      comments: connection([comment({ body: "shipping this", createdAt: "2026-08-19T09:00:00Z" })]),
      reviews: connection([review()]),
      reviewThreads: connection([
        thread({
          comments: connection([
            comment({
              body: "orphaned",
              createdAt: "2026-08-19T12:00:00Z",
              pullRequestReview: { id: "R-beyond-the-page" },
            }),
          ]),
        }),
      ]),
    })
    expect(pr.reviews[0]?.threads).toStrictEqual([])
    // In the order they were written, rather than in the order the two lists
    // happened to arrive in.
    expect(pr.conversation.map((c) => c.body)).toStrictEqual(["shipping this", "orphaned"])
  })

  it("is not fooled by a review nobody has submitted", () => {
    const pr = found({
      reviews: connection([review({ id: "R9", state: "PENDING", submittedAt: NOTHING })]),
      reviewThreads: connection([
        thread({
          comments: connection([comment({ body: "a draft", pullRequestReview: { id: "R9" } })]),
        }),
      ]),
    })
    expect(pr.reviews).toStrictEqual([])
    expect(pr.conversation.map((c) => c.body)).toStrictEqual(["a draft"])
  })

  it("keeps a withdrawn verdict's words without keeping the verdict", () => {
    expect(
      found({ reviews: connection([review({ state: "DISMISSED" })]) }).reviews[0],
    ).toMatchObject({ verdict: "commented" })
  })

  it("names an account that has gone rather than dropping what it said", () => {
    expect(
      found({ comments: connection([comment({ author: NOTHING })]) }).conversation[0]?.who,
    ).toBe("ghost")
  })

  it("says nobody has decided rather than that they decided nothing", () => {
    expect(found().decision).toBeUndefined()
    expect(found({ reviewDecision: "CHANGES_REQUESTED" }).decision).toBe("changesRequested")
    expect(found({ reviewDecision: "REVIEW_REQUIRED" }).decision).toBe("reviewRequired")
  })
})

describe("what was cut short", () => {
  it("says nothing was, when nothing was", () => {
    expect(
      found({ commits: rollup([{ name: "verify", state: "SUCCESS" }]) }).truncated,
    ).toStrictEqual([])
  })

  it("names each bounded list it only read the first page of", () => {
    expect(
      found({
        comments: connection([comment()], true),
        reviews: connection([review()], true),
        reviewThreads: connection([thread()], true),
        commits: rollup([{ name: "verify", state: "SUCCESS" }], true),
      }).truncated,
    ).toStrictEqual(["checks", "reviews", "threads", "conversation"])
  })

  it("counts a conversation cut short inside one thread as the threads being cut", () => {
    expect(
      found({
        reviews: connection([review()]),
        reviewThreads: connection([
          thread({
            comments: connection([comment({ pullRequestReview: { id: "R1" } })], true),
          }),
        ]),
      }).truncated,
    ).toStrictEqual(["threads"])
  })
})

// ============================================================================
// The listing — every pull request, coarsely, in one answer
// ============================================================================

const row = (over: Record<string, unknown> = {}) => ({
  headRefName: "trak/a",
  number: 7,
  url: "https://github.com/o/r/pull/7",
  title: "Remember the last thing GitHub said",
  state: "OPEN",
  isDraft: false,
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  reviewDecision: NOTHING,
  commits: connection([{ commit: { statusCheckRollup: NOTHING } }]),
  ...over,
})

/** The rollup as the listing query asks for it — one field, not a page of contexts. */
const rolled = (state: unknown) => connection([{ commit: { statusCheckRollup: { state } } }])

/**
 * The answer's shape: one aliased connection per branch asked about, in the order they
 * were asked. Each entry is the nodes that alias came back with — `[]` for a branch the
 * forge has no pull request on.
 */
const listed = (
  branches: readonly string[],
  answers: readonly (readonly unknown[])[],
): ForgeListing =>
  readForgeListing(
    JSON.stringify({
      data: {
        repository: Object.fromEntries(
          answers.map((nodes, i) => [`b${String(i)}`, connection(nodes)]),
        ),
      },
    }),
    branches,
  )

/** Every case below is about an answer that came back, so unwrap it once. */
const whole = (
  branches: readonly string[],
  answers: readonly (readonly unknown[])[],
): Extract<ForgeListing, { _tag: "Listed" }> => {
  const listing = listed(branches, answers)
  expect(listing._tag).toBe("Listed")
  if (listing._tag !== "Listed") throw new Error("unreachable")
  return listing
}

/** One branch, one answer — what most cases below are about. */
const only = (nodes: readonly unknown[] = []) => whole(["trak/a"], [nodes]).entries[0]

describe("the base branch", () => {
  it("is named on both answers, where the forge gave one", () => {
    expect(only([row({ baseRefName: "main" })])?.pull?.base).toBe("main")
    expect(only([row()])?.pull).not.toHaveProperty("base")
    expect(found({ baseRefName: "main" }).base).toBe("main")
    expect(found()).not.toHaveProperty("base")
  })
})

describe("the listing", () => {
  it("names the head commit its checks were read against, where the forge gave one", () => {
    expect(only([row({ headRefOid: "abc123" })])?.pull?.head).toBe("abc123")
    expect(only([row()])?.pull).not.toHaveProperty("head")
  })

  it("writes an entry with no pull request for a branch the forge has none on", () => {
    // The difference the whole change turns on: an entry saying *there is none* is a fact
    // about that branch, where a branch with no entry licenses saying nothing about it.
    expect(only()).toStrictEqual({ branch: "trak/a" })
  })

  /** The three scalars a card's head is drawn from. They are the only fields here that
   *  no list row reads, so nothing else in this file would notice them going missing. */
  it("carries the pull request's number, title and link", () => {
    expect(only([row()])?.pull).toMatchObject({
      number: 7,
      url: "https://github.com/o/r/pull/7",
      title: "Remember the last thing GitHub said",
    })
  })

  it("carries the merge commit where the pull request merged, and nothing where it did not", () => {
    // The one field of a row the engine reads: what a trak waiting on `merged` is handed.
    expect(
      only([row({ state: "MERGED", mergeCommit: { oid: "9f31c07aa11" } })])?.pull,
    ).toMatchObject({ state: "merged", mergeCommit: "9f31c07aa11" })
    expect("mergeCommit" in (only([row()])?.pull ?? {})).toBe(false)
  })

  it("writes one entry per branch asked about, in the order they were asked", () => {
    expect(
      whole(["trak/a", "trak/b"], [[], [row({ headRefName: "trak/b" })]]).entries.map((entry) => [
        entry.branch,
        entry.pull?.state,
      ]),
    ).toStrictEqual([
      ["trak/a", undefined],
      ["trak/b", "open"],
    ])
  })

  /** The bound, and a stale answer to a different question, both arrive this way: the
   *  branch was never in the document, so nothing may be said about it. */
  it("writes nothing at all for a branch that was not asked about", () => {
    expect(whole([], [[row()]]).entries).toStrictEqual([])
  })

  it("reads an answer that is not JSON as the forge being unreachable", () => {
    expect(readForgeListing("gh: command not found", ["trak/a"])._tag).toBe("Unavailable")
  })

  it("reads a repository the forge says nothing about as unreachable, not as empty", () => {
    // Entries with no pull request would be read by a caller as *no branch has one*, which
    // is a claim about every row on a page from an answer that said nothing at all.
    expect(
      readForgeListing(JSON.stringify({ data: { repository: NOTHING } }), ["trak/a"])._tag,
    ).toBe("Unavailable")
  })

  it("reads a shape it does not recognise as unreachable rather than throwing", () => {
    expect(
      readForgeListing(JSON.stringify({ data: { repository: { b0: 4 } } }), ["trak/a"])._tag,
    ).toBe("Unavailable")
  })

  it("reads the same words for a state, a merge verdict and a decision as the pane does", () => {
    // Off the same tables, which is what stops a row and the pane one click behind it
    // disagreeing about one pull request.
    expect(
      only([
        row({ state: "MERGED", mergeStateStatus: "DIRTY", reviewDecision: "CHANGES_REQUESTED" }),
      ]),
    ).toStrictEqual({
      branch: "trak/a",
      pull: {
        number: 7,
        url: "https://github.com/o/r/pull/7",
        title: "Remember the last thing GitHub said",
        state: "merged",
        isDraft: false,
        merging: "conflicting",
        decision: "changesRequested",
        checks: "none",
      },
    })
  })

  it("falls back to the coarser mergeability where the finer one is not worked out", () => {
    expect(
      only([row({ mergeStateStatus: NOTHING, mergeable: "CONFLICTING" })])?.pull?.merging,
    ).toBe("conflicting")
    expect(only([row({ mergeStateStatus: NOTHING, mergeable: NOTHING })])?.pull?.merging).toBe(
      "unknown",
    )
  })

  it("rolls the checks up to one word, and tells nothing-ran from nothing-known", () => {
    const checksOf = (state: unknown) => only([row({ commits: rolled(state) })])?.pull?.checks
    expect(checksOf("SUCCESS")).toBe("passed")
    expect(checksOf("FAILURE")).toBe("failed")
    expect(checksOf("ERROR")).toBe("failed")
    expect(checksOf("PENDING")).toBe("running")
    expect(checksOf("EXPECTED")).toBe("running")
    // A rollup state this build has never seen is *not known*, which is neither a pass
    // nor a failure — a caller reading either would be turning it into a verdict.
    expect(checksOf("QUARANTINED")).toBe("unknown")
    // And a commit nothing ran against has no rollup at all, which is a third thing.
    expect(only([row()])?.pull?.checks).toBe("none")
  })

  /**
   * A merged pull request is what a branch that has been tidied up off the remote still
   * answers with, which is the whole of why the query asks by branch name rather than
   * through the ref: the Merged pile would otherwise be empty for every trak that landed.
   */
  it("carries a merged pull request, so a landed trak still reaches a row", () => {
    expect(only([row({ state: "MERGED" })])?.pull?.state).toBe("merged")
  })

  /**
   * The node says which branch it is about, so an alias that answered out of order — or
   * about a branch nobody asked about — cannot be filed against the wrong row.
   */
  it("matches a node to its branch by what the node says, not by the alias it came under", () => {
    const entries = whole(
      ["trak/a", "trak/b"],
      [[row({ headRefName: "trak/b", state: "MERGED" })], []],
    ).entries
    expect(entries.map((entry) => [entry.branch, entry.pull?.state])).toStrictEqual([
      ["trak/a", undefined],
      ["trak/b", "merged"],
    ])
  })
})

// ============================================================================
// What a merge pressed now would come to
// ============================================================================

/** The pull request with the repository's merge settings beside it. */
const withSettings = (
  repository: Record<string, unknown>,
  over: Record<string, unknown> = {},
): PullRequest => {
  const answer = readForgeAnswer(
    JSON.stringify({
      data: { repository: { ...repository, pullRequests: connection([node(over)]) } },
    }),
  )
  if (answer._tag !== "Found") throw new Error("unreachable")
  return answer.pullRequest
}

const ALL_ALLOWED = { mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: true }

const rules = (...nodes: readonly unknown[]) => ({ baseRef: { rules: connection(nodes) } })

const check = (name: string, conclusion: string | undefined) => ({
  id: `CR_${name}`,
  name,
  status: conclusion === undefined ? "IN_PROGRESS" : "COMPLETED",
  conclusion: conclusion ?? NOTHING,
})

describe("the forge's verdict on a merge pressed now", () => {
  it.each([
    ["CLEAN", "Mergeable"],
    ["UNSTABLE", "Mergeable"],
    ["HAS_HOOKS", "Mergeable"],
    ["UNKNOWN", "Checking"],
  ])("reads %s as %s", (status, tag) => {
    expect(found({ mergeStateStatus: status }).mergeVerdict?._tag).toBe(tag)
  })

  it("lets through a failing check nothing requires, as the forge does", () => {
    const pull = found({ mergeStateStatus: "UNSTABLE", commits: rolledUp("FAILURE") })
    expect(pull.mergeVerdict).toStrictEqual({ _tag: "Mergeable" })
  })

  it.each([
    ["DIRTY", {}, "conflicting"],
    ["BEHIND", {}, "behind"],
    ["CLEAN", { isDraft: true }, "draft"],
    ["UNKNOWN", { mergeable: "CONFLICTING" }, "conflicting"],
  ])("blocks %s for its one cause", (status, over, cause) => {
    expect(found({ mergeStateStatus: status, ...over }).mergeVerdict).toStrictEqual({
      _tag: "Blocked",
      holds: [{ cause }],
    })
  })

  it("names a required review, with the approvals the base's rules ask for", () => {
    const pull = found({
      mergeStateStatus: "BLOCKED",
      reviewDecision: "REVIEW_REQUIRED",
      ...rules({ type: "PULL_REQUEST", parameters: { requiredApprovingReviewCount: 2 } }),
    })
    expect(pull.mergeVerdict).toStrictEqual({
      _tag: "Blocked",
      holds: [{ cause: "reviewRequired", approvals: 2 }],
    })
  })

  it("names the required checks that failed and those still running, and no other check", () => {
    const pull = found({
      mergeStateStatus: "BLOCKED",
      baseRef: {
        branchProtectionRule: { requiredStatusCheckContexts: ["lint"] },
        rules: connection([
          {
            type: "REQUIRED_STATUS_CHECKS",
            parameters: { requiredStatusChecks: [{ context: "verify" }] },
          },
        ]),
      },
      commits: rolledUp("FAILURE", [
        check("verify", "FAILURE"),
        check("lint", undefined),
        check("browser", "FAILURE"),
      ]),
    })
    expect(pull.mergeVerdict).toStrictEqual({
      _tag: "Blocked",
      holds: [
        { cause: "checks", names: ["verify"] },
        { cause: "waiting", names: ["lint"] },
      ],
    })
  })

  it("says changes were requested where a reviewer did", () => {
    const pull = found({ mergeStateStatus: "BLOCKED", reviewDecision: "CHANGES_REQUESTED" })
    expect(pull.mergeVerdict).toStrictEqual({
      _tag: "Blocked",
      holds: [{ cause: "changesRequested" }],
    })
  })

  it("names a branch rule where nothing the forge returned explains the block", () => {
    const pull = found({ mergeStateStatus: "BLOCKED", reviewDecision: "APPROVED" })
    expect(pull.mergeVerdict).toStrictEqual({ _tag: "Blocked", holds: [{ cause: "rule" }] })
  })

  it("gives no verdict on a pull request that is not open", () => {
    expect(found({ state: "MERGED" }).mergeVerdict).toBeUndefined()
  })
})

describe("the methods a merge may use", () => {
  it("offers every method the repository allows, in the forge's own order", () => {
    expect(withSettings(ALL_ALLOWED).mergeMethods).toStrictEqual(["merge", "squash", "rebase"])
    expect(withSettings({ ...ALL_ALLOWED, mergeCommitAllowed: false }).mergeMethods).toStrictEqual([
      "squash",
      "rebase",
    ])
  })

  it("narrows them to what the base branch's rulesets allow", () => {
    const pull = withSettings(
      ALL_ALLOWED,
      rules({ type: "PULL_REQUEST", parameters: { allowedMergeMethods: ["SQUASH", "REBASE"] } }),
    )
    expect(pull.mergeMethods).toStrictEqual(["squash", "rebase"])
  })

  it("drops the merge commit where linear history is required, by either kind of rule", () => {
    expect(
      withSettings(ALL_ALLOWED, rules({ type: "REQUIRED_LINEAR_HISTORY" })).mergeMethods,
    ).toStrictEqual(["squash", "rebase"])
    expect(
      withSettings(ALL_ALLOWED, {
        baseRef: { branchProtectionRule: { requiresLinearHistory: true } },
      }).mergeMethods,
    ).toStrictEqual(["squash", "rebase"])
  })

  it("offers none where the forge named no settings", () => {
    expect(found().mergeMethods).toStrictEqual([])
  })
})

describe("the method a merge uses", () => {
  const offer = { fallback: "squash" as const, allowed: ["squash", "rebase"] as const }

  it("is the pick where the forge allows it", () => {
    expect(mergeMethodFor("rebase", offer)).toBe("rebase")
  })

  it("is the default where nobody picked, or the pick is no longer allowed", () => {
    expect(mergeMethodFor(undefined, offer)).toBe("squash")
    expect(mergeMethodFor("merge", offer)).toBe("squash")
  })

  it("is the first allowed where the default is not allowed either", () => {
    expect(mergeMethodFor("merge", { fallback: "merge", allowed: ["rebase"] })).toBe("rebase")
  })

  it("trusts the pick where the forge named no allowed methods", () => {
    expect(mergeMethodFor("rebase", { fallback: "squash", allowed: [] })).toBe("rebase")
  })

  it("reads the merge query's answer, rules and all", () => {
    const stdout = JSON.stringify({
      data: {
        repository: {
          viewerDefaultMergeMethod: "SQUASH",
          ...ALL_ALLOWED,
          pullRequests: connection([rules({ type: "REQUIRED_LINEAR_HISTORY" })]),
        },
      },
    })
    expect(readMergeOffer(stdout)).toStrictEqual({
      fallback: "squash",
      allowed: ["squash", "rebase"],
    })
    expect(readMergeOffer("not json")).toBeUndefined()
  })
})
