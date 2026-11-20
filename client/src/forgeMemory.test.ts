/**
 * Tier 1 (`testing-tiers`): what the browser keeps of the forge and what it hands back —
 * no React, no cache, no storage.
 *
 * Written to catch three things. **A remembered answer outliving its hour**, which is the
 * whole of what bounds a stored verdict from deciding what a person can land. **The
 * allow-list drifting off the key vocabulary**, which fails as a screen that quietly stops
 * remembering. And **an older answer overwriting a newer one**, which the cache makes
 * ordinary: a carried answer and the live one overlap on nearly every branch.
 */

import { describe, expect, it } from "vitest"
import { makeListing, makePullRequest, makePullRequestSummary } from "./fixtures"
import {
  forgeAnswerKey,
  MEMORY_MS,
  rememberedByBranch,
  worthRemembering,
  type ForgeAnswered,
} from "./forgeMemory"
import { queryKeys } from "./queryCache"

const NOW = 1_760_000_000_000

const listed = (branches: readonly (readonly [string, boolean])[], at: number): ForgeAnswered => ({
  answer: makeListing({
    entries: branches.map(([branch, has]) =>
      has ? { branch, pull: makePullRequestSummary() } : { branch },
    ),
  }),
  at,
})

describe("what may be written down", () => {
  it("keeps the two forge keys and nothing else", () => {
    expect(forgeAnswerKey(queryKeys.pullRequest("t"))).toBe(true)
    expect(forgeAnswerKey(queryKeys.pullRequests(["trak/a"]))).toBe(true)
    // Everything else is the engine's and is a replay away — and persisting any of it would
    // put it under the same hour, since the plugin checks the age once over the whole store.
    expect(forgeAnswerKey(queryKeys.traks)).toBe(false)
    expect(forgeAnswerKey(queryKeys.trak("t"))).toBe(false)
    expect(forgeAnswerKey(queryKeys.changes("t", "step-1"))).toBe(false)
    expect(forgeAnswerKey(queryKeys.mergePreview("t"))).toBe(false)
    expect(forgeAnswerKey(queryKeys.agents)).toBe(false)
  })

  /** *We could not ask* says nothing about a branch, so an hour later it is evidence of
   *  nothing — and restoring one would put an answer in hand where the card needs to say
   *  it is still looking. */
  it("will not write down a forge it could not reach", () => {
    expect(worthRemembering({ _tag: "ForgeUnavailable", why: "no gh" })).toBe(false)
    expect(worthRemembering(makeListing())).toBe(true)
    expect(worthRemembering({ _tag: "NoPullRequest" })).toBe(true)
    expect(worthRemembering(undefined)).toBe(true)
  })
})

describe("what it hands back", () => {
  it("indexes by branch rather than by the question that was asked", () => {
    const memory = rememberedByBranch(
      [
        listed(
          [
            ["trak/a", true],
            ["trak/b", false],
          ],
          NOW,
        ),
      ],
      NOW,
    )
    expect(memory.get("trak/a")?.pull).toBeDefined()
    // An entry with no pull request is an answer and is kept as one: it is what rules a
    // pull request out and puts the local Merge press back on offer.
    expect(memory.has("trak/b")).toBe(true)
    expect(memory.get("trak/b")?.pull).toBeUndefined()
    // A branch no answer named is absent altogether, which is the third fact.
    expect(memory.has("trak/c")).toBe(false)
  })

  /** The carried answer and the live one overlap on nearly every branch, and the live one
   *  is what a row must be drawn from. */
  it("lets the newest answer win on a branch two of them name", () => {
    const older = listed([["trak/a", true]], NOW - 60_000)
    const newer = listed([["trak/a", false]], NOW)
    expect(rememberedByBranch([older, newer], NOW).get("trak/a")?.pull).toBeUndefined()
    // And in the other order, so it is the stamp deciding rather than the position.
    expect(rememberedByBranch([newer, older], NOW).get("trak/a")?.pull).toBeUndefined()
  })

  /**
   * The hour, per entry. The plugin's own `maxAge` is measured from when the store was last
   * *written*, which a long-open tab keeps fresh while the answer inside it ages — so this
   * is the check that actually bounds a verdict.
   */
  it("forgets an answer older than the hour", () => {
    const stale = listed([["trak/a", true]], NOW - MEMORY_MS - 1)
    expect(rememberedByBranch([stale], NOW).has("trak/a")).toBe(false)
    const just = listed([["trak/a", true]], NOW - MEMORY_MS)
    expect(rememberedByBranch([just], NOW).has("trak/a")).toBe(true)
  })

  /** A query that has never resolved stamps zero, which must not read as 1970 being within
   *  the hour of anything. */
  it("ignores an answer that never arrived", () => {
    expect(rememberedByBranch([{ answer: undefined, at: 0 }], NOW).size).toBe(0)
    expect(rememberedByBranch([{ ...listed([["trak/a", true]], 0) }], NOW).size).toBe(0)
  })

  /** It names no branch, so there is nothing in it to file — and it must not erase what an
   *  older answer said, which is the case a login expiring mid-session is in. */
  it("takes nothing from a forge that could not be reached", () => {
    const memory = rememberedByBranch(
      [
        listed([["trak/a", true]], NOW - 60_000),
        { answer: { _tag: "ForgeUnavailable", why: "no gh" }, at: NOW },
      ],
      NOW,
    )
    expect(memory.get("trak/a")?.pull).toBeDefined()
  })
})

