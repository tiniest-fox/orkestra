/**
 * The two facts this shell exists to get right, both of them invisible.
 *
 * Everything else about it — the ghosts, the band, the disc — is drawing, and the page
 * tests already assert the words each state says. What no rendered check would catch is
 * that the whole thing is announced to a reader who is not looking at it: the ghosts are
 * `aria-hidden` by design, so a loading state with no `role="status"` beside them is a
 * screen that says nothing at all, and it looks perfect.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { Unplug } from "lucide-react"
import EmptyState from "./EmptyState"

afterEach(cleanup)

describe("EmptyState", () => {
  it("says it is loading, where only a screen reader can hear it", () => {
    render(<EmptyState loading />)

    expect(screen.getByRole("status").textContent).toBe("Loading…")
    // The ghosts are the absence of content; announcing four empty rows would be
    // reporting data that does not exist.
    expect(screen.queryByRole("heading")).toBeNull()
  })

  it("announces a failure rather than only reddening", () => {
    render(
      <EmptyState tone="bad" icon={Unplug} title="Could not reach the engine">
        fetch failed
      </EmptyState>,
    )

    expect(screen.getByRole("alert").textContent).toContain("Could not reach the engine")
  })

  it("is not an alert when nothing is wrong", () => {
    render(
      <EmptyState icon={Unplug} title="No traks yet">
        Nothing has been started.
      </EmptyState>,
    )

    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByRole("heading", { name: "No traks yet" })).toBeDefined()
  })
})
