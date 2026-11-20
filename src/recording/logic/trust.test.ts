import { describe, expect, it } from "vitest"
import { ASSUMPTIONS } from "../types/recording.js"
import { acceptedOn, trustsOn } from "./trust.js"

describe("trust", () => {
  it("is skeptical wherever `CI` is set, and trusting where it is unset or empty", () => {
    expect(trustsOn({ CI: "true" })).toBe(false)
    expect(trustsOn({ CI: "1" })).toBe(false)
    expect(trustsOn({})).toBe(true)
    expect(trustsOn({ CI: "" })).toBe(true)
  })

  it("accepts every named assumption when trusting, and only the floor when not", () => {
    expect(acceptedOn(true)).toEqual(ASSUMPTIONS)
    expect(acceptedOn(false)).toEqual([])
  })
})
