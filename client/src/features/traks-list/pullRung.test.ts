/**
 * Tier 1 (`testing-tiers`): the ladder alone — no React, no transport.
 *
 * Written to catch five things. An ordering that reads plausibly one rung at a time and
 * files a draft under its failing checks when both are true at once; a tone scale where a
 * reviewer's no reads softer than a failing check; the failure the one return value exists
 * to make impossible — a row filed under *Merged* wearing a glyph that says it is open; a
 * bottom rung that drifts away from what a finished trak with no answer at all draws,
 * which is the one place two rows are meant to be identical; and **a value nobody
 * classified arriving at that bottom rung by default**, which is what the fall-through
 * table below is for. Every member of every union the ladder reads has a case there, so a
 * fall-through is a line somebody wrote rather than a line nobody did.
 */

import { describe, expect, it } from "vitest"
import type { ForgeListingDto, PullRequestSummaryDto } from "@orkestra/shared/dto/forge"
import type { TrakStateDto } from "@orkestra/shared/dto/trak"
import type { TrakSummaryDto } from "../../api/types"
import { rememberedByBranch, type ForgeMemory } from "../../forgeMemory"
import { makeListing, makePullRequestSummary, makeTrak } from "../../fixtures"
import { trakLabel } from "../../format/trakLabel"
import {
  ASKING,
  forgeBranches,
  pullRung,
  rungMerged,
  rungsOf,
  UNASKED,
  type Rung,
} from "./pullRung"
import { sectionOf } from "./sections"
import { stateIcon } from "./stateIcon"

/**
 * One case per rung, in the ladder's own order, each built so that *only* that rung can
 * match — plus the fields of the rungs below it where the point is that the higher one
 * wins anyway.
 */
const LADDER: readonly {
  readonly rung: number
  readonly what: string
  readonly pull: PullRequestSummaryDto
  readonly section: string
  readonly icon: string
  readonly label: string
  readonly tone: string
  readonly running: boolean
  readonly unmerged: boolean
}[] = [
  {
    rung: 1,
    what: "merged on the forge",
    // Conflicting and rejected too: a merged pull request is merged whatever else is
    // true of it, which is the whole point of it being the first rung.
    pull: makePullRequestSummary({
      state: "merged",
      merging: "conflicting",
      decision: "changesRequested",
    }),
    section: "merged",
    icon: "gitMerge",
    label: "Merged — checkout still here",
    tone: "good",
    running: false,
    unmerged: false,
  },
  {
    rung: 2,
    what: "closed without merging",
    pull: makePullRequestSummary({ state: "closed", checks: "failed" }),
    section: "issues",
    icon: "gitPullRequestClosed",
    label: "Closed without merging",
    tone: "neutral",
    running: false,
    unmerged: true,
  },
  {
    rung: 3,
    what: "still a draft",
    // Conflicting, rejected and failing all at once, because every one of those is moot
    // until it is marked ready — which is why this rung sits above them rather than
    // under them.
    pull: makePullRequestSummary({
      isDraft: true,
      merging: "conflicting",
      decision: "changesRequested",
      checks: "failed",
    }),
    section: "review",
    icon: "gitPullRequestDraft",
    label: "Draft",
    tone: "neutral",
    running: false,
    unmerged: true,
  },
  {
    rung: 4,
    what: "conflicting with its base",
    pull: makePullRequestSummary({ merging: "conflicting", decision: "approved" }),
    section: "issues",
    icon: "unlink",
    label: "Conflicts",
    tone: "bad",
    running: false,
    unmerged: true,
  },
  {
    rung: 5,
    what: "behind its base",
    pull: makePullRequestSummary({ merging: "behind", decision: "approved" }),
    section: "issues",
    icon: "history",
    label: "Behind the base",
    tone: "waiting",
    running: false,
    unmerged: true,
  },
  {
    rung: 6,
    what: "a reviewer asking for changes",
    // With every check green, so the rung above the checks is the one being read.
    pull: makePullRequestSummary({ decision: "changesRequested", checks: "passed" }),
    section: "issues",
    icon: "triangleAlert",
    label: "Changes requested",
    tone: "bad",
    running: false,
    unmerged: true,
  },
  {
    rung: 7,
    what: "a failing check",
    pull: makePullRequestSummary({ decision: "approved", checks: "failed" }),
    section: "issues",
    icon: "shieldX",
    label: "Checks failing",
    tone: "bad",
    running: false,
    unmerged: true,
  },
  {
    rung: 8,
    what: "checks still running",
    pull: makePullRequestSummary({ checks: "running" }),
    section: "review",
    icon: "shield",
    label: "Checks running",
    tone: "working",
    running: true,
    unmerged: true,
  },
  {
    rung: 9,
    what: "the forge waiting for somebody to look",
    pull: makePullRequestSummary({ decision: "reviewRequired", checks: "passed" }),
    section: "review",
    icon: "triangle",
    label: "Waiting on review",
    tone: "waiting",
    running: false,
    unmerged: true,
  },
  {
    rung: 10,
    what: "a mergeability the forge has not worked out",
    // Green and reviewed, so the only thing left to say is that GitHub has not computed
    // it — which is what a branch answers for a while after every push.
    pull: makePullRequestSummary({ merging: "unknown", decision: "approved", checks: "passed" }),
    section: "review",
    icon: "circleDashed",
    label: "Not worked out yet",
    tone: "neutral",
    running: false,
    unmerged: true,
  },
  {
    rung: 11,
    what: "nothing stopping it",
    // Approved, green and clean. *Approved* is deliberately not a rung of its own: the
    // question a row answers is what is in the way, and here nothing is.
    pull: makePullRequestSummary({ decision: "approved", checks: "passed" }),
    section: "ready",
    icon: "flag",
    label: "Ready to merge",
    tone: "waiting",
    running: false,
    unmerged: true,
  },
]

