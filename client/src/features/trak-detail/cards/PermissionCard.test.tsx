/**
 * Tier 2 (`testing-tiers`): RTL, no network — the card waiting for an answer, and the card
 * once answered.
 *
 * **The failure worth a render test is a card that lies about what is owed**: an answered
 * ask still asking, or one drawn as allowed that was refused. Both read the log correctly
 * and draw it wrong, so nothing upstream can catch them.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import type { StepOutputDto } from "../../../api/types"
import PermissionCard from "./PermissionCard"
import PermitPresses from "./gate/PermitPresses"
import type { Permitting } from "../usePermit"

afterEach(cleanup)

const ASK: Extract<StepOutputDto, { type: "permission" }> = {
  type: "permission",
  command: "git push --force-with-lease origin trak/x",
  reason: "The branch was rebased onto main.",
}

/* Inert: either press spends money, and nothing here presses one. */
const permitting = (said?: string): Permitting => ({
  send: () => undefined,
  isPending: false,
  disabled: false,
  said,
})

describe("an ask a person is standing at", () => {
  it("asks, with the reason, Refuse and Allow", () => {
    render(
      <PermissionCard
        permission={ASK}
        actions={<PermitPresses permitting={permitting()} />}
        permitted={undefined}
      />,
    )
    expect(screen.getByText("Asks to run a command")).toBeTruthy()
    expect(screen.getByText("The branch was rebased onto main.")).toBeTruthy()
    expect(screen.getByText("Run this command?")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Refuse" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Allow" })).toBeTruthy()
  })

  it("puts a refused press in place of the question", () => {
    render(
      <PermissionCard
        permission={ASK}
        actions={
          <PermitPresses permitting={permitting("Something is already driving this trak.")} />
        }
        permitted={undefined}
      />,
    )
    expect(screen.getByRole("alert").textContent).toBe("Something is already driving this trak.")
    expect(screen.queryByText("Run this command?")).toBeNull()
  })
})

describe("an ask somebody answered", () => {
  it("says it was allowed, drops the reason, and offers nothing to press", () => {
    render(<PermissionCard permission={ASK} actions={undefined} permitted />)
    expect(screen.getByText("Asked to run a command")).toBeTruthy()
    expect(screen.getByText(/Allowed — the step was told it can run this/)).toBeTruthy()
    expect(screen.queryByText("The branch was rebased onto main.")).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("says it was refused", () => {
    render(<PermissionCard permission={ASK} actions={undefined} permitted={false} />)
    expect(screen.getByText(/Refused — the step was told not to run this/)).toBeTruthy()
    expect(screen.queryByText(/Allowed/)).toBeNull()
  })
})
