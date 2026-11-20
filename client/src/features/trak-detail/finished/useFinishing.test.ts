/**
 * Tier 1 (`testing-tiers`): the three gates the finished pane's aggregator composes, with
 * no React and no network.
 *
 * What is worth pinning here is not that any question is *drawn* — the pane decides
 * that — but that none is **asked**. Each costs something outside this app per ask: the
 * preview is a `git merge-tree` against the daemon's own checkout, the forge is a `gh`
 * process every `POLL_MS` for as long as a drawer is open, and the deploy may run the
 * project's own script. A gate one case too wide is not a wrong screen; it is a cost
 * nothing on screen would ever report.
 */

import { describe, expect, it } from "vitest"
import type { TrakStateDto } from "../../../api/types"
import { finishingLive } from "./useFinishing"

/** The five a plan runs out into, which is where the pane is drawn at all. */
const ENDED: readonly TrakStateDto[] = [
  { _tag: "Finished" },
  { _tag: "Merging" },
  { _tag: "Closing" },
  { _tag: "Merged", sha: "9f31c07" },
  { _tag: "Closed" },
]

const OTHERS: readonly TrakStateDto[] = [
  { _tag: "Preparing" },
  { _tag: "Composing" },
  { _tag: "AwaitingProposal" },
  { _tag: "AgentWorking", step: 1 },
  { _tag: "AwaitingHuman", step: 1, kind: "approval" },
  { _tag: "Integrating" },
  { _tag: "Failed", kind: "provider", error: "the CLI exited 1" },
  { _tag: "Abandoned", reason: "did it by hand" },
]

const tags = (states: readonly TrakStateDto[]): readonly string[] => states.map((s) => s._tag)

/** No wait has found the branch merged — every case not about the deploy. */
const NOT_LANDED = undefined
const LANDED = { sha: "8c41d0e" }

const NONE = { destination: false, forge: false, deploy: false }

describe("finishingLive", () => {
  /** Two of the five, and `Merging` is why the preview's own switch is not `mergeOffered`:
   *  the merge is running into that branch right now, so the card has a destination to draw
   *  and no press to label. */
  it("asks where a merge would go at the two states still headed somewhere", () => {
    expect(tags(ENDED.filter((s) => finishingLive(s, true, NOT_LANDED, true).destination))).toEqual(
      ["Finished", "Merging"],
    )
  })

  /** All five, which is the wider gate: a pull request already merged still has to say the
   *  work is in over there, at a state the preview has stopped asking about. */
  it("asks the forge at every state the plan can run out into", () => {
    expect(tags(ENDED.filter((s) => finishingLive(s, true, NOT_LANDED, true).forge))).toEqual(
      tags(ENDED),
    )
  })

  /**
   * **One fact takes both away, and that is the point of them being written together.** A
   * branch nothing was committed to has nowhere for a merge to go and cannot have a pull
   * request, so each question has one possible answer and neither answer is drawn — while
   * the forge one costs a process per poll for as long as the drawer is open.
   */
  it("asks nothing about a branch nothing was ever committed to", () => {
    // Landed as well, which cannot happen — a branch with no commits never merges — and is
    // the case that shows `moved` narrows the deploy too rather than `landed` overriding it.
    for (const state of ENDED) {
      expect(finishingLive(state, false, NOT_LANDED, true)).toEqual(NONE)
      expect(finishingLive(state, false, LANDED, true)).toEqual(NONE)
    }
  })

  /**
   * The deploy is asked exactly where there is a merge commit to hand the script: a wait
   * found the branch merged, or the archive ended the trak `Merged` with one. A finished
   * trak whose pull request the forge says merged has neither — no wait was pending, and
   * `landed` is the wait's — so its pane draws no block and runs no script.
   */
  it("asks the deploy only where a wait has landed the branch, or the trak ended Merged", () => {
    expect(tags(ENDED.filter((s) => finishingLive(s, true, NOT_LANDED, true).deploy))).toEqual([
      "Merged",
    ])
    expect(tags(ENDED.filter((s) => finishingLive(s, true, LANDED, true).deploy))).toEqual(
      tags(ENDED),
    )
  })

  /** And only where the project has a script: the route answers `none` at once without
   *  one, and asking would draw a checking line that goes on every merged page. */
  it("asks the deploy only where the project has a deploy.sh", () => {
    for (const state of ENDED) expect(finishingLive(state, true, LANDED, false).deploy).toBe(false)
    expect(finishingLive({ _tag: "Merged", sha: "9f31c07" }, true, NOT_LANDED, false).deploy).toBe(
      false,
    )
  })

  /**
   * **The narrower question is never asked where the wider one is not**, over every state
   * and both readings of the branch — which is the shape *one fact narrows both* has to
   * take to mean anything. Two gates written apart could each be right about its own states
   * and still leave the pane asking where a merge would go on a trak the forge is not being
   * asked about, which is the pair having come apart without either half looking wrong.
   *
   * What makes narrowing the wider gate *safe* is not which states `moved` can be false at
   * — it is false at `Closed` too, which is exactly where pressing *Close it* on one of
   * these traks lands — but that a branch with no commits has neither answer to draw at any
   * of them. The header carries that argument; `src/app/dto.test.ts` pins the predicate
   * behind `moved` itself.
   */
  it("never asks about a destination without asking the forge", () => {
    for (const state of [...ENDED, ...OTHERS])
      for (const moved of [true, false]) {
        const live = finishingLive(state, moved, NOT_LANDED, true)
        expect(live.destination && !live.forge).toBe(false)
      }
  })

  /** Nothing is asked before the plan has run out, and nothing while the detail is still
   *  loading — an absent state is not a trak to ask about. */
  it("asks nothing at a trak still running, and nothing before one has loaded", () => {
    for (const state of OTHERS) expect(finishingLive(state, true, NOT_LANDED, true)).toEqual(NONE)
    expect(finishingLive(undefined, true, NOT_LANDED, true)).toEqual(NONE)
    // A trak still running that has landed is one whose held step is now running; the
    // block is the finished pane's and nothing asks the script until the plan runs out.
    for (const state of OTHERS) expect(finishingLive(state, true, LANDED, true).deploy).toBe(false)
  })
})