/**
 * Every member of every union the ladder reads that does **not** produce a rung of its own,
 * and the reason it does not.
 *
 * This is the half the ten-row table above cannot state: a rung table says what each
 * answer draws, and says nothing at all about the values that reach the bottom by matching
 * no rung. Those are the ones that go wrong silently — `merging: "unknown"` sat here
 * unwritten and read *Ready to merge* until it was given rung 10.
 *
 * A member added to any of these unions is a compile error in `pullRung.ts`, and a member
 * added *here* with the wrong expectation is a failure below. Between them there is no way
 * to add a wire literal and have it quietly land on the flag.
 */
const FALLS_THROUGH: readonly {
  readonly field: string
  readonly value: string
  readonly why: string
  readonly pull: PullRequestSummaryDto
}[] = [
  {
    field: "merging",
    value: "clean",
    why: "the forge would let it through, so the rungs below get to speak",
    pull: makePullRequestSummary({ merging: "clean", decision: "approved", checks: "passed" }),
  },
  {
    field: "decision",
    value: "approved",
    why: "a reviewer's yes is not in the way — *Approved* was a rung once and was deleted",
    pull: makePullRequestSummary({ decision: "approved", checks: "passed" }),
  },
  {
    field: "decision",
    value: "commented",
    why: "words without a verdict, which the finished pane also draws neutral",
    pull: makePullRequestSummary({ decision: "commented", checks: "passed" }),
  },
  {
    field: "decision",
    value: "absent",
    why: "no decision rather than a verdict of none: nobody has reviewed and nobody has to",
    pull: makePullRequestSummary({ checks: "passed" }),
  },
  {
    field: "checks",
    value: "passed",
    why: "a green run is not in the way",
    pull: makePullRequestSummary({ checks: "passed" }),
  },
  {
    field: "checks",
    value: "none",
    why: "a commit nothing ran against — not a pass, and not a failure",
    pull: makePullRequestSummary({ checks: "none" }),
  },
  {
    field: "checks",
    value: "unknown",
    why: "a rollup word this build does not recognise, which every mapped forge value avoids",
    pull: makePullRequestSummary({ checks: "unknown" }),
  },
]

