import { describe, expect, it } from "vitest"
import { makeTrak } from "../../fixtures"
import type { RailProjectDto } from "../../api/types"
import { formOfPixels, hueOf, initialsOf, owedOf, runningOf, tileLabel } from "./tile"

const project = (over: Partial<RailProjectDto>): RailProjectDto => ({
  path: "/Users/k/Repos/harbor-web",
  name: "harbor-web",
  short: "~/Repos/harbor-web",
  engine: "started",
  ...over,
})

describe("a tile's count", () => {
  it("is the traks the list files under its top section", () => {
    const traks = [
      makeTrak({ state: { _tag: "AwaitingHuman", step: 1, kind: "approval" } }),
      makeTrak({ state: { _tag: "AwaitingProposal" } }),
      makeTrak({ state: { _tag: "AgentWorking", step: 0 }, running: true }),
      makeTrak({ state: { _tag: "Finished" } }),
    ]
    expect(owedOf(traks)).toBe(2)
  })

  it("leaves out idle traks, so a project with only idle ones waiting wears no count", () => {
    const traks = [
      makeTrak({ state: { _tag: "AwaitingHuman", step: 1, kind: "approval" }, idle: true }),
      makeTrak({ state: { _tag: "AwaitingProposal" }, idle: true }),
    ]
    expect(owedOf(traks)).toBe(0)
    expect(tileLabel(project({ traks }))).toBe("harbor-web")
  })

  it("counts only the trak that needs attention beside five idle ones", () => {
    const idle = Array.from({ length: 5 }, () =>
      makeTrak({ state: { _tag: "AwaitingHuman", step: 1, kind: "approval" }, idle: true }),
    )
    const traks = [
      makeTrak({ state: { _tag: "AwaitingHuman", step: 1, kind: "approval" } }),
      ...idle,
    ]
    expect(owedOf(traks)).toBe(1)
    expect(tileLabel(project({ traks }))).toBe("harbor-web, 1 waiting on you")
  })

  it("is zero for a project with nothing waiting, and absent for one that has not said", () => {
    expect(owedOf([makeTrak({ state: { _tag: "Finished" } })])).toBe(0)
    expect(owedOf(undefined)).toBeUndefined()
  })
})

describe("a tile's running mark", () => {
  it("follows custody rather than state", () => {
    expect(
      runningOf([makeTrak({ state: { _tag: "AgentWorking", step: 0 }, running: false })]),
    ).toBe(false)
    expect(runningOf([makeTrak({ running: true })])).toBe(true)
    expect(runningOf(undefined)).toBe(false)
  })
})

describe("a tile with no picture", () => {
  it("wears the first letters of the name's first two words", () => {
    expect(initialsOf("harbor-web")).toBe("HW")
    expect(initialsOf("client_site_2026")).toBe("CS")
  })

  it("wears the first two letters of a one-word name", () => {
    expect(initialsOf("atelier")).toBe("AT")
    expect(initialsOf("x")).toBe("X")
  })

  it("sits on a hue that is the same for a name every time", () => {
    expect(hueOf("walkdown")).toBe(hueOf("walkdown"))
    expect(hueOf("walkdown")).not.toBe(hueOf("stillroom"))
  })
})

describe("what a tile is called", () => {
  it("says what the picture and the marks say", () => {
    expect(tileLabel(project({ engine: "off" }))).toBe("harbor-web, not started")
    expect(tileLabel(project({ engine: "failed" }))).toBe("harbor-web, did not start")
    expect(tileLabel(project({ engine: "starting" }))).toBe("harbor-web, starting")
    expect(tileLabel(project({ engine: "starting", phase: "engine" }))).toBe(
      "harbor-web, waiting for its engine",
    )
    expect(tileLabel(project({ engine: "starting", progress: 41.6 }))).toBe(
      "harbor-web, cloning, 42%",
    )
    expect(
      tileLabel(
        project({
          traks: [
            makeTrak({ state: { _tag: "AwaitingHuman", step: 1, kind: "approval" } }),
            makeTrak({ running: true }),
          ],
        }),
      ),
    ).toBe("harbor-web, 1 waiting on you, running")
  })

  it("is the name alone for a started project with nothing to report", () => {
    expect(tileLabel(project({ traks: [] }))).toBe("harbor-web")
  })
})

const SIDE = 64
const RED = [232, 53, 88]

/**
 * The pixels of a red shape on a transparent ground, `inside` saying how much of each
 * pixel the shape covers, sampled on a 4×4 grid so edges anti-alias as a canvas would.
 */
const draw = (inside: (x: number, y: number) => boolean): Uint8ClampedArray => {
  const cover = (x: number, y: number): number =>
    Array.from({ length: 16 }, (_, sub) =>
      inside(x + ((sub % 4) + 0.5) / 4, y + (Math.floor(sub / 4) + 0.5) / 4),
    ).filter(Boolean).length / 16
  const pixels = new Uint8ClampedArray(SIDE * SIDE * 4)
  for (let y = 0; y < SIDE; y += 1)
    for (let x = 0; x < SIDE; x += 1)
      pixels.set([...RED, Math.round(cover(x, y) * 255)], (y * SIDE + x) * 4)
  return pixels
}

/** A square filling the frame with its corners rounded at `share` of its side. */
const rounded = (share: number): Uint8ClampedArray => {
  const radius = SIDE * share
  return draw((x, y) => {
    const across = Math.max(radius - x, x - (SIDE - radius), 0)
    const down = Math.max(radius - y, y - (SIDE - radius), 0)
    return Math.hypot(across, down) <= radius
  })
}

describe("an icon's form", () => {
  it("is a tile when all four corners are fully opaque", () => {
    expect(formOfPixels(rounded(0), SIDE)).toBe("tile")
  })

  it("is a rounded tile, carrying its ground, for a square rounded at 22% or 25%", () => {
    expect(formOfPixels(rounded(0.22), SIDE)).toEqual({ ground: "rgb(232 53 88)" })
    expect(formOfPixels(rounded(0.25), SIDE)).toEqual({ ground: "rgb(232 53 88)" })
  })

  it("is a glyph for a square rounded past a quarter of its side", () => {
    expect(formOfPixels(rounded(0.3), SIDE)).toBe("glyph")
  })

  it("is a glyph for a circle filling the frame", () => {
    expect(formOfPixels(rounded(0.5), SIDE)).toBe("glyph")
  })

  it("is a glyph for a shape on a transparent ground", () => {
    const plus = draw(
      (x, y) => Math.abs(x - SIDE / 2) < SIDE / 8 || Math.abs(y - SIDE / 2) < SIDE / 8,
    )
    expect(formOfPixels(plus, SIDE)).toBe("glyph")
    expect(
      formOfPixels(
        draw(() => false),
        SIDE,
      ),
    ).toBe("glyph")
  })

  it("is a glyph when the pixels do not fill the canvas", () => {
    expect(formOfPixels(rounded(0), SIDE - 1)).toBe("glyph")
  })
})
