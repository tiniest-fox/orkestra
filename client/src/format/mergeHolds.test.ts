import { describe, expect, it } from "vitest"
import { mergeHoldsLine } from "./mergeHolds"

describe("mergeHoldsLine", () => {
  it("leads with GitHub's headline where GitHub blocks the merge", () => {
    expect(mergeHoldsLine([{ cause: "reviewRequired" }])).toStrictEqual({
      lead: "Merging is blocked.",
      text: "At least 1 approving review is required by reviewers with write access.",
    })
  })

  it("says one sentence per cause, naming the checks", () => {
    expect(
      mergeHoldsLine([
        { cause: "reviewRequired", approvals: 2 },
        { cause: "checks", names: ["verify"] },
        { cause: "waiting", names: ["lint", "build", "test"] },
      ]).text,
    ).toBe(
      "At least 2 approving reviews are required by reviewers with write access. " +
        "Required status check “verify” is failing. " +
        "Required status checks “lint”, “build” and “test” have not finished.",
    )
  })

  it.each([
    ["conflicting", "This branch has conflicts that must be resolved."],
    ["behind", "This branch is out-of-date with the base branch."],
    ["draft", "This pull request is still a work in progress."],
    ["rule", "Merging is blocked by a branch rule."],
  ] as const)("says %s as its own sentence, with no lead", (cause, text) => {
    expect(mergeHoldsLine([{ cause }])).toStrictEqual({ lead: undefined, text })
  })
})
