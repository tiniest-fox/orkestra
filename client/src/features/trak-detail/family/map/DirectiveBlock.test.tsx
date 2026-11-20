import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Hammer } from "lucide-react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { makeDetail } from "../../../../fixtures"
import type { Spot } from "../family"
import type { MapRow } from "../rows"
import DirectiveBlock from "./DirectiveBlock"

afterEach(cleanup)

const spot = (over: Partial<MapRow> = {}): Spot => ({
  key: "1",
  trak: makeDetail({ id: "p" }),
  row: {
    key: "1",
    at: 1,
    kind: "step",
    status: "running",
    tone: "working",
    mark: Hammer,
    title: "builder",
    caption: "Replace the deck with the strip",
    pieces: undefined,
    sha: undefined,
    turns: [],
    atGate: undefined,
    handUp: undefined,
    outstanding: 0,
    continues: undefined,
    model: undefined,
    window: undefined,
    effort: undefined,
    badge: undefined,
    waiting: undefined,
    ...over,
  },
})

const draw = (at: Spot, prev?: string, next?: string) => {
  const onStep = vi.fn<(to: string) => void>()
  render(<DirectiveBlock bands={[]} parent="p" spot={at} prev={prev} next={next} onStep={onStep} />)
  return onStep
}

describe("DirectiveBlock", () => {
  it("steps with its arrows, and disables the one with nowhere to go", () => {
    const onStep = draw(spot(), "0", undefined)
    fireEvent.click(screen.getByRole("button", { name: "Previous step" }))
    expect(onStep).toHaveBeenCalledWith("0")
    expect(screen.getByRole("button", { name: "Next step" })).toBeDisabled()
  })

  it("is one row with no state words, the instruction on it and the name behind it", () => {
    draw(spot({ outstanding: 3 }))
    expect(screen.queryByText("Running")).toBeNull()
    expect(screen.queryByText("3 still running")).toBeNull()
    expect(screen.queryByText("builder")).toBeNull()
  })

  it("shows the name on the row where there is no instruction", () => {
    draw(spot({ caption: "" }))
    expect(screen.getByRole("button", { name: "builder" })).toBeInTheDocument()
  })

  it("opens the instruction in place on a press", () => {
    draw(spot())
    const press = screen.getByRole("button", { name: "Replace the deck with the strip" })
    expect(press).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(press)
    expect(press).toHaveAttribute("aria-expanded", "true")
    // The name, and the whole instruction under it as well as on the row.
    expect(screen.getByText("builder")).toBeInTheDocument()
    expect(screen.getAllByText("Replace the deck with the strip")).toHaveLength(2)
  })
})
