import { describe, expect, it } from "vitest"
import { failureSignature, stripAnsi } from "./check-progress.js"

/** The escape byte, spelled once — a literal one in a test file is invisible. */
const E = "\u001B"

const same = (a: string, b: string): boolean =>
  failureSignature("verify", a) === failureSignature("verify", b)

describe("two failures are the same failure when", () => {
  it("they are identical", () => {
    expect(same("2 problems", "2 problems")).toBe(true)
  })

  it("the same complaints arrive in a different order", () => {
    // The case this exists for: a check that walks a directory can list the same
    // three files in a different order without a single one having been fixed.
    expect(same("a.ts: bad\nb.ts: worse", "b.ts: worse\na.ts: bad")).toBe(true)
  })

  it("the report is re-wrapped or re-indented", () => {
    expect(same("a.ts: bad", "   a.ts:   bad  ")).toBe(true)
  })

  it("blank lines come and go", () => {
    expect(same("a.ts: bad\n\n\nb.ts: worse", "a.ts: bad\nb.ts: worse")).toBe(true)
  })

  it("the same complaint arrives coloured one time and not the other", () => {
    // The event log keeps the escapes because the drawer draws them, so a check whose
    // colouring moves — a terminal detected on one run and not the next, a reporter that
    // dims a repeat — would otherwise read as a failure that changed. It did not.
    expect(same(`${E}[31ma.ts: bad${E}[0m`, "a.ts: bad")).toBe(true)
  })
})

describe("two failures are different when", () => {
  it("a complaint was fixed", () => {
    expect(same("a.ts: bad\nb.ts: worse", "b.ts: worse")).toBe(false)
  })

  it("the count went down", () => {
    // Digits survive normalization on purpose. "3 problems" becoming "1 problem"
    // is exactly the progress the retry loop exists to allow.
    expect(same("3 problems", "1 problem")).toBe(false)
  })

  it("a different check is the one failing", () => {
    // With fail-fast, that means the agent got past the first one.
    expect(failureSignature("lint", "broken")).not.toBe(failureSignature("types", "broken"))
  })
})

describe("stripAnsi", () => {
  it("takes out every family, not only the one that colours", () => {
    // A colour reader would leave the other two printed as text, which is the failure
    // this exists to answer rather than a tidier version of it.
    expect(stripAnsi(`${E}[31mred${E}[0m`)).toBe("red")
    expect(stripAnsi(`before${E}[2Kafter${E}[?25l`)).toBe("beforeafter")
    expect(stripAnsi(`a${E}]0;a window title${E}\\b`)).toBe("ab")
  })

  it("leaves a string that has none of them exactly as it was", () => {
    expect(stripAnsi("Check timed out after 300s.")).toBe("Check timed out after 300s.")
  })

  it("keeps the newlines, because a report is lines", () => {
    expect(stripAnsi(`${E}[1ma\nb${E}[22m`)).toBe("a\nb")
  })
})
