/**
 * Tier 1 (`testing-tiers`): the hold alone — no React, no transport.
 *
 * What it is written to catch is the altitude bug the first build shipped: a hold read
 * off the flat trak list, so a finished piece on a running parent's band held the page,
 * bought a ghost row for a row that never appears, and fell off the band for the length
 * of the call. Every case here therefore asserts what is *drawn* — the sections and
 * their bands — beside whether the page holds.
 */

import { describe, expect, it } from "vitest"
import type { ForgeListingDto } from "@orkestra/shared/dto/forge"
import type { TrakSummaryDto } from "../../api/types"
import { rememberedByBranch, type ForgeMemory } from "../../forgeMemory"
import { makeParent, makePullRequestSummary, makeTrak } from "../../fixtures"
import { withHold } from "./hold"
import { forgeBranches, rungsOf } from "./pullRung"

const NOW = 1_760_000_000_000

const done = (id: string, branch = `trak/${id}`): TrakSummaryDto =>
  makeTrak({ id, state: { _tag: "Finished" }, branch })

/**
 * The rung map as the page builds it: the live answer folded over what a case remembers,
 * exactly as `useForgeMemory` folds the cache — `pullRung.test.ts` carries why.
 */
const rungs = (
  traks: readonly TrakSummaryDto[],
  listing: ForgeListingDto | undefined,
  memory: ForgeMemory = new Map(),
) => {
  const held = new Map(memory)
  for (const [branch, said] of rememberedByBranch([{ answer: listing, at: NOW }], NOW)) {
    held.set(branch, said)
  }
  return rungsOf(traks, listing, forgeBranches(traks), held)
}

/** A spawn waiting on its pieces, one of them finished — the shape the flat hold got
 *  wrong. The piece resolves onto the band, so there is no row for the forge to place. */
const SPAWN: readonly TrakSummaryDto[] = [
  makeTrak({ id: "parent", state: { _tag: "AwaitingChildren", step: 0 } }),
  makeTrak({
    id: "piece",
    state: { _tag: "Finished" },
    branch: "trak/piece",
    parent: makeParent({ id: "parent", child: 0 }),
  }),
]

