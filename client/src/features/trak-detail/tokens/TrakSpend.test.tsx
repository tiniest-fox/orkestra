/**
 * Tier 2: the trak view's spend section — one figure, one bar, and the pieces outside it.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import TrakSpend from "./TrakSpend"
import { NOTHING, type Spend } from "./usage"

afterEach(cleanup)

const spend = (n: number): Spend => ({ ...NOTHING, cacheReadTokens: n })

describe("TrakSpend", () => {
  it("names the pieces' total in a sentence, outside the bar, and never adds it to the trak's", () => {
    render(
      <TrakSpend
        usage={{
          own: spend(1_200_000),
          positions: [{ key: "1", title: "builder", spend: spend(1_200_000) }],
          pieces: { pieces: 2, read: 2, spend: spend(5_600_000) },
        }}
      />,
    )
    // The head and the one legend row both say it; the pieces' figure is nowhere near.
    expect(screen.getAllByText("1.2m")).toHaveLength(2)
    expect(screen.getByText(/its 2 pieces spent/)).toBeDefined()
    expect(screen.getByText(/outside this bar/)).toBeDefined()
    expect(screen.getByText("5.6m")).toBeDefined()
    expect(screen.queryByText("6.8m")).toBeNull()
  })

  it("says how many pieces have answered while some are still to be read", () => {
    render(
      <TrakSpend
        usage={{
          own: spend(1000),
          positions: [],
          pieces: { pieces: 3, read: 1, spend: spend(500) },
        }}
      />,
    )
    expect(screen.getByText(/1 of its 3 pieces have answered so far/)).toBeDefined()
  })

  it("says nothing was measured rather than drawing an empty bar", () => {
    render(<TrakSpend usage={{ own: NOTHING, positions: [], pieces: undefined }} />)
    expect(screen.getByText("Nothing measured yet.")).toBeDefined()
    expect(screen.queryByRole("img")).toBeNull()
  })
})
