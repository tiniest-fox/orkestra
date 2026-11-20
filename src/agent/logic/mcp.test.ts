import { describe, expect, it } from "vitest"
import { calledTool, isViewKey, openToViews, resourceOf, resultOf, toolView } from "./mcp.js"

describe("toolView", () => {
  it("reads the address under ui.resourceUri and under the flat key", () => {
    expect(toolView({ ui: { resourceUri: "ui://a/b.html" } }).view).toBe("ui://a/b.html")
    expect(toolView({ "ui/resourceUri": "ui://a/b.html" }).view).toBe("ui://a/b.html")
  })

  it("has no view for a tool that declares none, or one that is not a ui address", () => {
    expect(toolView(undefined).view).toBeUndefined()
    expect(toolView({ ui: { resourceUri: "https://example.com/x" } }).view).toBeUndefined()
  })

  it("is open to views unless the server's visibility leaves `app` out", () => {
    expect(toolView(undefined).openToViews).toBe(true)
    expect(toolView({ ui: { visibility: ["app"] } }).openToViews).toBe(true)
    expect(toolView({ ui: { visibility: ["model", "app"] } }).openToViews).toBe(true)
    expect(toolView({ ui: { visibility: ["model"] } }).openToViews).toBe(false)
  })
})

describe("resultOf", () => {
  it("wraps a string `content` as the one text block it stands for", () => {
    expect(resultOf({ content: '{"count":1}', structuredContent: { count: 1 } }, false)).toEqual({
      content: [{ type: "text", text: '{"count":1}' }],
      structured: { count: 1 },
      isError: false,
    })
  })

  it("keeps an array, the server's meta, and either report of a failure", () => {
    const blocks = [{ type: "text", text: "count is 1" }]
    expect(resultOf({ content: blocks, _meta: { a: 1 } }, false)).toEqual({
      content: blocks,
      meta: { a: 1 },
      isError: false,
    })
    expect(resultOf({ content: blocks, isError: true }, false).isError).toBe(true)
    expect(resultOf(undefined, true)).toEqual({ content: [], isError: true })
  })
})

describe("resourceOf", () => {
  it("is the first content's text, with no policy where none is declared", () => {
    expect(resourceOf({ contents: [{ text: "<p>x</p>" }] })).toEqual({
      text: "<p>x</p>",
      policy: undefined,
    })
  })

  it("is nothing for an answer holding no text", () => {
    expect(resourceOf({ contents: [] })).toBeUndefined()
    expect(resourceOf({ contents: [{ blob: "AAAA" }] })).toBeUndefined()
  })
})

const tools = [
  { server: "a", name: "show", callName: "mcp__a__show", view: "ui://a/x", openToViews: true },
  { server: "a", name: "hidden", callName: "mcp__a__hidden", view: undefined, openToViews: false },
  { server: "b", name: "show", callName: "show", view: undefined, openToViews: true },
]

describe("a tool list", () => {
  it("joins a call to its tool by the name the call used, and by server where one is named", () => {
    expect(calledTool(tools, undefined, "mcp__a__show")?.server).toBe("a")
    expect(calledTool(tools, "b", "show")?.server).toBe("b")
    expect(calledTool(tools, "a", "show")).toBeUndefined()
  })

  it("opens to a view only its own server's tools, and only those open to views", () => {
    expect(openToViews(tools, "a").map((t) => t.name)).toEqual(["show"])
  })
})

describe("isViewKey", () => {
  it("takes a provider's call id and refuses anything that could be a path", () => {
    expect(isViewKey("toolu_01EHNLRww45ya3aZWbpWdT1C")).toBe(true)
    expect(isViewKey("exec-eac649c4-8ff6-4bd9-8575-0e55594d4356")).toBe(true)
    expect(isViewKey("../../etc/passwd")).toBe(false)
    expect(isViewKey("a/b")).toBe(false)
    expect(isViewKey("")).toBe(false)
  })
})
