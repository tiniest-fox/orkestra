/**
 * What the walkthrough exists to get right: one step picked at a time, Back and Next
 * walking it, and a path chosen without losing the reader's place. Its height holding
 * still is a layout fact happy-dom cannot measure — that is the proof's to show.
 *
 * Every step's words are drawn, hidden but the picked one's, so what is showing is the
 * one region the accessibility tree holds.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { parseWalkthrough } from "../format/walkthrough"
import Walkthrough from "./Walkthrough"

afterEach(cleanup)

const walk = parseWalkthrough(`actors: View, Client, Engine

path: Accepted
1. The view asks
   at: View -> Client
   Asked from the view.
2. The engine runs it
   at: Client -> Engine
   Run by the engine.
3. The view redraws
   at: Engine -> View
   Drawn again.

path: Refused
1. The view asks
   at: View -> Client
   Asked again.
2. The engine refuses
   at: Client -> Engine
   Refused by the engine.`)

const draw = (): void => {
  if (walk === undefined) throw new Error("the fixture does not parse")
  render(<Walkthrough walk={walk} />)
}

/** The step showing. */
const shown = () => within(screen.getByRole("region"))

describe("Walkthrough", () => {
  it("opens on the first step of the first path, with Back unavailable", () => {
    draw()

    expect(screen.getByRole("tab", { name: "Accepted", selected: true })).toBeDefined()
    expect(screen.getByRole("button", { pressed: true }).textContent).toContain("The view asks")
    expect(screen.getByRole("button", { pressed: true }).textContent).toContain("View → Client")
    expect(shown().getByText("Asked from the view.")).toBeDefined()
    expect(screen.getByRole("button", { name: /Back/ })).toHaveProperty("disabled", true)
    expect(screen.getByText("1 of 3")).toBeDefined()
  })

  it("walks the steps with Next and stops on the last", async () => {
    draw()
    const next = screen.getByRole("button", { name: /Next/ })

    await userEvent.click(next)
    await userEvent.click(next)

    expect(screen.getByRole("button", { pressed: true }).textContent).toContain("The view redraws")
    expect(shown().getByText("Drawn again.")).toBeDefined()
    expect(screen.getByText("3 of 3")).toBeDefined()
    expect(next).toHaveProperty("disabled", true)
  })

  it("walks back with Back and stops on the first", async () => {
    draw()
    await userEvent.click(screen.getByRole("button", { name: /Next/ }))
    const back = screen.getByRole("button", { name: /Back/ })

    await userEvent.click(back)

    expect(screen.getByText("1 of 3")).toBeDefined()
    expect(back).toHaveProperty("disabled", true)
  })

  it("opens a step that is pressed", async () => {
    draw()

    await userEvent.click(screen.getByRole("button", { name: /The engine runs it/ }))

    expect(screen.getByText("2 of 3")).toBeDefined()
    expect(shown().getByText("Run by the engine.")).toBeDefined()
    expect(shown().queryByText("Asked from the view.")).toBeNull()
  })

  it("keeps the step when another path is chosen, clamped to that path's length", async () => {
    draw()
    await userEvent.click(screen.getByRole("button", { name: /Next/ }))
    await userEvent.click(screen.getByRole("button", { name: /Next/ }))

    await userEvent.click(screen.getByRole("tab", { name: "Refused" }))

    expect(screen.getByRole("button", { pressed: true }).textContent).toContain(
      "The engine refuses",
    )
    expect(screen.getByText("2 of 2")).toBeDefined()
    expect(shown().getByText("Refused by the engine.")).toBeDefined()
    expect(screen.queryByText("Drawn again.")).toBeNull()
  })

  it("counts the steps in the header, and draws no tabs, for a walkthrough with one path", () => {
    const one = parseWalkthrough("actors: A, B\n1. Go\n   at: A -> B")
    if (one === undefined) throw new Error("the fixture does not parse")
    render(<Walkthrough walk={one} />)

    expect(screen.queryByRole("tablist")).toBeNull()
    expect(screen.getByText("1 step")).toBeDefined()
    expect(screen.getByText("1 of 1")).toBeDefined()
  })
})
