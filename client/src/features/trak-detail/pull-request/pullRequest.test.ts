/**
 * Tier 1 (`testing-tiers`): the words each section says about itself, and what a tick
 * becomes — no React, no network, no DOM.
 *
 * The rule the whole file is written under: **nothing here aggregates the three sections**,
 * so every case below asks one section a question about itself.
 */

import { describe, expect, it } from "vitest"
import {
  makePullRequest,
  makePullRequestCheck,
  makePullRequestComment,
  makePullRequestSummary,
  makeReview,
  makeReviewThread,
} from "../../../fixtures"
import {
  cardOf,
  checkPick,
  checksHeadline,
  coarseChecks,
  commentPick,
  countedVerdicts,
  headingOf,
  mergingPick,
  mergingWords,
  openThreads,
  pullMergeOf,
  pullRequestFound,
  resolvedThreads,
  reviewHeadline,
  standingOf,
  stateWords,
  syncedLine,
  threadPick,
  verdictWord,
  wasTruncated,
} from "./pullRequest"

describe("pullRequestFound", () => {
  /** The presence of one, never its being open — work that went in over there is never
   *  merged from here, so all three states answer the same. */
  it.each(["open", "closed", "merged"] as const)("finds one at %s", (state) => {
    expect(pullRequestFound(makePullRequest({ state }))?.state).toBe(state)
  })

  it("finds none where there is none, where the forge could not be asked, and while asking", () => {
    expect(pullRequestFound({ _tag: "NoPullRequest" })).toBeUndefined()
    expect(
      pullRequestFound({ _tag: "ForgeUnavailable", why: "gh is not installed" }),
    ).toBeUndefined()
    expect(pullRequestFound(undefined)).toBeUndefined()
  })
})

describe("checksHeadline", () => {
  it("says how many are failing, of how many", () => {
    expect(
      checksHeadline([
        makePullRequestCheck({ name: "verify" }),
        makePullRequestCheck({ name: "build", verdict: "passed" }),
      ]),
    ).toEqual({ text: "1 failing of 2", tone: "bad" })
  })

  /** The count is the verdict once nothing is failing, and what is still moving is the tone. */
  it("counts a run that is still going, in the working tone", () => {
    expect(
      checksHeadline([
        makePullRequestCheck({ name: "verify", verdict: "running" }),
        makePullRequestCheck({ name: "build", verdict: "passed" }),
      ]),
    ).toEqual({ text: "1 running · 1 passed", tone: "working" })
  })

  /**
   * The case the whole rule exists for: skipped and unrecognised nodes arrive mixed in with
   * the green ones, so a headline calling them passes would be asserting something the wire
   * never said.
   */
  it("counts by verdict rather than calling a mixed run passing", () => {
    expect(
      checksHeadline([
        makePullRequestCheck({ name: "a", verdict: "passed" }),
        makePullRequestCheck({ name: "b", verdict: "skipped" }),
        makePullRequestCheck({ name: "c", verdict: "unknown" }),
      ]),
    ).toEqual({ text: "1 passed · 1 skipped · 1 not known", tone: "neutral" })
  })

  it("is good only when every one of them passed", () => {
    expect(checksHeadline([makePullRequestCheck({ verdict: "passed" })])).toEqual({
      text: "1 passed",
      tone: "good",
    })
  })

  /** A commit with no checks is what the forge answers for most pull requests early on. */
  it("says so when nothing has run", () => {
    expect(checksHeadline([])).toEqual({ text: "No checks have run", tone: "neutral" })
  })
})

describe("countedVerdicts", () => {
  it("leaves a verdict nothing has out rather than reporting it as zero", () => {
    expect(countedVerdicts([makePullRequestCheck({ verdict: "passed" })])).toBe("1 passed")
  })

  it("names all five as themselves", () => {
    const all = ["passed", "failed", "running", "skipped", "unknown"] as const
    expect(all.map(verdictWord)).toEqual(["passed", "failed", "running", "skipped", "not known"])
  })
})

describe("reviewHeadline", () => {
  it("says nobody has reviewed where the forge reports no decision", () => {
    expect(reviewHeadline(undefined, 0)).toEqual({ text: "No review yet", tone: "neutral" })
  })

  /** The count is handed in rather than worked out here, so the folded row below the verdict
   *  and the verdict itself cannot say two different numbers. */
  it("carries the count it is handed on a request for changes", () => {
    expect(reviewHeadline("changesRequested", 2)).toEqual({
      text: "Changes requested · 2 unanswered",
      tone: "waiting",
    })
  })

  it("leaves the count off at nothing outstanding rather than reporting none", () => {
    expect(reviewHeadline("changesRequested", 0)).toEqual({
      text: "Changes requested",
      tone: "waiting",
    })
  })

  it("says approved and review required in their own words, count or no count", () => {
    expect(reviewHeadline("approved", 3).text).toBe("Approved")
    expect(reviewHeadline("reviewRequired", 3).text).toBe("Review required")
  })
})

