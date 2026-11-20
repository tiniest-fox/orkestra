/**
 * The card a check the agent ran draws as: which source each phase is read from, and when
 * the console is open.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import type { CheckEntryDto, CheckRunDto } from "../../../../api/types"
import { makeCheckEntry, makeCheckRun, makeTool } from "../../../../fixtures"
import CheckCallCard, { TrakCheck } from "./CheckCallCard"

afterEach(cleanup)

const drawn = (
  line: CheckEntryDto,
  live: CheckRunDto | undefined,
  driving = true,
  phone = false,
): ReactNode => (
  <TrakCheck value={{ live, root: "/repo", phone }}>
    <ol>
      <CheckCallCard
        checked={{ checked: line, call: makeTool({ kind: "Mcp", call: line.call }) }}
        driving={driving}
      />
    </ol>
  </TrakCheck>
)

const header = (): HTMLElement => screen.getByRole("button", { name: /orkestra-trak\/run_check/ })

const running = makeCheckRun({
  call: "toolu_1",
  command: "bash /repo/.orkestra/checks/verify-light.sh",
  output: "> fmt:check\nChecked 1,412 files",
})

describe("CheckCallCard", () => {
  it("is open on the console while the check runs, the line it was spawned as on top", () => {
    render(drawn(makeCheckEntry(), running))
    expect(header().getAttribute("aria-expanded")).toBe("true")
    expect(header().textContent).toContain("verify-light")
    expect(header().textContent).toContain("Running")
    expect(screen.getByText("bash .orkestra/checks/verify-light.sh")).toBeTruthy()
    expect(screen.getByText(/Checked 1,412 files/)).toBeTruthy()
  })

  it("says it is queued while it waits for the exclusive turn", () => {
    render(drawn(makeCheckEntry(), { ...running, queued: true, output: "Waiting" }))
    expect(header().textContent).toContain("Queued")
  })

  it("folds after a pass, and a press opens it", () => {
    const passed = { ...running, finished: { verdict: "passed" as const, at: 135_000 } }
    render(drawn(makeCheckEntry({ outcome: "passed" }), passed))
    expect(header().getAttribute("aria-expanded")).toBe("false")
    expect(header().textContent).toContain("passed · 2m14s")
    fireEvent.click(header())
    expect(screen.getByText(/Checked 1,412 files/)).toBeTruthy()
  })

  it("stays open on a failure", () => {
    const failed = { ...running, finished: { verdict: "failed" as const, exitCode: 1, at: 9_000 } }
    render(drawn(makeCheckEntry({ outcome: "failed" }), failed))
    expect(header().getAttribute("aria-expanded")).toBe("true")
    expect(header().textContent).toContain("failed · exit 1")
  })

  it("is a header alone for a reused pass, with nothing to open", () => {
    render(drawn(makeCheckEntry({ outcome: "reused" }), undefined))
    expect(header().textContent).toContain("passed before on these files")
    expect(header().hasAttribute("disabled")).toBe(true)
  })

  it("words a pass the files moved under, shorter on a phone", () => {
    render(drawn(makeCheckEntry({ outcome: "unrecorded" }), undefined, true, true))
    expect(header().textContent).toContain("passed · not recorded")
    expect(header().textContent).not.toContain("files changed")
  })

  it("reads a call nothing answered on a turn nobody is driving as ended with the turn", () => {
    render(drawn(makeCheckEntry(), running, false))
    expect(header().textContent).toContain("ended with the turn")
  })

  it("draws no output from a run another call started", () => {
    render(drawn(makeCheckEntry({ outcome: "passed" }), { ...running, call: "toolu_2" }))
    expect(header().hasAttribute("disabled")).toBe(true)
  })
})