/** The ladder is total now — it is only ever handed a pull request the forge named — so
 *  this is a rename rather than a guard. What the forge said *nothing* about never gets
 *  here at all; `rungsOf` below is where that is decided. */
const rungOf = (pull: PullRequestSummaryDto): Rung => pullRung(pull)

describe("pullRung", () => {
  it.each(LADDER)(
    "rung $rung — $what",
    ({ pull, section, icon, label, tone, running, unmerged }) => {
      expect(rungOf(pull)).toEqual({ section, icon, label, tone, running, unmerged })
    },
  )

  /** The one field a wait on the branch going in reads: every rung off an unmerged pull
   *  request says the branch is out, *Ready to merge* included, and the merged rung alone
   *  says it is in. The two nothings say neither — a row must not move on an inability to
   *  look, which is the failure the two rungs exist to keep out of the bottom rung. */
  it("says the branch is out on every rung but the merged one, and on neither nothing", () => {
    const inOrUnsaid = LADDER.filter((row) => !rungOf(row.pull).unmerged).map((row) => row.label)
    expect(inOrUnsaid).toEqual(["Merged — checkout still here"])
    expect(UNASKED.unmerged).toBe(false)
    expect(ASKING.unmerged).toBe(false)
  })

  /** Every rung says what is stopping it or says nothing is — no rung reports a sub-fact
   *  and leaves the reader to work out whether the branch could land. */
  it("files everything that cannot land right now away from Ready to merge", () => {
    const landable = LADDER.filter((row) => rungOf(row.pull).section === "ready").map(
      (row) => row.label,
    )
    expect(landable).toEqual(["Ready to merge"])
  })

  /** The one rule the tones are, rather than ten separate picks: `bad` is *not going in as
   *  it stands*, and nothing else open wears it. */
  it("gives bad to a conflict, a reviewer's no and a failing check, and to nothing else", () => {
    const bad = LADDER.filter((row) => rungOf(row.pull).tone === "bad").map((row) => row.label)
    expect(bad).toEqual(["Conflicts", "Changes requested", "Checks failing"])
  })

  /** `good` is the merge's and the merge's alone — the work is in, and the one press
   *  left is Archive. Rung 1 is that claim honoured. */
  it("keeps good for a merge, so an approved pull request reads waiting", () => {
    const good = LADDER.filter((row) => rungOf(row.pull).tone === "good").map((row) => row.label)
    expect(good).toEqual(["Merged — checkout still here"])
  })

  /** The segment says *this is happening now*, which of the ten answers is true of one. */
  it("moves the plate's edge for the forge's checks and for nothing else on the ladder", () => {
    const moving = LADDER.filter((row) => rungOf(row.pull).running).map((row) => row.label)
    expect(moving).toEqual(["Checks running"])
  })

  /** The failure the single return value exists to make unreachable: the pile and the
   *  glyph come off one answer, so no rung can put an open mark in the merged pile. */
  it("never lets the pile a row sits in and the glyph it wears disagree", () => {
    for (const row of LADDER) {
      const rung = rungOf(row.pull)
      expect(sectionOf({ _tag: "Finished" }, true, rung)).toBe(rung.section)
      expect(stateIcon({ _tag: "Finished" }, rung)).toEqual({
        icon: rung.icon,
        running: rung.running,
      })
    }
    expect(LADDER.filter((row) => row.section === "merged").map((row) => row.icon)).toEqual([
      "gitMerge",
    ])
  })

  /**
   * The bottom rung and a bare `Finished` row are meant to be indistinguishable, and this
   * is what keeps them so: an open pull request with nothing wrong, and a branch nobody
   * opened one for, both say *nothing is stopping this*. So the rung has to agree, field
   * for field, with what `Finished` draws on its own.
   *
   * **Read of a branch something was committed to, which is the only kind that reaches
   * this ladder** — a branch nobody pushed to is never asked about, so the bottom rung has
   * no RESOLVED row to be indistinguishable from and must not be.
   */
  it("draws its bottom rung exactly as a finished trak with no answer at all is drawn", () => {
    const bottom = rungOf(makePullRequestSummary())
    const state: TrakStateDto = { _tag: "Finished" }
    expect(bottom.section).toBe(sectionOf(state, true))
    expect(bottom.label).toBe(trakLabel(state, true).label)
    expect(bottom.tone).toBe(trakLabel(state, true).tone)
    expect({ icon: bottom.icon, running: bottom.running }).toEqual(stateIcon(state))
    expect(bottom.label).not.toBe(trakLabel(state, false).label)
  })

  /**
   * **And `UNASKED` is the one that must not be.** *We could not look* was the fourth row
   * in that group and is now its own rung: a `gh` nobody installed used to file every
   * finished trak under *Ready to merge*, which is a verdict about somebody's work
   * arrived at from an inability to look at it.
   */
  it("draws a forge it could not ask apart from a branch with nothing stopping it", () => {
    const bottom = rungOf(makePullRequestSummary())
    expect(UNASKED.section).not.toBe(bottom.section)
    expect(UNASKED.label).not.toBe(bottom.label)
    expect(UNASKED.icon).not.toBe(bottom.icon)
    // And out of the pile whose count is a claim about what a person could land.
    expect(UNASKED.section).not.toBe("ready")
    expect(UNASKED.running).toBe(false)
  })

  /**
   * The deliberate half. Each of these reaches the bottom rung because nothing is in the
   * way, and each is a line somebody wrote rather than the default destination of whatever
   * nobody enumerated.
   */
  it.each(FALLS_THROUGH)("$field: $value falls to the bottom rung — $why", ({ pull }) => {
    expect(rungOf(pull)).toEqual(rungOf(makePullRequestSummary()))
  })

  /**
   * The finding this change exists for.
   *
   * GitHub computes mergeability lazily and answers `UNKNOWN` for a while after every push
   * — and a trak reaches `Finished` immediately after its push, so this is the *first*
   * answer the list gets about nearly every new pull request. It used to fall the length
   * of the ladder to the flag and the pile whose header counts what a person can land.
   */
  it("never calls a mergeability the forge has not worked out a branch with nothing in the way", () => {
    const fresh = rungOf(makePullRequestSummary({ merging: "unknown" }))
    expect(fresh.section).not.toBe("ready")
    expect(fresh.label).not.toBe("Ready to merge")
    expect(fresh.icon).not.toBe("flag")
  })

  /**
   * And it stays out of the way of the things we *do* know. A branch fresh off a push has
   * an uncomputed mergeability *and* checks that have not finished, and the second of those
   * is the more useful of two true things — so the new rung sits at the foot of the ladder
   * rather than beside the two refusals.
   */
  it("prefers a blocker it knows to one it does not", () => {
    const unknown: Partial<PullRequestSummaryDto> = { merging: "unknown" }
    expect(rungOf(makePullRequestSummary({ ...unknown, checks: "running" })).label).toBe(
      "Checks running",
    )
    expect(rungOf(makePullRequestSummary({ ...unknown, checks: "failed" })).label).toBe(
      "Checks failing",
    )
    expect(rungOf(makePullRequestSummary({ ...unknown, decision: "changesRequested" })).label).toBe(
      "Changes requested",
    )
    expect(rungOf(makePullRequestSummary({ ...unknown, isDraft: true })).label).toBe("Draft")
    // And the ordinary case it was written for: nothing else to say, so it says this.
    expect(rungOf(makePullRequestSummary({ ...unknown, checks: "none" })).label).toBe(
      "Not worked out yet",
    )
  })

  /**
   * The words, against the pane's own for the same field, one click away.
   *
   * `mergingWords("unknown")` in `trak-detail/pull-request/pullRequest.ts` reads *GitHub has not worked
   * it out yet*, tone `neutral` — and the row is that sentence at row length, carrying the
   * same tone. It is quoted here rather than imported: a `traks-list` test reaching into
   * `trak-detail` would be this client's first cross-feature import, and `client-style`
   * says there is never a good first one.
   *
   * What the assertion can actually pin is the tone, and that the phrase is not the bottom
   * rung's — which is the thing that was wrong. Whether four words agree with a sentence is
   * a reading, and it is in the docstring where a reader can check it.
   */
  it("says about a mergeability nobody has worked out what the finished pane says", () => {
    const rung = rungOf(makePullRequestSummary({ merging: "unknown" }))
    expect(rung.label).toBe("Not worked out yet")
    expect(rung.tone).toBe("neutral")
    expect(rung.label).not.toBe(rungOf(makePullRequestSummary()).label)
  })
})

