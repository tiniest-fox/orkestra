/**
 * Tier 1: what the Review section's lines carry, off the wire shape alone.
 */

import { describe, expect, it } from "vitest"
import { makePullRequestComment, makeReview, makeReviewThread } from "../../../../fixtures"
import {
  commentLines,
  commenterBlocks,
  gist,
  picksOf,
  resolvedLines,
  reviewers,
  reviewLines,
  standingReview,
} from "./reviewLines"

describe("gist", () => {
  it("is the first line with the markdown taken off", () => {
    expect(gist("## Heading\n\nSome **bold** words\nand more")).toBe("Heading")
    expect(gist("> quoted `code` here")).toBe("quoted code here")
    expect(gist("- a list item")).toBe("a list item")
  })

  /** A bot's comment often opens with an HTML comment nobody is meant to read. */
  it("skips an html comment and blank lines to the first words", () => {
    expect(gist("<!-- marker -->\n\n\nThe words")).toBe("The words")
    expect(gist("")).toBe("")
  })
})

describe("reviewLines", () => {
  const review = makeReview({
    who: "alice",
    body: "Two things stop it going in.",
    threads: [
      makeReviewThread({
        path: "src/a.ts",
        line: 3,
        comments: [makePullRequestComment({ who: "bob", body: "why?" })],
      }),
      makeReviewThread({ resolved: true }),
      makeReviewThread({ path: undefined, line: undefined, outdated: true }),
    ],
  })

  it("leads with the summary, then every open conversation, and never a settled one", () => {
    const lines = reviewLines(review, 41)
    expect(lines.map((line) => line.place)).toEqual([
      "their review",
      "src/a.ts:3",
      "on the pull request",
    ])
    expect(lines.map((line) => line.outdated)).toEqual([false, false, true])
  })

  /** The summary is a verdict rather than a conversation, so nothing sends it back. */
  it("gives the summary no tick, and each conversation the tick that sends it whole", () => {
    const [summary, thread] = reviewLines(review, 41)
    expect(summary?.pick).toBeUndefined()
    expect(summary?.comments[0]?.body).toBe("Two things stop it going in.")
    expect(thread?.pick?.quote).toBe("why?")
    expect(thread?.key).toBe(thread?.pick?.key)
  })

  /** Named for whoever opened it — a reply from somebody else is still that person's words. */
  it("leads a conversation with its opener rather than the reviewer", () => {
    const [, thread] = reviewLines(review, 41)
    expect(thread?.who).toBe("bob")
    expect(thread?.out?.label).toBe("bob on src/a.ts:3 — open on GitHub")
  })

  it("has no summary line where the reviewer wrote nothing", () => {
    expect(reviewLines(makeReview({ threads: [makeReviewThread()] }), 41)).toHaveLength(1)
  })
})

describe("reviewers", () => {
  /** The forge makes each inline comment posted on its own a review — a bot's dozen are one person. */
  it("is one entry per person, in the order each first reviewed, their reviews oldest first", () => {
    const grouped = reviewers([
      makeReview({ id: "b2", who: "bot", at: 30 }),
      makeReview({ id: "a1", who: "alice", at: 20 }),
      makeReview({ id: "b1", who: "bot", at: 10 }),
    ])
    expect(grouped.map((reviewer) => reviewer.who)).toEqual(["bot", "alice"])
    expect(grouped[0]?.reviews.map((review) => review.id)).toEqual(["b1", "b2"])
  })
})

describe("standingReview", () => {
  it("is the latest approval or request for changes, and a later comment does not withdraw it", () => {
    const [reviewer] = reviewers([
      makeReview({ id: "1", verdict: "changesRequested", at: 1 }),
      makeReview({ id: "2", verdict: "approved", at: 2 }),
      makeReview({ id: "3", verdict: "commented", at: 3 }),
    ])
    expect(reviewer === undefined ? undefined : standingReview(reviewer).id).toBe("2")
  })

  it("is the latest review where the person only ever commented", () => {
    const [reviewer] = reviewers([makeReview({ id: "1", at: 1 }), makeReview({ id: "2", at: 2 })])
    expect(reviewer === undefined ? undefined : standingReview(reviewer).id).toBe("2")
  })
})

describe("resolvedLines", () => {
  it("collects the settled conversations of every review, each without a tick", () => {
    const lines = resolvedLines([
      makeReview({ threads: [makeReviewThread({ resolved: true, line: 1 })] }),
      makeReview({ threads: [makeReviewThread(), makeReviewThread({ resolved: true, line: 2 })] }),
    ])
    expect(lines.map((line) => line.place)).toEqual([
      "client/src/features/trak-detail/controls.ts:1",
      "client/src/features/trak-detail/controls.ts:2",
    ])
    expect(lines.every((line) => line.pick === undefined)).toBe(true)
    expect(lines[0]?.out?.label).toMatch(/, resolved — open on GitHub$/)
  })
})

describe("commentLines and picksOf", () => {
  it("makes one ticked line per comment on the pull request, and picksOf reaches only ticks", () => {
    const comments = commentLines([makePullRequestComment({ who: "sam", body: "ship it" })], 41)
    // No place: the box these are drawn in is headed with exactly those words already.
    expect(comments[0]).toMatchObject({ who: "sam", place: undefined })
    expect(comments[0]?.pick?.label).toBe("sam on the pull request")
    expect(
      picksOf([
        ...comments,
        ...resolvedLines([makeReview({ threads: [makeReviewThread({ resolved: true })] })]),
      ]),
    ).toHaveLength(1)
  })
})

/** One comment on the pull request, at a moment. */
const said = (who: string, at: number, body = who): ReturnType<typeof makePullRequestComment> =>
  makePullRequestComment({ who, at, body })

describe("commenterBlocks", () => {
  /** Newest person first, ranked by their latest; inside a group, oldest first. */
  it("groups a person with two or more comments, and leaves a person with one as a line", () => {
    const blocks = commenterBlocks(
      commentLines(
        [said("mara", 10, "m1"), said("bot", 20), said("mara", 30, "m2"), said("sam", 25)],
        41,
      ),
    )
    expect(blocks.map((block) => block.kind)).toEqual(["group", "one", "one"])
    expect(blocks[0]).toMatchObject({ who: "mara" })
    expect(blocks[0]?.kind === "group" && blocks[0].lines.map((l) => l.pick?.quote)).toEqual([
      "m1",
      "m2",
    ])
    expect(blocks[1]?.kind === "one" && blocks[1].line.who).toBe("sam")
    expect(blocks[2]?.kind === "one" && blocks[2].line.who).toBe("bot")
  })

  it("is empty for no comments, and a group's lines come in time order whatever the wire's", () => {
    expect(commenterBlocks([])).toEqual([])
    const [block] = commenterBlocks(
      commentLines([said("mara", 30, "late"), said("mara", 10, "early")], 41),
    )
    expect(block?.kind === "group" && block.lines.map((l) => l.pick?.quote)).toEqual([
      "early",
      "late",
    ])
  })
})
