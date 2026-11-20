/**
 * What the browser remembers of the forge between one load of the page and the next: which
 * answers are written to storage, how long one is good for, and how the last thing said
 * about a branch is found again.
 *
 * **Why anything is remembered at all.** Both forge reads cost the engine a `gh` process,
 * so neither can be answered on the frame the page paints — and until one is, a finished
 * row has to say something and the card has to draw something. Before this, both said the
 * wrong thing: every finished row read *Could not ask GitHub* under an unplug mark, and the
 * card drew nothing and then popped in over the merge press. Remembering the last answer
 * for an hour turns the commonest case — a reload of a page that was right a minute ago —
 * into a screen that keeps saying what it said.
 *
 * **A remembered verdict is a stronger claim than the placeholder it replaces, not a
 * weaker one.** It decides which rows land under *Ready to merge* and whether the local
 * Merge press is offered at all. The hour is what bounds that, and it is the reason this is
 * an hour rather than a day.
 *
 * **Top-level rather than in a feature**, for `queryCache`'s reason: both features read it,
 * and a `traks-list/` importing a `trak-detail/` constant would be the first cross-feature
 * import. Kind `pure` — no React, no cache, no I/O. `hooks/useForgeMemory` is what reaches
 * into the query cache and hands the answers here.
 */

import type {
  ForgeListingDto,
  PullRequestDto,
  PullRequestFoundDto,
  PullRequestsDto,
  PullRequestSummaryDto,
} from "./api/types"
import { queryKeys } from "./queryCache"

/**
 * How old a remembered answer may be — **the whole of the freshness rule, and it is
 * checked in two places that must agree.**
 *
 * The persist plugin takes it as `maxAge` and applies it *once over the whole stored
 * writing* rather than per entry: if the store is older than this, everything in it is
 * thrown away. That is only correct because the store holds nothing but forge answers, and
 * it is why the allow-list below is a rule rather than a tidiness — persisting a trak's log
 * under the same roof would silently put it under the same hour.
 *
 * `rememberedByBranch` applies it again, per entry, because the store's own timestamp is
 * when it was last *written* and an answer inside it can be older than that.
 *
 * An hour, because a pull request that has not been looked at for an hour is one whose
 * checks have finished and whose reviews have landed. Below that a verdict is worth
 * repeating; above it, saying nothing is the honest answer and the strip says so.
 */
export const MEMORY_MS = 60 * 60 * 1000

/**
 * The only two roots that may be written to storage — and the two the fold below reads,
 * which is the same fact: what the browser remembers is exactly what it is allowed to
 * write down.
 *
 * **Read off `queryKeys` rather than spelled again**, so a key that is renamed there cannot
 * leave this list quietly matching nothing — which fails as a screen that stopped
 * remembering, with nothing broken enough to notice.
 */
export const FORGE_ROOTS: readonly string[] = [
  queryKeys.pullRequest("")[0],
  queryKeys.pullRequests([])[0],
]

/**
 * Whether this query is one of the two — the allow-list, as `shouldDehydrateQuery` reads
 * it.
 *
 * An allow-list rather than a deny-list because the cost of being wrong is asymmetric: a
 * forge answer that is not persisted is a screen that looks like it did before, and a trak
 * log that is persisted is a browser writing a megabyte of somebody's transcript into
 * `localStorage` on every poll.
 */
export const forgeAnswerKey = (key: readonly unknown[]): boolean => {
  const [root] = key
  return typeof root === "string" && FORGE_ROOTS.includes(root)
}

/**
 * Whether the answer is one worth keeping — **and *we could not ask* is not.**
 *
 * It is a perfectly good answer and both surfaces draw it, but it is a fact about this
 * machine's `gh` at one moment rather than about a branch, so an hour later it is evidence
 * of nothing. Keeping it would also cost the card the one state it most needs: a restored
 * *unavailable* puts an answer in hand, so the page would draw the ruled-out card instead
 * of the strip that says it is still looking.
 *
 * `unknown` because `shouldDehydrateQuery` sees a query rather than a decoded body, and the
 * tag is the whole of what has to be told apart — both forge answers spell it the same way.
 */
export const worthRemembering = (data: unknown): boolean =>
  !(typeof data === "object" && data !== null && "_tag" in data && data._tag === "ForgeUnavailable")

