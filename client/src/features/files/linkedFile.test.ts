import { describe, expect, it } from "vitest"
import { linkedFile } from "./linkedFile"

describe("linkedFile", () => {
  it("resolves a relative link against the linking file's folder", () => {
    expect(linkedFile("README.md", "docs/setup.md")).toBe("docs/setup.md")
    expect(linkedFile("docs/setup.md", "./usage.md")).toBe("docs/usage.md")
    expect(linkedFile("docs/a/b.md", "../../README.md")).toBe("README.md")
  })

  it("drops the fragment and query, and decodes escapes", () => {
    expect(linkedFile("README.md", "docs/my%20notes.md#setup")).toBe("docs/my notes.md")
    expect(linkedFile("README.md", "CHANGELOG.md?plain=1")).toBe("CHANGELOG.md")
  })

  it("names nothing for a web link, a root path, an anchor or a climb past the root", () => {
    expect(linkedFile("README.md", "https://example.com/a.md")).toBeUndefined()
    expect(linkedFile("README.md", "mailto:someone@example.com")).toBeUndefined()
    expect(linkedFile("README.md", "//example.com/a.md")).toBeUndefined()
    expect(linkedFile("README.md", "/docs/a.md")).toBeUndefined()
    expect(linkedFile("README.md", "#setup")).toBeUndefined()
    expect(linkedFile("README.md", "../outside.md")).toBeUndefined()
  })

  it("names nothing for an escape that will not decode", () => {
    expect(linkedFile("README.md", "bad%E0%A4%A.md")).toBeUndefined()
  })
})
