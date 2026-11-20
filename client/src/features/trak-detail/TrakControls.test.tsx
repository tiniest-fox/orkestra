/**
 * Tier 2: the band's `⋯` on a phone. The page hands `onAsk`, so Archive and Rebuild each shut
 * the popover and report what they ask; the page draws the sheet — `BandQuestion` here, and
 * `TrakDetailPage.phone.test.tsx` for where. The desk's panel in the popover is
 * `TrakDetailPage.endings.test.tsx`'s and `.header`'s.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import BandQuestion, { type BandAsk, type BandOffer } from "./BandQuestion"
import TrakControls from "./TrakControls"

afterEach(cleanup)

const offer = (pressed: string[]): BandOffer => {
  const press = { isPending: false, disabled: false, said: undefined }
  return {
    offers: { abandon: false, close: true },
    unfinished: { ...press, archive: () => pressed.push("abandon") },
    archiving: { ...press, archive: () => pressed.push("archive") },
    rebuild: { owed: undefined, press: { ...press, rebuild: () => pressed.push("rebuild") } },
  }
}

describe("TrakControls on a phone", () => {
  it.each([
    ["Archive this trak", "archive"],
    ["Rebuild sandbox", "rebuild"],
  ])("shuts the popover on %s and reports the question, sending nothing", (item, ask) => {
    const pressed: string[] = []
    const asked: BandAsk[] = []
    render(<TrakControls offer={offer(pressed)} onAsk={(what) => asked.push(what)} />)
    fireEvent.click(screen.getByRole("button", { name: "More options" }))
    fireEvent.click(screen.getByRole("menuitem", { name: item }))
    expect(screen.queryByRole("menu")).toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(asked).toEqual([ask])
    expect(pressed).toEqual([])
  })
})

describe("BandQuestion as a sheet", () => {
  it.each([
    ["archive", "Archive this trak?", "Archive"],
    ["rebuild", "Rebuild this trak's sandbox?", "Rebuild"],
  ] as const)("asks %s and sends it once", (ask, heading, press) => {
    const pressed: string[] = []
    render(<BandQuestion ask={ask} offer={offer(pressed)} sheet onCancel={() => {}} />)
    const sheet = screen.getByRole("dialog", { name: heading })
    expect(sheet.querySelector(".rounded-t-sheet")).not.toBeNull()
    fireEvent.click(within(sheet).getByRole("button", { name: press }))
    expect(pressed).toEqual([ask])
  })
})
