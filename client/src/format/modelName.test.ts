// Tier 1: the one thing the client may derive from a model string — which CLI runs it —
// and the name left once the qualifier is taken off.

import { Asterisk, SquareTerminal, Terminal } from "lucide-react"
import { describe, expect, it } from "vitest"
import { bareName, cliGlyph } from "./modelName"

describe("a model name on screen", () => {
  it("draws a bare name whole, behind the claude mark", () => {
    expect(bareName("opus")).toBe("opus")
    expect(cliGlyph("opus")).toBe(Asterisk)
  })

  it("drops the qualifier and draws the CLI it named", () => {
    expect(bareName("codex/gpt-5.6-sol")).toBe("gpt-5.6-sol")
    expect(cliGlyph("codex/gpt-5.6-sol")).toBe(SquareTerminal)
  })

  it("splits at the first slash only, so a name with one inside survives", () => {
    expect(bareName("codex/org/model")).toBe("org/model")
    expect(cliGlyph("codex/org/model")).toBe(SquareTerminal)
  })

  it("marks a CLI it has no glyph for as one it cannot name, never as claude", () => {
    expect(cliGlyph("gemini/pro")).toBe(Terminal)
    expect(bareName("gemini/pro")).toBe("pro")
  })
})