/**
 * Every state the wire has. Hand-written for `sections.test.ts`' reason: a state the union
 * grows compiles here and simply stops being covered, so it has to be added by hand — the
 * compile error is in the switches this list is the input to.
 */
const EVERY_STATE: readonly TrakStateDto[] = [
  { _tag: "Preparing" },
  { _tag: "Composing" },
  { _tag: "AwaitingProposal" },
  { _tag: "AwaitingComposerAnswers" },
  { _tag: "AgentWorking", step: 0 },
  { _tag: "CheckRunning", step: 0 },
  { _tag: "ConditionRunning", step: 0 },
  { _tag: "AwaitingHuman", step: 0, kind: "approval" },
  { _tag: "Spawning", step: 0 },
  { _tag: "HandingOff", step: 0 },
  { _tag: "AwaitingChildren", step: 0 },
  { _tag: "Joining", step: 0 },
  { _tag: "Committing", step: 0 },
  { _tag: "Effecting", step: 0 },
  { _tag: "Integrating" },
  { _tag: "Abandoning", reason: "done with it" },
  { _tag: "Merging" },
  { _tag: "Closing" },
  { _tag: "Finished" },
  { _tag: "Merged", sha: "abc1234" },
  { _tag: "Closed" },
  { _tag: "Abandoned", reason: "done with it" },
  { _tag: "Failed", kind: "provider", error: "the CLI exited 1" },
]

