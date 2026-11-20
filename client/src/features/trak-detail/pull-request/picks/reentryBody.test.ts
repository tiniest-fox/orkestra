/**
 * Tier 1 (`testing-tiers`): the composing function alone — no React, no network, no DOM.
 *
 * It is the one thing on the client half that a person's words go through on the way to a
 * `claude`, so the cases below are the format itself rather than a sample of it.
 */

import { describe, expect, it } from "vitest"
import type { Picked } from "./reentryBody"
import { isPicked, pickAll, pickedBase, reentryBody, removePick, togglePick } from "./reentryBody"

const check: Picked = {
  key: "check:verify",
  label: "verify — failing",
  said: "The verify check is failing on pull request #41.",
  where: ["Failed 4m ago", "https://github.com/o/r/actions/runs/9"],
  quote: undefined,
}

const comment: Picked = {
  key: "thread:controls.ts:41",
  label: "octocat on controls.ts:41",
  said: "octocat left a comment on pull request #41.",
  where: ["client/src/features/trak-detail/controls.ts:41"],
  quote: "This composes outside the switch, doesn't it?",
}

const merging: Picked = {
  key: "merging",
  label: "GitHub will not merge it",
  said: "Pull request #41 cannot merge as it stands.",
  where: [],
  quote: "The pull request conflicts with its base branch.",
}

describe("reentryBody", () => {
  it("puts the sentence first and each picked thing under its own header, quoted verbatim", () => {
    expect(reentryBody([check, comment, merging], "Fix the checks and address the comment.")).toBe(
      [
        "Fix the checks and address the comment.",
        "",
        "The verify check is failing on pull request #41.",
        "Failed 4m ago",
        "https://github.com/o/r/actions/runs/9",
        "",
        "octocat left a comment on pull request #41.",
        "client/src/features/trak-detail/controls.ts:41",
        "> This composes outside the switch, doesn't it?",
        "",
        "Pull request #41 cannot merge as it stands.",
        "> The pull request conflicts with its base branch.",
      ].join("\n"),
    )
  })

  it("sends a ticked check's name, when it failed and its link — and no output", () => {
    const body = reentryBody([check], "")
    expect(body).toContain("verify")
    expect(body).toContain("https://github.com/o/r/actions/runs/9")
    // No quoted block at all: a check's output is never fetched, so there is nothing to
    // quote and nothing may be invented in its place.
    expect(body).not.toContain(">")
  })

  it("quotes every line of a multi-line comment, blank lines included", () => {
    const long: Picked = {
      ...comment,
      quote: "First paragraph.\n\nSecond paragraph.",
    }
    expect(reentryBody([long], "")).toBe(
      [
        "octocat left a comment on pull request #41.",
        "client/src/features/trak-detail/controls.ts:41",
        "> First paragraph.",
        "> ",
        "> Second paragraph.",
      ].join("\n"),
    )
  })

  it("sends the ticked things alone when nothing was typed", () => {
    expect(reentryBody([merging], "   ")).toBe(
      "Pull request #41 cannot merge as it stands.\n> The pull request conflicts with its base branch.",
    )
  })

  it("sends the sentence alone when nothing was ticked, which is the plain re-entry", () => {
    expect(reentryBody([], "  The commit message should name the step.  ")).toBe(
      "The commit message should name the step.",
    )
  })

  it("is empty with nothing ticked and nothing typed, which is what turns the press off", () => {
    expect(reentryBody([], "")).toBe("")
    expect(reentryBody([], "\n  \n")).toBe("")
  })

  it("never draws the label — it names the line in the box, not the block that is sent", () => {
    expect(reentryBody([check, comment], "")).not.toContain("verify — failing")
  })
})

describe("the picked list", () => {
  it("ticks and unticks by key, keeping the order things were ticked in", () => {
    const one = togglePick([], check)
    const two = togglePick(one, comment)
    expect(two.map((p) => p.key)).toEqual([check.key, comment.key])
    expect(togglePick(two, check).map((p) => p.key)).toEqual([comment.key])
  })

  it("draws a row's own tick off the list, so there is only ever one answer", () => {
    expect(isPicked([check], check.key)).toBe(true)
    expect(isPicked([check], comment.key)).toBe(false)
  })

  /**
   * The affordance the box at the foot has and the row does not: a line goes without
   * anybody finding the row it came from, several folds away. It leaves the list, so the
   * body changes to match and the tick goes with it — two answers to *is this picked* is a
   * surface that can disagree with what it would send.
   */
  it("removes a picked thing from the box, and the body it composes changes with it", () => {
    const held = [check, comment, merging]
    const left = removePick(held, comment.key)

    expect(left.map((p) => p.key)).toEqual([check.key, merging.key])
    expect(isPicked(left, comment.key)).toBe(false)
    expect(reentryBody(left, "")).not.toContain("This composes outside the switch")
    expect(reentryBody(held, "")).toContain("This composes outside the switch")
  })

  /**
   * The tick in a reviewer's head: everything under it on, or — once it all is — everything
   * under it off. What was ticked elsewhere is left as it was either way.
   */
  it("ticks a whole group at once, and unticks it once every one of them is on", () => {
    const some = pickAll([check], [comment, merging])
    expect(some.map((one) => one.key)).toEqual([check.key, comment.key, merging.key])

    // Half on is not on: the press fills in the missing one rather than clearing the group.
    const filled = pickAll([check, comment], [comment, merging])
    expect(filled.map((one) => one.key)).toEqual([check.key, comment.key, merging.key])

    const none = pickAll(filled, [comment, merging])
    expect(none.map((one) => one.key)).toEqual([check.key])
  })

  it("removing something that was never picked changes nothing", () => {
    expect(removePick([check], "merging")).toEqual([check])
  })
})

describe("pickedBase", () => {
  it("is the base on a ticked refusal, and nothing without one", () => {
    expect(pickedBase([check, { ...merging, base: "main" }, comment])).toBe("main")
    expect(pickedBase([check, merging, comment])).toBeUndefined()
    expect(pickedBase([])).toBeUndefined()
  })
})