describe("coarseChecks", () => {
  /**
   * The row knows a word where the card knows a count, and the two absences stay absences:
   * `none` and `unknown` are neither a pass nor a failure, which is the rule the per-check
   * `unknown` is already written under.
   */
  it("says the rollup's own word, and turns neither absence into a verdict", () => {
    expect(coarseChecks("failed")).toEqual({ text: "Some checks are failing", tone: "bad" })
    expect(coarseChecks("running")).toEqual({ text: "Checks are running", tone: "working" })
    expect(coarseChecks("passed")).toEqual({ text: "Checks passed", tone: "good" })
    expect(coarseChecks("none").tone).toBe("neutral")
    expect(coarseChecks("unknown").tone).toBe("neutral")
  })
})

describe("cardOf", () => {
  const cold = { pull: undefined, row: undefined, at: undefined, confirmed: false, fetching: true }

  /**
   * The four, and the one line that matters most is the last: *we could not ask* has to go
   * on offering the local Merge press, or a machine with no `gh` loses local merging — while
   * *nothing yet* has to withhold it, because offering a merge and taking it away a second
   * later is worse than not offering it for a second.
   */
  it("tells the four apart, and never calls a moment before the first answer an answer", () => {
    expect(cardOf({ ...cold, pull: makePullRequest() })).toBe("whole")
    expect(cardOf({ ...cold, row: { pull: makePullRequestSummary(), at: 1 } })).toBe("row")
    expect(cardOf(cold)).toBe("checking")
    expect(cardOf({ ...cold, pull: { _tag: "NoPullRequest" } })).toBe("none")
    // No `origin` outranks a row a removed remote left behind: the local press is offered.
    expect(cardOf({ ...cold, pull: { _tag: "NoOrigin" } })).toBe("none")
    expect(
      cardOf({
        ...cold,
        pull: { _tag: "NoOrigin" },
        row: { pull: makePullRequestSummary(), at: 1 },
      }),
    ).toBe("none")
    expect(cardOf({ ...cold, pull: { _tag: "ForgeUnavailable", why: "no gh" } })).toBe("none")
    expect(cardOf({ ...cold, row: { pull: undefined, at: 1 } })).toBe("none")
  })

  /**
   * The detail and the row are separate calls, and the detail can fail where the row did
   * not — a token refused one of its fields. The row's pull request is still drawn, and the
   * local Merge press still withheld; the detail's own *none* still outranks an older row.
   */
  it("falls back to the row where the detail could not be asked", () => {
    const down = { _tag: "ForgeUnavailable", why: "gh exited 1" } as const
    const row = { pull: makePullRequestSummary({ state: "open" }), at: 1 }
    expect(cardOf({ ...cold, pull: down, row })).toBe("row")
    expect(standingOf({ ...cold, pull: down, row })).toBe("open")
    expect(headingOf({ ...cold, pull: down, row })?.number).toBe(row.pull.number)
    expect(cardOf({ ...cold, pull: down, row: { pull: undefined, at: 1 } })).toBe("none")
    expect(cardOf({ ...cold, pull: { _tag: "NoPullRequest" }, row })).toBe("none")
  })

  /** The whole answer wins over the coarse one wherever both are in hand. */
  it("draws the whole answer where it has one, coarse or not", () => {
    expect(
      cardOf({ ...cold, pull: makePullRequest(), row: { pull: makePullRequestSummary(), at: 1 } }),
    ).toBe("whole")
  })

  /**
   * **The invariant, not a second table.** `standingOf` is what the sentence above the card
   * is read off and `cardOf` is what the card is drawn from, and *is there a pull request*
   * has to be one answer: the two disagreeing is a card with a merge button under it, or a
   * sentence naming a press that is not drawn.
   */
  it("says a pull request stands somewhere at exactly the cards that draw one", () => {
    const forges = [
      cold,
      { ...cold, pull: makePullRequest({ state: "merged" }) },
      { ...cold, row: { pull: makePullRequestSummary({ state: "closed" }), at: 1 } },
      { ...cold, row: { pull: undefined, at: 1 } },
      { ...cold, pull: { _tag: "NoPullRequest" } as const },
      { ...cold, pull: { _tag: "ForgeUnavailable", why: "no gh" } as const },
    ]
    for (const forge of forges) {
      expect(standingOf(forge) === "none").toBe(cardOf(forge) === "none")
    }
  })

  /** The coarse answer carries the same `state` literal the whole one does, which is what
   *  lets a card built from the traks list say what the pull request is doing. */
  it("takes the state off whichever answer the card is drawn from", () => {
    expect(standingOf({ ...cold, pull: makePullRequest({ state: "merged" }) })).toBe("merged")
    expect(
      standingOf({ ...cold, row: { pull: makePullRequestSummary({ state: "merged" }), at: 1 } }),
    ).toBe("merged")
    // And nothing known is its own answer rather than folding into *there is none*, because
    // the press is withheld at one and offered at the other.
    expect(standingOf(cold)).toBe("unknown")
  })
})

