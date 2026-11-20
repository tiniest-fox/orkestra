import { describe, expect, it } from "vitest"
import { diagramKind, fitScale, sideways, svgWidth } from "./mermaid"

describe("sideways", () => {
  it.each(["TD", "TB", "BT", "RL", "LR"])("turns a `flowchart %s` to LR", (direction) => {
    expect(sideways(`flowchart ${direction}\n  A --> B`)).toBe("flowchart LR\n  A --> B")
  })

  it("turns a `graph` header the same way", () => {
    expect(sideways("graph TD\n  A --> B")).toBe("graph LR\n  A --> B")
  })

  it("names LR on a flowchart header that names no direction", () => {
    expect(sideways("flowchart\n  A --> B")).toBe("flowchart LR\n  A --> B")
  })

  it("leaves a node named like a direction alone", () => {
    expect(sideways("flowchart TD\n  TD --> LR")).toBe("flowchart LR\n  TD --> LR")
  })

  it("adds a direction under a state diagram's header", () => {
    expect(sideways("stateDiagram-v2\n  [*] --> A")).toBe(
      "stateDiagram-v2\n  direction LR\n  [*] --> A",
    )
    expect(sideways("stateDiagram\n  [*] --> A")).toBe("stateDiagram\n  direction LR\n  [*] --> A")
  })

  it("replaces a state diagram's own top-level direction", () => {
    expect(sideways("stateDiagram-v2\n  direction TB\n  [*] --> A")).toBe(
      "stateDiagram-v2\n  direction LR\n  [*] --> A",
    )
  })

  it("leaves the direction inside a composite state to the source", () => {
    const source =
      "stateDiagram-v2\n  state Busy {\n    direction TB\n    a --> b\n  }\n  [*] --> Busy"
    expect(sideways(source)).toBe(
      "stateDiagram-v2\n  direction LR\n  state Busy {\n    direction TB\n    a --> b\n  }\n  [*] --> Busy",
    )
  })

  it("reads past comments, directives and frontmatter to the header", () => {
    expect(sideways("%% the gate\n%%{init: {}}%%\n\nflowchart TD\n  A --> B")).toBe(
      "%% the gate\n%%{init: {}}%%\n\nflowchart LR\n  A --> B",
    )
    expect(sideways("---\ntitle: Gate\n---\nflowchart TB\n  A --> B")).toBe(
      "---\ntitle: Gate\n---\nflowchart LR\n  A --> B",
    )
  })

  it("leaves a sequence diagram, and anything else, as written", () => {
    const sequence = "sequenceDiagram\n  A->>B: hi"
    expect(sideways(sequence)).toBe(sequence)
    expect(sideways('pie\n  "a": 1')).toBe('pie\n  "a": 1')
    expect(sideways("")).toBe("")
  })
})

describe("diagramKind", () => {
  it("names the diagram by its header's first word", () => {
    expect(diagramKind("flowchart TD\n  A --> B")).toBe("flowchart")
    expect(diagramKind("graph LR\n  A --> B")).toBe("flowchart")
    expect(diagramKind("%% note\nstateDiagram-v2\n  [*] --> A")).toBe("state diagram")
    expect(diagramKind("sequenceDiagram\n  A->>B: hi")).toBe("sequence")
    expect(diagramKind('pie\n  "a": 1')).toBe("diagram")
    expect(diagramKind("")).toBe("diagram")
  })
})

describe("svgWidth", () => {
  it("reads the width out of the viewBox, rounded up", () => {
    expect(svgWidth('<svg viewBox="-8 -8 412.5 120">')).toBe(413)
  })

  it("is 0 for an SVG with no viewBox", () => {
    expect(svgWidth("<svg>")).toBe(0)
  })
})

describe("fitScale", () => {
  it("draws a drawing that fits, or one not yet measured, at full size", () => {
    expect(fitScale(300, 600)).toBe(1)
    expect(fitScale(600, 600)).toBe(1)
    expect(fitScale(600, 0)).toBe(1)
  })

  it("shrinks a wider drawing to fit, down to 0.8", () => {
    expect(fitScale(1000, 900)).toBe(0.9)
    expect(fitScale(1000, 500)).toBe(0.8)
  })
})
