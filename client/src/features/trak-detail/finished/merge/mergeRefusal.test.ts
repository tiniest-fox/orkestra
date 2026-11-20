/**
 * Tier 1: which refusal the plate draws, and how git's text is split — no React, no
 * network.
 */

import { describe, expect, it } from "vitest"
import type { TrakStateDto } from "../../../../api/types"
import { gitSaid, mergeRefusal } from "./mergeRefusal"

const FINISHED: TrakStateDto = { _tag: "Finished" }
const SAID = [
  "merge: git merge --no-ff --no-verify -m Merge trak/a trak/a exited 2: error: Your local changes to the following files would be overwritten by merge:",
  "\tshared.md",
  "Aborting",
].join("\n")
const REFUSED: TrakStateDto = { _tag: "Failed", kind: "merge", error: SAID }

describe("mergeRefusal", () => {
  it("draws nothing on an ordinary finished trak", () => {
    expect(mergeRefusal(FINISHED, [], "blank-white-booby")).toBeUndefined()
    expect(mergeRefusal(FINISHED, [], undefined)).toBeUndefined()
  })

  it("plates a child's dirty refusal with the files and the commit press", () => {
    const plate = mergeRefusal(FINISHED, ["a.md", "src/b.ts"], "blank-white-booby")
    expect(plate).toMatchObject({
      head: "the merge was refused",
      said: undefined,
      files: ["a.md", "src/b.ts"],
      commit: { press: "Commit blank-white-booby and merge" },
    })
    expect(plate?.line).toContain("blank-white-booby's checkout")
    expect(plate?.commit?.says).toContain("2 files")
  })

  /** The host repository keeps its refusal at the press: nothing commits a person's own tree. */
  it("leaves a dirty refusal with no parent to the band", () => {
    expect(mergeRefusal(FINISHED, ["a.md"], undefined)).toBeUndefined()
  })

  it("plates a failed merge with git's own text, and the press only where there is a parent", () => {
    const child = mergeRefusal(REFUSED, [], "blank-white-booby")
    expect(child).toMatchObject({ head: "the merge was refused", said: SAID, files: [] })
    expect(child?.commit?.press).toBe("Commit blank-white-booby and merge")
    expect(child?.commit?.says).toContain("whatever is uncommitted")

    expect(mergeRefusal(REFUSED, [], undefined)?.commit).toBeUndefined()
  })

  /** A press refused after the failure is the fresher answer, so its files win — and the
   *  case below is what keeps that the only order a list can arrive in. */
  it("prefers the press's refusal over the failure where both are true", () => {
    const plate = mergeRefusal(REFUSED, ["a.md"], "blank-white-booby")
    expect(plate?.said).toBeUndefined()
    expect(plate?.files).toEqual(["a.md"])
  })

  /**
   * The commit press's two exits, as this sees them: the Merge press has forgotten its
   * files by the time either lands (`useCommitAndMerge`), so a merge that went in draws
   * nothing and one git still declined draws git's newer words — not the sentence about
   * uncommitted work over a checkout that was just committed. Declined and not conflicted:
   * unmerged paths recompose and never reach `Failed{merge}` — see `useCommitAndMerge`.
   */
  it("draws git's second refusal, not the old file list, once the commit press has landed", () => {
    const declined =
      "check checkout branch: /w/blank-white-booby is on main, not trak/blank-white-booby: whatever was committed there is not on the trak's branch, so nothing here can tell work from an empty branch. The checkout is kept — move or merge the commits onto trak/blank-white-booby and retry."
    const failed: TrakStateDto = { _tag: "Failed", kind: "merge", error: declined }

    expect(
      mergeRefusal({ _tag: "Merged", sha: "abc1234" }, [], "blank-white-booby"),
    ).toBeUndefined()
    const plate = mergeRefusal(failed, [], "blank-white-booby")
    expect(plate?.said).toBe(declined)
    expect(plate?.files).toEqual([])
    expect(plate?.line).not.toContain("uncommitted work")
    expect(plate?.commit?.says).toContain("whatever is uncommitted")
  })

  /**
   * The files outlive the state they were earned at: a commit-and-merge is a different
   * mutation, so nothing clears them when the child lands. Every end state past the press
   * draws no plate, and the two the press can still be made from draw it.
   */
  it("drops a remembered refusal once the trak has moved past the merge", () => {
    const past: readonly TrakStateDto[] = [
      { _tag: "Merging" },
      { _tag: "Merged", sha: "abc1234" },
      { _tag: "Closing" },
      { _tag: "Closing", merged: "abc1234" },
      { _tag: "Closed" },
    ]
    for (const state of past) {
      expect(mergeRefusal(state, ["a.md"], "blank-white-booby")).toBeUndefined()
    }
    expect(mergeRefusal(FINISHED, ["a.md"], "blank-white-booby")?.files).toEqual(["a.md"])
    expect(mergeRefusal(REFUSED, ["a.md"], "blank-white-booby")?.files).toEqual(["a.md"])
  })

  /** The other failure kinds keep their notice at the position they stopped on. */
  it("plates no other failure", () => {
    expect(mergeRefusal({ _tag: "Failed", kind: "worktree", error: "x" }, [], "p")).toBeUndefined()
  })
})

describe("gitSaid", () => {
  it("splits the engine's command prefix from git's own words", () => {
    expect(gitSaid(SAID)).toEqual({
      command: "merge: git merge --no-ff --no-verify -m Merge trak/a trak/a exited 2:",
      output: [
        "error: Your local changes to the following files would be overwritten by merge:",
        "\tshared.md",
        "Aborting",
      ].join("\n"),
    })
  })

  it("draws a sentence with no such prefix whole", () => {
    expect(gitSaid("no branch to merge")).toEqual({
      command: undefined,
      output: "no branch to merge",
    })
  })
})