/**
 * The other feeder: a trak's own whole answer, projected onto the row's shape and filed
 * beside the listing's entries. This is what keeps a row saying what the card a click
 * ahead of it just said, and what reaches a branch past the listing's hundred-branch cut
 * at all.
 */
describe("what a trak's own answer contributes", () => {
  it("files a whole answer as a row's answer, carrying the rollup word across", () => {
    const said = rememberedByBranch(
      [
        {
          answer: makePullRequest({
            branch: "trak/a",
            state: "merged",
            merging: "conflicting",
            decision: "changesRequested",
            rollup: "failed",
          }),
          at: NOW,
        },
      ],
      NOW,
    ).get("trak/a")
    expect(said?.pull).toStrictEqual(
      makePullRequestSummary({
        state: "merged",
        merging: "conflicting",
        decision: "changesRequested",
        checks: "failed",
      }),
    )
  })

  /** The projection is the head and the verdicts, never a fold of the per-check list —
   *  `rollup` is GitHub's own word and it crosses the wire for exactly this. */
  it("reads the rollup field, not the page of checks", () => {
    const said = rememberedByBranch(
      [{ answer: makePullRequest({ branch: "trak/a", rollup: "none" }), at: NOW }],
      NOW,
    ).get("trak/a")
    expect(said?.pull?.checks).toBe("none")
  })

  it("files the card's *there is none* as an answer about that branch, not as silence", () => {
    const memory = rememberedByBranch(
      [{ answer: { _tag: "NoPullRequest", branch: "trak/a" }, at: NOW }],
      NOW,
    )
    expect(memory.has("trak/a")).toBe(true)
    expect(memory.get("trak/a")?.pull).toBeUndefined()
  })

  /** A trak that never got a checkout is answered without the forge being consulted, and
   *  the answer names no branch — so there is nothing to file, rather than an entry under
   *  some invented key. */
  it("files nothing from an answer that names no branch", () => {
    expect(rememberedByBranch([{ answer: { _tag: "NoPullRequest" }, at: NOW }], NOW).size).toBe(0)
    expect(rememberedByBranch([{ answer: makePullRequest(), at: NOW }], NOW).size).toBe(0)
  })

  /** Newest wins between the two kinds too, in either direction — a stale card answer must
   *  not overwrite a fresher listing one, and the reverse holds the same way. */
  it("lets the newest of a card answer and a listing answer win, either way round", () => {
    const card: ForgeAnswered = {
      answer: makePullRequest({ branch: "trak/a", state: "merged" }),
      at: NOW - 60_000,
    }
    const listing = listed([["trak/a", true]], NOW)
    for (const answers of [
      [card, listing],
      [listing, card],
    ]) {
      expect(rememberedByBranch(answers, NOW).get("trak/a")?.pull?.state).toBe("open")
    }
    const fresher: ForgeAnswered = { ...card, at: NOW + 1_000 }
    expect(rememberedByBranch([fresher, listing], NOW).get("trak/a")?.pull?.state).toBe("merged")
  })
})
