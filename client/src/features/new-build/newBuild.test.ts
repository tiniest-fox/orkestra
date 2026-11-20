import { describe, expect, it } from "vitest"
import { newerBuild } from "./newBuild"

describe("newerBuild", () => {
  it("offers a reported id that is neither this page's nor dismissed", () => {
    expect(newerBuild("a", "b", undefined)).toBe("b")
  })

  it("offers nothing for the build this page is", () => {
    expect(newerBuild("a", "a", undefined)).toBeUndefined()
  })

  it("offers nothing on a page with no id of its own, whatever the engine says", () => {
    expect(newerBuild(undefined, "b", undefined)).toBeUndefined()
  })

  it("reads no answer, or no id in it, as could not tell", () => {
    expect(newerBuild("a", undefined, undefined)).toBeUndefined()
  })

  it("holds back the dismissed id, and offers the next rebuild again", () => {
    expect(newerBuild("a", "b", "b")).toBeUndefined()
    expect(newerBuild("a", "c", "b")).toBe("c")
  })
})
