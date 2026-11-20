import { describe, expect, it } from "vitest"
import { pageOriginsAt } from "./pageDomain"

describe("where a process's page is served", () => {
  it("is its own hostname under the page domain, on the page's own scheme", () => {
    const origins = pageOriginsAt("example.com", "https://orkestra.example.com/p/proj/", "t")
    expect(origins?.("dev")).toBe("https://dev--t--proj.example.com")
  })

  it("names the project checkout by its reserved trak segment", () => {
    const origins = pageOriginsAt("example.com", "https://orkestra.example.com/p/proj/", undefined)
    expect(origins?.("atelier")).toBe("https://atelier--checkout--proj.example.com")
  })

  it("is nowhere new with no page domain, or no project in the base", () => {
    expect(pageOriginsAt(undefined, "https://orkestra.example.com/p/proj/", "t")).toBeUndefined()
    expect(pageOriginsAt("example.com", "http://127.0.0.1:4000/", "t")).toBeUndefined()
  })

  it("has no hostname for a name too long to make one", () => {
    const origins = pageOriginsAt("example.com", "https://o.example.com/p/proj/", "t")
    expect(origins?.("p".repeat(60))).toBeUndefined()
  })
})