/** A trak whose plan has run out, on a branch named after it. */
const done = (id: string, branch = `trak/${id}`) =>
  makeTrak({ id, state: { _tag: "Finished" }, branch })

/** An entry saying this branch has a pull request, as the wire carries it. */
const on = (branch: string, over: Parameters<typeof makePullRequestSummary>[0] = {}) => ({
  branch,
  pull: makePullRequestSummary(over),
})

/** When the live listing landed, as far as these cases care — newer than anything a case
 *  puts in the memory by hand, which stamps small numbers. */
const NOW = 1_760_000_000_000

/**
 * `rungsOf` as the page calls it: the question is every finished branch on the list, the
 * live listing reaches the rows through the store — folded by the real
 * `rememberedByBranch`, exactly as `useForgeMemory` folds the cache — and the browser
 * remembers nothing else unless a case hands it something.
 *
 * All three are arguments rather than defaults on the function itself, because forgetting
 * any is a silent wrong answer — an empty question makes every row read *we could not ask*.
 */
const rungs = (
  traks: readonly TrakSummaryDto[],
  listing: ForgeListingDto | undefined,
  memory: ForgeMemory = new Map(),
) => {
  const held = new Map(memory)
  // The live answer overlays what a case remembered: it is the newest thing in the cache,
  // which is what "newest wins per branch" resolves to here.
  for (const [branch, said] of rememberedByBranch([{ answer: listing, at: NOW }], NOW)) {
    held.set(branch, said)
  }
  return rungsOf(traks, listing, forgeBranches(traks), held)
}

