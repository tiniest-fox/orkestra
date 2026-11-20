/**
 * Tier 2: the usage cell on the desk's git bar. No reading reads `Usage unavailable` on
 * the bar, and the panel it opens says why. A reading draws the leading window's meter.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { CliUsageDto, UsageUnavailableDto } from "../../../api/types"
import { makeCliUsage } from "../../../fixtures"
import UsageCell from "./UsageCell"

afterEach(cleanup)

const Opened = ({ usage }: { readonly usage: CliUsageDto }) => (
  <UsageCell usage={usage} open setOpen={() => undefined} />
)

const unavailable = (why: UsageUnavailableDto): CliUsageDto =>
  makeCliUsage({ usage: { _tag: "Unavailable", at: Date.now(), why } })

describe("UsageCell", () => {
  it("reads Usage unavailable for a claude that reports no windows, and the panel says why", () => {
    render(<Opened usage={unavailable({ reason: "shape" })} />)
    expect(screen.getAllByText("Usage unavailable")).toHaveLength(2)
    expect(screen.getByRole("dialog", { name: "Claude usage" }).textContent).toContain(
      "without the usage windows",
    )
  })

  it("says not read before the first Claude turn", () => {
    render(<Opened usage={makeCliUsage()} />)
    expect(screen.getByText("Usage not read")).toBeTruthy()
    expect(screen.getByText(/first reading comes with the first Claude turn/)).toBeTruthy()
  })

  it("draws the leading window's meter, and every window when opened", () => {
    const now = Date.now()
    const usage = makeCliUsage({
      polling: true,
      usage: {
        _tag: "Read",
        at: now,
        windows: [
          { kind: "five_hour", utilization: 72, resetsAt: now + 3 * 3_600_000 },
          { kind: "seven_day", utilization: 44, resetsAt: now + 3 * 86_400_000 },
          { kind: "seven_day", model: "sonnet", utilization: 51, resetsAt: now + 3 * 86_400_000 },
        ],
      },
    })
    let open = false
    render(
      <UsageCell
        usage={usage}
        open={false}
        setOpen={(next) => {
          open = next
        }}
      />,
    )
    expect(screen.getByRole("meter", { name: /^Five-hour: 72% used/ })).toBeTruthy()
    expect(screen.getByRole("img", { name: "polling" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Claude usage" }))
    expect(open).toBe(true)
    cleanup()
    render(<Opened usage={usage} />)
    const panel = screen.getByRole("dialog", { name: "Claude usage" })
    expect(panel.querySelectorAll('[role="meter"]')).toHaveLength(3)
    expect(panel.textContent).toContain("Weekly, Sonnet")
  })

  it("opens Codex's own panel, listing its five-hour and weekly windows", () => {
    const now = Date.now()
    render(
      <Opened
        usage={makeCliUsage({
          cli: "codex",
          usage: {
            _tag: "Read",
            at: now,
            windows: [
              { kind: "five_hour", utilization: 12, resetsAt: now + 4 * 3_600_000 },
              { kind: "seven_day", utilization: 18, resetsAt: now + 5 * 86_400_000 },
            ],
          },
        })}
      />,
    )
    const panel = screen.getByRole("dialog", { name: "Codex usage" })
    expect(
      [...panel.querySelectorAll('[role="meter"]')].map((m) => m.getAttribute("aria-label")),
    ).toEqual([
      expect.stringMatching(/^Five-hour: 12% used/),
      expect.stringMatching(/^Weekly: 18% used/),
    ])
  })
})
