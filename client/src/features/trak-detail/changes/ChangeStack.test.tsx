/**
 * Tier 2 (`testing-tiers`): the phone's diff against fixture props — RTL, no engine.
 *
 * The facts this exists to get right: the pill names the file being read and its place in
 * the slice; the sheet it opens is the index, whose directory rows are labels and whose
 * file rows are presses; a pick puts the sheet away; and the stack's gutter carries the
 * new side alone. Each draws something plausible when it is wrong — a pill counting a
 * file the slice no longer holds, a sheet that stays up over the card it just scrolled
 * to, a deleted line wearing a number from the wrong side.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { makeFileChange } from "../../../fixtures"
import ChangeStack from "./ChangeStack"

afterEach(cleanup)

const files = [
  makeFileChange({ path: "client/src/api/types.ts" }),
  makeFileChange({ path: "client/src/api/client.ts" }),
]

const draw = (omitted?: number): void => {
  render(
    <ChangeStack
      trak="trak-1"
      slice="all"
      files={files}
      omitted={omitted}
      landing={undefined}
      onLanded={() => {}}
      lead={undefined}
      bandBelow={false}
    />,
  )
}

/** The pill: the one control that offers the dialog. */
const pill = (): HTMLElement => screen.getByRole("button", { name: /1 of 2/ })

describe("ChangeStack", () => {
  it("names the first file and its ordinal on the pill before anyone scrolls", () => {
    draw()

    expect(pill().textContent).toContain("client/src/api/types.ts")
  })

  it("opens the index as a sheet, with directories as labels and files as presses", async () => {
    draw()

    await userEvent.click(pill())
    const sheet = screen.getByRole("dialog", { name: "Files changed" })

    // The run of single-child directories is one label, and it is not pressable.
    expect(within(sheet).getByText("client/src/api")).toBeDefined()
    expect(within(sheet).queryByRole("button", { name: "client/src/api" })).toBeNull()
    expect(within(sheet).getByRole("button", { name: /types\.ts/ })).toBeDefined()
  })

  it("puts the sheet away when a file is picked", async () => {
    draw()

    await userEvent.click(pill())
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Files changed" })).getByRole("button", {
        name: /client\.ts/,
      }),
    )

    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("closes on Escape without picking", async () => {
    draw()

    await userEvent.click(pill())
    await userEvent.keyboard("{Escape}")

    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("says what the cap dropped in the sheet as well as at the foot", async () => {
    draw(24)

    expect(screen.getByText(/24 more files changed and are not shown/)).toBeDefined()

    await userEvent.click(pill())

    expect(
      within(screen.getByRole("dialog", { name: "Files changed" })).getByText(
        /24 more files changed/,
      ),
    ).toBeDefined()
  })

  it("draws the new side's line number and not the old side's", () => {
    draw()

    const card = screen.getByRole("region", { name: "client/src/api/types.ts" })

    // The fixture's context row is 10 on both sides and its del row is old-side 11 —
    // which the stack must not draw, while the add rows' new-side 11 and 12 stay.
    expect(within(card).getAllByText("11")).toHaveLength(1)
    expect(within(card).getByText("12")).toBeDefined()
  })
})