describe("rungsOf", () => {
  it("gives a rung to the finished traks and to nothing else", () => {
    const traks = EVERY_STATE.map((state, i) =>
      makeTrak({ id: `t${String(i)}`, state, branch: `trak/t${String(i)}` }),
    )
    // Every one of them has a pull request, so what keeps the count at one is the state.
    const found = rungs(traks, makeListing({ entries: traks.map((trak) => on(`trak/${trak.id}`)) }))
    expect([...found.keys()]).toHaveLength(1)
    const [only] = [...found.keys()]
    expect(traks.find((trak) => trak.id === only)?.state._tag).toBe("Finished")
  })

  /**
   * The rabbit hole this stays out of: a trak whose pull request has merged is *still*
   * `Finished` in the log, so it is still looked up. Read the set off where the ladder
   * filed a row instead and that row leaves the pile it was in, stops being looked up,
   * loses its answer, falls back, and is filed again — a fifteen-second loop.
   */
  it("keeps reading a trak whose pull request has already merged", () => {
    const trak = done("t")
    const listing = makeListing({ entries: [on("trak/t", { state: "merged" })] })
    expect(rungs([trak], listing).get("t")?.section).toBe("merged")
    // Twice, because the second read is the one a derived set would have skipped.
    expect(rungs([trak], listing).get("t")?.section).toBe("merged")
  })

  /**
   * **No rung of any kind, `UNASKED` included.** It was not asked about and there is nothing
   * to say — `sectionOf` files it under RESOLVED off its own state, and a rung there
   * would override that with a pile about a pull request that cannot exist. It is the one
   * absence here that is neither a claim nor a failure to look.
   */
  it("gives no rung to a finished trak whose branch was never committed to", () => {
    const nothing = makeTrak({
      id: "n",
      state: { _tag: "Finished" },
      branch: "trak/n",
      branchMoved: false,
    })
    // Even where an answer names the branch — a stale one, or a pull request opened by
    // hand: the trak was left out of the question, so nothing about it is read.
    for (const listing of [undefined, makeListing(), makeListing({ entries: [on("trak/n")] })])
      expect(rungs([nothing], listing).get("n")).toBeUndefined()
    // The control: flip the one fact and the branch is in the question again, so the same
    // empty answer reads as *we are still asking* rather than as nothing at all.
    expect(rungs([{ ...nothing, branchMoved: true }], makeListing()).get("n")).toBe(ASKING)
  })

  it("matches a row to an answer by branch, and leaves the ones the forge cleared alone", () => {
    const named = done("named", "trak/named")
    const quiet = done("quiet", "trak/quiet")
    const found = rungs(
      [named, quiet],
      makeListing({
        entries: [on("trak/named", { merging: "conflicting" }), { branch: "trak/quiet" }],
      }),
    )
    expect(found.get("named")?.label).toBe("Conflicts")
    // No rung at all: the forge was asked about this branch by name and said it has no
    // pull request — which is `Finished`'s own row and a true statement about it.
    expect(found.get("quiet")).toBeUndefined()
  })

  /**
   * The finding this change exists for. A forge that could not be asked used to reach the
   * same absence a branch with no pull request reaches, so `gh` not being installed drew
   * every finished trak as *Ready to merge*.
   */
  it("never lets a forge it could not reach read as a branch with nothing in the way", () => {
    const found = rungs([done("a"), done("b")], {
      _tag: "ForgeUnavailable",
      why: "gh: not authenticated",
    })
    expect(found.get("a")).toEqual(UNASKED)
    expect(found.get("b")).toEqual(UNASKED)
  })

  /**
   * The absences the whole shape exists to keep apart. An answer that holds no entry for a
   * branch said nothing about it, and nothing may be drawn on that — but *why* it said
   * nothing is now two different rows, and `asked` is what tells them apart.
   */
  it("will not read a branch it has no entry for as a branch with nothing in its way", () => {
    // Past the engine's per-call bound: the question never named it, and nobody is still
    // asking on its behalf.
    expect(rungsOf([done("a")], makeListing(), [], new Map()).get("a")).toEqual(UNASKED)
    // In the question, and the answer in hand is to an older one — which is what
    // `keepPreviousData` leaves on screen the moment a trak finishes. We are still asking.
    expect(rungs([done("a")], makeListing()).get("a")).toEqual(ASKING)
    // And a branch the same answer *does* hold an entry for is answered normally: what was
    // asked is still true, and only what was not asked is unknown.
    const named = makeListing({ entries: [on("trak/a", { state: "merged" })] })
    expect(rungs([done("a")], named).get("a")?.label).toBe("Merged — checkout still here")
  })

  /** A finished trak with no branch has nothing to match on, so it is unaskable however
   *  healthy the forge is. Nothing produces one today — the branch rides on the worktree
   *  and replay never clears it — and the case is here so that an absent field can never
   *  be read as an absent pull request. */
  it("treats a finished trak with no branch as one it could not ask about", () => {
    // Built here rather than through `done`, which always names one: the case *is* the
    // absent field, and an answer holding an entry for every branch there is makes it the
    // only thing being tested.
    const noBranch = makeTrak({ id: "a", state: { _tag: "Finished" } })
    expect(rungs([noBranch], makeListing()).get("a")).toEqual(UNASKED)
  })

  /**
   * Nothing has answered yet. It must not be no rung at all — `sections.ts` files a
   * finished trak the ladder never reached under *Ready to merge*, so silence here is a
   * verdict and a conflicting row would be drawn as landable for as long as an answer
   * took. And it must not be `UNASKED` either, which asserts the forge is unreachable
   * while we are in the middle of reaching it.
   */
  it("says it is still asking while no answer has come back at all", () => {
    expect(rungs([done("a")], undefined).get("a")).toEqual(ASKING)
  })

  /**
   * What the whole change is for: a reload lands with nothing in flight answered yet, and
   * the verdicts drawn a moment ago are still true. A remembered answer is read exactly
   * where a live one would be — including its saying there is no pull request, which is
   * what leaves the row on the bottom rung and the local Merge press on offer.
   */
  it("draws a remembered answer as the live one would be drawn", () => {
    const memory: ForgeMemory = new Map([
      ["trak/a", { pull: makePullRequestSummary({ merging: "conflicting" }), at: 1 }],
      ["trak/b", { pull: undefined, at: 1 }],
    ])
    const found = rungs([done("a"), done("b")], undefined, memory)
    expect(found.get("a")?.label).toBe("Conflicts")
    expect(found.get("b")).toBeUndefined()
  })

  /** A live entry always wins: the remembered one is a floor, never a second opinion. */
  it("prefers the answer in hand to the one it remembers", () => {
    const memory: ForgeMemory = new Map([
      ["trak/a", { pull: makePullRequestSummary({ merging: "conflicting" }), at: 1 }],
    ])
    expect(rungs([done("a")], makeListing({ entries: [on("trak/a")] }), memory).get("a")).toEqual(
      rungs([done("a")], makeListing({ entries: [on("trak/a")] })).get("a"),
    )
  })

  /** A forge that cannot be reached now does not erase what it said twenty minutes ago —
   *  which is the case a machine whose `gh` login expired mid-session is in. */
  it("keeps drawing a remembered answer while the forge cannot be reached", () => {
    const memory: ForgeMemory = new Map([
      ["trak/a", { pull: makePullRequestSummary({ state: "merged" }), at: 1 }],
    ])
    const found = rungs([done("a")], { _tag: "ForgeUnavailable", why: "no gh" }, memory)
    expect(found.get("a")?.label).toBe("Merged — checkout still here")
  })

  /**
   * A branch past the hundred-branch cut is never in the question, so the listing can
   * never answer about it — it used to read *Could not ask GitHub* forever. Its own page
   * can, and an answer filed by branch reaches the row wherever it came from.
   */
  it("draws a verdict from the store for a branch the question never named", () => {
    const memory: ForgeMemory = new Map([
      ["trak/a", { pull: makePullRequestSummary({ state: "merged" }), at: 1 }],
    ])
    expect(rungsOf([done("a")], undefined, [], memory).get("a")?.label).toBe(
      "Merged — checkout still here",
    )
  })
})

