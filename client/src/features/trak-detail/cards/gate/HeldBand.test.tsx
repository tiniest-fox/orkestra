/**
 * `UnattendedBand.test.tsx`'s sibling: one heading and nothing under it, because the log
 * corroborates one fact.
 * Where the band *reaches* a card is `DrawerPane.test.tsx`.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import HeldBand from "./HeldBand"

afterEach(cleanup)

describe("HeldBand", () => {
  it("says the step was held for the person, and nothing more", () => {
    const { container } = render(<HeldBand />)

    expect(screen.getByText("held for you")).toBeDefined()
    expect(container.querySelector("ul")).toBeNull()
    // Never the engine's phrase: nobody took this gate on the trak's behalf.
    expect(screen.queryByText("automatically approved")).toBeNull()
  })
})