describe("syncedLine", () => {
  const NOW = 1_760_000_000_000

  it("says how long ago, and *just now* under a minute", () => {
    expect(syncedLine(NOW - 59_000, false, false, NOW).text).toBe("Synced just now")
    expect(syncedLine(NOW - 60_000, false, false, NOW).text).toBe("Synced 1 minute ago")
    expect(syncedLine(NOW - 34 * 60_000, false, false, NOW).text).toBe("Synced 34 minutes ago")
  })

  /** A card built from a coarse answer says so, because a head and three verdicts with the
   *  rows still coming is not the whole of what *Synced* would be claiming — and it names
   *  no source, because the store the answer comes from may as well hold this pane's own
   *  earlier read as the traks list's. */
  it("claims an earlier answer, not a source, where the card is drawn coarse", () => {
    expect(syncedLine(NOW - 34 * 60_000, true, false, NOW).text).toBe(
      "From an earlier answer, 34 minutes ago",
    )
  })

  /** The glyph turns only while a fetch is out on a card nobody has confirmed — a static
   *  pair of refresh arrows on a card a reader sees constantly looks pressable. */
  it("says it is rechecking, and turns the glyph, only then", () => {
    expect(syncedLine(NOW, false, true, NOW)).toEqual({
      text: "Synced just now · rechecking",
      turning: true,
    })
    expect(syncedLine(NOW, false, false, NOW).turning).toBe(false)
  })

  /** The browser's clock ahead of the engine's is not something that has not happened yet. */
  it("reads a stamp in the future as just now", () => {
    expect(syncedLine(NOW + 60_000, false, false, NOW).text).toBe("Synced just now")
  })
})

describe("threads", () => {
  it("splits a review's own threads into the outstanding ones and the settled ones", () => {
    const review = makeReview({
      threads: [makeReviewThread(), makeReviewThread({ resolved: true }), makeReviewThread()],
    })
    // The position is carried, because a filtered list has lost it and it is what names a
    // thread the forge gave no path for.
    expect(openThreads(review).map((t) => t.at)).toEqual([0, 2])
    expect(resolvedThreads(review).map((t) => t.at)).toEqual([1])
  })
})

describe("mergingWords", () => {
  it("says conflicts to resolve", () => {
    const { text, tone, reason } = mergingWords("conflicting")
    expect(text).toBe("GitHub sees conflicts to resolve")
    expect(tone).toBe("bad")
    expect(reason).toBe("The pull request conflicts with its base branch.")
  })

  /** Reported only where the forge is actually refusing for that reason, which makes it a
   *  refusal like a conflict rather than a separate concern. */
  it("says the branch is behind, and treats it as a refusal", () => {
    expect(mergingWords("behind")).toMatchObject({
      text: "The branch is behind its base",
      tone: "bad",
    })
  })

  /** `clean` absorbs the forge's blocked and unstable, which are the other two sections'
   *  business — so the words say what this section knows and never that the merge is free. */
  it("says what it knows and nothing about checks or reviews", () => {
    const { text, reason } = mergingWords("clean")
    expect(text).toBe("No conflicts, and up to date with its base")
    expect(text).not.toMatch(/ready|nothing is blocking|good to/i)
    expect(reason).toBeUndefined()
  })

  /** The ordinary answer for a while after every push, so it is neutral in tone and words. */
  it("says not worked out yet, neutrally", () => {
    expect(mergingWords("unknown")).toEqual({
      text: "GitHub has not worked it out yet",
      tone: "neutral",
      reason: undefined,
    })
  })
})

