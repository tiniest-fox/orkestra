import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { FailedNotice } from "./FailedNotice"

/** The escape byte, spelled once — a literal one in a test file is invisible. */
const E = "\u001B"

describe("the notice a turn that gave up leaves", () => {
  it("takes the escapes out of a turn's reason, which carries a CLI's stderr", () => {
    render(
      <FailedNotice failed={{ type: "failed", error: `exit 1: ${E}[31mno such model${E}[0m` }} />,
    )
    expect(screen.getByText(/no such model/).textContent).not.toContain(E)
  })
})