describe("withHold", () => {
  it("holds while every finished group is still in the question", () => {
    const traks = [done("a"), done("b")]
    const { sections, held } = withHold(traks, rungs(traks, undefined))
    expect(held).toBe(2)
    expect(sections).toEqual([])
  })

  it("never holds a page with no finished work", () => {
    expect(withHold([], new Map()).held).toBe(0)
    const traks = [makeTrak({ id: "a", state: { _tag: "AgentWorking", step: 0 }, running: true })]
    const { sections, held } = withHold(traks, rungs(traks, undefined))
    expect(held).toBe(0)
    expect(sections.map((s) => s.key)).toEqual(["progress"])
  })

  it("never holds for a forge that could not be asked", () => {
    // `gh` missing or unreachable is `UNASKED` the moment that answer lands — it must
    // not be a placeholder from then on, however long the tab stays open.
    const traks = [done("a")]
    expect(withHold(traks, rungs(traks, { _tag: "ForgeUnavailable", why: "no gh" })).held).toBe(0)
    // A branch past the question's bound is nobody's to answer either.
    expect(withHold(traks, rungsOf(traks, undefined, [], new Map())).held).toBe(0)
  })

  it("never holds a reload whose remembered answers cover every finished branch", () => {
    const memory: ForgeMemory = new Map([
      ["trak/a", { pull: makePullRequestSummary({ merging: "conflicting" }), at: 1 }],
      ["trak/b", { pull: undefined, at: 1 }],
    ])
    const traks = [done("a"), done("b")]
    expect(withHold(traks, rungs(traks, undefined, memory)).held).toBe(0)
  })

  it("keeps the classified piles up when one trak finishes on an answered page", () => {
    // *Every* rather than *any*: `keepPreviousData` holds the old answer across the key
    // change, so one newly-`ASKING` group on an answered page is ordinary — and blanking
    // the classified block for it would be a worse flicker than the one being removed.
    const memory: ForgeMemory = new Map([["trak/a", { pull: undefined, at: 1 }]])
    const traks = [done("a"), done("b")]
    const { sections, held } = withHold(traks, rungs(traks, undefined, memory))
    expect(held).toBe(0)
    expect(sections.map((s) => s.key)).toEqual(["ready", "finished"])
  })

  it("leaves a finished piece on a running parent's band out of the hold", () => {
    // The review's case, end to end: the group is placed by its running parent, so its
    // pile is not the forge's to decide — no hold, no ghost, and the column stays.
    const { sections, held } = withHold(SPAWN, rungs(SPAWN, undefined))
    expect(held).toBe(0)
    expect(sections.map((s) => s.key)).toEqual(["progress"])
    expect(sections[0]?.rows[0]?.band.map((b) => b.id)).toEqual(["piece"])
  })

  it("keeps a running group's band intact while other groups hold", () => {
    const traks = [...SPAWN, done("flat")]
    const { sections, held } = withHold(traks, rungs(traks, undefined))
    // One ghost — the flat trak's group — and the spawn drawn whole above it.
    expect(held).toBe(1)
    expect(sections.map((s) => s.key)).toEqual(["progress"])
    expect(sections[0]?.rows[0]?.band.map((b) => b.id)).toEqual(["piece"])
  })

  it("holds a group of finished parent and piece as one ghost, not two", () => {
    // The count is of rows owed: however many finished members a group has, it will
    // land as one row, so it buys one ghost.
    const traks = [
      done("parent"),
      makeTrak({
        id: "piece",
        state: { _tag: "Finished" },
        branch: "trak/piece",
        parent: makeParent({ id: "parent", child: 0 }),
      }),
    ]
    const { sections, held } = withHold(traks, rungs(traks, undefined))
    expect(held).toBe(1)
    expect(sections).toEqual([])
  })

  it("lets a locally merged trak keep drawing while the rest holds", () => {
    // *Merged* by state is an ending, not a forge answer: nobody is waiting on it, so
    // it neither blocks the hold nor is dropped by it — it files under the archive's
    // lid, which is where every ended state now draws.
    const traks = [makeTrak({ id: "m", state: { _tag: "Merged", sha: "a91" } }), done("a")]
    const { sections, held } = withHold(traks, rungs(traks, undefined))
    expect(held).toBe(1)
    expect(sections.map((s) => s.key)).toEqual(["archived"])
  })

  it("lets a trak that kept nothing on its branch draw, and never waits on one", () => {
    // RESOLVED is placed below *Ready to merge* like the four piles the forge
    // decides, and is the one pile down there a state put rather than an answer: the
    // forge is never asked about a branch nothing was committed to, so such a member has
    // no rung — not even `ASKING`. Counting it would hold every page carrying one
    // forever. It carries a branch here to say that it is the flag doing this and not a
    // missing field.
    const nothing = makeTrak({
      id: "n",
      state: { _tag: "Finished" },
      branch: "trak/n",
      branchMoved: false,
    })
    const flat = [nothing, done("a")]
    const drawn = withHold(flat, rungs(flat, undefined))
    expect(drawn.held).toBe(1)
    expect(drawn.sections.map((s) => s.key)).toEqual(["resolved"])

    // And on a group holding one of each, the asked member is the whole question.
    const group = [done("parent"), { ...nothing, parent: makeParent({ id: "parent", child: 0 }) }]
    const together = withHold(group, rungs(group, undefined))
    expect(together.held).toBe(1)
    expect(together.sections).toEqual([])
  })

  it("reads a pull request merged on the forge as an answered page, not an ending to skip", () => {
    // The same pile as above with the opposite provenance: placed by rung, the group is
    // the forge's and answered — and one answered group keeps the whole page up.
    const memory: ForgeMemory = new Map([
      ["trak/a", { pull: makePullRequestSummary({ state: "merged" }), at: 1 }],
    ])
    const traks = [done("a"), done("b")]
    expect(withHold(traks, rungs(traks, undefined, memory)).held).toBe(0)
  })
})