describe("stateWords", () => {
  /** The case an adversarial pass caught: the forge keeps answering clean after a merge, so
   *  a pane drawing mergeability there says *ready to merge* about work already in. */
  it("replaces mergeability once the pull request is not open, at any merging value", () => {
    expect(stateWords(makePullRequest({ state: "merged", merging: "clean" }))?.text).toBe(
      "Merged on GitHub — the work is in over there",
    )
    expect(stateWords(makePullRequest({ state: "closed", merging: "clean" }))?.text).toBe(
      "Closed on GitHub — nothing was merged, and the branch is still here",
    )
  })

  it("says nothing while it is open, because mergeability is the answer there", () => {
    expect(stateWords(makePullRequest({ state: "open" }))).toBeUndefined()
  })
})

describe("wasTruncated", () => {
  it("is true for any of the kinds asked about", () => {
    expect(wasTruncated(["threads"], "reviews", "threads")).toBe(true)
    expect(wasTruncated(["checks"], "reviews", "threads")).toBe(false)
    expect(wasTruncated([], "checks")).toBe(false)
  })
})

describe("what a tick becomes", () => {
  /** Its name, when it failed and its link — and no quote, because the output is never
   *  fetched and there is nothing to put in its place. */
  it("gives a check its name, when it failed and its link, and nothing to quote", () => {
    expect(checkPick(makePullRequestCheck({ id: "run:9", at: 1_000 }), 41, 61_000)).toEqual({
      key: "check:run:9",
      label: "verify — failing",
      said: "The verify check is failing on pull request #41.",
      where: ["Failed 1m 0s ago", "https://github.com/o/r/actions/runs/9"],
      quote: undefined,
    })
  })

  it("leaves out a time the forge did not stamp rather than inventing one", () => {
    expect(checkPick(makePullRequestCheck({ at: undefined }), 41, 61_000).where).toEqual([
      "https://github.com/o/r/actions/runs/9",
    ])
  })

  /** The thread is the unit, so every comment in it is quoted — and it is named for whoever
   *  opened it rather than for the review it hangs under. */
  it("quotes a whole conversation and names whoever opened it", () => {
    const thread = makeReviewThread({
      comments: [
        makePullRequestComment({ who: "opener", body: "Why here?" }),
        makePullRequestComment({ who: "replier", body: "Because of the switch." }),
      ],
    })
    const pick = threadPick(makeReview({ who: "reviewer" }), thread, 0, 41)
    expect(pick.said).toBe("opener left a comment on pull request #41.")
    expect(pick.where).toEqual(["client/src/features/trak-detail/controls.ts:41"])
    expect(pick.quote).toBe("Why here?\n\nBecause of the switch.")
  })

  it("names a thread the forge gave no position for by its first comment", () => {
    const loose = makeReviewThread({ path: undefined, line: undefined })
    const pick = threadPick(makeReview({ who: "reviewer" }), loose, 2, 41)
    expect(pick.where).toEqual([])
    expect(pick.key).toBe(`thread:${loose.comments[0]?.url ?? ""}`)
  })

  it("quotes a comment on the pull request itself", () => {
    const comment = makePullRequestComment({ who: "someone", body: "Timeout?" })
    expect(commentPick(comment, 41)).toMatchObject({
      said: "someone commented on pull request #41.",
      quote: "Timeout?",
    })
  })

  /**
   * **A key names one thing, and the pane can draw two that look alike.** Two workflows each
   * with a job called `test`, and one person reviewing twice on the same line, are both
   * ordinary — and both produce two rows a name or a position-plus-author would key
   * identically, which draws both ticked and sends one. A case per kind of pick.
   */
  describe("keys are unique across everything the pane can draw at once", () => {
    /** The link is not what separates them and must not be: whoever created the run supplies
     *  it, so two checks from one CI system pointing at one build page is ordinary. */
    it("tells two checks of one name and one link apart by their ids", () => {
      const shared = { name: "test", url: "https://example.invalid/build/1" }
      const [a, b] = [
        makePullRequestCheck({ ...shared, id: "run:1" }),
        makePullRequestCheck({ ...shared, id: "run:2" }),
      ]
      expect(checkPick(a, 41, 0).key).not.toBe(checkPick(b, 41, 0).key)
    })

    /** A check the forge gave no link at all is keyed the same way as any other, because the
     *  key never read the link. */
    it("tells two unlinked checks of one name apart just the same", () => {
      const bare = { name: "test", url: undefined }
      expect(checkPick(makePullRequestCheck({ ...bare, id: "run:1" }), 41, 0).key).not.toBe(
        checkPick(makePullRequestCheck({ ...bare, id: "run:2" }), 41, 0).key,
      )
    })

    it("tells two reviews by one person on one line apart by the comment each opened with", () => {
      const first = makeReviewThread({ comments: [makePullRequestComment({ body: "first pass" })] })
      const second = makeReviewThread({
        comments: [makePullRequestComment({ body: "second pass" })],
      })
      const one = makeReview({ who: "alice", threads: [first] })
      const two = makeReview({ who: "alice", threads: [second] })

      expect(threadPick(one, first, 0, 41).key).not.toBe(threadPick(two, second, 0, 41).key)
    })

    /** A thread with no comments has no permalink of its own, so it falls back to the review
     *  that owns it — by the id the wire promises, not by the link the two here share. */
    it("tells two empty threads under two reviews by one person apart", () => {
      const empty = makeReviewThread({ comments: [] })
      const link = "https://github.com/o/r/pull/41#pullrequestreview-same"
      const one = makeReview({ who: "alice", url: link })
      const two = makeReview({ who: "alice", url: link })

      expect(threadPick(one, empty, 0, 41).key).not.toBe(threadPick(two, empty, 0, 41).key)
      // And two empty threads within one review, which the position separates.
      expect(threadPick(one, empty, 0, 41).key).not.toBe(threadPick(one, empty, 1, 41).key)
    })

    it("tells two comments on the pull request apart by their permalinks", () => {
      const one = makePullRequestComment({ who: "alice", body: "same words" })
      const two = makePullRequestComment({ who: "alice", body: "same words" })
      expect(commentPick(one, 41).key).not.toBe(commentPick(two, 41).key)
    })

    /** The four kinds share no prefix, so nothing a person ticks can answer to another
     *  kind's key. The merging fact is the one there is only ever one of. */
    it("keeps the four kinds from ever answering alike", () => {
      const keys = [
        checkPick(makePullRequestCheck(), 41, 0).key,
        threadPick(makeReview(), makeReviewThread(), 0, 41).key,
        commentPick(makePullRequestComment(), 41).key,
        mergingPick(makePullRequest({ merging: "conflicting" }))?.key ?? "",
      ]
      expect(new Set(keys).size).toBe(4)
    })
  })

  it("offers the merging fact only where the forge is refusing", () => {
    expect(mergingPick(makePullRequest({ merging: "conflicting" }))).toMatchObject({
      key: "merging",
      said: "Pull request #41 cannot merge as it stands.",
      quote: "The pull request conflicts with its base branch.",
    })
    expect(mergingPick(makePullRequest({ merging: "clean" }))).toBeUndefined()
    expect(mergingPick(makePullRequest({ merging: "unknown" }))).toBeUndefined()
    // Nothing to send back about a merge that has already happened.
    expect(
      mergingPick(makePullRequest({ state: "merged", merging: "conflicting" })),
    ).toBeUndefined()
  })
})

