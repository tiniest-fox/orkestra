import { describe, expect, it } from "vitest"
import { placement } from "./page.js"

describe("where the native page view is placed", () => {
  it("takes the pane's box as it is at no zoom", () => {
    expect(placement({ x: 488, y: 120, width: 792, height: 700 }, 1)).toEqual({
      x: 488,
      y: 120,
      width: 792,
      height: 700,
    })
  })

  it("scales by the page's zoom and rounds outward, so no edge of the pane shows", () => {
    expect(placement({ x: 10.5, y: 20.25, width: 100.5, height: 50 }, 1.1)).toEqual({
      x: 11,
      y: 22,
      width: 112,
      height: 56,
    })
  })

  it("refuses anything that is not a box with area", () => {
    expect(placement(undefined, 1)).toBeUndefined()
    expect(placement("0,0,10,10", 1)).toBeUndefined()
    expect(placement({ x: 0, y: 0, width: 10 }, 1)).toBeUndefined()
    expect(placement({ x: 0, y: 0, width: 0, height: 10 }, 1)).toBeUndefined()
    expect(placement({ x: Number.NaN, y: 0, width: 10, height: 10 }, 1)).toBeUndefined()
  })
})
