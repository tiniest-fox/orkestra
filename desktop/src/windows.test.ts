import { describe, expect, it } from "vitest"
import { afterRemoval, parseWindows, routeOpen, serializeWindows } from "./windows.js"

describe("the saved windows", () => {
  it("round-trips every window with its projects and its selected one", () => {
    const windows = [
      { projects: ["/a", "/b"], selected: "/b" },
      { projects: [], selected: undefined },
    ]
    expect(parseWindows(serializeWindows(windows))).toEqual(windows)
  })

  it("reads a file it did not write as no windows", () => {
    expect(parseWindows("")).toEqual([])
    expect(parseWindows("not json")).toEqual([])
    expect(parseWindows(JSON.stringify({ windows: "none" }))).toEqual([])
  })

  it("keeps a project in the first window that names it", () => {
    const text = JSON.stringify({
      windows: [
        { projects: ["/a", "/b"], selected: "/a" },
        { projects: ["/b", "/c"], selected: "/b" },
      ],
    })
    expect(parseWindows(text)).toEqual([
      { projects: ["/a", "/b"], selected: "/a" },
      { projects: ["/c"], selected: "/c" },
    ])
  })

  it("reads a selection that is not on the rail as the first tile", () => {
    const text = JSON.stringify({ windows: [{ projects: ["/a", "/b"], selected: "/gone" }] })
    expect(parseWindows(text)).toEqual([{ projects: ["/a", "/b"], selected: "/a" }])
  })
})

describe("removing a project from a window", () => {
  const window = { projects: ["/a", "/b", "/c"], selected: "/b" }

  it("selects the tile that takes the removed one's place", () => {
    expect(afterRemoval(window, "/b")).toEqual({ projects: ["/a", "/c"], selected: "/c" })
  })

  it("selects the tile above when the last one is removed", () => {
    expect(afterRemoval({ ...window, selected: "/c" }, "/c")).toEqual({
      projects: ["/a", "/b"],
      selected: "/b",
    })
  })

  it("leaves the selection alone when another tile is removed", () => {
    expect(afterRemoval(window, "/a")).toEqual({ projects: ["/b", "/c"], selected: "/b" })
  })

  it("leaves a window with no projects and nothing selected", () => {
    expect(afterRemoval({ projects: ["/a"], selected: "/a" }, "/a")).toEqual({
      projects: [],
      selected: undefined,
    })
  })
})

describe("opening a project", () => {
  const windows = [
    { projects: ["/a"], selected: "/a" },
    { projects: ["/b", "/c"], selected: "/b" },
  ]

  it("brings forward the window that already holds it, whichever window asked", () => {
    expect(routeOpen(windows, "/c", 0)).toEqual({ to: "held", window: 1 })
    expect(routeOpen(windows, "/a", undefined)).toEqual({ to: "held", window: 0 })
  })

  it("joins the window the press came from", () => {
    expect(routeOpen(windows, "/new", 0)).toEqual({ to: "add", window: 0 })
  })

  it("joins the window last focused when the press has no window of its own", () => {
    expect(routeOpen(windows, "/new", undefined)).toEqual({ to: "add", window: 1 })
  })

  it("gets a window of its own when none is open", () => {
    expect(routeOpen([], "/new", undefined)).toEqual({ to: "new" })
  })
})