describe("rungsOf with no origin", () => {
  /**
   * A project with no `origin`: the engine asked no forge, and no branch can have a pull
   * request. Every finished trak whose branch moved is landable with the local press, and
   * a remembered pull request from a remote since removed does not outrank that.
   */
  it("files every finished trak under Ready to merge where there is no origin", () => {
    const memory: ForgeMemory = new Map([
      ["trak/b", { pull: makePullRequestSummary({ merging: "conflicting" }), at: 1 }],
    ])
    const found = rungs([done("a"), done("b")], { _tag: "NoOrigin" }, memory)
    expect(found.get("a")).toBeUndefined()
    expect(found.get("b")).toBeUndefined()
    const finished: TrakStateDto = { _tag: "Finished" }
    expect(sectionOf(finished, true, found.get("a"))).toBe("ready")
    expect(trakLabel(finished, true).label).toBe("Ready to merge")
    expect([...found.values()]).not.toContainEqual(UNASKED)
  })
})

describe("forgeBranches", () => {
  /** A `gh` process every fifteen seconds for as long as a tab is open, so a list with
   *  nothing to draw it on names nothing and the query never runs. */
  it("names the branch of everything that has run its plan out, and nothing else", () => {
    expect(forgeBranches([])).toStrictEqual([])
    expect(forgeBranches([makeTrak({ state: { _tag: "AgentWorking", step: 1 } })])).toStrictEqual(
      [],
    )
    expect(forgeBranches([makeTrak({ state: { _tag: "Merged", sha: "a91" } })])).toStrictEqual([])
    expect(forgeBranches([done("a")])).toStrictEqual(["trak/a"])
  })

  /** Nothing to match an answer on, so there is nothing to ask — and the row reads
   *  `UNASKED` for exactly that reason. */
  it("leaves out a finished trak with no branch", () => {
    expect(forgeBranches([makeTrak({ id: "a", state: { _tag: "Finished" } })])).toStrictEqual([])
  })

  /** It is a cache key. Two renders producing the same set in a different order would
   *  otherwise be two questions, refetching on a render and making the poll interval mean
   *  nothing. */
  it("comes back sorted, and names a branch once however many rows carry it", () => {
    expect(forgeBranches([done("c"), done("a"), done("b"), done("b2", "trak/a")])).toStrictEqual([
      "trak/a",
      "trak/b",
      "trak/c",
    ])
  })

  /** The ask-set's rule one level up: read it off where rows were filed and the answer
   *  that moved them is the answer that stops it being asked. */
  it("keeps naming a trak whose pull request has already merged", () => {
    const trak = done("t")
    const listing = makeListing({ entries: [on("trak/t", { state: "merged" })] })
    expect(rungs([trak], listing).get("t")?.section).toBe("merged")
    expect(forgeBranches([trak])).toStrictEqual(["trak/t"])
  })

  /**
   * A branch nobody pushed to cannot have a pull request, so the question has one possible
   * answer and asking costs a slot of the per-call bound. **`branchMoved` off the summary,
   * never off the pile it produced** — the skip is one condition away from the fifteen-second
   * loop `rungsOf` is written around.
   */
  it("asks about no branch that was never committed to", () => {
    const nothing = makeTrak({ id: "n", state: { _tag: "Finished" }, branch: "trak/n" })
    expect(forgeBranches([{ ...nothing, branchMoved: false }])).toStrictEqual([])
    expect(forgeBranches([nothing])).toStrictEqual(["trak/n"])
  })
})

/** What Archive's confirmation may claim about the branch: only what the forge said. */
describe("rungMerged", () => {
  it("is true at the merged rung and false where the forge says the branch is out", () => {
    expect(rungMerged(rungOf(makePullRequestSummary({ state: "merged" })))).toBe(true)
    expect(rungMerged(rungOf(makePullRequestSummary({ state: "open" })))).toBe(false)
    // No rung is the forge answering that there is no pull request on the branch.
    expect(rungMerged(undefined)).toBe(false)
  })

  it("knows nothing at the two rungs that say nothing about the branch", () => {
    expect(rungMerged(UNASKED)).toBeUndefined()
    expect(rungMerged(ASKING)).toBeUndefined()
  })
})
