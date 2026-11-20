/**
 * Tier 2: the goal head's `⋯` on a phone — Drop shuts the popover and reports, and the screen
 * draws `DropQuestion` as a sheet; `GoalPage.phone.test.tsx` has where. The desk's panel in
 * the popover is `GoalPage.test.tsx`'s.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import DropQuestion from "./DropQuestion"
import GoalMenu from "./GoalMenu"

afterEach(cleanup)

const PAUSE = { pause: () => {}, isPending: false, said: undefined }

describe("GoalMenu on a phone", () => {
  it("shuts the popover on Drop and reports it, dropping nothing", () => {
    const pressed: string[] = []
    render(
      <GoalMenu
        pausing={true}
        pause={PAUSE}
        open={2}
        dropping={{ drop: () => pressed.push("drop"), isPending: false, said: undefined }}
        onDrop={() => pressed.push("asked")}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Goal options" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Drop this goal" }))
    expect(screen.queryByRole("menu")).toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(pressed).toEqual(["asked"])
  })
})

const drawDrop = (said?: string) => {
  const pressed: string[] = []
  render(
    <DropQuestion
      open={2}
      dropping={{ drop: () => pressed.push("drop"), isPending: false, said }}
      sheet
      onCancel={() => pressed.push("cancel")}
    />,
  )
  return { pressed, sheet: screen.getByRole("dialog", { name: "Drop this goal?" }) }
}

describe("DropQuestion as a sheet", () => {
  it("says how many traks keep running, and drops once on its press", () => {
    const { pressed, sheet } = drawDrop()
    expect(sheet.querySelector(".rounded-t-sheet")).not.toBeNull()
    expect(sheet).toHaveTextContent("Its 2 traks keep running as your own.")
    fireEvent.click(within(sheet).getByRole("button", { name: "Drop" }))
    expect(pressed).toEqual(["drop"])
  })

  it("keeps the refusal in the sheet", () => {
    const { sheet } = drawDrop("The composer is mid-turn.")
    expect(within(sheet).getByRole("alert")).toHaveTextContent("The composer is mid-turn.")
  })
})
