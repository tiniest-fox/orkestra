/**
 * The request panel draws what a person asked for as markdown, and offers More only where
 * the drawn request overflows its clamp.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import RequestView from "./RequestView"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** jsdom lays nothing out, so the clamped element's two heights are stated. */
const measuring = (scroll: number, client: number): void => {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(scroll)
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(client)
}

const ASKED = [
  "Make search work",
  "from every screen",
  "",
  "- one box",
  "",
  "| Where | When |",
  "| - | - |",
  "| list | always |",
  "",
  "```ts",
  "const q = 1",
  "```",
].join("\n")

describe("RequestView", () => {
  it("draws a list, a table and a fence, and keeps a single line break", () => {
    measuring(0, 0)
    const { container } = render(<RequestView description={ASKED} />)

    const first = container.querySelector("p")
    expect(first?.innerHTML).toBe("Make search work<br>\nfrom every screen")
    expect(screen.getByRole("listitem")).toHaveTextContent("one box")
    expect(screen.getAllByText("always").length).toBeGreaterThan(0)
    expect(screen.getByText("const q = 1", { exact: false })).toBeDefined()
    expect(screen.queryByText(/```/)).toBeNull()
  })

  it("offers no More where the drawn request fits", () => {
    measuring(60, 60)
    render(<RequestView description="Short" />)

    expect(screen.queryByRole("button", { name: "More" })).toBeNull()
  })

  it("offers More where it overflows, and Less returns it to the clamp", async () => {
    measuring(400, 60)
    const { container } = render(<RequestView description={ASKED} />)
    const clamp = container.querySelector(".max-h-15")
    expect(clamp).not.toBeNull()

    await userEvent.click(screen.getByRole("button", { name: "More" }))
    expect(container.querySelector(".max-h-15")).toBeNull()

    await userEvent.click(screen.getByRole("button", { name: "Less" }))
    expect(container.querySelector(".max-h-15")).not.toBeNull()
  })
})
