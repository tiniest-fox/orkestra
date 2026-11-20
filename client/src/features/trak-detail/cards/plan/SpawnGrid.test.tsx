/**
 * Tier 2 (`testing-tiers`): RTL, no network — the grid at a raggedness a real plan reaches.
 *
 * Reached directly rather than through a `ProposalDto`, because what is under test is the
 * geometry: three columns of differing depth, the empty cells they leave, and the rule that
 * survives beside one that has run out. `ProposalCard`'s own test covers a piece with a plan
 * arriving off the wire.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import SpawnGrid from "./SpawnGrid"

afterEach(cleanup)

const step = (n: string): { readonly agent: string; readonly instruction: string } => ({
  agent: "review",
  instruction: `read it for ${n}`,
})

/** Ragged on purpose — 3, 1, 1. Equal columns are the one shape that never happens. */
const RAGGED = [
  [step("the state machine"), step("what git says"), step("the copy")],
  [step("the worktree")],
  [step("the drawer")],
]

describe("a child that holds a plan of its own", () => {
  it("marks every step of it, not only the first", () => {
    render(<SpawnGrid agents={[]} at="3" columns={RAGGED} />)

    for (const mark of ["3·1.1", "3·1.2", "3·1.3"]) expect(screen.getByText(mark)).toBeDefined()
  })

  it("leaves a child of one step unnumbered past its own position", () => {
    render(<SpawnGrid agents={[]} at="3" columns={RAGGED} />)

    expect(screen.getByText("3·2")).toBeDefined()
    expect(screen.queryByText("3·2.1")).toBeNull()
  })
})

describe("a column that has run out", () => {
  it("draws nothing where it has no step", () => {
    render(<SpawnGrid agents={[]} at="3" columns={RAGGED} />)

    // Five steps across three columns of depth three: the four cells with nothing in them
    // are not items a reader is offered, empty or otherwise.
    expect(screen.getAllByRole("listitem")).toHaveLength(5)
  })

  it("keeps the rule beside it while the column it separates is still going", () => {
    const { container } = render(<SpawnGrid agents={[]} at="3" columns={RAGGED} />)

    // A rule divides two columns, so one of them continuing is enough to need it. At the
    // second row only the first child has a step, and exactly one vertical is right:
    // between the child still going and the one that stopped.
    const ruled = [...container.querySelectorAll("li")].filter(
      (cell) => cell.style.gridRow === "2" && cell.className.includes("border-l"),
    )
    expect(ruled).toHaveLength(1)
    expect(ruled[0]?.style.gridColumn).toBe("2")
  })
})

describe("a spawn of nothing", () => {
  it("draws no grid at all, rather than one of no columns", () => {
    const { container } = render(<SpawnGrid agents={[]} at="3" columns={[]} />)

    expect(container.querySelector("ol")).toBeNull()
  })
})
