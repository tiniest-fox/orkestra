import { describe, expect, it } from "vitest"
import { gitTooOld, MIN_GIT } from "./version.js"

describe("the git a merge prediction needs", () => {
  it("reads the version out of what git actually prints, vendor suffix and all", () => {
    expect(gitTooOld("git version 2.39.5 (Apple Git-154)")).toBe(false)
    expect(gitTooOld("git version 2.51.0")).toBe(false)
    expect(gitTooOld("git version 3.0.0")).toBe(false)
  })

  it("refuses the versions without `merge-tree --write-tree`", () => {
    expect(gitTooOld("git version 2.37.9")).toBe(true)
    expect(gitTooOld("git version 1.9.1")).toBe(true)
  })

  it("takes the minimum itself as new enough, rather than one patch either side of it", () => {
    // The patch level is deliberately not compared, so the boundary is the whole
    // of the rule: 2.38.0 has the feature and 2.37.anything does not.
    expect(gitTooOld(`git version ${MIN_GIT}.0`)).toBe(false)
    expect(gitTooOld(`git version ${MIN_GIT}.9`)).toBe(false)
  })

  it("refuses a line it cannot read rather than assuming the git is new", () => {
    // Not knowing is not the same as being new enough, and the two mistakes cost
    // differently: a refusal is a sentence somebody acts on, where carrying on
    // hands them a prediction that quietly never fires.
    expect(gitTooOld("")).toBe(true)
    expect(gitTooOld("git: command not found")).toBe(true)
  })
})
