// The mermaid adapter against the real parser, with no DOM environment: the
// window mermaid needs to load is the adapter's own to provide and take away.

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { Diagrams } from "../../src/agent/ports/diagrams.js"
import { MermaidDiagramsLayer } from "../../src/agent/adapters/diagrams-mermaid.js"

const refusal = (source: string) =>
  Effect.runPromise(
    Effect.flatMap(Diagrams, (d) => d.refusal(source)).pipe(Effect.provide(MermaidDiagramsLayer)),
  )

describe("MermaidDiagramsLayer", () => {
  it.each([
    ["flowchart", "flowchart TD\n  A[Start] -->|go| B[End]"],
    ["state", "stateDiagram-v2\n  [*] --> Idle: begin\n  Idle --> Busy"],
    ["class", "classDiagram\n  class Animal {\n    +int age\n  }\n  Animal <|-- Dog : extends"],
    [
      "gantt",
      "gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section Build\n  Task :a1, 2024-01-01, 3d",
    ],
  ])("accepts a labelled %s", async (_, source) => {
    expect(await refusal(source)).toBeUndefined()
  })

  it("refuses a dangling edge in mermaid's own words", async () => {
    expect(await refusal("flowchart TD\n  A -->")).toMatch(/^Parse error on line \d+:/u)
  })

  it("leaves no window behind once it has loaded", async () => {
    await refusal('pie\n  "a": 1')
    expect("window" in globalThis).toBe(false)
  })
})
