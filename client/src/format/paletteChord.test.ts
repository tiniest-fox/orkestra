import { describe, expect, it } from "vitest"
import { paletteChordOn } from "./paletteChord"

describe("paletteChordOn", () => {
  it("is ⌘K on Apple platforms", () => {
    expect(paletteChordOn("MacIntel")).toStrictEqual({ meta: true, hint: "⌘K" })
    expect(paletteChordOn("iPad")).toStrictEqual({ meta: true, hint: "⌘K" })
  })

  it("is Ctrl K everywhere else, and where the platform is not said", () => {
    expect(paletteChordOn("Linux x86_64")).toStrictEqual({ meta: false, hint: "Ctrl K" })
    expect(paletteChordOn("Win32")).toStrictEqual({ meta: false, hint: "Ctrl K" })
    expect(paletteChordOn("")).toStrictEqual({ meta: false, hint: "Ctrl K" })
  })
})
