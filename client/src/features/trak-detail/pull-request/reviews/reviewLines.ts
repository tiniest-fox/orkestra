/**
 * The Review section as lines: one per conversation, each a line until it is pressed.
 *
 * **Every conversation costs one line at rest, whoever opened it and whatever it says.**
 * A pull request with a dozen unanswered threads is a dozen lines between the trak's
 * ending and the presses under the card, rather than a dozen paragraphs — the crowding
 * that made the trak's own context hard to find under the pull request's detail.
 *
 * Three kinds of thing become a line, and they differ only in what they carry: a reviewer's
 * own summary, which no tick can send back; a conversation on a line of the diff, which one
 * tick sends whole; and a comment on the pull request itself. A settled conversation is a
 * line too, with no tick — resolved is read, never sent.
 *
 * Pure, so every shape is a tier-1 test.
 */

import type { PullRequestCommentDto, ReviewDto } from "../../../../api/types"
import {
  commentPick,
  openThreads,
  resolvedThreads,
  threadKey,
  threadLabel,
  threadPick,
  threadWhere,
} from "../pullRequest"
import type { Picked } from "../picks/reentryBody"

/** One conversation, as the row draws it shut and open. */
export interface Line {
  /** The pick's own key where there is one, so the row and its tick cannot drift apart. */
  readonly key: string
  /** Who opened it — the name the shut line leads with. */
  readonly who: string
  /**
   * Where it is: a file and line, or the words for a conversation attached to none.
   *
   * **`undefined` where the box the line sits in has already said it.** A comment on the
   * pull request is drawn under a heading that names exactly that, and repeating it costs
   * the row's widest column at desk width and a whole line of its own below the breakpoint,
   * where `place` wraps. A thread inside a reviewer's card keeps the words, because there
   * it is what tells it apart from the `file:line` rows beside it.
   */
  readonly place: string | undefined
  readonly comments: readonly PullRequestCommentDto[]
  readonly hunk: string | undefined
  /** A tick only where there is work to send back. `undefined` is read-only. */
  readonly pick: Picked | undefined
  readonly outdated: boolean
  /** The way out to the forge, drawn once the line is open. */
  readonly out: { readonly url: string; readonly label: string } | undefined
}