/** The last thing the forge said about one branch, and when it said it. */
export interface Remembered {
  /**
   * **Absent is the forge's own answer**: it was asked about this branch by name and said
   * there is no pull request on it. Never *we have not heard* — a branch nothing was said
   * about has no entry in the map at all.
   */
  readonly pull: PullRequestSummaryDto | undefined
  readonly at: number
}

/** Every branch anything in the cache still has an answer for. */
export type ForgeMemory = ReadonlyMap<string, Remembered>

/** One forge answer as the cache holds it — the body, and when it arrived. Either of the
 *  two questions: the listing about many branches, or a trak's own whole answer. */
export interface ForgeAnswered {
  readonly answer: ForgeListingDto | PullRequestDto | undefined
  /** `dataUpdatedAt`. Zero for a query that has never resolved, which ages out below. */
  readonly at: number
}

/**
 * A whole answer, as the row's shape — the projection that lets a trak's own read feed
 * the same store the listing does.
 *
 * Total, because the whole answer is a superset: the head, the four verdict fields, the
 * base, and `rollup` — GitHub's own word over the head commit, carried across the wire
 * precisely so this never folds the per-check list into a second version of that
 * judgement.
 */
const summaryOf = (pull: PullRequestFoundDto): PullRequestSummaryDto => ({
  number: pull.number,
  title: pull.title,
  url: pull.url,
  state: pull.state,
  isDraft: pull.isDraft,
  merging: pull.merging,
  ...(pull.decision === undefined ? {} : { decision: pull.decision }),
  ...(pull.base === undefined ? {} : { base: pull.base }),
  checks: pull.rollup,
})

type Said = PullRequestsDto["entries"][number]

/**
 * What one answer says, branch by branch — the members of the two unions, read as
 * entries.
 *
 * `ForgeUnavailable` contributes nothing rather than erasing what an older answer said:
 * that member names no branch, so there is nothing in it to file. A per-trak answer that
 * names no branch — a trak that never got a checkout — is the same nothing.
 */
const saidOf = (answer: ForgeListingDto | PullRequestDto | undefined): readonly Said[] => {
  switch (answer?._tag) {
    case "PullRequests":
      return answer.entries
    case "PullRequest":
      return answer.branch === undefined ? [] : [{ branch: answer.branch, pull: summaryOf(answer) }]
    case "NoPullRequest":
      // An entry with nothing in it is the forge's own *there is none* — see `Remembered`.
      return answer.branch === undefined ? [] : [{ branch: answer.branch }]
    // Both name no branch. `NoOrigin` settles every branch the listing asked about, which
    // `rungsOf` reads off the listing's tag rather than off this store.
    case "ForgeUnavailable":
    case "NoOrigin":
    case undefined:
      return []
  }
}

/**
 * The freshest thing known about each branch, from every forge answer the cache holds —
 * the listing's and every open trak's own alike.
 *
 * **Keyed by branch and not by the question that was asked.** The list's cache key *is* the
 * sorted set of finished branches, so it changes the moment a trak finishes or is merged —
 * which is precisely when somebody is looking — and a trak's own answer is keyed by trak
 * id, which no list ever holds. An answer under either key is perfectly good by branch, so
 * the branch is what this indexes on and every answer is merged rather than one being
 * chosen.
 *
 * **Newest wins, per branch.** Two answers overlapping on a branch is the ordinary case — a
 * carried answer beside the live one, or a card's fresh read beside a listing one poll
 * old — and the newest is what a row should be drawn from. Fair between the two questions
 * because both `dataUpdatedAt` stamps come from this client's one clock.
 */
export const rememberedByBranch = (answers: readonly ForgeAnswered[], now: number): ForgeMemory => {
  const held = new Map<string, Remembered>()
  for (const { answer, at } of answers) {
    // Per entry as well as over the store — see `MEMORY_MS`. An answer that never resolved
    // stamps zero, which is comfortably past the hour and so falls out here.
    if (now - at > MEMORY_MS) continue
    for (const entry of saidOf(answer)) {
      const already = held.get(entry.branch)
      if (already !== undefined && already.at >= at) continue
      held.set(entry.branch, { pull: entry.pull, at })
    }
  }
  return held
}
