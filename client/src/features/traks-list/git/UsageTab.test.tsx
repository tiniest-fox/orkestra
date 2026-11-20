/**
 * Tier 2: the phone dock's one usage tab. One CLI keeps the single-CLI layout; two draw a
 * row each, with the mark, meter, percentage and polling dot, or a dashed track and `—`
 * where a CLI is not read. A stale row dims alone, and the whole tab dims when every row is
 * stale. The sheet it opens lists every CLI.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { CliUsageDto } from "../../../api/types"
import { makeCliUsage } from "../../../fixtures"
import UsageSheet from "./UsageSheet"
import UsageTab from "./UsageTab"

afterEach(cleanup)

const H = 3_600_000

/** A reading `age` old, five-hour window at `used`. */
const read = (cli: CliUsageDto["cli"], used: number, age: number, polling = false) => {
  const at = Date.now() - age
  return makeCliUsage({
    cli,
    polling,
    usage: {
      _tag: "Read",
      at,
      windows: [
        { kind: "five_hour", utilization: used, resetsAt: at + 4 * H },
        { kind: "seven_day", utilization: 10, resetsAt: at + 96 * H },
      ],
    },
  })
}

const tab = (): HTMLElement => screen.getByRole("button", { name: /usage$/ })
const rowsOf = (button: HTMLElement): readonly Element[] => [
  ...(button.firstElementChild?.children ?? []),
]

describe("UsageTab", () => {
  it("draws one CLI as the single-CLI tab, with its window's short name", () => {
    render(<UsageTab usage={[read("claude", 46, 60_000)]} onClick={() => undefined} />)
    expect(tab().getAttribute("aria-label")).toBe("Claude usage")
    expect(tab().textContent).toBe("5h46%")
  })

  it("draws a row per CLI, Claude first, each with its own meter, figure and polling dot", () => {
    render(
      <UsageTab
        usage={[read("claude", 46, 60_000, true), read("codex", 81, 60_000)]}
        onClick={() => undefined}
      />,
    )
    expect(tab().getAttribute("aria-label")).toBe("Claude and Codex usage")
    const rows = rowsOf(tab())
    expect(rows.map((row) => row.textContent)).toEqual(["46%", "81%"])
    expect(rows[0]?.querySelector('[role="meter"]')).toBeTruthy()
    expect(rows[0]?.querySelector('[aria-label="polling"]')).toBeTruthy()
    expect(rows[1]?.querySelector('[aria-label="polling"]')).toBeNull()
  })

  it("draws a CLI not yet read as a dashed track and a dash", () => {
    render(
      <UsageTab
        usage={[read("claude", 46, 60_000), makeCliUsage({ cli: "codex" })]}
        onClick={() => undefined}
      />,
    )
    const codex = rowsOf(tab())[1]
    expect(codex?.querySelector('[role="meter"]')).toBeNull()
    expect(codex?.querySelector('[aria-label="Not read"]')).toBeTruthy()
    expect(codex?.textContent).toBe("—")
  })

  it("dims a stale row alone, and the whole tab only when every row is stale", () => {
    render(
      <UsageTab
        usage={[read("claude", 46, 60_000, true), read("codex", 12, 3 * H)]}
        onClick={() => undefined}
      />,
    )
    expect(tab().className).not.toContain("opacity-50")
    expect(rowsOf(tab()).map((row) => row.className.includes("opacity-50"))).toEqual([false, true])
    cleanup()
    render(
      <UsageTab
        usage={[read("claude", 58, 3 * H), read("codex", 12, 3 * H)]}
        onClick={() => undefined}
      />,
    )
    expect(tab().className).toContain("opacity-50")
    expect(rowsOf(tab()).some((row) => row.className.includes("opacity-50"))).toBe(false)
  })

  it("draws no tab where no CLI is named", () => {
    render(<UsageTab usage={[]} onClick={() => undefined} />)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("opens a sheet listing every CLI, the tick taught once", () => {
    let opened = false
    const usage = [read("claude", 46, 60_000), makeCliUsage({ cli: "codex" })]
    render(
      <UsageTab
        usage={usage}
        onClick={() => {
          opened = true
        }}
      />,
    )
    fireEvent.click(tab())
    expect(opened).toBe(true)
    cleanup()
    render(<UsageSheet usage={usage} onClose={() => undefined} />)
    const sheet = screen.getByRole("dialog", { name: "Claude and Codex usage" })
    expect(sheet.textContent).toContain("Claude usage")
    expect(sheet.textContent).toContain("The first reading comes with the first Codex turn.")
    expect(sheet.textContent.match(/Tick is the share/g)).toHaveLength(1)
  })
})
