import { Hammer } from "lucide-react"
import { describe, expect, it } from "vitest"
import { makeDetail } from "../../../../fixtures"
import type { Band, Spot } from "../family"
import { headOf } from "./directive"

const PARENT = makeDetail({ id: "p", description: "Ship the phone pass" })

const spot = (key: string, title: string, trak = PARENT): Spot => ({
  key,
  trak,
  row: {
    key,
    at: 0,
    kind: "step",
    status: "running",
    tone: "working",
    mark: Hammer,
    title,
    caption: `${title} ran`,
    pieces: undefined,
    sha: undefined,
    turns: [],
    atGate: undefined,
    handUp: undefined,
    outstanding: 0,
    continues: undefined,
    model: undefined,
    window: undefined,
    effort: undefined,
    badge: undefined,
    waiting: undefined,
  },
})

const piece = (id: string, description: string): Spot =>
  spot(`${id}:0`, "builder", makeDetail({ id, description }))

describe("headOf", () => {
  it("names the parent's own position by its title", () => {
    const own = spot("0", "planner")
    expect(headOf(own, [{ spot: own, columns: [] }], "p")).toBe("planner")
  })

  it("leads a piece's position with the word that tells it from its siblings", () => {
    const header = piece("c1", "Build the header for every screen")
    const strip = piece("c2", "Build the strip for the phone")
    const bands: readonly Band[] = [
      {
        spot: spot("1", "2 pieces"),
        columns: [
          { id: "c1", spots: [header] },
          { id: "c2", spots: [strip] },
        ],
      },
    ]
    expect(headOf(header, bands, "p")).toBe("the header · builder")
    expect(headOf(strip, bands, "p")).toBe("the strip · builder")
  })
})