const HTML_COMMENT = /<!--[\s\S]*?-->/g
const MARKUP = /[*_`<>]/g
const LEADING = /^[#>\-*\s]+/

/** The first line of a comment with the markdown taken off, which is what a shut line shows. */
export const gist = (body: string): string =>
  body
    .replace(HTML_COMMENT, "")
    .split("\n")
    .map((line) => line.replace(LEADING, "").replace(MARKUP, "").trim())
    .find((line) => line.length > 0) ?? ""

const WHOLE = "on the pull request"

/** Who opened a conversation: its first comment's author, or the reviewer where it has none. */
const opener = (review: ReviewDto, comments: readonly PullRequestCommentDto[]): string =>
  comments[0]?.who ?? review.who

/**
 * A reviewer's own words about the whole pull request — a line with no tick, because they
 * are a verdict rather than a conversation, and nothing to link out to, because the
 * reviewer's head above it already carries the way to their review.
 */
const summaryLine = (review: ReviewDto): Line | undefined =>
  review.body === undefined
    ? undefined
    : {
        key: `summary:${review.id}`,
        who: review.who,
        place: "their review",
        comments: [{ who: review.who, body: review.body, url: review.url, at: review.at }],
        hunk: undefined,
        pick: undefined,
        outdated: false,
        out: undefined,
      }

/** The lines under one reviewer's head: their summary, then every conversation still open. */
export const reviewLines = (review: ReviewDto, number: number): readonly Line[] => {
  const summary = summaryLine(review)
  const open = openThreads(review).map(({ thread, at }): Line => {
    const pick = threadPick(review, thread, at, number)
    const [first] = thread.comments
    return {
      key: pick.key,
      who: opener(review, thread.comments),
      place: threadWhere(thread) ?? WHOLE,
      comments: thread.comments,
      hunk: thread.diffHunk,
      pick,
      outdated: thread.outdated,
      out:
        first === undefined
          ? undefined
          : { url: first.url, label: `${pick.label} — open on GitHub` },
    }
  })
  return summary === undefined ? open : [summary, ...open]
}

/**
 * The reviews as one card per person: every review that person left, oldest first.
 *
 * **A reviewer is one card however many reviews they left.** The forge makes each inline
 * comment posted on its own a review of its own, so a bot that comments line by line — Claude
 * Code's does — leaves a dozen reviews on one pull request, and a card per review drew the
 * same name a dozen times. Cards run in the order each person first reviewed.
 */
export interface Reviewer {
  readonly who: string
  readonly reviews: readonly [ReviewDto, ...ReviewDto[]]
}

export const reviewers = (reviews: readonly ReviewDto[]): readonly Reviewer[] => {
  const byWho = new Map<string, [ReviewDto, ...ReviewDto[]]>()
  for (const review of reviews) {
    const theirs = byWho.get(review.who)
    if (theirs === undefined) byWho.set(review.who, [review])
    else theirs.push(review)
  }
  return [...byWho.entries()].map(([who, theirs]) => ({
    who,
    reviews: theirs.sort((a, b) => a.at - b.at),
  }))
}

/**
 * The review a reviewer's card speaks for: their latest approval or request for changes,
 * and their latest review where they only ever commented.
 *
 * The forge's own rule — a comment after an approval does not withdraw it — so the card's
 * verdict agrees with the one the forge is holding the merge on.
 */
export const standingReview = (reviewer: Reviewer): ReviewDto => {
  const latest = reviewer.reviews.at(-1) ?? reviewer.reviews[0]
  return reviewer.reviews.findLast((review) => review.verdict !== "commented") ?? latest
}

/** The conversations somebody has settled, across every review. No tick on any of them. */
export const resolvedLines = (reviews: readonly ReviewDto[]): readonly Line[] =>
  reviews.flatMap((review) =>
    resolvedThreads(review).map(({ thread, at }): Line => {
      const [first] = thread.comments
      return {
        key: threadKey(review, thread, at),
        who: opener(review, thread.comments),
        place: threadWhere(thread) ?? WHOLE,
        comments: thread.comments,
        hunk: thread.diffHunk,
        pick: undefined,
        outdated: thread.outdated,
        out:
          first === undefined
            ? undefined
            : {
                url: first.url,
                label: `${threadLabel(review, thread)}, resolved — open on GitHub`,
              },
      }
    }),
  )

/**
 * The comments on the pull request itself, attached to no line of the diff.
 *
 * No `place`: these are drawn in a box headed *On the pull request*, so the words are
 * already above them. The pick's own label keeps them, because it is read in the box at the
 * foot where nothing else says where it came from.
 */
export const commentLines = (
  conversation: readonly PullRequestCommentDto[],
  number: number,
): readonly Line[] =>
  conversation.map((comment): Line => {
    const pick = commentPick(comment, number)
    return {
      key: pick.key,
      who: comment.who,
      place: undefined,
      comments: [comment],
      hunk: undefined,
      pick,
      outdated: false,
      out: { url: comment.url, label: `${pick.label} — open on GitHub` },
    }
  })

/**
 * The box under *On the pull request*, as one sequence of cards and single lines.
 *
 * **A person with two or more comments is a group; a person with one is a line on its
 * own.** A head over one comment is a name printed twice for nothing. Groups and singles
 * run in one order, the person whose latest comment is newest first, so the box reads
 * top-down as *who spoke most recently*; inside a group the comments run oldest first, the
 * way a conversation is read.
 *
 * **A reviewer who also commented is here as well as in their review card.** Their review
 * is about the diff and their comments are about the pull request, and folding the second
 * into the first is what a box headed *On the pull request* exists to avoid.
 */
export type Block =
  | { readonly kind: "one"; readonly line: Line }
  | { readonly kind: "group"; readonly who: string; readonly lines: readonly Line[] }

const latestAt = (lines: readonly Line[]): number =>
  Math.max(...lines.map((line) => line.comments[0]?.at ?? 0))

export const commenterBlocks = (lines: readonly Line[]): readonly Block[] => {
  const byWho = new Map<string, Line[]>()
  for (const line of lines) byWho.set(line.who, [...(byWho.get(line.who) ?? []), line])
  return [...byWho.entries()]
    .map(([who, theirs]) => ({ who, theirs, latest: latestAt(theirs) }))
    .sort((a, b) => b.latest - a.latest)
    .map(({ who, theirs }): Block => {
      const [only] = theirs
      return theirs.length === 1 && only !== undefined
        ? { kind: "one", line: only }
        : {
            kind: "group",
            who,
            lines: [...theirs].sort((a, b) => (a.comments[0]?.at ?? 0) - (b.comments[0]?.at ?? 0)),
          }
    })
}

/** What a tick over several lines reaches: only the ones that carry a tick of their own. */
export const picksOf = (lines: readonly Line[]): readonly Picked[] =>
  lines.flatMap((line) => (line.pick === undefined ? [] : [line.pick]))
