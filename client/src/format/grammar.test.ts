import { describe, expect, it } from "vitest"
import { grammarOf } from "./grammar"

describe("grammarOf", () => {
  it("answers for an extension and for a grammar's own name alike", () => {
    expect(grammarOf("ts")).toBe("typescript")
    expect(grammarOf("typescript")).toBe("typescript")
    expect(grammarOf("yml")).toBe("yaml")
    expect(grammarOf("bash")).toBe("shell")
  })

  it("ignores case, which a fence label and a path both vary", () => {
    expect(grammarOf("TS")).toBe("typescript")
    expect(grammarOf("JSON")).toBe("json")
  })

  it("is undefined for a name nothing here claims, including an object's own keys", () => {
    expect(grammarOf("wat")).toBeUndefined()
    expect(grammarOf("")).toBeUndefined()
    // `diff` and `mermaid` are fences with a renderer of their own, not grammars.
    expect(grammarOf("diff")).toBeUndefined()
    expect(grammarOf("mermaid")).toBeUndefined()
    expect(grammarOf("constructor")).toBeUndefined()
  })
})
