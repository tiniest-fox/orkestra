import { describe, expect, it } from "vitest"
import { splitTail } from "./paths"

describe("where a path is cut for the middle ellipsis", () => {
  it("keeps the last two segments whole", () => {
    expect(splitTail("~/Documents/Repos/acme/harbor/apps/client")).toEqual([
      "~/Documents/Repos/acme/harbor",
      "/apps/client",
    ])
  })

  it("leaves a path of two segments or fewer uncut", () => {
    expect(splitTail("~/notes")).toEqual(["", "~/notes"])
    expect(splitTail("/Volumes")).toEqual(["", "/Volumes"])
    expect(splitTail("notes")).toEqual(["", "notes"])
  })

  it("cuts an absolute path the same way", () => {
    expect(splitTail("/Volumes/scratch/experiments/rust-playground")).toEqual([
      "/Volumes/scratch",
      "/experiments/rust-playground",
    ])
  })
})
