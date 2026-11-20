/**
 * Tier 2: the phone's confirmation sheet — the frame's ways out and where focus lands. No
 * Tailwind is loaded here, so the sheet is told from the panel by its rounded top's class.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import ConfirmSheet from "./ConfirmSheet"

afterEach(cleanup)

const draw = (said?: string) => {
  const pressed: string[] = []
  render(
    <ConfirmSheet
      heading="Archive this trak?"
      press="Archive"
      said={said}
      onCancel={() => pressed.push("cancel")}
      onConfirm={() => pressed.push("confirm")}
    >
      The checkout goes, and so does the branch.
    </ConfirmSheet>,
  )
  return { pressed, sheet: screen.getByRole("dialog", { name: "Archive this trak?" }) }
}

describe("ConfirmSheet", () => {
  it("rises as a sheet with Cancel and the press side by side, focus on the press", () => {
    const { sheet } = draw()
    expect(sheet.querySelector(".rounded-t-sheet")).not.toBeNull()
    const presses = within(sheet).getAllByRole("button")
    expect(presses.map((press) => press.getAttribute("aria-label") ?? press.textContent)).toEqual([
      "Cancel",
      "Archive",
    ])
    expect(document.activeElement).toBe(within(sheet).getByRole("button", { name: "Archive" }))
  })

  it("cancels on Escape, on the wash and on Cancel, and not on a press inside the card", () => {
    const { pressed, sheet } = draw()
    fireEvent.keyDown(within(sheet).getByRole("button", { name: "Archive" }), { key: "Escape" })
    fireEvent.click(sheet)
    fireEvent.click(within(sheet).getByText("The checkout goes, and so does the branch."))
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }))
    expect(pressed).toEqual(["cancel", "cancel", "cancel"])
  })

  it("confirms on the press alone", () => {
    const { pressed, sheet } = draw()
    fireEvent.click(within(sheet).getByRole("button", { name: "Archive" }))
    expect(pressed).toEqual(["confirm"])
  })

  it("says a refusal above the presses", () => {
    const { sheet } = draw("A process still holds the checkout.")
    const said = within(sheet).getByRole("alert")
    expect(said).toHaveTextContent("A process still holds the checkout.")
    const cancel = within(sheet).getByRole("button", { name: "Cancel" })
    expect(said.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
