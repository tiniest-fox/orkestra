import { describe, expect, it } from "vitest"
import { ansiSpans } from "./ansi"

/** The escape byte, spelled once — a literal one in a test file is invisible. */
const E = "\u001B"
const BEL = "\u0007"

const drawn = (text: string): string =>
  ansiSpans(text)
    .map((s) => s.text)
    .join("")
const classesOf = (text: string): readonly string[] => ansiSpans(text).map((s) => s.className)

describe("what survives", () => {
  it("keeps a string with no escapes in it whole and unstyled", () => {
    expect(ansiSpans("Check timed out after 300s.")).toEqual([
      { text: "Check timed out after 300s.", className: "", style: undefined },
    ])
  })

  it("has nothing to draw for an empty string", () => {
    expect(ansiSpans("")).toEqual([])
  })

  it("keeps the words and drops the bytes of every escape, not only the colouring", () => {
    expect(drawn(`before${E}[2Kafter`)).toBe("beforeafter")
    expect(drawn(`${E}[?25lhidden cursor`)).toBe("hidden cursor")
    expect(drawn(`a${E}]0;a window title${BEL}b`)).toBe("ab")
    expect(drawn(`${E}]8;;https://example.com${E}\\link${E}]8;;${E}\\`)).toBe("link")
    expect(drawn(`a${E}b`)).toBe("ab")
  })

  it("keeps the newlines, so a wrapped block is still lines", () => {
    expect(drawn(`a\nb${E}[31mc\nd`)).toBe("a\nbc\nd")
  })
})

describe("colour becomes tone", () => {
  it("maps the sixteen onto the tokens the system already names", () => {
    expect(classesOf(`${E}[31mfailed`)).toEqual(["text-tone-bad"])
    expect(classesOf(`${E}[32mpassed`)).toEqual(["text-tone-good"])
    expect(classesOf(`${E}[33mcareful`)).toEqual(["text-tone-waiting"])
  })

  it("folds bright onto the base tone rather than inventing a second green", () => {
    expect(classesOf(`${E}[92mbright`)).toEqual(classesOf(`${E}[32mplain`))
  })

  it("reads bright black as the quiet ink, which is what a terminal means by it", () => {
    expect(classesOf(`${E}[90maside`)).toEqual(["text-fg-subtle"])
  })

  it("draws a background as a chip, never as a painted fill", () => {
    const [chip] = ansiSpans(`${E}[41m${E}[30mERR${E}[0m`)
    expect(chip?.className).toContain("bg-tone-bad-bg")
    expect(chip?.className).toContain("rounded-tile")
    expect(chip?.className).not.toContain("bg-tone-bad ")
  })
})

describe("the attributes", () => {
  it("draws each one it has a treatment for", () => {
    expect(classesOf(`${E}[1mbold`)).toEqual(["font-semibold"])
    expect(classesOf(`${E}[2mdim`)).toEqual(["opacity-75"])
    expect(classesOf(`${E}[4munder`)).toEqual(["underline"])
  })

  it("lets 22 clear dim as well as bold", () => {
    expect(classesOf(`${E}[1m${E}[2mboth${E}[22mneither`)).toEqual(["font-semibold opacity-75", ""])
  })

  it("draws no treatment for the attributes a drawer must not have", () => {
    expect(classesOf(`${E}[5mblink`)).toEqual([""])
    expect(classesOf(`${E}[8mhidden`)).toEqual([""])
  })
})

describe("reverse video", () => {
  it("marks a span rather than drawing a black block, where nothing coloured it", () => {
    // How tsc draws the gutter of the line it quotes; the span's own squiggle is bright red.
    expect(classesOf(`${E}[7mmarked`)).toEqual(["bg-surface-2 text-fg"])
  })

  it("fills with the tone where something did colour it", () => {
    expect(classesOf(`${E}[31m${E}[7mbadge`)).toEqual(["bg-tone-bad text-surface"])
  })
})

describe("256-colour and truecolor pass through as themselves", () => {
  it("resolves a cube index to the colour it actually names", () => {
    // 16 is the corner of the cube, so all three channels are at level 0.
    expect(ansiSpans(`${E}[38;5;16mx`)[0]?.style).toEqual({
      color: "rgb(0, 0, 0)",
      backgroundColor: undefined,
    })
  })

  it("resolves the grey ramp", () => {
    expect(ansiSpans(`${E}[38;5;232mx`)[0]?.style?.color).toBe("rgb(8, 8, 8)")
  })

  it("routes the first sixteen indices through the tone map, not through a literal", () => {
    expect(classesOf(`${E}[38;5;1mx`)).toEqual(["text-tone-bad"])
    expect(ansiSpans(`${E}[38;5;1mx`)[0]?.style).toBeUndefined()
  })

  it("carries a 24-bit colour through", () => {
    expect(ansiSpans(`${E}[38;2;12;34;56mx`)[0]?.style?.color).toBe("rgb(12, 34, 56)")
  })

  it("drops a ground that resolved to the same literal as its ink", () => {
    const span = ansiSpans(`${E}[38;2;1;2;3m${E}[48;2;1;2;3mx`)[0]
    expect(span?.style?.color).toBe("rgb(1, 2, 3)")
    expect(span?.style?.backgroundColor).toBeUndefined()
  })
})
