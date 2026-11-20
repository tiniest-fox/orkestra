/**
 * The pill's two rules a proof cannot hold: local work, and work from a log written before
 * places were recorded, draw nothing at all; and the detail a press opens carries the
 * runner's own words and both ids.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import PlacePill from "./PlacePill"

afterEach(cleanup)

const remote = {
  _tag: "Remote",
  runner: "Runs each trak in a sandbox of its own.",
  sandbox: "sb_d9a25ep5",
  exec: "ex_41c2",
} as const

describe("PlacePill", () => {
  it("draws nothing for local work or an unrecorded place", () => {
    const local = render(<PlacePill place={{ _tag: "Local" }} />)
    expect(local.container.childElementCount).toBe(0)
    cleanup()
    const old = render(<PlacePill place={undefined} />)
    expect(old.container.childElementCount).toBe(0)
  })

  it("shows the sandbox id, and opens the runner's description and both ids", () => {
    render(<PlacePill place={remote} />)
    const pill = screen.getByRole("button", { name: "Ran in sandbox sb_d9a25ep5" })
    expect(pill.textContent).toBe("sb_d9a25ep5")

    fireEvent.click(pill)
    const detail = screen.getByRole("dialog", { name: "Where this ran" })
    expect(detail.textContent).toContain(remote.runner)
    expect(detail.textContent).toContain("ex_41c2")
    expect(screen.getByRole("button", { name: "Copy sandbox id" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Copy exec id" })).toBeDefined()
  })

  it("draws the cloud alone where the runner printed no id", () => {
    render(<PlacePill place={{ _tag: "Remote", runner: remote.runner, exec: remote.exec }} />)
    const pill = screen.getByRole("button", { name: "Ran in a sandbox" })
    expect(pill.textContent).toBe("")
    fireEvent.click(pill)
    expect(screen.queryByRole("button", { name: "Copy sandbox id" })).toBeNull()
  })
})
