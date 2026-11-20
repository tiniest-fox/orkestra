import { describe, expect, it } from "vitest"
import { mermaidSources } from "./mermaid-fences.js"

describe("mermaidSources", () => {
  it("finds a backtick fence and a tilde fence, and nothing else", () => {
    const doc = [
      "```mermaid",
      "flowchart TD",
      "  A --> B",
      "```",
      "",
      "```ts",
      "const a = 1",
      "```",
      "~~~mermaid title",
      "pie",
      "~~~",
    ].join("\n")
    expect(mermaidSources(doc)).toEqual(["flowchart TD\n  A --> B", "pie"])
  })

  it("does not find an example shown inside a longer fence", () => {
    const doc = ["````md", "```mermaid", "flowchart TD", "```", "````"].join("\n")
    expect(mermaidSources(doc)).toEqual([])
  })

  it("closes only on the opener's character at the opener's length or more", () => {
    const doc = ["````mermaid", "a", "```", "~~~~", "b", "`````", "after"].join("\n")
    expect(mermaidSources(doc)).toEqual(["a\n```\n~~~~\nb"])
  })

  it("runs a fence left open to the end of the document", () => {
    expect(mermaidSources("text\n```mermaid\npie\n")).toEqual(["pie\n"])
  })

  it("reads the first word of the info string, case and all", () => {
    expect(mermaidSources("```Mermaid\npie\n```\n```mermaidx\npie\n```")).toEqual([])
  })

  it("strips the opener's indent from the content, and ignores a fence indented four", () => {
    expect(mermaidSources("  ```mermaid\n    pie\n  ```")).toEqual(["  pie"])
    expect(mermaidSources("    ```mermaid\n    pie\n    ```")).toEqual([])
  })

  it("does not take a line with a backtick in its info string for an opener", () => {
    expect(mermaidSources("```mermaid `x`\npie\n```")).toEqual([])
  })
})