describe("the merging fact", () => {
  it("carries the pull request's base", () => {
    expect(mergingPick(makePullRequest({ merging: "behind", base: "main" }))?.base).toBe("main")
  })
})

describe("pullMergeOf", () => {
  const cold = { pull: undefined, row: undefined, at: undefined, confirmed: false, fetching: true }
  const offering = (over: Parameters<typeof makePullRequest>[0] = {}) => ({
    ...cold,
    pull: makePullRequest({ number: 142, mergeMethod: "squash", ...over }),
  })

  it("draws the press from the whole answer, carrying GitHub's methods and verdict", () => {
    expect(pullMergeOf(offering({ mergeMethods: ["merge", "squash"] }), undefined)).toStrictEqual({
      number: 142,
      method: "squash",
      methods: ["merge", "squash"],
      verdict: { _tag: "Mergeable" },
    })
  })

  it("merges by the trak's pick where GitHub offers it, and the default where it does not", () => {
    expect(pullMergeOf(offering({ mergeMethods: ["squash", "rebase"] }), "rebase")?.method).toBe(
      "rebase",
    )
    expect(pullMergeOf(offering({ mergeMethods: ["squash", "rebase"] }), "merge")?.method).toBe(
      "squash",
    )
    expect(pullMergeOf(offering({ mergeMethods: ["rebase"] }), undefined)?.method).toBe("rebase")
  })

  it("says merge where the forge named no method", () => {
    expect(pullMergeOf({ ...cold, pull: makePullRequest() }, undefined)?.method).toBe("merge")
  })

  it("draws nothing off a coarse answer, a pull request that is not open, or none", () => {
    expect(
      pullMergeOf({ ...cold, row: { pull: makePullRequestSummary(), at: 1 } }, undefined),
    ).toBe(undefined)
    expect(pullMergeOf({ ...cold, pull: makePullRequest({ state: "merged" }) }, undefined)).toBe(
      undefined,
    )
    expect(pullMergeOf({ ...cold, pull: { _tag: "NoPullRequest" } }, undefined)).toBe(undefined)
  })
})
