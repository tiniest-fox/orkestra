import { describe, expect, it } from "vitest"
import {
  bumped,
  parseRecents,
  RECENTS_LIMIT,
  rowsOf,
  serializeRecents,
  without,
} from "./recents.js"

describe("the recent projects list", () => {
  it("puts an opened project first", () => {
    expect(bumped(["/a", "/b"], "/c")).toEqual(["/c", "/a", "/b"])
  })

  it("moves a project already on the list rather than listing it twice", () => {
    expect(bumped(["/a", "/b"], "/b")).toEqual(["/b", "/a"])
  })

  it("cuts the tail at the limit", () => {
    const full = Array.from({ length: RECENTS_LIMIT }, (_, i) => `/p${String(i)}`)
    const next = bumped(full, "/new")
    expect(next).toHaveLength(RECENTS_LIMIT)
    expect(next[0]).toBe("/new")
    expect(next).not.toContain(`/p${String(RECENTS_LIMIT - 1)}`)
  })

  it("drops a project that no longer opens", () => {
    expect(without(["/a", "/b"], "/a")).toEqual(["/b"])
  })

  it("round-trips through the file format", () => {
    expect(parseRecents(serializeRecents(["/a", "/b"]))).toEqual(["/a", "/b"])
  })

  it("reads anything it did not write as no recents", () => {
    expect(parseRecents("")).toEqual([])
    expect(parseRecents("not json")).toEqual([])
    expect(parseRecents("[]")).toEqual([])
    expect(parseRecents('{"recents": "one"}')).toEqual([])
    expect(parseRecents('{"recents": ["/a", 3, null]}')).toEqual(["/a"])
  })

  it("draws a row as the folder's name over its path, with home as ~", () => {
    expect(
      rowsOf(["/Users/k/Repos/app", "/Volumes/scratch/lab", "/Users/kim/x"], "/Users/k"),
    ).toEqual([
      { path: "/Users/k/Repos/app", name: "app", short: "~/Repos/app" },
      { path: "/Volumes/scratch/lab", name: "lab", short: "/Volumes/scratch/lab" },
      { path: "/Users/kim/x", name: "x", short: "/Users/kim/x" },
    ])
  })
})
